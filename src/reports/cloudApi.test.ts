import { describe, expect, test, vi } from 'vitest';
import { createCloudReportsApi } from './cloudApi';

// All names and text are fictional.
const URL = 'https://proj.supabase.test';
const mk = (token: string | null, respond: (u: string, i: RequestInit) => Response | Promise<Response>) => {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchFn = vi.fn(async (u: RequestInfo | URL, i?: RequestInit) => { calls.push({ url: String(u), init: i ?? {} }); return respond(String(u), i ?? {}); });
  const api = createCloudReportsApi({ url: URL, anonKey: 'anon-fiction', getToken: async () => token, getUserId: async () => 'sup-1', fetch: fetchFn as unknown as typeof fetch });
  return { api, calls };
};
const json = (status: number, v: unknown) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } });
const sent = (c: { init: RequestInit }) => JSON.parse(c.init.body as string);

describe('submit', () => {
  test('posts the action, title and text to the function with the student’s own token', async () => {
    const { api, calls } = mk('tok', () => json(201, { id: 'r1' }));
    expect(await api.submit({ title: 'Week 3', body: 'text body' })).toEqual({ ok: true, id: 'r1' });
    expect(calls[0]!.url).toBe(`${URL}/functions/v1/reports`);
    expect(calls[0]!.init.method).toBe('POST');
    expect(sent(calls[0]!)).toEqual({ action: 'submit', title: 'Week 3', body: 'text body' });
    const h = calls[0]!.init.headers as Record<string, string>;
    expect(h.Authorization).toBe('Bearer tok');
    expect(h.apikey).toBe('anon-fiction');
  });
  test('422 returns the findings, rule and positions only', async () => {
    const { api } = mk('tok', () => json(422, { error: 'identifying_details', findings: [{ rule: 'phone', start: 3, end: 11 }] }));
    expect(await api.submit({ title: 't', body: 'b' })).toEqual({ ok: false, status: 422, findings: [{ rule: 'phone', start: 3, end: 11 }] });
  });
  test.each([[502, 'drive_auth'], [502, 'drive_quota'], [429, 'rate_limited'], [403, 'reports_disabled']])('%i %s comes back as a status and a code', async (status, code) => {
    const { api } = mk('tok', () => json(status, { error: code }));
    expect(await api.submit({ title: 't', body: 'b' })).toMatchObject({ ok: false, status, code });
  });
  test('a reply that is not JSON still gives a failure with the status', async () => {
    const { api } = mk('tok', () => new Response('<html>gateway</html>', { status: 502 }));
    expect(await api.submit({ title: 't', body: 'b' })).toMatchObject({ ok: false, status: 502 });
  });
  test('no session: 401 without calling the network', async () => {
    const { api, calls } = mk(null, () => json(201, {}));
    expect(await api.submit({ title: 't', body: 'b' })).toMatchObject({ ok: false, status: 401, code: 'unauthorized' });
    expect(calls).toHaveLength(0);
  });
});

describe('get, remove, list', () => {
  test('get returns title and body; 410 and 404 come back as statuses', async () => {
    expect(await mk('tok', () => json(200, { title: 'T', body: 'B' })).api.get('id1')).toEqual({ ok: true, title: 'T', body: 'B' });
    expect(await mk('tok', () => json(410, { error: 'file_gone' })).api.get('id1')).toEqual({ ok: false, status: 410 });
    expect(await mk('tok', () => json(404, { error: 'not_found' })).api.get('id1')).toEqual({ ok: false, status: 404 });
    const { api, calls } = mk('tok', () => json(200, { title: 'T', body: 'B' }));
    await api.get('id1');
    expect(sent(calls[0]!)).toEqual({ action: 'get', id: 'id1' });
  });
  test('remove is true when deleted, and when it was already gone; false on a real failure', async () => {
    const ok = mk('tok', () => json(200, { deleted: true }));
    expect(await ok.api.remove('id1')).toBe(true);
    expect(sent(ok.calls[0]!)).toEqual({ action: 'delete', id: 'id1' });
    expect(await mk('tok', () => json(404, {})).api.remove('id1')).toBe(true);
    expect(await mk('tok', () => json(502, { error: 'drive_unavailable' })).api.remove('id1')).toBe(false);
  });
  test('list reads titles and dates straight from the table, newest first (the database decides what is visible)', async () => {
    const { api, calls } = mk('tok', () => json(200, [{ id: 'a', title: 'One', created_at: '2026-11-01T00:00:00Z' }]));
    expect(await api.list()).toEqual([{ id: 'a', title: 'One', createdAt: '2026-11-01T00:00:00Z' }]);
    expect(calls[0]!.url).toBe(`${URL}/rest/v1/reports?select=id,title,created_at&order=created_at.desc`);
    expect(calls[0]!.init.method ?? 'GET').toBe('GET');
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });
  test('list throws on failure so the page shows its error', async () => {
    await expect(mk('tok', () => json(500, {})).api.list()).rejects.toThrow();
    await expect(mk(null, () => json(200, [])).api.list()).rejects.toThrow();
  });
});

