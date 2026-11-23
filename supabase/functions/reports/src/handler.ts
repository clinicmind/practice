import { scan, scanHigh, summarize } from '../../../../packages/deid/src';
import { createDrive, DriveError, type DriveEnv, type FetchFn } from './drive';

/**
 * The `reports` Edge Function: submit, get and delete, told apart by `action` in the JSON body.
 *
 * - Reads of a report go through the caller's own token, so row level security decides who may see it.
 * - Writes go through the service role, because students have no write policy on `reports`.
 * - The text goes to Drive and nowhere else. Nothing here logs, and no response echoes text or a secret.
 */
export type Env = DriveEnv & { SUPABASE_URL?: string; SUPABASE_ANON_KEY?: string; SUPABASE_SERVICE_ROLE_KEY?: string };

const MIN_BODY = 200;
const MAX_BODY = 30_000;
const MAX_TITLE = 100;
const MAX_PER_DAY = 5;
const KEEP_DAYS = 90;
const MAX_REQUEST_BYTES = 200_000; // 30,000 characters is at most about 120,000 bytes in UTF-8, plus the JSON around it
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const reply = (status: number, body: unknown) =>
  new Response(body === null ? null : JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const fail = (status: number, error: string) => reply(status, { error });

const DRIVE_STATUS: Record<string, string> = { auth: 'drive_auth', quota: 'drive_quota', unavailable: 'drive_unavailable' };

export async function handleRequest(req: Request, env: Env, fetchFn: FetchFn, now: () => Date = () => new Date()): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return fail(405, 'method_not_allowed');
  try {
    return await route(req, env, fetchFn, now);
  } catch (e) {
    if (e instanceof DriveError) return fail(502, DRIVE_STATUS[e.kind]!);
    return fail(500, 'server_error'); // no detail: the cause could contain report text
  }
}

