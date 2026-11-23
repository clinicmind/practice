// @vitest-environment node
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { handleRequest } from '../src/handler';
import { A, B, ENV, FakeBackend, S1, X } from './fakeBackend';

// All text is fictional. The permission rules themselves (who sees which expired report) are tested
// against Postgres in supabase/tests/retention.test.ts; here the fake models the same rules.
const NOW = () => new Date('2027-04-02T03:00:00.000Z'); // today is 2027-04-02
const SECRET_TITLE = 'Fictional week 3 summary';
const SECRET_BODY = 'Fictional body text that must never be logged.';

let be: FakeBackend;
let logs: ReturnType<typeof vi.spyOn>[];
beforeEach(() => {
  be = new FakeBackend();
  logs = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
});
afterEach(() => vi.restoreAllMocks());

let n = 0;
/** A report that already exists in the database and in Drive. */
function seed(owner: string, deleteAfter: string, opts: { drive?: boolean } = {}) {
  const id = `00000000-0000-4000-8000-${String(900 + ++n).padStart(12, '0')}`;
  const fid = `seeded-file-${n}`;
  be.reports.push({ id, user_id: owner, title: SECRET_TITLE, drive_file_id: fid, deid_summary: {}, status: 'submitted', created_at: '2026-12-01T00:00:00Z', delete_after: deleteAfter });
  if (opts.drive !== false) be.files.set(fid, { name: `${id}.txt`, parent: 'x', text: SECRET_BODY, trashed: false });
  return { id, fid };
}

async function call(token: string | null, payload: unknown, env: Record<string, string | undefined> = ENV) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await handleRequest(new Request('https://proj.supabase.test/functions/v1/reports', { method: 'POST', headers, body: JSON.stringify(payload) }), env, be.fetch as typeof fetch, NOW);
  const text = await res.text();
  return { status: res.status, text, json: text ? JSON.parse(text) : null };
}
const purge = (token: string | null) => call(token, { action: 'purge' });

describe('purge: what is deleted', () => {
  test('a supervisor’s purge removes expired reports of their cohort: Drive file, row, and an audit row', async () => {
    const old = seed(A, '2027-04-01');
    const r = await purge('tok-S1');
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ purged: 1, failed: 0, more: false, driveError: null });
    expect(be.reports).toHaveLength(0);
    expect(be.files.has(old.fid)).toBe(false);
    expect(be.audit.filter((a) => a.action === 'purge_report')).toEqual([expect.objectContaining({ actor_id: S1, target_id: old.id })]);
  });
  test('a report whose date is today is kept; tomorrow it goes', async () => {
    const today = seed(A, '2027-04-02');
    const r = await purge('tok-S1');
    expect(r.json.purged).toBe(0);
    expect(be.reports.map((x) => x.id)).toEqual([today.id]);
    expect(be.files.has(today.fid)).toBe(true);
  });
  test('reports not yet expired are untouched', async () => {
    const future = seed(B, '2027-06-01');
    const old = seed(A, '2027-04-01');
    await purge('tok-S1');
    expect(be.reports.map((x) => x.id)).toEqual([future.id]);
    expect(be.files.has(future.fid)).toBe(true);
    expect(be.files.has(old.fid)).toBe(false);
  });
  test('a supervisor cannot purge another cohort’s reports', async () => {
    const theirs = seed(X, '2027-04-01'); // cohort 2, supervised by SUP_OTHER
    const mine = seed(A, '2027-04-01');
    await purge('tok-S1');
    expect(be.reports.map((x) => x.id)).toEqual([theirs.id]);
    expect(be.files.has(theirs.fid)).toBe(true);
    expect(be.files.has(mine.fid)).toBe(false);
    await purge('tok-S2');
    expect(be.reports).toHaveLength(0);
  });
  test('a student cannot purge, not even their own expired report', async () => {
    const old = seed(A, '2027-04-01');
    const r = await purge('tok-A');
    expect(r.status).toBe(403);
    expect(r.json).toEqual({ error: 'not_allowed' });
    expect(be.reports).toHaveLength(1);
    expect(be.files.has(old.fid)).toBe(true);
  });
  test('no token or a bad token is refused', async () => {
    seed(A, '2027-04-01');
    expect((await purge(null)).status).toBe(401);
    expect((await purge('tok-nobody')).status).toBe(401);
    expect(be.reports).toHaveLength(1);
  });
  test('nothing to purge is a normal answer', async () => {
    expect((await purge('tok-S1')).json).toMatchObject({ purged: 0, failed: 0, more: false });
  });
  test('purging twice is harmless', async () => {
    seed(A, '2027-04-01');
    await purge('tok-S1');
    expect((await purge('tok-S1')).json.purged).toBe(0);
  });
});

