import {
  buildPracticeRequest, checkOutput, checkPromptSize, claimAction, costUsd, decide, guardInput, LIMITS, LlmError, MODELS, PROMPT_VERSION,
  requestSettings, roundUsd, rollingWindowStart,
  type DecideReason, type FeedbackOutput, type LlmClient, type LlmResult, type Locale,
} from '../../../../packages/ai-feedback/src';
import { loadDrill, type FetchFn } from './content';

/**
 * The `ai-feedback` Edge Function: practice feedback after a self-rating, and reading a stored result.
 *
 * Order of work (a step that fails stops everything after it; the model is the last thing called):
 *   1 the token, 2 student with a cohort and that cohort's switch (`ai_enabled`: off ends here, before any
 *   request to the content site or the model), 3 the attempt, read with the CALLER's token so row level
 *   security decides if it exists for them, 4 an already stored result is returned as it is,
 *   5 the input guard, 6 limits and budget, 7 claim the attempt, 8 content, 9 the model, 10 check the output,
 *   11 store it.
 *
 * Idempotency: the unique `ai_feedback.attempt_id` plus a 'pending' row claimed before the call
 * (see `claimAction` in packages/ai-feedback/src/limits.ts). A failed or discarded call removes its pending row.
 * Writes are service role only; students have no write policy anywhere.
 *
 * The student's response is read from the database, never from the request. Nothing here logs, no response echoes
 * the student's text, the model's raw output or a secret, and `ai_usage` holds numbers and labels only.
 */
export type Env = { SUPABASE_URL?: string; SUPABASE_ANON_KEY?: string; SUPABASE_SERVICE_ROLE_KEY?: string; SITE_URL?: string };
export type Deps = { fetchFn: FetchFn; llm: LlmClient; now?: () => Date; nonce: () => string };

const MAX_REQUEST_BYTES = 4_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE = 1000; // PostgREST's page size; a longer list has to be read page by page or it is silently cut
const MAX_PAGES = 100;

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const fail = (status: number, error: string) => reply(status, { error });

const LIMIT_ERROR: Record<DecideReason, string> = {
  disabled: 'ai_disabled', budget_unset: 'budget_exhausted', budget_exhausted: 'budget_exhausted',
  daily_cap: 'daily_cap', item_cap: 'item_cap', weekly_cap: 'daily_cap',
};

export async function handleRequest(req: Request, env: Env, deps: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return fail(405, 'method_not_allowed');
  try {
    return await route(req, env, deps);
  } catch {
    return fail(500, 'server_error'); // no detail: the cause could contain the student's text or a key
  }
}

type Stored = { id: string; status: 'pending' | 'done'; output: FeedbackOutput | null; created_at: string };

