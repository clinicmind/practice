import { test, expect } from 'vitest';
import {
  buildPracticeRequest, createAnthropicClient, LlmError, API_VERSION, ANTHROPIC_MESSAGES_URL,
  type LlmRequest,
} from '../src/index';

const SECRET = 'sk-ant-test-0000-fictional-key';
const req: LlmRequest = buildPracticeRequest({
  locale: 'en', context: 'Session 3.', client: 'I cannot cope.', criteria: ['a', 'b', 'c'],
  modelResponse: 'm', studentResponse: 'That sounds really hard, tell me more about it.', nonce: 'a1b2c3d4e5f60718293a4b5c',
});

type Call = { url: string; init: RequestInit; body: any };
function fake(replies: (Response | Error)[]) {
  const calls: Call[] = [];
  const fetchFn = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {}, body: JSON.parse(String(init?.body ?? '{}')) });
    const next = replies[Math.min(calls.length - 1, replies.length - 1)]!;
    if (next instanceof Error) throw next;
    return next.clone();
  };
  return { calls, fetchFn: fetchFn as typeof fetch };
}
const ok = (over: Record<string, unknown> = {}) =>
  new Response(JSON.stringify({
    id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-haiku-5-5',
    content: [{ type: 'thinking', thinking: '', signature: 's' }, { type: 'text', text: '{"a":1}' }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 700, output_tokens: 150, cache_creation_input_tokens: 1300, cache_read_input_tokens: 0 },
    ...over,
  }), { status: 200, headers: { 'content-type': 'application/json' } });
const status = (n: number, body = '{"error":{"type":"x","message":"secret detail sk-ant-leak"}}') => new Response(body, { status: n });
const noSleep = async () => {};

function client(replies: (Response | Error)[]) {
  const f = fake(replies);
  return { ...f, llm: createAnthropicClient({ apiKey: SECRET, fetchFn: f.fetchFn, sleep: noSleep }) };
}

test('request goes to the Messages endpoint with the key and version headers; the key is not in the body', async () => {
  const { llm, calls } = client([ok()]);
  await llm.complete(req);
  expect(calls).toHaveLength(1);
  expect(calls[0]!.url).toBe(ANTHROPIC_MESSAGES_URL);
  expect(ANTHROPIC_MESSAGES_URL).toBe('https://api.anthropic.com/v1/messages');
  const h = new Headers(calls[0]!.init.headers);
  expect(h.get('x-api-key')).toBe(SECRET);
  expect(h.get('anthropic-version')).toBe(API_VERSION);
  expect(h.get('content-type')).toBe('application/json');
  expect(JSON.stringify(calls[0]!.body)).not.toContain(SECRET);
  expect(calls[0]!.init.method).toBe('POST');
});

test('request body has no temperature, top_p, top_k or prefill, has max_tokens 600 and effort set', async () => {
  const { llm, calls } = client([ok()]);
  await llm.complete(req);
  const b = calls[0]!.body;
  for (const k of ['temperature', 'top_p', 'top_k']) expect(b).not.toHaveProperty(k);
  expect(b.max_tokens).toBe(600);
  expect(b.output_config.effort).toBe('low');
  expect(b.model).toBe('claude-haiku-5-5');
  expect(b.thinking).toEqual({ type: 'adaptive' });
  expect(b.messages).toHaveLength(1);
  expect(b.messages[0].role).toBe('user'); // 最後一則是 user：沒有 assistant prefill
  expect(b).not.toHaveProperty('output_format');
  expect(b).not.toHaveProperty('tool_choice');
});

test('thinking disabled is sent as {type:"disabled"}', async () => {
  const { llm, calls } = client([ok()]);
  await llm.complete({ ...req, thinking: 'disabled' });
  expect(calls[0]!.body.thinking).toEqual({ type: 'disabled' });
});

test('request body has two cache_control breakpoints and a json_schema output format', async () => {
  const { llm, calls } = client([ok()]);
  await llm.complete(req);
  const b = calls[0]!.body;
  const count = JSON.stringify(b).split('"cache_control"').length - 1;
  expect(count).toBe(2);
  expect(b.system[0].cache_control).toEqual({ type: 'ephemeral' });
  expect(b.messages[0].content[0].cache_control).toEqual({ type: 'ephemeral' });
  expect(b.messages[0].content[2]).not.toHaveProperty('cache_control');
  expect(b.output_config.format.type).toBe('json_schema');
  expect(b.output_config.format.schema).toEqual(req.schema);
});

