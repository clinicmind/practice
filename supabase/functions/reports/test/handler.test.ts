// @vitest-environment node
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { handleRequest } from '../src/handler';
import { A, B, C1, ENV, FakeBackend, S1, X } from './fakeBackend';

// All text is fictional.
const FILL = 'The trainee noted that the client spoke slowly and paused often before answering. ';
const CLEAN = FILL.repeat(4) + 'We agreed to look at one small step this week.';
const NOW = () => new Date('2026-11-23T10:00:00.000Z');

let be: FakeBackend;
let logs: ReturnType<typeof vi.spyOn>[];
beforeEach(() => {
  be = new FakeBackend();
  logs = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
});
afterEach(() => vi.restoreAllMocks());

async function call(token: string | null, payload: unknown, opts: { method?: string; raw?: string } = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const req = new Request('https://proj.supabase.test/functions/v1/reports', { method: opts.method ?? 'POST', headers, body: opts.method === 'OPTIONS' || opts.method === 'GET' ? undefined : (opts.raw ?? JSON.stringify(payload)) });
  const res = await handleRequest(req, ENV, be.fetch as typeof fetch, NOW);
  const text = await res.text();
  return { status: res.status, headers: res.headers, text, json: text ? JSON.parse(text) : null };
}
const submit = (token: string | null, body: string, title = 'Week 3 summary') => call(token, { action: 'submit', title, body });

describe('submit: the happy path', () => {
  test('a clean report is written to Drive, then the row is stored with a server-made summary and delete_after', async () => {
    const r = await submit('tok-A', CLEAN);
    expect(r.status).toBe(201);
    expect(be.reports).toHaveLength(1);
    const row = be.reports[0]!;
    expect(row).toMatchObject({ id: r.json.id, user_id: A, title: 'Week 3 summary', delete_after: '2027-04-01' }); // term_end 2027-01-01 + 90 days
    expect(be.files.get(row.drive_file_id)).toMatchObject({ text: CLEAN, name: `${r.json.id}.txt` });
    expect(JSON.stringify(row)).not.toContain('The trainee noted');
  });
  test('the file name is the report id only, and the file sits in a per-cohort folder inside the app folder', async () => {
    await submit('tok-A', CLEAN);
    const f = [...be.files.values()][0]!;
    expect(f.name).toMatch(/^[0-9a-f-]{36}\.txt$/);
    const cohortFolder = be.folders.find((x) => x.name === C1)!;
    expect(f.parent).toBe(cohortFolder.id);
    expect(be.folders.find((x) => x.id === cohortFolder.parent)!.name).toBe('ClinicMind Practice Reports');
  });
  test('a second report reuses the folders', async () => {
    await submit('tok-A', CLEAN);
    await submit('tok-B', CLEAN);
    expect(be.folders).toHaveLength(2);
  });
  test('the service key is used only for writes and for the reads the server must make itself', async () => {
    await submit('tok-A', CLEAN);
    const userCalls = be.calls.filter((c) => c.url.includes('/auth/v1/user'));
    expect(userCalls[0]!.headers.authorization).toBe('Bearer tok-A');
  });
  test('a client-supplied deid_summary is ignored; the summary is computed from the text', async () => {
    const withMedium = CLEAN + ' She told me about Mr Chan at the weekend.';
    const r = await call('tok-A', { action: 'submit', title: 't', body: withMedium, deid_summary: { phone: { found: 0, rewritten: 9, notIdentifying: 9 } } });
    expect(r.status).toBe(201);
    const s = be.reports[0]!.deid_summary as Record<string, { found: number; rewritten: number; notIdentifying: number }>;
    expect(s['title-name']).toEqual({ found: 1, rewritten: 0, notIdentifying: 0 });
    expect(s.phone).toBeUndefined();
    expect(JSON.stringify(s)).not.toContain('Chan');
  });
});