async function route(req: Request, env: Env, deps: Deps): Promise<Response> {
  const { SUPABASE_URL: url, SUPABASE_ANON_KEY: anon, SUPABASE_SERVICE_ROLE_KEY: service } = env;
  if (!url || !anon || !service) return fail(500, 'server_error');
  const { fetchFn, llm } = deps;
  const now = deps.now ?? (() => new Date());

  const token = /^Bearer (.+)$/.exec(req.headers.get('Authorization') ?? '')?.[1];
  if (!token) return fail(401, 'unauthorized');

  const raw = await req.text();
  if (raw.length > MAX_REQUEST_BYTES) return fail(413, 'bad_request');
  let input: Record<string, unknown>;
  try {
    const parsed = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return fail(400, 'bad_request');
    input = parsed as Record<string, unknown>;
  } catch {
    return fail(400, 'bad_request');
  }
  const action = input.action;
  const attemptId = input.attempt_id;
  if ((action !== 'practice' && action !== 'get') || typeof attemptId !== 'string' || !UUID.test(attemptId)) return fail(400, 'bad_request');
  if (input.locale !== undefined && input.locale !== 'en' && input.locale !== 'zh-Hant') return fail(400, 'bad_request');
  const locale: Locale = input.locale === 'zh-Hant' ? 'zh-Hant' : 'en';

  // 1. Who is asking. Auth answers for the token itself; nothing in the token is trusted before that.
  const who = await fetchFn(`${url}/auth/v1/user`, { headers: { apikey: anon, Authorization: `Bearer ${token}` } });
  if (!who.ok) return fail(401, 'unauthorized');
  const userId = ((await who.json().catch(() => null)) as { id?: string } | null)?.id;
  if (!userId || !UUID.test(userId)) return fail(401, 'unauthorized');

  const rest = (key: string, path: string, init: RequestInit = {}) =>
    fetchFn(`${url}/rest/v1/${path}`, { ...init, headers: { apikey: anon, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(init.headers as Record<string, string>) } });
  const asService = (path: string, init?: RequestInit) => rest(service, path, init);
  const asUser = (path: string, init?: RequestInit) => rest(token, path, init);
  const readJson = async <T>(r: Response): Promise<T | null> => (r.ok ? ((await r.json().catch(() => null)) as T | null) : null);

  // 2. A student with a cohort whose switch is on.
  const profiles = await readJson<{ role: string; cohort_id: string | null }[]>(await asService(`profiles?id=eq.${userId}&select=role,cohort_id`));
  if (!profiles) return fail(500, 'server_error');
  const profile = profiles[0];
  if (!profile || profile.role !== 'student' || !profile.cohort_id) return fail(403, 'not_allowed');
  const cohorts = await readJson<{ ai_enabled: boolean }[]>(await asService(`cohorts?id=eq.${profile.cohort_id}&select=ai_enabled`));
  if (!cohorts?.[0]) return fail(500, 'server_error');
  if (cohorts[0].ai_enabled !== true) return fail(403, 'ai_disabled'); // nothing has been sent anywhere

  // 3. The attempt, through the caller's own token. Not visible to them: 404, whatever the reason.
  const attempts = await readJson<{ id: string; user_id: string; item_id: string; response: string }[]>(
    await asUser(`attempts?id=eq.${attemptId}&select=id,user_id,item_id,response`),
  );
  if (!attempts) return fail(500, 'server_error');
  const attempt = attempts[0];
  if (!attempt || attempt.user_id !== userId) return fail(404, 'not_found');

  // 4. A stored result.
  const existing = async (): Promise<Stored | null> => {
    const rows = await readJson<Stored[]>(await asService(`ai_feedback?attempt_id=eq.${attemptId}&select=id,status,output,created_at`));
    if (!rows) throw new Error('read_failed');
    return rows[0] ?? null;
  };
  const answer = (output: FeedbackOutput, useLocale: Locale): Response => {
    if (output.concern !== 'none') return reply(200, { status: 'concern', concern: output.concern });
    const checked = checkOutput(output, attempt.response, useLocale);
    return reply(200, { status: 'ok', output, warnings: checked.ok ? checked.warnings : [] });
  };
  const stored = await existing();
  if (stored?.status === 'done' && stored.output) return answer(stored.output, locale);
  if (action === 'get') return reply(200, { status: 'none' });

  // 5. The input guard.
  const nonce = deps.nonce();
  const guard = guardInput(attempt.response, nonce);
  if (!guard.ok) return guard.reason === 'too_short' ? fail(400, 'input_too_short') : guard.reason === 'too_long' ? fail(400, 'input_too_long') : fail(400, 'input_rejected');

  // 6. Limits and budget, decided before the call, not after.
  const t = now();
  const spent = await sumSpending(asService, monthStart(t));
  const usedToday = await readJson<{ id: string }[]>(
    await asService(`ai_usage?user_id=eq.${userId}&counted=eq.true&created_at=gte.${encodeURIComponent(rollingWindowStart(t, 'day'))}&select=id`),
  );
  const sameItem = await sameItemToday(asService, userId, attempt.item_id, rollingWindowStart(t, 'day'));
  const budgetRows = await readJson<{ monthly_limit_usd: number | string }[]>(await asService('ai_budget?select=monthly_limit_usd'));
  if (spent === null || !usedToday || sameItem === null || !budgetRows) return fail(500, 'server_error');
  const limit = budgetRows[0] ? Number(budgetRows[0].monthly_limit_usd) : null;
  const verdict = decide(
    { enabled: true, usedToday: usedToday.length, dailyCap: LIMITS.practicePerDay, sameItemToday: sameItem, itemCap: LIMITS.itemPerDay, monthSpent: spent, monthLimit: limit },
    'practice',
  );
  if (!verdict.allow) return fail(429, LIMIT_ERROR[verdict.reason]);

  // 7. Claim the attempt. The unique attempt_id lets exactly one request through.
  const claim = async (): Promise<'claimed' | 'in_progress' | 'done'> => {
    const ins = await asService('ai_feedback', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ attempt_id: attemptId, status: 'pending' }) });
    if (ins.ok) return 'claimed';
    if (ins.status !== 409) throw new Error('claim_failed');
    const row = await existing();
    switch (claimAction(row ? { status: row.status, createdAt: row.created_at } : null, t)) {
      case 'return_done': return 'done';
      case 'reclaim': {
        await asService(`ai_feedback?id=eq.${row!.id}&status=eq.pending`, { method: 'DELETE' });
        const again = await asService('ai_feedback', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ attempt_id: attemptId, status: 'pending' }) });
        return again.ok ? 'claimed' : 'in_progress';
      }
      default: return 'in_progress';
    }
  };
  const claimed = await claim();
  if (claimed === 'in_progress') return fail(409, 'in_progress');
  if (claimed === 'done') {
    const row = await existing();
    return row?.output ? answer(row.output, locale) : fail(409, 'in_progress');
  }
  const release = () => asService(`ai_feedback?attempt_id=eq.${attemptId}&status=eq.pending`, { method: 'DELETE' }).catch(() => null);
  const recordUsage = async (outcome: 'ok' | 'invalid' | 'refusal' | 'error', counted: boolean, result: LlmResult | null): Promise<boolean> => {
    let cost = 0;
    try { cost = result ? roundUsd(costUsd(MODELS.practice, result.usage)) : 0; } catch { cost = 0; }
    const u = result?.usage;
    const res = await asService('ai_usage', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        user_id: userId, cohort_id: profile.cohort_id, kind: 'practice', model: MODELS.practice, prompt_version: PROMPT_VERSION,
        input_tokens: u?.input ?? 0, output_tokens: u?.output ?? 0, cache_write_tokens: u?.cacheWrite ?? 0, cache_read_tokens: u?.cacheRead ?? 0,
        cost_usd: cost, outcome, counted,
      }),
    }).catch(() => null);
    return !!res?.ok;
  };
  const unavailable = async (outcome: 'invalid' | 'refusal' | 'error', result: LlmResult | null): Promise<Response> => {
    await recordUsage(outcome, false, result);
    await release();
    return fail(502, 'unavailable');
  };

  try {
    // 8. Content.
    if (!env.SITE_URL) throw new Error('no_site');
    const drill = await loadDrill(env.SITE_URL, fetchFn, attempt.item_id, locale);
    if (!drill) throw new Error('no_content');

    // 9. The model.
    const request = buildPracticeRequest({
      locale: drill.locale, context: drill.context, client: drill.client, criteria: drill.criteria,
      modelResponse: drill.modelResponse, studentResponse: attempt.response, nonce,
    });
    if (!checkPromptSize(request).ok) return await unavailable('error', null);
    let result: LlmResult;
    try {
      result = await llm.complete(request);
    } catch (e) {
      if (e instanceof LlmError || e instanceof Error) return await unavailable('error', null); // whatever it was, no detail goes on
      throw e;
    }

    // 10. Only a finished answer is read; refusals, cut-offs and the rest are dropped.
    if (result.stopReason === 'refusal') return await unavailable('refusal', result);
    if (result.stopReason !== 'end_turn' || result.text === null) return await unavailable('error', result);
    let parsed: unknown;
    try { parsed = JSON.parse(result.text); } catch { return await unavailable('invalid', result); }
    const checked = checkOutput(parsed, attempt.response, drill.locale);
    if (!checked.ok) return await unavailable('invalid', result);

    // 11. Store. The spending is written first: it must never be invisible.
    if (!(await recordUsage('ok', true, result))) { await release(); return fail(500, 'server_error'); }
    const done = await asService(`ai_feedback?attempt_id=eq.${attemptId}&status=eq.pending`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ status: 'done', model: MODELS.practice, prompt_version: PROMPT_VERSION, settings: requestSettings(request), output: checked.value }),
    });
    if (!done.ok) { await release(); return fail(500, 'server_error'); }
    if (checked.value.concern !== 'none') return reply(200, { status: 'concern', concern: checked.value.concern });
    return reply(200, { status: 'ok', output: checked.value, warnings: checked.warnings });
  } catch {
    await release();
    return fail(500, 'server_error');
  }
}