test('success: text comes from text blocks only; usage maps cache fields', async () => {
  const { llm } = client([ok()]);
  expect(await llm.complete(req)).toEqual({
    stopReason: 'end_turn', text: '{"a":1}', usage: { input: 700, output: 150, cacheWrite: 1300, cacheRead: 0 },
  });
});

test('missing cache usage fields count as 0', async () => {
  const { llm } = client([ok({ usage: { input_tokens: 5, output_tokens: 6 } })]);
  expect((await llm.complete(req)).usage).toEqual({ input: 5, output: 6, cacheWrite: 0, cacheRead: 0 });
});

test('stop_reason refusal → { stopReason: "refusal", text: null }, usage still reported', async () => {
  const { llm } = client([ok({ stop_reason: 'refusal', stop_details: { type: 'refusal', category: 'general_harms' }, content: [{ type: 'text', text: 'partial' }] })]);
  const r = await llm.complete(req);
  expect(r.stopReason).toBe('refusal');
  expect(r.text).toBeNull();
  expect(r.usage.output).toBe(150);
});

test('max_tokens → "max_tokens" with no text; other stop reasons → "other"', async () => {
  const a = await client([ok({ stop_reason: 'max_tokens' })]).llm.complete(req);
  expect(a).toMatchObject({ stopReason: 'max_tokens', text: null });
  const b = await client([ok({ stop_reason: 'pause_turn' })]).llm.complete(req);
  expect(b).toMatchObject({ stopReason: 'other', text: null });
});

test('end_turn with no text block gives text null', async () => {
  const { llm } = client([ok({ content: [{ type: 'thinking', thinking: '', signature: 's' }] })]);
  expect(await llm.complete(req)).toMatchObject({ stopReason: 'end_turn', text: null });
});

test('429 then 200: retried once and succeeds', async () => {
  const { llm, calls } = client([status(429), ok()]);
  expect((await llm.complete(req)).stopReason).toBe('end_turn');
  expect(calls).toHaveLength(2);
});

test('429 and 5xx become LlmError and are retried at most once', async () => {
  for (const [code, kind] of [[429, 'rate_limited'], [500, 'unavailable'], [503, 'unavailable'], [529, 'unavailable']] as const) {
    const { llm, calls } = client([status(code)]);
    const err = await llm.complete(req).catch((e) => e);
    expect(err).toBeInstanceOf(LlmError);
    expect(err.kind).toBe(kind);
    expect(calls).toHaveLength(2);
  }
});

test('a network error is retried once, then becomes unavailable', async () => {
  const { llm, calls } = client([new TypeError('fetch failed')]);
  const err = await llm.complete(req).catch((e) => e);
  expect(err).toBeInstanceOf(LlmError);
  expect(err.kind).toBe('unavailable');
  expect(calls).toHaveLength(2);
});

test('400 is bad_request and 401/403 are auth: no retry', async () => {
  for (const [code, kind] of [[400, 'bad_request'], [404, 'bad_request'], [413, 'bad_request'], [401, 'auth'], [403, 'auth']] as const) {
    const { llm, calls } = client([status(code)]);
    const err = await llm.complete(req).catch((e) => e);
    expect(err.kind).toBe(kind);
    expect(calls).toHaveLength(1);
  }
});

test('a timeout is unavailable and is not retried (the first request may already be billed)', async () => {
  const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
  const { llm, calls } = client([abort]);
  const err = await llm.complete(req).catch((e) => e);
  expect(err.kind).toBe('unavailable');
  expect(calls).toHaveLength(1);
});

test('the API key and the response body never appear in an error message or thrown value', async () => {
  for (const replies of [[status(401)], [status(500)], [new TypeError(`boom ${SECRET}`)], [status(400, `echo ${SECRET}`)]]) {
    const { llm } = client(replies);
    const err = await llm.complete(req).catch((e) => e);
    const dump = `${err.message} ${err.stack ?? ''} ${JSON.stringify(err)} ${String(err)}`;
    expect(dump).not.toContain(SECRET);
    expect(dump).not.toContain('sk-ant');
    expect(dump).not.toContain('secret detail');
  }
});

test('a body that is not JSON or lacks the fields is an unavailable error, not a crash', async () => {
  const { llm } = client([new Response('<html>', { status: 200 })]);
  expect((await llm.complete(req).catch((e) => e)).kind).toBe('unavailable');
  const { llm: l2 } = client([new Response('{"nope":1}', { status: 200 })]);
  expect((await l2.complete(req).catch((e) => e)).kind).toBe('unavailable');
});

test('construction fails without a key', () => {
  expect(() => createAnthropicClient({ apiKey: '', fetchFn: fetch })).toThrow();
});