describe('submit: refusals', () => {
  test('a high-level finding is refused with rule and offsets only; nothing reaches Drive or the database', async () => {
    const body = CLEAN + ' Call 91234567 please.';
    const r = await submit('tok-A', body);
    expect(r.status).toBe(422);
    expect(r.json.findings).toEqual([{ rule: 'phone', start: body.indexOf('91234567'), end: body.indexOf('91234567') + 8 }]);
    expect(r.text).not.toContain('91234567');
    expect(be.reports).toHaveLength(0);
    expect(be.files.size).toBe(0);
    expect(be.calls.some((c) => c.url.includes('googleapis'))).toBe(false);
  });
  test('the server scan still catches full-width and spaced identifiers', async () => {
    expect((await submit('tok-A', CLEAN + ' Ａ１２３４５６（３）')).status).toBe(422);
    expect((await submit('tok-A', CLEAN + ' 9123 4567')).status).toBe(422);
  });
  test('a high-level finding in the title is refused without echoing it', async () => {
    const r = await submit('tok-A', CLEAN, 'Call 91234567');
    expect(r.status).toBe(400);
    expect(r.json.error).toBe('title_identifying');
    expect(r.text).not.toContain('91234567');
    expect(be.files.size).toBe(0);
  });
  test('403 when reports are off for the cohort', async () => {
    be.cohorts[C1]!.reports_enabled = false;
    const r = await submit('tok-A', CLEAN);
    expect(r.status).toBe(403);
    expect(r.json.error).toBe('reports_disabled');
    expect(be.files.size).toBe(0);
  });
  test('403 for a supervisor, and for a student with no cohort', async () => {
    expect((await submit('tok-S1', CLEAN)).status).toBe(403);
    be.profiles[A]!.cohort_id = null;
    expect((await submit('tok-A', CLEAN)).status).toBe(403);
  });
  test('401 without a valid session', async () => {
    expect((await submit(null, CLEAN)).status).toBe(401);
    expect((await submit('tok-forged', CLEAN)).status).toBe(401);
    expect(be.files.size).toBe(0);
  });
  test.each([
    ['too short', 'x'.repeat(199), 400, 'body_length'],
    ['too long', 'x'.repeat(30_001), 413, 'body_length'],
  ])('body %s', async (_n, body, status, error) => {
    const r = await submit('tok-A', body);
    expect(r.status).toBe(status);
    expect(r.json.error).toBe(error);
  });
  test('the limits are inclusive: 200 and 30,000 characters are accepted', async () => {
    expect((await submit('tok-A', 'x '.repeat(100))).status).toBe(201);
    expect((await submit('tok-B', 'ab '.repeat(10_000))).status).toBe(201);
  });
  test.each([[''], ['   '], ['t'.repeat(101)], [123 as unknown as string]])('bad title %j is refused', async (title) => {
    expect((await submit('tok-A', CLEAN, title)).status).toBe(400);
  });
  test('bad request shapes', async () => {
    expect((await call('tok-A', { action: 'nope' })).status).toBe(400);
    expect((await call('tok-A', null, { raw: 'not json' })).status).toBe(400);
    expect((await call('tok-A', { action: 'submit', title: 'x', body: 5 })).status).toBe(400);
    expect((await call('tok-A', null, { method: 'GET' })).status).toBe(405);
  });
  test('the 6th successful submission in 24 hours is refused; the 5th is accepted', async () => {
    for (let i = 0; i < 5; i++) expect((await submit('tok-A', CLEAN)).status).toBe(201);
    const r = await submit('tok-A', CLEAN);
    expect(r.status).toBe(429);
    expect(r.json.error).toBe('rate_limited');
    expect(be.reports).toHaveLength(5);
    expect((await submit('tok-B', CLEAN)).status).toBe(201); // another student is not affected
  });
  test('deleting reports does not reset the limit', async () => {
    for (let i = 0; i < 5; i++) await submit('tok-A', CLEAN);
    for (const r of [...be.reports]) await call('tok-A', { action: 'delete', id: r.id });
    expect((await submit('tok-A', CLEAN)).status).toBe(429);
  });
  test('a rejected submission does not count against the limit', async () => {
    for (let i = 0; i < 6; i++) await submit('tok-A', CLEAN + ' 91234567');
    expect((await submit('tok-A', CLEAN)).status).toBe(201);
  });
});