export function monthStart(t: Date): string {
  return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 1)).toISOString();
}

/**
 * The month's spending, every row, page by page. Reading only the first page would under-count and let spending
 * continue past the limit, so too many pages is reported as "unknown" (null) and the request is refused.
 */
export async function sumSpending(asService: (p: string, i?: RequestInit) => Promise<Response>, since: string): Promise<number | null> {
  let total = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const r = await asService(`ai_usage?created_at=gte.${encodeURIComponent(since)}&select=cost_usd&order=id.asc&limit=${PAGE}&offset=${page * PAGE}`);
    if (!r.ok) return null;
    const rows = (await r.json().catch(() => null)) as { cost_usd: number | string }[] | null;
    if (!rows) return null;
    for (const row of rows) {
      const n = Number(row.cost_usd);
      if (!Number.isFinite(n)) return null;
      total += n;
    }
    if (rows.length < PAGE) return total;
  }
  return null;
}

/** How many finished feedbacks this student already got on this drill in the window. */
async function sameItemToday(asService: (p: string, i?: RequestInit) => Promise<Response>, userId: string, itemId: string, since: string): Promise<number | null> {
  const a = await asService(`attempts?user_id=eq.${userId}&item_id=eq.${encodeURIComponent(itemId)}&select=id`);
  if (!a.ok) return null;
  const ids = ((await a.json().catch(() => null)) as { id: string }[] | null)?.map((x) => x.id);
  if (!ids) return null;
  if (ids.length === 0) return 0;
  const f = await asService(`ai_feedback?attempt_id=in.(${ids.join(',')})&status=eq.done&created_at=gte.${encodeURIComponent(since)}&select=id`);
  if (!f.ok) return null;
  const rows = (await f.json().catch(() => null)) as unknown[] | null;
  return rows ? rows.length : null;
}
