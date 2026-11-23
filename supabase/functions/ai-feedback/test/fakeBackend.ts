/**
 * A stand-in for Supabase (auth, PostgREST) and the public content site, as one `fetch`, plus a fake `LlmClient`.
 * It models only the calls the function makes. Row level security is modelled by `visible`: the real rules are
 * tested against Postgres in supabase/tests/aiFeedback.test.ts. All data is fictional. No real request is ever made.
 */
import { LlmError, type LlmClient, type LlmRequest, type LlmResult } from '../../../../packages/ai-feedback/src';

export type Calls = { url: string; method: string; headers: Record<string, string>; body: string }[];

export const ENV = {
  SUPABASE_URL: 'https://proj.supabase.test',
  SUPABASE_ANON_KEY: 'anon-key-fiction',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key-fiction',
  SITE_URL: 'https://site.test',
};

export const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const S1 = id(1), A = id(11), B = id(12), X = id(21), NOCOH = id(31);
export const C1 = id(101), C2 = id(102);
export const TOKENS: Record<string, string> = { 'tok-A': A, 'tok-B': B, 'tok-X': X, 'tok-S1': S1, 'tok-N': NOCOH };
export const ATT_A = id(201), ATT_B = id(202), ATT_X = id(203);

export const ITEM = 'alliance-e01';
export const RESPONSE = '聽起來你這幾週真的很累。是什麼讓你覺得撐不下去了？我想先了解你最近睡得怎麼樣。';
export const DRILL = {
  id: ITEM, level: 'easy', skill: 'reflection-of-feeling', context: 'Second session (fictional).', client: 'I am so tired of all of it.',
  criteria: ['Names a feeling.', 'Offered tentatively.', 'Short, no question.'],
};

type Attempt = { id: string; user_id: string; item_id: string; response: string; criteria_met: boolean[] };
type Fb = { id: string; attempt_id: string; status: 'pending' | 'done'; model?: string; prompt_version?: string; settings?: unknown; output?: unknown; created_at: string };
type Usage = { id: string; user_id: string; cohort_id: string | null; kind: string; model: string; prompt_version: string | null; input_tokens: number; output_tokens: number; cache_write_tokens: number; cache_read_tokens: number; cost_usd: number; outcome: string; counted: boolean; created_at: string };

export class FakeBackend {
  calls: Calls = [];
  now = '2026-11-23T10:00:00.000Z';
  profiles: Record<string, { role: string; cohort_id: string | null }> = {
    [A]: { role: 'student', cohort_id: C1 }, [B]: { role: 'student', cohort_id: C1 }, [X]: { role: 'student', cohort_id: C2 },
    [S1]: { role: 'supervisor', cohort_id: null }, [NOCOH]: { role: 'student', cohort_id: null },
  };
  cohorts: Record<string, { ai_enabled: boolean; supervisor_id: string }> = {
    [C1]: { ai_enabled: true, supervisor_id: S1 }, [C2]: { ai_enabled: true, supervisor_id: S1 },
  };
  attempts: Attempt[] = [
    { id: ATT_A, user_id: A, item_id: ITEM, response: RESPONSE, criteria_met: [true, true, false] },
    { id: ATT_B, user_id: B, item_id: ITEM, response: RESPONSE, criteria_met: [true, true, false] },
    { id: ATT_X, user_id: X, item_id: ITEM, response: RESPONSE, criteria_met: [true, true, false] },
  ];
  feedback: Fb[] = [];
  usage: Usage[] = [];
  budget: { monthly_limit_usd: number }[] = [{ monthly_limit_usd: 5 }];
  /** Content site. A path that is not here answers 404. */
  site = new Map<string, unknown>();
  siteDown = false;
  failUsageInsert = false;
  private seq = 1000;

  constructor() {
    this.site.set('/content/en/stages.json', [{ stage: 'foundations', title: 'Foundations' }, { stage: 'eft', title: 'EFT' }]);
    this.site.set('/content/en/foundations/alliance/module.json', { meta: {}, sessions: [], drills: [DRILL] });
    this.site.set('/content/en/foundations/alliance/models.json', { [ITEM]: { model_response: 'You felt worn out.', why: 'w', avoid: 'a' } });
    this.site.set('/content/zh-Hant/stages.json', [{ stage: 'foundations', title: '基礎' }]);
  }

  fetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const headers = Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    const body = typeof init.body === 'string' ? init.body : '';
    const method = init.method ?? 'GET';
    this.calls.push({ url: url.href, method, headers, body });
    const json = (status: number, v: unknown) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } });
    if (url.host === 'proj.supabase.test') return this.supabase(url, method, headers, body, json);
    if (url.host === 'site.test') {
      if (this.siteDown) return json(503, {});
      const v = this.site.get(url.pathname);
      return v === undefined ? json(404, {}) : json(200, v);
    }
    throw new Error(`unexpected host ${url.host}`);
  };

  /** Requests that went anywhere except Supabase. */
  outsideSupabase = () => this.calls.filter((c) => new URL(c.url).host !== 'proj.supabase.test');
  /** PostgREST tables the function touched, as "METHOD table". */
  touched = () => this.calls.filter((c) => new URL(c.url).host === 'proj.supabase.test').map((c) => `${c.method} ${new URL(c.url).pathname.replace('/rest/v1/', '').replace('/auth/v1/', 'auth/')}`);

  private supabase(url: URL, method: string, h: Record<string, string>, body: string, json: (s: number, v: unknown) => Response) {
    const bearer = (h.authorization ?? '').replace(/^Bearer /, '');
    if (url.pathname === '/auth/v1/user') {
      const uid = TOKENS[bearer];
      return uid ? json(200, { id: uid }) : json(401, { msg: 'invalid' });
    }
    const asService = bearer === ENV.SUPABASE_SERVICE_ROLE_KEY;
    const uid = asService ? null : TOKENS[bearer];
    if (!asService && !uid) return json(401, { message: 'invalid jwt' });
    const table = url.pathname.replace('/rest/v1/', '');
    const q = (col: string) => url.searchParams.get(col) ?? undefined;
    const eq = (col: string) => { const v = q(col); return v?.startsWith('eq.') ? v.slice(3) : undefined; };
    const gte = (col: string) => { const v = q(col); return v?.startsWith('gte.') ? v.slice(4) : undefined; };
    const page = <T,>(rows: T[]): T[] => {
      const off = Number(q('offset') ?? 0), lim = Number(q('limit') ?? 1000);
      return rows.slice(off, off + Math.min(lim, 1000)); // PostgREST caps a page at 1000 rows
    };

    if (table === 'profiles' && method === 'GET') { const p = this.profiles[eq('id') ?? '']; return json(200, p ? [p] : []); }
    if (table === 'cohorts' && method === 'GET') { const c = this.cohorts[eq('id') ?? '']; return json(200, c ? [{ ai_enabled: c.ai_enabled }] : []); }
    if (table === 'ai_budget' && method === 'GET') return json(200, this.budget);

    if (table === 'attempts' && method === 'GET') {
      const visible = (a: Attempt) => asService || a.user_id === uid || (this.cohorts[this.profiles[a.user_id]?.cohort_id ?? '']?.supervisor_id === uid);
      const wantId = eq('id'), wantUser = eq('user_id'), wantItem = eq('item_id');
      return json(200, this.attempts.filter((a) => visible(a) && (!wantId || a.id === wantId) && (!wantUser || a.user_id === wantUser) && (!wantItem || a.item_id === wantItem)));
    }

    if (table === 'ai_feedback') {
      if (!asService) return json(403, { message: 'permission denied' });
      if (method === 'GET') {
        const att = q('attempt_id');
        let hit = this.feedback;
        if (att?.startsWith('eq.')) hit = hit.filter((f) => f.attempt_id === att.slice(3));
        else if (att?.startsWith('in.(')) { const set = att.slice(4, -1).split(','); hit = hit.filter((f) => set.includes(f.attempt_id)); }
        if (eq('status')) hit = hit.filter((f) => f.status === eq('status'));
        if (gte('created_at')) hit = hit.filter((f) => f.created_at >= gte('created_at')!);
        return json(200, hit);
      }
      if (method === 'POST') {
        const r = JSON.parse(body) as { attempt_id: string; status: 'pending' | 'done' };
        if (this.feedback.some((f) => f.attempt_id === r.attempt_id)) return json(409, { code: '23505', message: 'duplicate key' });
        this.feedback.push({ id: id(this.seq++), created_at: this.now, ...r });
        return new Response(null, { status: 201 });
      }
      if (method === 'PATCH') {
        const f = this.feedback.find((x) => x.attempt_id === eq('attempt_id') && (!eq('status') || x.status === eq('status')));
        if (f) Object.assign(f, JSON.parse(body));
        return new Response(null, { status: 204 });
      }
      if (method === 'DELETE') {
        this.feedback = this.feedback.filter((f) => !((!eq('id') || f.id === eq('id')) && (!eq('attempt_id') || f.attempt_id === eq('attempt_id')) && (!eq('status') || f.status === eq('status'))));
        return new Response(null, { status: 204 });
      }
    }

    if (table === 'ai_usage') {
      if (!asService) return json(403, { message: 'permission denied' });
      if (method === 'POST') {
        if (this.failUsageInsert) return json(500, { message: 'boom' });
        this.usage.push({ id: id(this.seq++), created_at: this.now, ...JSON.parse(body) });
        return new Response(null, { status: 201 });
      }
      if (method === 'GET') {
        let hit = this.usage;
        if (eq('user_id')) hit = hit.filter((u) => u.user_id === eq('user_id'));
        if (eq('counted')) hit = hit.filter((u) => String(u.counted) === eq('counted'));
        if (gte('created_at')) hit = hit.filter((u) => u.created_at >= gte('created_at')!);
        return json(200, page(hit));
      }
    }
    return json(404, { message: `fake: no route ${method} ${table}` });
  }
}

export const GOOD = {
  criteria: [
    { met: true, evidence: '聽起來你這幾週真的很累' },
    { met: true, evidence: '是什麼讓你覺得撐不下去了？' },
    { met: false, evidence: '' },
  ],
  suggestion: '可以試試在問睡眠之前，先回應她說的疲累。',
  concern: 'none',
};

export const okResult = (output: unknown = GOOD, usage = { input: 120, output: 80, cacheWrite: 0, cacheRead: 900 }): LlmResult => ({ stopReason: 'end_turn', text: JSON.stringify(output), usage });

/** A fake `LlmClient`. By default it answers GOOD. Set `next` to change the answer; `error` to make it throw. */
export class FakeLlm implements LlmClient {
  calls: LlmRequest[] = [];
  next: LlmResult | ((req: LlmRequest) => LlmResult | Promise<LlmResult>) = okResult();
  error: LlmError | null = null;
  async complete(req: LlmRequest): Promise<LlmResult> {
    this.calls.push(req);
    if (this.error) throw this.error;
    return typeof this.next === 'function' ? this.next(req) : this.next;
  }
}
