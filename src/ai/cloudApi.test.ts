import { describe, expect, test, vi } from 'vitest';
import { AiError } from './AiContext';
import { createCloudAiClient } from './cloudApi';

// All text is fictional.
const URL = 'https://proj.supabase.test';
const mk = (token: string | null, respond: (i: RequestInit) => Response | Promise<Response>) => {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchFn = vi.fn(async (u: RequestInfo | URL, i?: RequestInit) => { calls.push({ url: String(u), init: i ?? {} }); return respond(i ?? {}); });
  const client = createCloudAiClient({ url: URL, anonKey: 'anon-fiction', getToken: async () => token, fetch: fetchFn as unknown as typeof fetch });
  return { client, calls };
};
const json = (status: number, v: unknown) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } });
const OK = { status: 'ok', output: { criteria: [{ met: true, evidence: 'a b' }, { met: false, evidence: '' }, { met: true, evidence: '' }], suggestion: 'You could try x.', concern: 'none' }, warnings: [{ criterion: 2, kind: 'unsupported' }] };

describe('cloud AI client', () => {
  test('sends only the action, the attempt id and the language, with the student’s own token', async () => {
    const { client, calls } = mk('tok', () => json(200, OK));
    await client.request('att-1', 'zh-Hant');
    expect(calls[0]!.url).toBe(`${URL}/functions/v1/ai-feedback`);
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ action: 'practice', attempt_id: 'att-1', locale: 'zh-Hant' });
    const h = calls[0]!.init.headers as Record<string, string>;
    expect(h.Authorization).toBe('Bearer tok');
    expect(h.apikey).toBe('anon-fiction');
  });
  test('get uses the read-only action and returns null when nothing is stored', async () => {
    const { client, calls } = mk('tok', () => json(200, { status: 'none' }));
    expect(await client.get('att-1', 'en')).toBeNull();
    expect(JSON.parse(calls[0]!.init.body as string).action).toBe('get');
  });
  test('an ok reply carries the output and which criteria had no quoted words', async () => {
    const r = await mk('tok', () => json(200, OK)).client.request('att-1', 'en');
    expect(r).toMatchObject({ status: 'ok', unsupported: [2] });
  });
  test('a concern reply carries no criteria or suggestion', async () => {
    const r = await mk('tok', () => json(200, { status: 'concern', concern: 'risk-content' })).client.request('att-1', 'en');
    expect(r).toEqual({ status: 'concern', concern: 'risk-content' });
  });
  test.each(['ai_disabled', 'budget_exhausted', 'daily_cap', 'item_cap', 'in_progress', 'unavailable'])('error %s comes back as an AiError with that code', async (code) => {
    await expect(mk('tok', () => json(code === 'ai_disabled' ? 403 : 429, { error: code })).client.request('att-1', 'en')).rejects.toMatchObject({ code });
  });
  test('a reply of the wrong shape, a non-JSON reply and a network failure are all "unavailable"', async () => {
    await expect(mk('tok', () => json(200, { status: 'ok', output: { criteria: [] } })).client.request('a', 'en')).rejects.toMatchObject({ code: 'unavailable' });
    await expect(mk('tok', () => new Response('<html>', { status: 502 })).client.request('a', 'en')).rejects.toMatchObject({ code: 'unavailable' });
    await expect(mk('tok', () => { throw new TypeError('Failed to fetch'); }).client.request('a', 'en')).rejects.toBeInstanceOf(AiError);
  });
  test('request cannot return "nothing stored"', async () => {
    await expect(mk('tok', () => json(200, { status: 'none' })).client.request('a', 'en')).rejects.toMatchObject({ code: 'unavailable' });
  });
  test('no session: unauthorized without calling the network', async () => {
    const { client, calls } = mk(null, () => json(200, OK));
    await expect(client.get('a', 'en')).rejects.toMatchObject({ code: 'unauthorized' });
    expect(calls).toHaveLength(0);
  });
});
