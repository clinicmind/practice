// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, test } from 'vitest';
import YAML from 'yaml';
import { scan, scanHigh } from '../packages/deid/src';
import { AI_FEEDBACK_OUT, bundleAiFeedbackFunction, bundleReportsFunction, REPORTS_OUT } from './build-functions';
import { buildPracticeRequest, checkOutput, guardInput } from '../packages/ai-feedback/src';
import { ENV as AI_ENV, FakeBackend as AiBackend, FakeLlm, ATT_A } from '../supabase/functions/ai-feedback/test/fakeBackend';
import { ENV, FakeBackend } from '../supabase/functions/reports/test/fakeBackend';

// The Edge Function is pasted into the Supabase web page as ONE file, so the scanner is bundled into it.
// These tests make sure the pasted file is current, is really one file, and scans exactly like the original.

type Bundle = { scan: typeof scan; scanHigh: typeof scanHigh; handleRequest: (r: Request, e: Record<string, string>, f: typeof fetch) => Promise<Response> };
const load = async (): Promise<Bundle> => (await import(/* @vite-ignore */ pathToFileURL(REPORTS_OUT).href)) as Bundle;
const corpus = join(__dirname, '..', 'packages', 'deid', 'test', 'corpus');

describe('the bundled Edge Function', () => {
  test('the committed file is what the build produces now (run `npm run functions` if this fails)', async () => {
    expect(readFileSync(REPORTS_OUT, 'utf8')).toBe(await bundleReportsFunction());
  });
  test('it says it is generated and must not be edited by hand', () => {
    expect(readFileSync(REPORTS_OUT, 'utf8').split('\n').slice(0, 3).join('\n')).toMatch(/由程式產生，不要手改/);
  });
  test('it is a single file: no imports or requires left', () => {
    const src = readFileSync(REPORTS_OUT, 'utf8');
    expect(src).not.toMatch(/^\s*import\s.+from\s/m);
    expect(src).not.toMatch(/\brequire\(/);
    expect(src).not.toMatch(/\bimport\(/);
    expect(src).not.toMatch(/node:/);
  });
  test('it starts a server only when running inside Deno', () => {
    expect(readFileSync(REPORTS_OUT, 'utf8')).toMatch(/typeof Deno !== "undefined"/);
  });

  test('scan and scanHigh give the same findings as the original on every corpus case', async () => {
    const b = await load();
    const cases = [
      ...(YAML.parse(readFileSync(join(corpus, 'positive.yaml'), 'utf8')) as { text: string }[]).map((c) => c.text),
      ...(YAML.parse(readFileSync(join(corpus, 'negative.yaml'), 'utf8')) as { text: string }[]).map((c) => c.text),
      readFileSync(join(corpus, 'clean-report.txt'), 'utf8'),
      '', ' ', 'ID​：Ａ１２３４５６（３）end', 'tel 91234567', '陳大文 told Mr Chan about 彩虹邨',
    ];
    expect(cases.length).toBeGreaterThan(100);
    for (const t of cases) {
      expect(b.scan(t), t).toEqual(scan(t));
      expect(b.scanHigh(t), t).toEqual(scanHigh(t));
    }
  });
  test('and on texts made by joining and slicing the corpus (positions included)', async () => {
    const b = await load();
    const all = (YAML.parse(readFileSync(join(corpus, 'positive.yaml'), 'utf8')) as { text: string }[]).map((c) => c.text);
    let seed = 7;
    const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
    for (let i = 0; i < 200; i++) {
      const t = Array.from({ length: 1 + rnd(5) }, () => all[rnd(all.length)]!).join([' ', '\n', '，', ''][rnd(4)]);
      expect(b.scan(t)).toEqual(scan(t));
    }
  });
  test('the bundled function itself accepts a clean report and refuses an identifying one', async () => {
    const b = await load();
    const be = new FakeBackend();
    const fill = 'The trainee noted that the client spoke slowly and paused often before answering. '.repeat(4);
    const post = (body: string) => b.handleRequest(new Request('https://x.test/f', { method: 'POST', headers: { Authorization: 'Bearer tok-A' }, body: JSON.stringify({ action: 'submit', title: 'Week 3', body }) }), ENV, be.fetch as typeof fetch);
    expect((await post(fill)).status).toBe(201);
    const refused = await post(fill + ' call 91234567');
    expect(refused.status).toBe(422);
    expect(await refused.text()).not.toContain('91234567');
    expect(be.reports).toHaveLength(1);
  });
});

describe('the bundled ai-feedback Edge Function', () => {
  type AiBundle = {
    handleRequest: (r: Request, e: Record<string, string>, d: { fetchFn: typeof fetch; llm: FakeLlm; nonce: () => string }) => Promise<Response>;
    checkOutput: typeof checkOutput; guardInput: typeof guardInput; buildPracticeRequest: typeof buildPracticeRequest;
  };
  const loadAi = async (): Promise<AiBundle> => (await import(/* @vite-ignore */ pathToFileURL(AI_FEEDBACK_OUT).href)) as AiBundle;
  const src = () => readFileSync(AI_FEEDBACK_OUT, 'utf8');

  test('the committed file is what the build produces now (run `npm run functions` if this fails)', async () => {
    expect(src()).toBe(await bundleAiFeedbackFunction());
  });
  test('it says it is generated and must not be edited by hand', () => {
    expect(src().split('\n').slice(0, 3).join('\n')).toMatch(/由程式產生，不要手改/);
  });
  test('it is a single file: no imports or requires left', () => {
    expect(src()).not.toMatch(/^\s*import\s.+from\s/m);
    expect(src()).not.toMatch(/\brequire\(/);
    expect(src()).not.toMatch(/\bimport\(/);
    expect(src()).not.toMatch(/node:/);
  });
  test('it starts a server only when running inside Deno', () => {
    expect(src()).toMatch(/typeof Deno !== "undefined"/);
  });
  test('it holds no key, and no web address except the one Anthropic endpoint', () => {
    expect(src()).not.toMatch(/sk-ant-/i);
    expect(src()).not.toMatch(/service[-_ ]?role[-_ ]?key-fiction|anon-key-fiction/);
    expect([...new Set(src().match(/https?:\/\/[^\s"'`)<>\\]+/g) ?? [])]).toEqual(['https://api.anthropic.com/v1/messages']);
    // It reads only these settings from the environment.
    expect([...new Set([...src().matchAll(/\b(SUPABASE_[A-Z_]+|SITE_URL|ANTHROPIC_API_KEY)\b/g)].map((m) => m[1]))].sort()).toEqual(['ANTHROPIC_API_KEY', 'SITE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_URL']);
  });
  test('it never writes to the console', () => {
    expect(src()).not.toMatch(/\bconsole\./);
  });

  const good = { criteria: [{ met: true, evidence: 'alpha beta' }, { met: false, evidence: '' }, { met: true, evidence: 'gamma' }], suggestion: 'You could try x.', concern: 'none' };
  const inputs: [unknown, string, 'en' | 'zh-Hant'][] = [
    [good, 'alpha  beta and gamma here', 'en'],
    [good, 'alpha beta', 'en'],
    [{ ...good, concern: 'off-task' }, 'alpha beta gamma', 'en'],
    [{ ...good, concern: 'risk-content', suggestion: '' }, 'alpha beta gamma', 'en'],
    [{ ...good, concern: 'other' }, 'alpha beta gamma', 'en'],
    [{ ...good, suggestion: '' }, 'alpha beta gamma', 'en'],
    [{ ...good, suggestion: 'word '.repeat(41) }, 'alpha beta gamma', 'en'],
    [{ ...good, suggestion: 'word '.repeat(40) }, 'alpha beta gamma', 'en'],
    [{ ...good, suggestion: '可以試試' + '字'.repeat(57) }, 'alpha beta gamma', 'zh-Hant'],
    [{ ...good, suggestion: '可以試試' + '字'.repeat(56) }, 'alpha beta gamma', 'zh-Hant'],
    [{ ...good, criteria: good.criteria.slice(0, 2) }, 'alpha beta gamma', 'en'],
    [{ ...good, criteria: [...good.criteria, good.criteria[0]] }, 'alpha beta gamma', 'en'],
    [{ ...good, extra: 1 }, 'alpha beta gamma', 'en'],
    [{ ...good, criteria: [{ met: 'yes', evidence: '' }, good.criteria[1], good.criteria[2]] }, 'alpha beta gamma', 'en'],
    [{ ...good, criteria: [{ met: true, evidence: 'Alpha Beta' }, good.criteria[1], good.criteria[2]] }, 'alpha beta gamma', 'en'],
    [{ ...good, criteria: [{ met: true, evidence: 'alpha，beta' }, good.criteria[1], good.criteria[2]] }, 'alpha,beta gamma', 'en'],
    [{ ...good, criteria: [{ met: true, evidence: '' }, good.criteria[1], good.criteria[2]] }, 'alpha beta gamma', 'en'],
    [null, 'x', 'en'], ['text', 'x', 'en'], [[], 'x', 'zh-Hant'],
  ];
  test('the bundled checks give the same answers as the original on 20 inputs', async () => {
    const b = await loadAi();
    expect(inputs).toHaveLength(20);
    for (const [raw, resp, loc] of inputs) expect(b.checkOutput(raw, resp, loc)).toEqual(checkOutput(raw, resp, loc));
    for (const [resp, nonce] of [['x'.repeat(19), 'n'], ['x'.repeat(20), 'n'], ['x'.repeat(1500), 'n'], ['x'.repeat(1501), 'n'], ['あ'.repeat(1500), 'n'], ['has STUDENT_RESPONSE in it ok ok ok ok', 'n']] as const) {
      expect(b.guardInput(resp, nonce)).toEqual(guardInput(resp, nonce));
    }
    const p = { locale: 'zh-Hant', context: 'c', client: 'k', criteria: ['a', 'b', 'c'], modelResponse: 'm', studentResponse: 's', nonce: 'a1b2c3d4e5f60718' } as const;
    expect(b.buildPracticeRequest({ ...p, criteria: [...p.criteria] as [string, string, string] })).toEqual(buildPracticeRequest({ ...p, criteria: [...p.criteria] as [string, string, string] }));
  });
  test('the bundled function itself gives feedback through fakes, and stays shut when the switch is off', async () => {
    const b = await loadAi();
    const be = new AiBackend();
    const llm = new FakeLlm();
    const post = () => b.handleRequest(new Request('https://x.test/f', { method: 'POST', headers: { Authorization: 'Bearer tok-A' }, body: JSON.stringify({ action: 'practice', attempt_id: ATT_A }) }), AI_ENV, { fetchFn: be.fetch as typeof fetch, llm, nonce: () => 'n01abcdef0123456789abcd' });
    expect((await post()).status).toBe(200);
    expect(llm.calls).toHaveLength(1);
    const be2 = new AiBackend();
    for (const c of Object.values(be2.cohorts)) c.ai_enabled = false;
    const llm2 = new FakeLlm();
    const off = await b.handleRequest(new Request('https://x.test/f', { method: 'POST', headers: { Authorization: 'Bearer tok-A' }, body: JSON.stringify({ action: 'practice', attempt_id: ATT_A }) }), AI_ENV, { fetchFn: be2.fetch as typeof fetch, llm: llm2, nonce: () => 'n01abcdef0123456789abcd' });
    expect(off.status).toBe(403);
    expect(llm2.calls).toHaveLength(0);
    expect(be2.outsideSupabase()).toEqual([]);
  });
});