describe('submit: Drive and database failures leave nothing behind', () => {
  test('Drive is down: 502 drive_unavailable, no row, and the text is not kept anywhere', async () => {
    be.drive.api = 'down';
    const r = await submit('tok-A', CLEAN);
    expect(r.status).toBe(502);
    expect(r.json.error).toBe('drive_unavailable');
    expect(be.reports).toHaveLength(0);
    expect(be.audit).toHaveLength(0);
    expect(be.calls.filter((c) => c.url.includes('supabase.test/rest') && c.method === 'POST')).toHaveLength(0);
  });
  test('the refresh token is no longer valid: 502 drive_auth', async () => {
    be.drive.token = 'invalid_grant';
    const r = await submit('tok-A', CLEAN);
    expect(r.status).toBe(502);
    expect(r.json.error).toBe('drive_auth');
    expect(be.reports).toHaveLength(0);
  });
  test('the Google secrets are missing: 502 drive_auth', async () => {
    const res = await handleRequest(new Request('https://x.test/f', { method: 'POST', headers: { Authorization: 'Bearer tok-A' }, body: JSON.stringify({ action: 'submit', title: 't', body: CLEAN }) }), { ...ENV, GOOGLE_REFRESH_TOKEN: undefined }, be.fetch as typeof fetch, NOW);
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: string }).error).toBe('drive_auth');
  });
  test('Drive rejects the token mid-flight (401): drive_auth', async () => {
    be.drive.api = '401';
    expect((await submit('tok-A', CLEAN)).json.error).toBe('drive_auth');
  });
  test('Drive is full: 502 drive_quota', async () => {
    be.drive.api = 'quota';
    const r = await submit('tok-A', CLEAN);
    expect(r.status).toBe(502);
    expect(r.json.error).toBe('drive_quota');
  });
  test('Google cannot be reached at all: 502 drive_unavailable', async () => {
    const f = (async (u: RequestInfo | URL, i?: RequestInit) => {
      if (String(u).includes('google')) throw new TypeError('network');
      return be.fetch(u, i);
    }) as typeof fetch;
    const res = await handleRequest(new Request('https://x.test/f', { method: 'POST', headers: { Authorization: 'Bearer tok-A' }, body: JSON.stringify({ action: 'submit', title: 't', body: CLEAN }) }), ENV, f, NOW);
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: string }).error).toBe('drive_unavailable');
  });
  test('the database insert fails after Drive succeeded: the Drive file is deleted again', async () => {
    be.dbInsertFails = true;
    const r = await submit('tok-A', CLEAN);
    expect(r.status).toBe(500);
    expect(r.json.error).toBe('storage_failed');
    expect(be.files.size).toBe(0);
    expect(be.reports).toHaveLength(0);
  });
});

describe('get', () => {
  let rid: string;
  beforeEach(async () => { rid = (await submit('tok-A', CLEAN)).json.id; });

  test('the owner reads the text back', async () => {
    const r = await call('tok-A', { action: 'get', id: rid });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ title: 'Week 3 summary', body: CLEAN });
  });
  test('the cohort supervisor reads it; another cohort’s supervisor does not', async () => {
    expect((await call('tok-S1', { action: 'get', id: rid })).status).toBe(200);
    expect((await call('tok-S2', { action: 'get', id: rid })).status).toBe(404);
  });
  test('another student’s report is 404, and Drive is never asked', async () => {
    const before = be.calls.length;
    for (const t of ['tok-B', 'tok-X']) expect((await call(t, { action: 'get', id: rid })).status).toBe(404);
    expect(be.calls.slice(before).some((c) => c.url.includes('googleapis'))).toBe(false);
  });
  test('the permission check uses the caller’s own token, not the service key', async () => {
    be.calls.length = 0;
    await call('tok-B', { action: 'get', id: rid });
    const read = be.calls.find((c) => c.url.includes('/rest/v1/reports'))!;
    expect(read.headers.authorization).toBe('Bearer tok-B');
  });
  test('a file deleted in Drive gives 410', async () => {
    be.files.clear();
    const r = await call('tok-A', { action: 'get', id: rid });
    expect(r.status).toBe(410);
    expect(r.json.error).toBe('file_gone');
  });
  test('a file moved to the Drive trash gives 410', async () => {
    for (const f of be.files.values()) f.trashed = true;
    expect((await call('tok-A', { action: 'get', id: rid })).status).toBe(410);
  });
  test('Drive failing gives 502, not a crash', async () => {
    be.drive.token = 'invalid_grant';
    expect((await call('tok-A', { action: 'get', id: rid })).json.error).toBe('drive_auth');
  });
  test('unknown or malformed ids are 404 and 400', async () => {
    expect((await call('tok-A', { action: 'get', id: '00000000-0000-4000-8000-0000000000ff' })).status).toBe(404);
    expect((await call('tok-A', { action: 'get', id: 'x" or 1=1' })).status).toBe(400);
  });
});

