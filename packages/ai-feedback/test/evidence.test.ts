import { test, expect } from 'vitest';
import { checkOutput } from '../src/index';
import { output, RESPONSE_EN, RESPONSE_ZH } from './fixtures';

const crit = (...ev: [boolean, string][]) => ev.map(([met, evidence]) => ({ met, evidence }));

test('evidence that is a substring passes; a paraphrase is rejected', () => {
  expect(checkOutput(output(), RESPONSE_ZH, 'zh-Hant').ok).toBe(true);
  const para = output({ criteria: crit([true, '你這幾週很疲累'], [false, ''], [false, '']) });
  expect(checkOutput(para, RESPONSE_ZH, 'zh-Hant')).toEqual({ ok: false, reason: 'evidence' });
});

test('evidence differing only by runs of whitespace passes', () => {
  const o = output({
    criteria: crit([true, 'last few weeks have been exhausting. What made it'], [true, 'unbearable? I would like'], [false, '']),
    suggestion: 'You could try asking about sleep later.',
  });
  expect(checkOutput(o, RESPONSE_EN, 'en').ok).toBe(true);
});

test('evidence differing by one character, by full-width punctuation or by case is rejected', () => {
  const cases: [string, string][] = [
    ['聽起來你這幾週真的很累', '聽起來你這幾周真的很累'],
    ['是什麼讓你覺得撐不下去了？', '是什麼讓你覺得撐不下去了?'],
    ['It sounds like the last few weeks', 'it sounds like the last few weeks'],
    ['It sounds like', 'It sounds like!'],
  ];
  for (const [resp, ev] of cases) {
    const o = output({ criteria: crit([true, ev], [false, ''], [false, '']), suggestion: 'x' });
    expect(checkOutput(o, resp.includes('聽') || resp.includes('是什麼') ? RESPONSE_ZH : RESPONSE_EN, 'zh-Hant')).toEqual({ ok: false, reason: 'evidence' });
  }
});

test('evidence is not allowed to be wrapped in other text from the model', () => {
  const o = output({ criteria: crit([true, '聽起來你這幾週真的很累。是嗎'], [false, ''], [false, '']) });
  expect(checkOutput(o, RESPONSE_ZH, 'zh-Hant')).toEqual({ ok: false, reason: 'evidence' });
});

test('empty evidence is allowed when met is false', () => {
  const o = output({ criteria: crit([false, ''], [false, ''], [false, '']) });
  const r = checkOutput(o, RESPONSE_ZH, 'zh-Hant');
  expect(r.ok).toBe(true);
  if (r.ok) expect(r.warnings).toEqual([]);
});

test('met true with empty evidence passes with an "unsupported" warning', () => {
  const o = output({ criteria: crit([true, ''], [false, ''], [true, '']) });
  const r = checkOutput(o, RESPONSE_ZH, 'zh-Hant');
  expect(r.ok).toBe(true);
  if (r.ok) expect(r.warnings).toEqual([{ criterion: 0, kind: 'unsupported' }, { criterion: 2, kind: 'unsupported' }]);
});

test('non-empty evidence on a met=false criterion must also be a substring', () => {
  const o = output({ criteria: crit([false, '我沒說過這句話'], [false, ''], [false, '']) });
  expect(checkOutput(o, RESPONSE_ZH, 'zh-Hant')).toEqual({ ok: false, reason: 'evidence' });
});

test('suggestion over 60 CJK characters is rejected; at 60 passes (zh-Hant)', () => {
  const at60 = '可'.repeat(60);
  expect(checkOutput(output({ suggestion: at60 }), RESPONSE_ZH, 'zh-Hant').ok).toBe(true);
  expect(checkOutput(output({ suggestion: at60 + '可' }), RESPONSE_ZH, 'zh-Hant')).toEqual({ ok: false, reason: 'suggestion_length' });
});

test('suggestion length counts code points, not UTF-16 units', () => {
  const rare = '𠮷'.repeat(60); // 60 code points, 120 UTF-16 units
  expect(checkOutput(output({ suggestion: rare }), RESPONSE_ZH, 'zh-Hant').ok).toBe(true);
});

test('suggestion over 40 words is rejected; at 40 passes (en)', () => {
  const words = (n: number) => Array.from({ length: n }, () => 'word').join(' ');
  const base = { criteria: crit([false, ''], [false, ''], [false, '']) };
  expect(checkOutput(output({ ...base, suggestion: words(40) }), RESPONSE_EN, 'en').ok).toBe(true);
  expect(checkOutput(output({ ...base, suggestion: words(41) }), RESPONSE_EN, 'en')).toEqual({ ok: false, reason: 'suggestion_length' });
  expect(checkOutput(output({ ...base, suggestion: `${words(40)}  \n ` }), RESPONSE_EN, 'en').ok).toBe(true);
});

test('a student response that contains the evidence twice is fine; text not in the response is rejected', () => {
  const resp = '我很累。我很累。';
  const ok = output({ criteria: crit([true, '我很累。'], [false, ''], [false, '']) });
  expect(checkOutput(ok, resp, 'zh-Hant').ok).toBe(true);
  const bad = output({ criteria: crit([true, '我很累。我很累。我很累。'], [false, ''], [false, '']) });
  expect(checkOutput(bad, resp, 'zh-Hant')).toEqual({ ok: false, reason: 'evidence' });
});

test('concern other than none still validates the criteria (fabricated evidence is still rejected)', () => {
  const o = output({ concern: 'risk-content', criteria: crit([true, '捏造'], [false, ''], [false, '']) });
  expect(checkOutput(o, RESPONSE_ZH, 'zh-Hant')).toEqual({ ok: false, reason: 'evidence' });
});
