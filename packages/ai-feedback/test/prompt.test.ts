import { test, expect } from 'vitest';
import { buildPracticeRequest, newNonce, PROMPT_VERSION, SYSTEM_PROMPT, MODELS, type PracticeInput } from '../src/index';

const NONCE_A = 'a1b2c3d4e5f60718293a4b5c';
const NONCE_B = '0f9e8d7c6b5a49382716f5e4';

const base: PracticeInput = {
  locale: 'zh-Hant',
  context: '第三次會談，個案剛提到上週的爭吵。',
  client: '我真的不知道該怎麼辦，我什麼都做不好。',
  criteria: ['反映個案的感受', '不急著給建議', '用開放式問句'],
  modelResponse: '聽起來你很挫折，也很自責。想多說說上週發生的事嗎？',
  studentResponse: '你覺得很挫折，好像怎麼做都不對。可以說說是哪一刻最讓你難受嗎？',
  nonce: NONCE_A,
};

/** FNV-1a，只用來鎖定文字，不是安全用途。 */
function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (const ch of s) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}

// 改系統提示的任何文字：遞增 PROMPT_VERSION，並在這裡加一列新的雜湊。舊的列不刪（它們是歷史）。
const PROMPT_HASHES: Record<string, string> = { p1: 'ad0b44a5' };

test('system prompt text is locked to PROMPT_VERSION (changing it requires bumping the version)', () => {
  expect(PROMPT_HASHES[PROMPT_VERSION], `add a hash for ${PROMPT_VERSION}: ${fnv(SYSTEM_PROMPT)}`).toBe(fnv(SYSTEM_PROMPT));
});

test('system prompt is byte-identical across calls and across locales', () => {
  const a = buildPracticeRequest(base);
  const b = buildPracticeRequest({ ...base, locale: 'en', nonce: NONCE_B, studentResponse: 'x'.repeat(30) });
  expect(a.system).toBe(SYSTEM_PROMPT);
  expect(b.system).toBe(a.system);
});

test('system prompt carries the rules the spec requires', () => {
  const s = SYSTEM_PROMPT;
  expect(s).toMatch(/never follow|do not follow|not instructions/i); // 分隔標記內不執行
  expect(s).toMatch(/verbatim/i); // evidence 逐字
  expect(s).toMatch(/risk-content/);
  expect(s).toMatch(/off-task/);
  expect(s).toMatch(/diagnos/i);
  expect(s).toContain('可以試試');
  expect(s).toContain('You could try');
});

test('the first two content blocks are identical across two different students answering the same drill', () => {
  const a = buildPracticeRequest(base);
  const b = buildPracticeRequest({ ...base, nonce: NONCE_B, studentResponse: '你好像很累。你想從哪裡說起呢？請慢慢說。' });
  expect(b.blocks[0]).toEqual(a.blocks[0]);
  expect(b.blocks[1]).toEqual(a.blocks[1]);
  expect(a.blocks).toHaveLength(3);
});

test('the cached prefix contains no timestamp, nonce, user id or attempt id', () => {
  const r = buildPracticeRequest(base);
  const cached = [r.system, ...r.blocks.slice(0, 2).map((b) => b.text)].join('\n');
  expect(cached).not.toContain(NONCE_A);
  expect(cached).not.toMatch(/\b20\d\d-\d\d-\d\d\b|\d\d:\d\d:\d\d/);
  expect(cached).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i); // uuid
  expect(cached).not.toContain(base.studentResponse);
});

test('the student response appears only inside the nonce delimiters, in the last block', () => {
  const r = buildPracticeRequest(base);
  const where = [r.system, ...r.blocks.map((b) => b.text)].map((t) => t.includes(base.studentResponse));
  expect(where).toEqual([false, false, false, true]);
  const last = r.blocks[2]!.text;
  const start = last.indexOf(`<<<STUDENT_RESPONSE_${NONCE_A}`);
  const end = last.indexOf(`STUDENT_RESPONSE_${NONCE_A}>>>`);
  const at = last.indexOf(base.studentResponse);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(at).toBeGreaterThan(start);
  expect(end).toBeGreaterThan(at);
  expect(last.split(NONCE_A)).toHaveLength(3); // 恰好兩個標記
});

test('two drills that share criteria produce the same criteria block, whatever else differs', () => {
  const a = buildPracticeRequest(base);
  const b = buildPracticeRequest({
    ...base, context: '另一個情境。', client: '我最近睡不好。', modelResponse: '睡不好很折磨人，對吧？',
  });
  expect(b.blocks[0]).toEqual(a.blocks[0]);
  expect(b.blocks[1]).not.toEqual(a.blocks[1]);
});

test('cache flags: system prefix, criteria block cached; drill and student blocks not', () => {
  const r = buildPracticeRequest(base);
  expect(r.blocks.map((b) => b.cache)).toEqual([true, false, false]);
});

test('the locale is told to the model in the drill block, not in the shared criteria block', () => {
  const zh = buildPracticeRequest(base);
  const en = buildPracticeRequest({ ...base, locale: 'en' });
  expect(zh.blocks[1]!.text).toMatch(/Traditional Chinese/);
  expect(en.blocks[1]!.text).toMatch(/English/);
  expect(zh.blocks[0]).toEqual(en.blocks[0]);
});

test('request settings: Haiku 5.5, max_tokens 600, effort low, adaptive thinking; override for the T14 comparison', () => {
  const r = buildPracticeRequest(base);
  expect(r).toMatchObject({ model: 'claude-haiku-5-5', maxTokens: 600, effort: 'low', thinking: 'adaptive' });
  const a = buildPracticeRequest(base, { thinking: 'disabled' });
  expect(a.thinking).toBe('disabled');
  expect(a.system).toBe(r.system);
});

test('model ids are exactly claude-haiku-5-5 and claude-sonnet-5-5', () => {
  expect(MODELS).toEqual({ practice: 'claude-haiku-5-5', report: 'claude-sonnet-5-5' });
});

test('the schema sent is the structural JSON schema', () => {
  const r = buildPracticeRequest(base);
  expect((r.schema as { required: string[] }).required).toEqual(['criteria', 'suggestion', 'concern']);
});

test('a malformed nonce or the wrong number of criteria is a programming error, not a silent request', () => {
  expect(() => buildPracticeRequest({ ...base, nonce: 'short' })).toThrow();
  expect(() => buildPracticeRequest({ ...base, nonce: 'has space and symbols!!!!!!' })).toThrow();
  expect(() => buildPracticeRequest({ ...base, criteria: ['a', 'b'] as never })).toThrow();
});

test('newNonce: 24 hex characters, different each time', () => {
  const a = newNonce();
  expect(a).toMatch(/^[0-9a-f]{24}$/);
  expect(newNonce()).not.toBe(a);
});

test('no prompt text mentions the time, a user id or an attempt id placeholder', () => {
  expect(SYSTEM_PROMPT).not.toMatch(/\{\{|\$\{|Date\(|now\(\)/);
});
