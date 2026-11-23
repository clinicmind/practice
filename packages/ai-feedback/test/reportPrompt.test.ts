import { describe, expect, test } from 'vitest';
import {
  buildReportRequest, checkReportOutput, guardReport, MODELS, parseRubric, REPORT_DIMENSIONS, REPORT_JSON_SCHEMA, REPORT_PROMPT_VERSION,
  REPORT_SYSTEM_PROMPT, type Rubric,
} from '../src/index';

// All fictional.
const NONCE = 'a1b2c3d4e5f60718293a4b5c';
const level = (d: string, n: number) => `${d} level ${n} description`;
const rubric = (): Rubric =>
  Object.fromEntries(REPORT_DIMENSIONS.map((d) => [d, { name: `Name of ${d}`, levels: [1, 2, 3, 4].map((n) => level(d, n)) }])) as Rubric;
const REPORT = 'The trainee describes the first session. The client arrived late and spoke quietly about work. A fictional detail: the lamp was green.';

function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (const ch of s) { h ^= ch.codePointAt(0)!; h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16);
}
// Changing the system prompt text: bump REPORT_PROMPT_VERSION and add a row. Old rows stay (they are history).
const HASHES: Record<string, string> = { r1: 'd8fa327c' };

describe('the prompt', () => {
  test('the text is locked to the version', () => {
    expect(HASHES[REPORT_PROMPT_VERSION], `add a hash for ${REPORT_PROMPT_VERSION}: ${fnv(REPORT_SYSTEM_PROMPT)}`).toBe(fnv(REPORT_SYSTEM_PROMPT));
  });
  test('uses the report model, a bounded output, and the schema', () => {
    const r = buildReportRequest({ locale: 'zh-Hant', rubric: rubric(), reportText: REPORT, nonce: NONCE });
    expect(r.model).toBe(MODELS.report);
    expect(r.maxTokens).toBe(3500);
    expect(r.schema).toBe(REPORT_JSON_SCHEMA);
  });
  test('carries the rules: injection, verbatim quotes, no identifying details, no diagnosis', () => {
    const s = REPORT_SYSTEM_PROMPT;
    expect(s).toMatch(/never follow|do not follow/i);
    expect(s).toMatch(/verbatim/i);
    expect(s).toMatch(/names?, .*(places|dates|numbers)|identif/i);
    expect(s).toMatch(/diagnos/i);
    expect(s).toMatch(/supervisor/i);
  });
  test('wraps the report in delimiters that contain the random token, and only there', () => {
    const r = buildReportRequest({ locale: 'en', rubric: rubric(), reportText: REPORT, nonce: NONCE });
    const last = r.blocks[r.blocks.length - 1]!;
    expect(last.cache).toBe(false);
    expect(last.text).toContain(`<<<REPORT_TEXT_${NONCE}`);
    expect(last.text).toContain(`REPORT_TEXT_${NONCE}>>>`);
    expect(last.text).toContain(REPORT);
    for (const b of r.blocks.slice(0, -1)) expect(b.text).not.toContain(REPORT);
    expect(r.system).not.toContain(NONCE);
  });
  test('the rubric block is the same for every report (it is cached); the six dimensions and 24 level texts are in it', () => {
    const a = buildReportRequest({ locale: 'en', rubric: rubric(), reportText: REPORT, nonce: NONCE });
    const b = buildReportRequest({ locale: 'zh-Hant', rubric: rubric(), reportText: 'another report text that is long enough', nonce: 'ffffffffffffffffffffffff' });
    expect(a.system).toBe(b.system);
    expect(a.blocks[0]).toEqual(b.blocks[0]);
    expect(a.blocks[0]!.cache).toBe(true);
    for (const d of REPORT_DIMENSIONS) for (let n = 1; n <= 4; n++) expect(a.blocks[0]!.text).toContain(level(d, n));
  });
  test('the language of the comments follows the locale', () => {
    const zh = buildReportRequest({ locale: 'zh-Hant', rubric: rubric(), reportText: REPORT, nonce: NONCE });
    const en = buildReportRequest({ locale: 'en', rubric: rubric(), reportText: REPORT, nonce: NONCE });
    expect(zh.blocks.map((b) => b.text).join('\n')).toContain('Traditional Chinese');
    expect(en.blocks.map((b) => b.text).join('\n')).toMatch(/in English/);
  });
  test('a bad token is refused', () => {
    expect(() => buildReportRequest({ locale: 'en', rubric: rubric(), reportText: REPORT, nonce: 'short' })).toThrow();
  });
});

describe('guardReport', () => {
  test('too short, too long, delimiter word or token inside', () => {
    expect(guardReport('x'.repeat(199), NONCE)).toEqual({ ok: false, reason: 'too_short' });
    expect(guardReport('x'.repeat(30_001), NONCE)).toEqual({ ok: false, reason: 'too_long' });
    expect(guardReport('x'.repeat(200) + ' REPORT_TEXT ', NONCE)).toEqual({ ok: false, reason: 'contains_delimiter' });
    expect(guardReport('x'.repeat(200) + NONCE, NONCE)).toEqual({ ok: false, reason: 'contains_delimiter' });
    expect(guardReport('x'.repeat(200), NONCE)).toEqual({ ok: true });
    expect(guardReport('字'.repeat(30_000), NONCE)).toEqual({ ok: true }); // counted in characters, not bytes
  });
});