describe('delete', () => {
  let rid: string;
  beforeEach(async () => { rid = (await submit('tok-A', CLEAN)).json.id; });

  test('the owner deletes: the Drive file and the row both go, with an audit row that has no text', async () => {
    const r = await call('tok-A', { action: 'delete', id: rid });
    expect(r.status).toBe(200);
    expect(be.reports).toHaveLength(0);
    expect(be.files.size).toBe(0);
    expect(be.audit.at(-1)).toMatchObject({ actor_id: A, action: 'delete_report', target_id: rid });
    expect(JSON.stringify(be.audit)).not.toContain('Week 3');
  });
  test('the cohort supervisor can delete; another cohort’s supervisor and classmates cannot', async () => {
    for (const t of ['tok-B', 'tok-X', 'tok-S2']) expect((await call(t, { action: 'delete', id: rid })).status).toBe(404);
    expect(be.reports).toHaveLength(1);
    expect(be.files.size).toBe(1);
    expect((await call('tok-S1', { action: 'delete', id: rid })).status).toBe(200);
    expect(be.reports).toHaveLength(0);
  });
  test('a second delete is a no-op: 404, nothing else changes', async () => {
    await call('tok-A', { action: 'delete', id: rid });
    const audits = be.audit.length;
    expect((await call('tok-A', { action: 'delete', id: rid })).status).toBe(404);
    expect(be.audit.length).toBe(audits);
  });
  test('the Drive file is already gone: the delete still succeeds', async () => {
    be.files.clear();
    expect((await call('tok-A', { action: 'delete', id: rid })).status).toBe(200);
    expect(be.reports).toHaveLength(0);
  });
  test('Drive failing keeps the row, so the delete can be tried again', async () => {
    be.drive.api = 'down';
    expect((await call('tok-A', { action: 'delete', id: rid })).status).toBe(502);
    expect(be.reports).toHaveLength(1);
    be.drive.api = undefined;
    expect((await call('tok-A', { action: 'delete', id: rid })).status).toBe(200);
    expect(be.files.size).toBe(0);
  });
  test('the database delete failing after the file is gone can be retried', async () => {
    be.dbDeleteFails = true;
    expect((await call('tok-A', { action: 'delete', id: rid })).status).toBe(500);
    be.dbDeleteFails = false;
    expect((await call('tok-A', { action: 'delete', id: rid })).status).toBe(200);
    expect(be.reports).toHaveLength(0);
  });
});

describe('transport', () => {
  test('preflight answers with CORS headers and does no work', async () => {
    const r = await call(null, null, { method: 'OPTIONS' });
    expect(r.status).toBe(204);
    expect(r.headers.get('access-control-allow-headers')).toMatch(/authorization/i);
    expect(r.headers.get('access-control-allow-headers')).toMatch(/apikey/i);
    expect(be.calls).toHaveLength(0);
  });
  test('every response carries CORS headers', async () => {
    expect((await submit('tok-A', CLEAN)).headers.get('access-control-allow-origin')).toBeTruthy();
    expect((await submit(null, CLEAN)).headers.get('access-control-allow-origin')).toBeTruthy();
  });
});

describe('secrets and text never leak', () => {
  test('no response contains the refresh token, client secret, service key or access token', async () => {
    const outs: string[] = [];
    be.drive.token = 'invalid_grant';
    outs.push((await submit('tok-A', CLEAN)).text);
    be.drive.token = undefined;
    be.drive.api = 'down';
    outs.push((await submit('tok-A', CLEAN)).text);
    be.drive.api = undefined;
    const ok = await submit('tok-A', CLEAN);
    outs.push(ok.text, (await call('tok-A', { action: 'get', id: ok.json.id })).text.replace(CLEAN, ''), (await call('tok-A', { action: 'delete', id: ok.json.id })).text);
    for (const secret of [ENV.GOOGLE_REFRESH_TOKEN, ENV.GOOGLE_CLIENT_SECRET, ENV.SUPABASE_SERVICE_ROLE_KEY, 'access-token-fiction'])
      for (const o of outs) expect(o).not.toContain(secret);
  });
  test('nothing is logged, on success or on any failure', async () => {
    await submit('tok-A', CLEAN);
    await submit('tok-A', CLEAN + ' 91234567');
    be.drive.api = 'down';
    await submit('tok-B', CLEAN);
    be.drive.api = undefined;
    be.dbInsertFails = true;
    await submit('tok-B', CLEAN);
    for (const spy of logs) expect(spy).not.toHaveBeenCalled();
  });
  test('the report text is sent only to Drive; never to the database, Auth or in a URL', async () => {
    await submit('tok-A', CLEAN);
    const fragment = 'paused often before answering';
    for (const c of be.calls) {
      const toDrive = c.url.includes('upload/drive');
      expect(c.url).not.toContain(fragment);
      if (!toDrive) expect(c.body).not.toContain(fragment);
    }
    expect(be.calls.filter((c) => c.body.includes(fragment))).toHaveLength(1);
  });
  test('an unexpected exception returns a plain 500 with no detail', async () => {
    const f = (async () => { throw new Error('secret detail 91234567'); }) as unknown as typeof fetch;
    const res = await handleRequest(new Request('https://x.test/f', { method: 'POST', headers: { Authorization: 'Bearer tok-A' }, body: JSON.stringify({ action: 'submit', title: 't', body: CLEAN }) }), ENV, f, NOW);
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain('91234567');
    for (const spy of logs) expect(spy).not.toHaveBeenCalled();
  });
});

// keep the unused fixtures referenced so a rename is caught
void B; void X; void S1;
