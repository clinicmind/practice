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
  test('punctuation inside a quotation embedded in a sentence is not a sentence end', () => {
    expect(countSentences("When you slip you hear 'Stupid. Again.', and then you can't think. We could try.")).toBe(2);
    expect(countSentences('你一犯錯就聽到「笨。又來了。」然後沒法思考。我們試試。')).toBe(2);
    expect(countSentences("He says, 'Did you really think that would work?' and you feel hot. Where do you feel it?")).toBe(2);
    expect(countSentences('他說：「你真的以為那樣行得通嗎？」而你覺得熱。你在哪裡感覺到它？')).toBe(2);
    expect(countSentences('It is "Stop? Wait?" that she said. Then she left.')).toBe(2);
  });
  test('a quotation that ends the sentence still ends it', () => {
    expect(countSentences("She said 'Stop.' Then she left.")).toBe(2);
    expect(countSentences('她說「停。」')).toBe(1);
    expect(countSentences('她說「停。」她走了。')).toBe(1);
  });
  test('apostrophes inside words are not quotation marks', () => {
    expect(countSentences("It's fine. Don't worry. She'd know.")).toBe(3);
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
  test('"a sentence" in a description is not a limit; after write/in it is', () => {
    expect(maxSentencesRequested('J was in the middle of a sentence.')).toBeUndefined();
    expect(maxSentencesRequested('Task: write a sentence.')).toBe(1);
  });
  test('Chinese "一句回應" means "one response", not a one-sentence limit', () => {
    expect(maxSentencesRequested('任務：寫一句回應，留在個案的感受上。')).toBeUndefined();
    expect(maxSentencesRequested('任務：寫一句簡短的回應。')).toBeUndefined();
    // 真正的句數上限照舊
    expect(maxSentencesRequested('寫一句回應。簡短：一到兩句話。')).toBe(2);
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

describe('parseReportRefs: status (resolved / judgment / note)', () => {
  const mods = ['demo-intro'];
  const ids = new Map([['demo-intro', new Set(['e01', 'e02', 'e03', 'e04', 'e05', 'e06', 'e07', 'e08', 'e09', 'm01', 'm02', 'm03'].map((n) => `demo-intro-${n}`))]]);
  const md = [
    '# 報告', // 1
    '## 摘要：最重要的 3 點', // 2
    '', // 3
    '1. 示範超過句數。**已處理**：縮短（模組 1 e01）。', // 4
    '2. 臨床判斷，請擁有人定（模組 1 e02）：', // 5
    '   - 子項也屬於第 2 點（模組 1 e03）。', // 6
    '3. 示範沒有試探語氣（模組 1 e04）。建議補上。', // 7
    '## 已處理（第二輪）', // 8
    '### 摘要第 3 點：試探語氣', // 9
    '- 模組 1 e04 加了「也許」。', // 10
    '### 這次沒有處理的項目', // 11
    '- 模組 1 e05 沒有動。', // 12
    '## 模組 1：`demo-intro`', // 13
    '- e06：我沒有改，請擁有人確認。', // 14
    '- e07：已修正。', // 15
    '- e08：符合標準。', // 16
    '## 已修正', // 17
    '- 模組 1 e09：縮短；請擁有人留意這是我補的。', // 18
    '- 模組 1 m01 縮短。', // 19
  ].join('\n');
  const refs = parseReportRefs(md, 'r.md', mods, ids);
  const status = (n: string, line: number) => refs.get(`demo-intro-${n}`)!.find((r) => r.line === line)!.status;
  test('summary points: "已處理" item is resolved, others are judgment (sub-bullets follow their point)', () => {
    expect(status('e01', 4)).toBe('resolved');
    expect(status('e02', 5)).toBe('judgment');
    expect(status('e03', 6)).toBe('judgment');
  });
  test('a summary point that a later "摘要第 N 點" section handled is resolved', () => {
    expect(status('e04', 7)).toBe('resolved');
    expect(status('e04', 10)).toBe('resolved');
  });
  test('"沒有處理" headings are judgment, even under a resolved parent', () => {
    expect(status('e05', 12)).toBe('judgment');
  });
  test('module sections: judgment words win, resolved words next, otherwise a plain note', () => {
    expect(status('e06', 14)).toBe('judgment');
    expect(status('e07', 15)).toBe('resolved');
    expect(status('e08', 16)).toBe('note');
  });
  test('under a resolved heading everything is resolved unless the line asks the owner', () => {
    expect(status('m01', 19)).toBe('resolved');
    expect(status('e09', 18)).toBe('judgment');
  });
});

describe('checkModelLength: "in one sentence" inside a criterion limits one part, not the whole', () => {
  const resp = 'I do not think it is about fault. They did their best. Does that match?';
  test('a criterion that says the first part is one sentence does not cap the whole response', () => {
    expect(
      checkModelLength(
        { context: 'Session 3.', criteria: ["It answers J's worry first, in one sentence, before it says anything else.", 'It is kind.'] },
        resp,
        'en',
      ),
    ).toBeUndefined();
    expect(
      checkModelLength(
        { context: '第 3 次會談。', criteria: ['先用一句話回應 J 真正擔心的事，再說其他的。'] },
        '我不覺得這是誰的錯。他們已經盡力了。這和你記得的一樣嗎？',
        'zh-Hant',
      ),
    ).toBeUndefined();
  });
  test('the task text in the context still caps the whole response', () => {
    expect(checkModelLength({ context: 'Task: write one sentence.', criteria: ['It is kind.'] }, resp, 'en')?.message).toContain('3 句');
  });
});

describe('compareDrill: a question mark inside a quotation is not the response asking a question', () => {
  test('quoted question in one language only is not flagged', () => {
    const en = { model_response: "It might be that you ask 'am I just being dramatic?' each time.", client: 'x' };
    const zh = { model_response: '可能你每次都會先問自己「我是不是只是在戲劇化」。', client: 'x' };
    expect(compareDrill(en, zh)).toEqual([]);
  });
  test('a real question in one language only is still flagged', () => {
    const en = { model_response: 'We can leave it, if that is easier.', client: 'x' };
    const zh = { model_response: '我們可以先放下它，這樣會比較容易嗎？', client: 'x' };
    expect(compareDrill(en, zh).map((f) => f.message).join()).toContain('問句');
  });
});
