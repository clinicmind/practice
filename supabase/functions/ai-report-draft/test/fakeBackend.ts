/**
 * A stand-in for Supabase (auth, PostgREST), the public content site and Google Drive, as one `fetch`,
 * plus a fake `LlmClient`. It models only the calls the function makes. Row level security is modelled by `visible`:
 * the real rules are tested against Postgres in supabase/tests/aiReportDraft.test.ts. All data is fictional.
 * No real request is ever made.
 */
import { LlmError, REPORT_DIMENSIONS, type LlmClient, type LlmRequest, type LlmResult } from '../../../../packages/ai-feedback/src';

export type Calls = { url: string; method: string; headers: Record<string, string>; body: string }[];

export const ENV = {
  SUPABASE_URL: 'https://proj.supabase.test',
  SUPABASE_ANON_KEY: 'anon-key-fiction',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key-fiction',
  SITE_URL: 'https://site.test',
  GOOGLE_CLIENT_ID: 'client-id-fiction',
  GOOGLE_CLIENT_SECRET: 'client-secret-fiction',
  GOOGLE_REFRESH_TOKEN: 'refresh-token-fiction',
};

export const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const S1 = id(1), S2 = id(2), A = id(11), B = id(12), X = id(21);
export const C1 = id(101), C2 = id(102);
export const R_A = id(401), R_A2 = id(402), R_B = id(403), R_X = id(404), R_GONE = id(405);
export const TOKENS: Record<string, string> = { 'tok-S1': S1, 'tok-S2': S2, 'tok-A': A, 'tok-B': B, 'tok-X': X };

/** A marker that must never appear anywhere except in the model request and the Drive read. */
export const MARK = 'ZZ-REPORT-MARKER-91f3';
export const REPORT_TEXT = `The trainee describes the first session in detail. The client arrived late and spoke quietly about work. ${MARK} The trainee then wrote about what they noticed in themselves and what they would do next time. `.repeat(2);

type Report = { id: string; user_id: string; drive_file_id: string };
type Fb = { id: string; report_id: string; author_id: string | null; ai_draft: boolean; scores: unknown; comments: string; status: string; created_at: string };
type Usage = { id: string; user_id: string; cohort_id: string | null; subject_id: string | null; kind: string; model: string; prompt_version: string | null; input_tokens: number; output_tokens: number; cache_write_tokens: number; cache_read_tokens: number; cost_usd: number; outcome: string; counted: boolean; created_at: string };

export class FakeBackend {
  calls: Calls = [];
  now = '2026-11-23T10:00:00.000Z';
  profiles: Record<string, { role: string; cohort_id: string | null }> = {
    [A]: { role: 'student', cohort_id: C1 }, [B]: { role: 'student', cohort_id: C1 }, [X]: { role: 'student', cohort_id: C2 },
    [S1]: { role: 'supervisor', cohort_id: null }, [S2]: { role: 'supervisor', cohort_id: null },
  };
  cohorts: Record<string, { ai_enabled: boolean; supervisor_id: string }> = {
    [C1]: { ai_enabled: true, supervisor_id: S1 }, [C2]: { ai_enabled: true, supervisor_id: S2 },
  };
  reports: Report[] = [
    { id: R_A, user_id: A, drive_file_id: 'drive-a' }, { id: R_A2, user_id: A, drive_file_id: 'drive-a2' },
    { id: R_B, user_id: B, drive_file_id: 'drive-b' }, { id: R_X, user_id: X, drive_file_id: 'drive-x' },
    { id: R_GONE, user_id: B, drive_file_id: 'drive-gone' },
  ];
  /** Drive files by id. A file that is not here answers 404; `trashed` models the Drive bin. */
  files = new Map<string, { text: string; trashed: boolean }>([
    ['drive-a', { text: REPORT_TEXT, trashed: false }], ['drive-a2', { text: REPORT_TEXT, trashed: false }],
    ['drive-b', { text: REPORT_TEXT, trashed: false }], ['drive-x', { text: REPORT_TEXT, trashed: false }],
  ]);
  feedback: Fb[] = [];
  usage: Usage[] = [];
  budget: { monthly_limit_usd: number }[] = [{ monthly_limit_usd: 5 }];
  site = new Map<string, unknown>();
  siteDown = false;
  driveToken: 'ok' | 'invalid_grant' = 'ok';
  failUsageInsert = false;
  failFeedbackWrite = false;
  private seq = 1000;

  constructor() {
    const dims = Object.fromEntries(REPORT_DIMENSIONS.map((d) => [d, { name: `Name of ${d}`, levels: [1, 2, 3, 4].map((n) => `${d} level ${n} (fictional)`) }]));
    this.site.set('/content/en/report-rubric.json', { reviewed: true, dimensions: dims });
    this.site.set('/content/zh-Hant/report-rubric.json', { reviewed: true, dimensions: dims });
  }

  fetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const headers = Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    const body = typeof init.body === 'string' ? init.body : init.body instanceof URLSearchParams ? init.body.toString() : '';
    const method = init.method ?? 'GET';
    this.calls.push({ url: url.href, method, headers, body });
    const json = (status: number, v: unknown) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } });
    if (url.host === 'proj.supabase.test') return this.supabase(url, method, headers, body, json);
    if (url.host === 'site.test') {
      if (this.siteDown) return json(503, {});
      const v = this.site.get(url.pathname);
      return v === undefined ? json(404, {}) : json(200, v);
    }
    if (url.host === 'oauth2.googleapis.com') return this.driveToken === 'ok' ? json(200, { access_token: 'access-token-fiction' }) : json(400, { error: 'invalid_grant' });
    if (url.host === 'www.googleapis.com') return this.google(url, headers, json);
    throw new Error(`unexpected host ${url.host}`);
  };

  /** Requests that went anywhere except Supabase. */
  outsideSupabase = () => this.calls.filter((c) => new URL(c.url).host !== 'proj.supabase.test');
  touched = () => this.calls.filter((c) => new URL(c.url).host === 'proj.supabase.test').map((c) => `${c.method} ${new URL(c.url).pathname.replace('/rest/v1/', '').replace('/auth/v1/', 'auth/')}`);

  private google(url: URL, h: Record<string, string>, json: (s: number, v: unknown) => Response) {
    if (h.authorization !== 'Bearer access-token-fiction') return json(401, {});
    const m = /^\/drive\/v3\/files\/(.+)$/.exec(url.pathname);
    const f = m ? this.files.get(decodeURIComponent(m[1]!)) : undefined;
    if (!f) return json(404, { error: { errors: [{ reason: 'notFound' }] } });
    return url.searchParams.get('alt') === 'media' ? new Response(f.text, { status: 200 }) : json(200, { trashed: f.trashed });
  }

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
    const page = <T,>(rows: T[]): T[] => { const off = Number(q('offset') ?? 0), lim = Number(q('limit') ?? 1000); return rows.slice(off, off + Math.min(lim, 1000)); };
    const supervises = (owner: string) => this.cohorts[this.profiles[owner]?.cohort_id ?? '']?.supervisor_id === uid;

    if (table === 'profiles' && method === 'GET') { const p = this.profiles[eq('id') ?? '']; return json(200, p ? [p] : []); }
    if (table === 'cohorts' && method === 'GET') { const c = this.cohorts[eq('id') ?? '']; return json(200, c ? [{ ai_enabled: c.ai_enabled }] : []); }
    if (table === 'ai_budget' && method === 'GET') return json(200, this.budget);

    if (table === 'reports' && method === 'GET') {
      const visible = (r: Report) => asService || r.user_id === uid || supervises(r.user_id); // row level security
      return json(200, this.reports.filter((r) => visible(r) && (!eq('id') || r.id === eq('id'))));
    }

    if (table === 'feedback') {
      if (!asService) return json(403, { message: 'permission denied' });
      if (method === 'GET') return json(200, this.feedback.filter((f) => (!eq('report_id') || f.report_id === eq('report_id')) && (eq('ai_draft') === undefined || String(f.ai_draft) === eq('ai_draft'))));
      if (this.failFeedbackWrite) return json(500, { message: 'boom' });
      if (method === 'POST') {
        const r = JSON.parse(body) as Partial<Fb> & { report_id: string };
        if (r.ai_draft && this.feedback.some((f) => f.report_id === r.report_id && f.ai_draft)) return json(409, { code: '23505', message: 'duplicate key' });
        const row = { id: id(this.seq++), created_at: this.now, status: 'draft', ...r } as Fb;
        this.feedback.push(row);
        return json(201, [row]);
      }
      if (method === 'PATCH') {
        const f = this.feedback.find((x) => x.id === eq('id') && (eq('ai_draft') === undefined || String(x.ai_draft) === eq('ai_draft')));
        if (f) Object.assign(f, JSON.parse(body));
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
        if (eq('kind')) hit = hit.filter((u) => u.kind === eq('kind'));
        if (eq('subject_id')) hit = hit.filter((u) => u.subject_id === eq('subject_id'));
        if (eq('counted')) hit = hit.filter((u) => String(u.counted) === eq('counted'));
        if (gte('created_at')) hit = hit.filter((u) => u.created_at >= gte('created_at')!);
        return json(200, page(hit));
      }
    }
    return json(404, { message: `fake: no route ${method} ${table}` });
  }
}

export const GOOD = {
  scores: { picture: 3, formulation: 2, link: 3, process: 4, self: 2, ethics: 3 },
  comments: '這份報告清楚描述了第一次會談，下一步可以多寫你對自己反應的觀察。',
  notes: [{ dimension: 'picture', quote: 'The client arrived late and spoke quietly about work.' }],
};

export const okResult = (output: unknown = GOOD, usage = { input: 14_000, output: 900, cacheWrite: 0, cacheRead: 1_200 }): LlmResult => ({ stopReason: 'end_turn', text: JSON.stringify(output), usage });

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
