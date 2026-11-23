import { describe, expect, test, vi } from 'vitest';
import { createCloudReportsApi } from './cloudApi';

// All names and text are fictional.
const URL = 'https://proj.supabase.test';
const mk = (token: string | null, respond: (u: string, i: RequestInit) => Response | Promise<Response>) => {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchFn = vi.fn(async (u: RequestInfo | URL, i?: RequestInit) => { calls.push({ url: String(u), init: i ?? {} }); return respond(String(u), i ?? {}); });
  const api = createCloudReportsApi({ url: URL, anonKey: 'anon-fiction', getToken: async () => token, fetch: fetchFn as unknown as typeof fetch });
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
