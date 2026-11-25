// @vitest-environment node
import { describe, expect, test } from 'vitest';
import {
  compareDecision,
  compareDrill,
  countSentences,
  findForbiddenTerms,
  maxSentencesRequested,
  checkModelLength,
  parseReportRefs,
} from './review-precheck';

describe('findForbiddenTerms', () => {
  test('finds English diagnosis, medication and scale names, case-insensitively, on word boundaries', () => {
    const hits = findForbiddenTerms('She was told it was PTSD, then started sertraline. The PHQ-9 was normal.');
    expect(hits.map((h) => h.term).sort()).toEqual(['PHQ-9', 'PTSD', 'sertraline'].sort());
    expect(hits.find((h) => h.term === 'PTSD')!.category).toBe('diagnosis');
    expect(hits.find((h) => h.term === 'sertraline')!.category).toBe('medication');
    expect(hits.find((h) => h.term === 'PHQ-9')!.category).toBe('scale');
  });
  test('finds Chinese terms', () => {
    const hits = findForbiddenTerms('醫師說是憂鬱症，開了百憂解，還做了貝克憂鬱量表。');
    expect(hits.map((h) => h.term).sort()).toEqual(['憂鬱症', '百憂解', '貝克憂鬱量表'].sort());
  });
  test('does not match inside longer words or ordinary feeling words', () => {
    expect(findForbiddenTerms('I felt depressed and anxious, and the ocdx "adhesive" word is fine: ADHD? no.')
      .map((h) => h.term)).toEqual(['ADHD']);
    expect(findForbiddenTerms('他很憂鬱，也很焦慮。')).toEqual([]);
  });
  test('all-capital acronyms are case-sensitive, so ordinary words are not hit', () => {
    expect(findForbiddenTerms('She did what he said, and the audit was fine.')).toEqual([]);
    expect(findForbiddenTerms('Screened with the AUDIT and a DID check.').map((h) => h.term).sort()).toEqual(['AUDIT', 'DID']);
  });
  test('reports each term once', () => {
    expect(findForbiddenTerms('PTSD PTSD ptsd')).toHaveLength(1);
  });
});

describe('countSentences', () => {
  test('counts English sentences, ignoring abbreviations and ellipses inside a sentence', () => {
    expect(countSentences('One. Two! Three?')).toBe(3);
    expect(countSentences('Something, e.g. a sound, stops you. Maybe that is it.')).toBe(2);
    expect(countSentences('"You stop in the hallway." Maybe there is more.')).toBe(2);
    expect(countSentences('A single line with no end')).toBe(1);
    expect(countSentences('')).toBe(0);
  });
  test('counts Chinese sentences', () => {
    expect(countSentences('你停在走廊。好像有些東西說不清？')).toBe(2);
    expect(countSentences('「你說沒事。」也許有一部分的你知道不是。')).toBe(2);
  });
});

describe('maxSentencesRequested', () => {
  test('reads the limit from English and Chinese task text', () => {
    expect(maxSentencesRequested('Task: write one or two sentences that invite')).toBe(2);
    expect(maxSentencesRequested('It is two or three sentences, offered as')).toBe(3);
    expect(maxSentencesRequested('Write one sentence.')).toBe(1);
    expect(maxSentencesRequested('Write no more than three sentences.')).toBe(3);
    expect(maxSentencesRequested('任務：寫一至兩句話，邀請個案')).toBe(2);
    expect(maxSentencesRequested('只有兩句短句。')).toBe(2);
    expect(maxSentencesRequested('用兩到三句話回應')).toBe(3);
    expect(maxSentencesRequested('寫一句話')).toBe(1);
  });
  test('returns undefined when no limit is stated', () => {
    expect(maxSentencesRequested('Respond to the client.')).toBeUndefined();
  });
});

describe('checkModelLength', () => {
  const drill = (extra = {}) => ({
    context: 'Task: write one or two sentences.',
    criteria: ['a', 'b', 'c'] as [string, string, string],
    ...extra,
  });
  test('flags a model response with more sentences than asked', () => {
    const flag = checkModelLength(drill(), 'One. Two. Three.', 'en');
    expect(flag?.kind).toBe('sentence-count');
    expect(flag?.message).toMatch(/3/);
    expect(flag?.message).toMatch(/2/);
  });
  test('is quiet when within the limit or no limit is stated', () => {
    expect(checkModelLength(drill(), 'One. Two.', 'en')).toBeUndefined();
    expect(checkModelLength({ context: 'Reply.', criteria: ['a', 'b', 'c'] }, 'One. Two. Three. Four.', 'en')).toBeUndefined();
  });
  test('works for Chinese', () => {
    const d = { context: '任務：寫一至兩句話。', criteria: ['a', 'b', 'c'] as [string, string, string] };
    expect(checkModelLength(d, '一。二。三。', 'zh-Hant')?.kind).toBe('sentence-count');
    expect(checkModelLength(d, '一。二。', 'zh-Hant')).toBeUndefined();
  });
});

