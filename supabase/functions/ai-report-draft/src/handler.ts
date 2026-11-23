import {
  buildReportRequest, checkPromptSize, checkReportOutput, costUsd, decide, guardReport, LIMITS, LlmError, MODELS, parseRubric, REPORT_PROMPT_VERSION,
  roundUsd, rollingWindowStart,
  type DecideReason, type LlmClient, type LlmResult, type Locale, type Rubric,
} from '../../../../packages/ai-feedback/src';
import { createDrive, DriveError, type DriveEnv } from '../../reports/src/drive';
import { monthStart, sumSpending } from '../../ai-feedback/src/handler';

/**
 * The `ai-report-draft` Edge Function: a supervisor asks for an AI draft of feedback on a student's report.
 *
 * The draft is a row in `feedback` that no student can ever read and that can never be released (migration 0008).
 * The supervisor reads it, writes their own feedback, and releases THAT. Nothing here publishes anything.
 *
 * Order of work (a step that fails stops everything after it; the model is the last thing called):
 *   1 the token, 2 a supervisor, 3 the report, read with the CALLER's token so row level security decides if it
 *   exists for them, 4 that report's cohort switch (`ai_enabled`: off ends here, before any request to the content
 *   site, Drive or the model), 5 the reviewed rubric (none published: `rubric_unreviewed`), 6 a draft that already
 *   exists is returned as it is (reading costs nothing, so it works even when the budget is spent),
 *   7 limits and budget, 8 the report text from Drive, 9 the guard, 10 the model, 11 check the output,
 *   12 spending recorded, 13 draft stored.
 *
 * The report text lives only in this function's memory, and in the request to the model. It is never logged,
 * never written to `ai_usage`, never in an error body. The draft the supervisor receives is the model's own words.
 * The `notes` (quotes that justify scores) are checked against the report and returned once; they are not stored.
 */
export type Env = DriveEnv & { SUPABASE_URL?: string; SUPABASE_ANON_KEY?: string; SUPABASE_SERVICE_ROLE_KEY?: string; SITE_URL?: string };
export type Deps = { fetchFn: typeof fetch; llm: LlmClient; now?: () => Date; nonce: () => string };

const MAX_REQUEST_BYTES = 2_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DRIVE_STATUS: Record<string, string> = { auth: 'drive_auth', quota: 'drive_quota', unavailable: 'drive_unavailable' };

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const fail = (status: number, error: string) => reply(status, { error });

const LIMIT_ERROR: Record<DecideReason, string> = {
  disabled: 'ai_disabled', budget_unset: 'budget_exhausted', budget_exhausted: 'budget_exhausted',
  daily_cap: 'weekly_cap', item_cap: 'weekly_cap', weekly_cap: 'weekly_cap',
};

export async function handleRequest(req: Request, env: Env, deps: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return fail(405, 'method_not_allowed');
  try {
    return await route(req, env, deps);
  } catch (e) {
    if (e instanceof DriveError) return fail(502, DRIVE_STATUS[e.kind]!);
    return fail(500, 'server_error'); // no detail: the cause could contain the report
  }
}