describe('review: supervisor', () => {
  const fb = { id: 'f1', scores: { picture: 3 }, comments: 'ok', status: 'draft', released_at: null };
  test('listForReview reads reports and student names with the supervisor’s own token', async () => {
    const { api, calls } = mk('tok', (u) =>
      u.includes('/reports?')
        ? json(200, [{ id: 'r1', title: 'One', created_at: '2026-11-01T00:00:00Z', status: 'submitted', delete_after: '2027-04-01', user_id: 'u1', deid_summary: { 'cjk-name': { found: 2, rewritten: 0, notIdentifying: 0 } } }])
        : json(200, [{ id: 'u1', display_name: 'Alice' }]));
    expect(await api.listForReview()).toEqual([
      { id: 'r1', title: 'One', createdAt: '2026-11-01T00:00:00Z', studentName: 'Alice', status: 'submitted', deleteAfter: '2027-04-01', summary: { 'cjk-name': { found: 2 } } },
    ]);
    expect(calls.map((c) => c.url)).toEqual([
      `${URL}/rest/v1/reports?select=id,title,created_at,status,delete_after,user_id,deid_summary&order=created_at.desc`,
      `${URL}/rest/v1/profiles?select=id,display_name&role=eq.student`,
    ]);
    expect(calls.every((c) => (c.init.headers as Record<string, string>).Authorization === 'Bearer tok')).toBe(true);
  });
  test('a report whose student is not found still lists, with an empty name; a failed read throws', async () => {
    const { api } = mk('tok', (u) => (u.includes('/reports?') ? json(200, [{ id: 'r1', title: 'One', created_at: 'd', status: 'reviewed', delete_after: 'x', user_id: 'gone', deid_summary: {} }]) : json(200, [])));
    expect((await api.listForReview())[0]).toMatchObject({ studentName: '', status: 'reviewed', summary: {} });
    await expect(mk('tok', () => json(500, {})).api.listForReview()).rejects.toThrow();
  });
  test('myFeedback reads the newest row for the report; null when there is none', async () => {
    const { api, calls } = mk('tok', () => json(200, [fb]));
    expect(await api.myFeedback('r1')).toEqual({ id: 'f1', scores: { picture: 3 }, comments: 'ok', status: 'draft', releasedAt: null });
    expect(calls[0]!.url).toBe(`${URL}/rest/v1/feedback?report_id=eq.r1&select=id,scores,comments,status,released_at&order=created_at.desc&limit=1`);
    expect(await mk('tok', () => json(200, [])).api.myFeedback('r1')).toBeNull();
    await expect(mk('tok', () => json(500, {})).api.myFeedback('r1')).rejects.toThrow();
  });
  test('saveFeedback inserts a new draft signed by the supervisor', async () => {
    const { api, calls } = mk('tok', (u, i) => (i.method === 'POST' ? json(201, [{ ...fb, scores: { picture: 4 }, comments: 'hello' }]) : json(200, [])));
    const r = await api.saveFeedback('r1', { scores: { picture: 4 }, comments: 'hello' }, false);
    expect(r).toEqual({ ok: true, record: { id: 'f1', scores: { picture: 4 }, comments: 'hello', status: 'draft', releasedAt: null } });
    const post = calls.find((c) => c.init.method === 'POST')!;
    expect(post.url).toBe(`${URL}/rest/v1/feedback`);
    expect(sent(post)).toEqual({ report_id: 'r1', author_id: 'sup-1', scores: { picture: 4 }, comments: 'hello' });
    expect((post.init.headers as Record<string, string>).Prefer).toBe('return=representation');
  });
  test('saveFeedback updates the existing row, and a release sets status and time once', async () => {
    const { api, calls } = mk('tok', (u, i) => (i.method === 'PATCH' ? json(200, [{ ...fb, status: 'released', released_at: '2026-11-23T00:00:00Z' }]) : json(200, [fb])));
    const r = await api.saveFeedback('r1', { scores: { picture: 3 }, comments: 'ok' }, true);
    expect(r).toMatchObject({ ok: true, record: { status: 'released' } });
    const patch = calls.find((c) => c.init.method === 'PATCH')!;
    expect(patch.url).toBe(`${URL}/rest/v1/feedback?id=eq.f1`);
    expect(sent(patch)).toMatchObject({ scores: { picture: 3 }, comments: 'ok', status: 'released' });
    expect(typeof sent(patch).released_at).toBe('string');
  });
  test('correcting released feedback does not move its release time or status', async () => {
    const released = { ...fb, status: 'released', released_at: '2026-11-20T00:00:00Z' };
    const { api, calls } = mk('tok', (u, i) => (i.method === 'PATCH' ? json(200, [released]) : json(200, [released])));
    await api.saveFeedback('r1', { scores: { picture: 3 }, comments: 'fixed' }, true);
    expect(sent(calls.find((c) => c.init.method === 'PATCH')!)).toEqual({ scores: { picture: 3 }, comments: 'fixed' });
  });
  test('a refusal from the database (an incomplete release) is a failure, not a throw', async () => {
    const { api } = mk('tok', (u, i) => (i.method === 'PATCH' ? json(400, { code: '23514' }) : json(200, [fb])));
    expect(await api.saveFeedback('r1', { scores: {}, comments: '' }, true)).toEqual({ ok: false });
  });
  test('purgeExpired and driveStatus call the function', async () => {
    const p = mk('tok', () => json(200, { purged: 2, failed: 0, more: false, driveError: null }));
    expect(await p.api.purgeExpired()).toEqual({ ok: true, purged: 2, failed: 0, more: false, driveError: null });
    expect(sent(p.calls[0]!)).toEqual({ action: 'purge' });
    expect(await mk('tok', () => json(403, { error: 'not_allowed' })).api.purgeExpired()).toEqual({ ok: false, status: 403 });
    const d = mk('tok', () => json(200, { status: 'auth' }));
    expect(await d.api.driveStatus()).toBe('auth');
    expect(sent(d.calls[0]!)).toEqual({ action: 'drive_status' });
    expect(await mk('tok', () => json(500, {})).api.driveStatus()).toBe('error');
    expect(await mk('tok', () => json(200, { status: 'weird' })).api.driveStatus()).toBe('error');
  });
});

describe('review: student', () => {
  test('releasedFeedback asks only for released rows', async () => {
    const { api, calls } = mk('tok', () => json(200, [{ id: 'f1', scores: { picture: 3 }, comments: 'ok', status: 'released', released_at: '2026-11-20T00:00:00Z' }]));
    expect(await api.releasedFeedback('r1')).toMatchObject({ id: 'f1', status: 'released', releasedAt: '2026-11-20T00:00:00Z' });
    expect(calls[0]!.url).toBe(`${URL}/rest/v1/feedback?report_id=eq.r1&status=eq.released&select=id,scores,comments,status,released_at&order=released_at.desc&limit=1`);
  });
  test('null when nothing is released; a failure throws', async () => {
    expect(await mk('tok', () => json(200, [])).api.releasedFeedback('r1')).toBeNull();
    await expect(mk('tok', () => json(500, {})).api.releasedFeedback('r1')).rejects.toThrow();
  });
});