describe('compareDrill (English vs Chinese structure)', () => {
  const en = { model_response: 'You stop in the hallway. Maybe something is there?', why: 'x', avoid: 'y', client: 'Hi. What now?' };
  const zh = { model_response: '你停在走廊。也許有些東西在那裡？', why: 'x', avoid: 'y', client: '嗨。現在怎麼辦？' };
  test('is quiet when the two match', () => {
    expect(compareDrill(en, zh)).toEqual([]);
  });
  test('flags a big difference in sentence count', () => {
    const flags = compareDrill(en, { ...zh, model_response: '一。二。三。四？' });
    expect(flags.map((f) => f.kind)).toEqual(['structure']);
  });
  test('flags a question in one language but not the other', () => {
    const flags = compareDrill(en, { ...zh, model_response: '你停在走廊。也許有些東西在那裡。' });
    expect(flags.some((f) => /問句|question/.test(f.message))).toBe(true);
  });
  test('flags a missing side', () => {
    expect(compareDrill(en, undefined)[0].message).toMatch(/繁中/);
    expect(compareDrill(undefined, zh)[0].message).toMatch(/英文/);
  });
});

describe('compareDecision', () => {
  const opt = (id: string, fit: string) => ({ id, text: id, fit, note: id });
  const base = { type: 'choice', options: [opt('a', 'strong'), opt('b', 'workable'), opt('c', 'weak')] };
  test('is quiet when types, option ids and fits agree', () => {
    expect(compareDecision(base as any, base as any)).toEqual([]);
  });
  test('flags different fit, type or option ids', () => {
    const fit = { ...base, options: [opt('a', 'workable'), opt('b', 'workable'), opt('c', 'weak')] };
    expect(compareDecision(base as any, fit as any)[0].message).toMatch(/fit/);
    expect(compareDecision(base as any, { type: 'free' } as any)[0].message).toMatch(/free|choice|類型/);
    const ids = { ...base, options: [opt('a', 'strong'), opt('b', 'workable'), opt('d', 'weak')] };
    expect(compareDecision(base as any, ids as any)[0].message).toMatch(/選項/);
  });
});

describe('parseReportRefs', () => {
  const md = [
    '# 報告',
    '',
    '## 摘要',
    '',
    '1. **模組 2 難題 h01–h05 的示範回應，沒有達到標準。**（`eft-two-emotion-h01`）',
    '2. 看 `demo-intro-e02` 和走讀 s1-d1。',
    '',
    '## 模組 1：`demo-intro`',
    '',
    '- e02：沒有猜測語氣。',
    '- m03、m04 直陳；s1-d1 的理由前後不一。',
    '- e99：不存在的題目。',
    '',
    '## 模組 2：`demo-second`',
    '',
    '- h03：模糊。',
  ].join('\n');
  const mods = ['demo-intro', 'demo-second'];
  const ids = new Map([
    ['demo-intro', new Set(['demo-intro-e02', 'demo-intro-m03', 'demo-intro-m04', 'demo-intro-s1-d1'])],
    ['demo-second', new Set(['demo-second-h01', 'demo-second-h02', 'demo-second-h03', 'demo-second-h04', 'demo-second-h05'])],
  ]);
  const refs = parseReportRefs(md, 'r.md', mods, ids);
  test('uses the heading section for short ids', () => {
    expect(refs.get('demo-intro-e02')!.map((r) => r.line)).toContain(10);
    expect(refs.get('demo-intro-m03')![0].line).toBe(11);
    expect(refs.get('demo-intro-m04')![0].line).toBe(11);
    expect(refs.get('demo-intro-s1-d1')!.map((r) => r.line)).toContain(11);
    expect(refs.get('demo-second-h03')!.map((r) => r.line)).toContain(16);
  });
  test('uses a "模組 N" mention on the line, and expands ranges', () => {
    for (const n of ['h01', 'h02', 'h03', 'h04', 'h05']) {
      expect(refs.get(`demo-second-${n}`)!.some((r) => r.line === 5)).toBe(true);
    }
  });
  test('full ids work anywhere; ids that do not exist in the content are dropped', () => {
    expect(refs.get('demo-intro-e02')!.some((r) => r.line === 6)).toBe(true);
    expect(refs.has('demo-intro-e99')).toBe(false);
  });
  test('each ref carries the report name, the line text, and the nearest heading', () => {
    const r = refs.get('demo-intro-m03')![0];
    expect(r.report).toBe('r.md');
    expect(r.text).toContain('m03、m04');
    expect(r.heading).toBe('模組 1：`demo-intro`');
  });
});