describe('purge: failures', () => {
  test('a Drive file that is already gone does not stop the row from being deleted', async () => {
    seed(A, '2027-04-01', { drive: false });
    const r = await purge('tok-S1');
    expect(r.json.purged).toBe(1);
    expect(be.reports).toHaveLength(0);
  });
  test('when the Drive link has expired nothing is deleted and the answer says why', async () => {
    const old = seed(A, '2027-04-01');
    be.drive.token = 'invalid_grant';
    const r = await purge('tok-S1');
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ purged: 0, driveError: 'drive_auth' });
    expect(be.reports).toHaveLength(1); // the row stays, so the file is never orphaned
    expect(be.files.has(old.fid)).toBe(true);
  });
  test('when the database delete fails the file may be gone, the row stays, and the next purge finishes it', async () => {
    const old = seed(A, '2027-04-01');
    be.dbDeleteFails = true;
    const r = await purge('tok-S1');
    expect(r.json).toMatchObject({ purged: 0, failed: 1 });
    expect(be.reports).toHaveLength(1);
    expect(be.files.has(old.fid)).toBe(false);
    be.dbDeleteFails = false;
    expect((await purge('tok-S1')).json.purged).toBe(1);
    expect(be.reports).toHaveLength(0);
  });
  test('a large backlog is done in batches of 50', async () => {
    for (let i = 0; i < 60; i++) seed(A, '2027-04-01');
    const first = await purge('tok-S1');
    expect(first.json).toMatchObject({ purged: 50, more: true });
    const second = await purge('tok-S1');
    expect(second.json).toMatchObject({ purged: 10, more: false });
    expect(be.reports).toHaveLength(0);
  });
});

describe('purge and status: nothing sensitive leaves the function', () => {
  test('no log line, response or audit row holds report text, title or a secret', async () => {
    seed(A, '2027-04-01');
    const out = [(await purge('tok-S1')).text, (await call('tok-S1', { action: 'drive_status' })).text];
    const everything = JSON.stringify([out, be.audit, logs.flatMap((l) => l.mock.calls)]);
    for (const secret of [SECRET_BODY, SECRET_TITLE, ENV.GOOGLE_REFRESH_TOKEN, ENV.GOOGLE_CLIENT_SECRET, ENV.SUPABASE_SERVICE_ROLE_KEY]) expect(everything).not.toContain(secret);
    expect(logs.flatMap((l) => l.mock.calls)).toEqual([]);
  });
});

describe('drive_status', () => {
  const status = (token: string | null, env?: Record<string, string | undefined>) => call(token, { action: 'drive_status' }, env);
  test('ok when Drive answers', async () => {
    expect((await status('tok-S1')).json).toEqual({ status: 'ok' });
  });
  test('auth when the refresh token is rejected', async () => {
    be.drive.token = 'invalid_grant';
    expect((await status('tok-S1')).json).toEqual({ status: 'auth' });
  });
  test('auth when Drive refuses the access token', async () => {
    be.drive.api = '401';
    expect((await status('tok-S1')).json).toEqual({ status: 'auth' });
  });
  test('unavailable when Google does not answer', async () => {
    be.drive.token = 'down';
    expect((await status('tok-S1')).json).toEqual({ status: 'unavailable' });
    be.drive.token = undefined;
    be.drive.api = 'down';
    expect((await status('tok-S1')).json).toEqual({ status: 'unavailable' });
  });
  test('not_configured when a secret is missing, without calling Google', async () => {
    const { GOOGLE_REFRESH_TOKEN: _drop, ...partial } = ENV;
    expect((await status('tok-S1', partial)).json).toEqual({ status: 'not_configured' });
    expect(be.calls.some((c) => c.url.includes('googleapis'))).toBe(false);
  });
  test('students cannot ask', async () => {
    const r = await status('tok-A');
    expect(r.status).toBe(403);
    expect(be.calls.some((c) => c.url.includes('googleapis'))).toBe(false);
  });
  test('needs a signed-in user', async () => {
    expect((await status(null)).status).toBe(401);
  });
});