async function route(req: Request, env: Env, fetchFn: FetchFn, now: () => Date): Promise<Response> {
  const { SUPABASE_URL: url, SUPABASE_ANON_KEY: anon, SUPABASE_SERVICE_ROLE_KEY: service } = env;
  if (!url || !anon || !service) return fail(500, 'server_error');

  const token = /^Bearer (.+)$/.exec(req.headers.get('Authorization') ?? '')?.[1];
  if (!token) return fail(401, 'unauthorized');

  const raw = await req.text();
  if (raw.length > MAX_REQUEST_BYTES) return fail(413, 'body_length');
  let input: Record<string, unknown>;
  try {
    const parsed = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return fail(400, 'bad_request');
    input = parsed as Record<string, unknown>;
  } catch {
    return fail(400, 'bad_request');
  }
  const action = input.action;
  if (action !== 'submit' && action !== 'get' && action !== 'delete') return fail(400, 'bad_request');

  // Who is asking. Auth answers for the token itself; nothing in the token is trusted before that.
  const who = await fetchFn(`${url}/auth/v1/user`, { headers: { apikey: anon, Authorization: `Bearer ${token}` } });
  if (!who.ok) return fail(401, 'unauthorized');
  const userId = ((await who.json().catch(() => null)) as { id?: string } | null)?.id;
  if (!userId || !UUID.test(userId)) return fail(401, 'unauthorized');

  const rest = (key: string, path: string, init: RequestInit = {}) =>
    fetchFn(`${url}/rest/v1/${path}`, { ...init, headers: { apikey: anon, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(init.headers as Record<string, string>) } });
  const asService = (path: string, init?: RequestInit) => rest(service, path, init);
  const asUser = (path: string, init?: RequestInit) => rest(token, path, init);
  const audit = (action: string, target: string) =>
    asService('audit_log', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ actor_id: userId, action, target_table: 'reports', target_id: target }) }).catch(() => null);
  const drive = createDrive(env, fetchFn);

  if (action === 'submit') return submit();
  return existing(action);

  async function submit(): Promise<Response> {
    const title = typeof input.title === 'string' ? input.title.trim() : null;
    const body = input.body;
    if (title === null || title.length < 1 || title.length > MAX_TITLE || typeof body !== 'string') return fail(400, 'bad_request');

    const prof = await asService(`profiles?id=eq.${userId}&select=role,cohort_id`);
    const profile = prof.ok ? ((await prof.json()) as { role: string; cohort_id: string | null }[])[0] : undefined;
    if (!prof.ok) return fail(500, 'server_error');
    if (!profile || profile.role !== 'student' || !profile.cohort_id) return fail(403, 'not_allowed');
    const coh = await asService(`cohorts?id=eq.${profile.cohort_id}&select=reports_enabled,term_end`);
    const cohort = coh.ok ? ((await coh.json()) as { reports_enabled: boolean; term_end: string }[])[0] : undefined;
    if (!coh.ok || !cohort) return fail(500, 'server_error');
    if (!cohort.reports_enabled) return fail(403, 'reports_disabled');

    if (body.length < MIN_BODY) return fail(400, 'body_length');
    if (body.length > MAX_BODY) return fail(413, 'body_length');

    // Server-side re-check. Only rule and position leave this function, never the matched text.
    if (scanHigh(title).length > 0) return fail(400, 'title_identifying');
    const high = scanHigh(body);
    if (high.length > 0) return reply(422, { error: 'identifying_details', findings: high.map(({ rule, start, end }) => ({ rule, start, end })) });

    const since = new Date(now().getTime() - 24 * 3600 * 1000).toISOString();
    const recent = await asService(`audit_log?actor_id=eq.${userId}&action=eq.submit_report&created_at=gte.${encodeURIComponent(since)}&select=id`);
    if (!recent.ok) return fail(500, 'server_error');
    if (((await recent.json()) as unknown[]).length >= MAX_PER_DAY) return fail(429, 'rate_limited');

    const id = crypto.randomUUID();
    const deleteAfter = new Date(new Date(`${cohort.term_end}T00:00:00Z`).getTime() + KEEP_DAYS * 86_400_000).toISOString().slice(0, 10);
    // The summary is computed here from the text. Whatever the browser says about it is never read.
    const deid_summary = summarize(scan(body), {});

    // Drive first. If it fails, nothing is stored anywhere and the student is told.
    const fileId = await drive.createFile(profile.cohort_id, `${id}.txt`, body);
    const ins = await asService('reports', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ id, user_id: userId, title, drive_file_id: fileId, deid_summary, delete_after: deleteAfter }),
    }).catch(() => null);
    if (!ins?.ok) {
      await drive.deleteFile(fileId).catch(() => {}); // roll back; a leftover file would be a copy nobody can see or delete
      return fail(500, 'storage_failed');
    }
    await audit('submit_report', id);
    return reply(201, { id });
  }

  async function existing(which: 'get' | 'delete'): Promise<Response> {
    const id = input.id;
    if (typeof id !== 'string' || !UUID.test(id)) return fail(400, 'bad_request');
    // The caller's own token: row level security decides whether this report is visible at all.
    const found = await asUser(`reports?id=eq.${id}&select=id,title,drive_file_id`);
    if (!found.ok) return fail(500, 'server_error');
    const row = ((await found.json()) as { id: string; title: string; drive_file_id: string }[])[0];
    if (!row) return fail(404, 'not_found');

    if (which === 'get') {
      const text = await drive.readFile(row.drive_file_id);
      if (text === null) return fail(410, 'file_gone');
      return reply(200, { title: row.title, body: text });
    }
    // File first, then the row: a failure in between leaves a row that can simply be deleted again.
    await drive.deleteFile(row.drive_file_id);
    const del = await asService(`reports?id=eq.${id}`, { method: 'DELETE' });
    if (!del.ok) return fail(500, 'storage_failed');
    await audit('delete_report', id);
    return reply(200, { deleted: true });
  }
}