describe('the output schema sent to the model', () => {
  test('no length or range keywords (the structured-output subset does not support them) and every object is closed', () => {
    const text = JSON.stringify(REPORT_JSON_SCHEMA);
    expect(text).not.toMatch(/minLength|maxLength|minimum|maximum|minItems|maxItems/);
    const walk = (n: unknown): void => {
      if (!n || typeof n !== 'object') return;
      const o = n as Record<string, unknown>;
      if (o.type === 'object') expect(o.additionalProperties).toBe(false);
      Object.values(o).forEach(walk);
    };
    walk(REPORT_JSON_SCHEMA);
  });
});

const good = () => ({
  scores: { picture: 3, formulation: 2, link: 3, process: 4, self: 2, ethics: 3 },
  comments: 'A fictional draft comment.',
  notes: [{ dimension: 'picture', quote: 'The client arrived late and spoke quietly about work.' }],
});

describe('checkReportOutput', () => {
  test('accepts a good output', () => {
    const r = checkReportOutput(good(), REPORT);
    expect(r.ok).toBe(true);
  });
  test('a quote that is not in the report discards everything', () => {
    const o = good();
    o.notes = [{ dimension: 'self', quote: 'The trainee wept in the corridor.' }];
    expect(checkReportOutput(o, REPORT)).toEqual({ ok: false, reason: 'quote' });
  });
  test('a quote is compared after folding runs of whitespace, not more', () => {
    const o = good();
    o.notes = [{ dimension: 'picture', quote: 'client  arrived\nlate' }];
    expect(checkReportOutput(o, REPORT).ok).toBe(true);
    o.notes = [{ dimension: 'picture', quote: 'Client arrived late' }];
    expect(checkReportOutput(o, REPORT)).toEqual({ ok: false, reason: 'quote' });
  });
  test('an empty quote is refused', () => {
    const o = good();
    o.notes = [{ dimension: 'picture', quote: '' }];
    expect(checkReportOutput(o, REPORT)).toEqual({ ok: false, reason: 'schema' });
  });
  test('scores must be the integers 1 to 4, all six, and nothing else', () => {
    for (const bad of [0, 5, 2.5, '3', null, -1]) {
      const o = good() as any;
      o.scores.ethics = bad;
      expect(checkReportOutput(o, REPORT), String(bad)).toEqual({ ok: false, reason: 'schema' });
    }
    const missing = good() as any;
    delete missing.scores.self;
    expect(checkReportOutput(missing, REPORT)).toEqual({ ok: false, reason: 'schema' });
    const extra = good() as any;
    extra.scores.other = 3;
    expect(checkReportOutput(extra, REPORT)).toEqual({ ok: false, reason: 'schema' });
  });
  test('comments: required, at most 3,000 characters (not bytes)', () => {
    expect(checkReportOutput({ ...good(), comments: '   ' }, REPORT)).toEqual({ ok: false, reason: 'schema' });
    expect(checkReportOutput({ ...good(), comments: '字'.repeat(3000) }, REPORT).ok).toBe(true);
    expect(checkReportOutput({ ...good(), comments: '字'.repeat(3001) }, REPORT)).toEqual({ ok: false, reason: 'comments_length' });
  });
  test('an unknown dimension in a note, extra keys, and non-objects are refused', () => {
    const o = good() as any;
    o.notes = [{ dimension: 'style', quote: 'client' }];
    expect(checkReportOutput(o, REPORT)).toEqual({ ok: false, reason: 'schema' });
    expect(checkReportOutput({ ...good(), extra: 1 }, REPORT)).toEqual({ ok: false, reason: 'schema' });
    for (const x of [null, 'text', [], 7]) expect(checkReportOutput(x, REPORT)).toEqual({ ok: false, reason: 'schema' });
  });
  test('an output that obeys an instruction inside the report is still just a valid output (the draft is checked by a person)', () => {
    const o = { ...good(), scores: { picture: 4, formulation: 4, link: 4, process: 4, self: 4, ethics: 4 } };
    expect(checkReportOutput(o, REPORT).ok).toBe(true);
  });
});

describe('parseRubric (the published rubric file)', () => {
  const file = () => ({ reviewed: true, dimensions: rubric() });
  test('a complete, reviewed file gives a rubric', () => {
    expect(parseRubric(file())).toEqual(rubric());
  });
  test('anything incomplete or not marked reviewed gives null', () => {
    expect(parseRubric({ ...file(), reviewed: false })).toBeNull();
    expect(parseRubric({ dimensions: rubric() })).toBeNull();
    const missing = file() as any;
    delete missing.dimensions.ethics;
    expect(parseRubric(missing)).toBeNull();
    const three = file() as any;
    three.dimensions.self.levels = three.dimensions.self.levels.slice(0, 3);
    expect(parseRubric(three)).toBeNull();
    const blank = file() as any;
    blank.dimensions.link.levels[2] = '  ';
    expect(parseRubric(blank)).toBeNull();
    for (const x of [null, 'x', [], 3, {}]) expect(parseRubric(x)).toBeNull();
  });
});