type StoredDraft = { id: string; scores: unknown; comments: string; created_at: string };

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
  const reportId = input.report_id;
  if (input.action !== 'draft' || typeof reportId !== 'string' || !UUID.test(reportId)) return fail(400, 'bad_request');
  if (input.locale !== undefined && input.locale !== 'en' && input.locale !== 'zh-Hant') return fail(400, 'bad_request');
  if (input.regenerate !== undefined && typeof input.regenerate !== 'boolean') return fail(400, 'bad_request');
  const locale: Locale = input.locale === 'zh-Hant' ? 'zh-Hant' : 'en';
  const regenerate = input.regenerate === true;

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

  // 2. A supervisor. Students are refused here, before anything about the report is read.
  const me = await readJson<{ role: string }[]>(await asService(`profiles?id=eq.${userId}&select=role`));
  if (!me) return fail(500, 'server_error');
  if (me[0]?.role !== 'supervisor') return fail(403, 'not_allowed');

  // 3. The report, through the caller's own token. Not visible to them (another cohort, or not there): 404.
  const reports = await readJson<{ id: string; user_id: string; drive_file_id: string }[]>(await asUser(`reports?id=eq.${reportId}&select=id,user_id,drive_file_id`));
  if (!reports) return fail(500, 'server_error');
  const report = reports[0];
  if (!report) return fail(404, 'not_found');

  // 4. The switch of the cohort the report's owner belongs to.
  const owner = await readJson<{ cohort_id: string | null }[]>(await asService(`profiles?id=eq.${report.user_id}&select=role,cohort_id`));
  const cohortId = owner?.[0]?.cohort_id;
  if (!owner) return fail(500, 'server_error');
  if (!cohortId) return fail(403, 'ai_disabled');
  const cohorts = await readJson<{ ai_enabled: boolean }[]>(await asService(`cohorts?id=eq.${cohortId}&select=ai_enabled`));
  if (!cohorts?.[0]) return fail(500, 'server_error');
  if (cohorts[0].ai_enabled !== true) return fail(403, 'ai_disabled'); // nothing has been sent anywhere

  // 5. The reviewed rubric. Not published = not reviewed = the feature is shut.
  if (!env.SITE_URL) return fail(500, 'server_error');
  let rubric: Rubric | null;
  try {
    rubric = await loadRubric(env.SITE_URL, fetchFn, locale);
  } catch {
    return fail(502, 'unavailable');
  }
  if (!rubric) return fail(409, 'rubric_unreviewed');

  // 6. A draft that exists.
  const existing = async (): Promise<StoredDraft | null> => {
    const rows = await readJson<StoredDraft[]>(await asService(`feedback?report_id=eq.${reportId}&ai_draft=eq.true&select=id,scores,comments,created_at`));
    if (!rows) throw new Error('read_failed');
    return rows[0] ?? null;
  };
  const had = await existing();
  if (had && !regenerate) return reply(200, { status: 'ok', existing: true, draft: had });

  // 7. Limits and budget, decided before the call. The weekly count is per student (the report's owner).
  const t = now();
  const spent = await sumSpending(asService, monthStart(t));
  const week = await readJson<{ id: string }[]>(
    await asService(`ai_usage?kind=eq.report_draft&subject_id=eq.${report.user_id}&counted=eq.true&created_at=gte.${encodeURIComponent(rollingWindowStart(t, 'week'))}&select=id`),
  );
  const budgetRows = await readJson<{ monthly_limit_usd: number | string }[]>(await asService('ai_budget?select=monthly_limit_usd'));
  if (spent === null || !week || !budgetRows) return fail(500, 'server_error');
  const limit = budgetRows[0] ? Number(budgetRows[0].monthly_limit_usd) : null;
  const verdict = decide(
    { enabled: true, usedToday: 0, dailyCap: 0, sameItemToday: 0, itemCap: 0, monthSpent: spent, monthLimit: limit, reportsThisWeek: week.length, weeklyReportCap: LIMITS.reportPerWeek },
    'report_draft',
  );
  if (!verdict.allow) return fail(429, LIMIT_ERROR[verdict.reason]);

  // 8. The report text, from the owner's Drive. Only this function's memory holds it.
  const text = await createDrive(env, fetchFn).readFile(report.drive_file_id);
  if (text === null) return fail(410, 'file_gone');

  // 9. The guard.
  const nonce = deps.nonce();
  if (!guardReport(text, nonce).ok) return fail(400, 'report_length');
  const request = buildReportRequest({ locale, rubric, reportText: text, nonce });
  if (!checkPromptSize(request).ok) return fail(400, 'report_length');

  const recordUsage = async (outcome: 'ok' | 'invalid' | 'refusal' | 'error', counted: boolean, result: LlmResult | null): Promise<boolean> => {
    let cost = 0;
    try { cost = result ? roundUsd(costUsd(MODELS.report, result.usage)) : 0; } catch { cost = 0; }
    const u = result?.usage;
    const res = await asService('ai_usage', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        user_id: userId, cohort_id: cohortId, subject_id: report.user_id, kind: 'report_draft', model: MODELS.report, prompt_version: REPORT_PROMPT_VERSION,
        input_tokens: u?.input ?? 0, output_tokens: u?.output ?? 0, cache_write_tokens: u?.cacheWrite ?? 0, cache_read_tokens: u?.cacheRead ?? 0,
        cost_usd: cost, outcome, counted,
      }),
    }).catch(() => null);
    return !!res?.ok;
  };
  const unavailable = async (outcome: 'invalid' | 'refusal' | 'error', result: LlmResult | null): Promise<Response> => {
    await recordUsage(outcome, false, result);
    return fail(502, 'unavailable');
  };

  // 10. The model.
  let result: LlmResult;
  try {
    result = await llm.complete(request);
  } catch (e) {
    if (e instanceof LlmError || e instanceof Error) return unavailable('error', null); // whatever it was, no detail goes on
    throw e;
  }

  // 11. Only a finished answer is read; refusals, cut-offs and the rest are dropped.
  if (result.stopReason === 'refusal') return unavailable('refusal', result);
  if (result.stopReason !== 'end_turn' || result.text === null) return unavailable('error', result);
  let parsed: unknown;
  try { parsed = JSON.parse(result.text); } catch { return unavailable('invalid', result); }
  const checked = checkReportOutput(parsed, text);
  if (!checked.ok) return unavailable('invalid', result);

  // 12–13. The spending is written first: it must never be invisible. Then the draft.
  if (!(await recordUsage('ok', true, result))) return fail(500, 'server_error');
  const { scores, comments, notes } = checked.value;
  let stored: StoredDraft | null = null;
  if (had) {
    const patched = await asService(`feedback?id=eq.${had.id}&ai_draft=eq.true`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ scores, comments, created_at: t.toISOString() }),
    });
    if (!patched.ok) return fail(500, 'server_error');
    stored = { id: had.id, scores, comments, created_at: t.toISOString() };
  } else {
    const ins = await asService('feedback?select=id,scores,comments,created_at', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ report_id: reportId, author_id: null, ai_draft: true, scores, comments, status: 'draft' }),
    });
    if (ins.status === 409) {
      // Someone else's draft arrived while this one was being made (one draft per report is enforced by the table).
      // The spending is on record; show what is stored.
      const other = await existing();
      return other ? reply(200, { status: 'ok', existing: true, draft: other }) : fail(409, 'in_progress');
    }
    stored = (await readJson<StoredDraft[]>(ins))?.[0] ?? null;
    if (!stored) return fail(500, 'server_error');
  }
  return reply(200, { status: 'ok', existing: false, draft: stored, notes });
}

/** The reviewed rubric the site publishes (`/content/<locale>/report-rubric.json`). English is the fallback, as for drills. */
async function loadRubric(siteUrl: string, fetchFn: typeof fetch, locale: Locale): Promise<Rubric | null> {
  const base = siteUrl.replace(/\/+$/, '');
  for (const loc of locale === 'en' ? (['en'] as const) : ([locale, 'en'] as const)) {
    const r = await fetchFn(`${base}/content/${loc}/report-rubric.json`);
    if (r.status === 404) continue;
    if (!r.ok) throw new Error('content_unavailable');
    const rubric = parseRubric(await r.json().catch(() => null));
    if (rubric) return rubric;
    return null; // published but not reviewed or incomplete: do not fall through to another language
  }
  return null;
}
