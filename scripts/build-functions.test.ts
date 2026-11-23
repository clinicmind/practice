// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, test } from 'vitest';
import YAML from 'yaml';
import { scan, scanHigh } from '../packages/deid/src';
import { bundleReportsFunction, REPORTS_OUT } from './build-functions';
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
