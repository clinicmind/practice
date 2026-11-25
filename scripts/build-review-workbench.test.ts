// @vitest-environment node
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse, stringify } from 'yaml';
import { describe, expect, test } from 'vitest';
import { buildWorkbench, parseArgs, workbenchFileName } from './build-review-workbench';

const MULTI = join(__dirname, '..', 'tests', 'fixtures', 'content', 'multi');
const tmp = () => mkdtempSync(join(tmpdir(), 'wb-'));
const read = (f: string) => readFileSync(f, 'utf8');
const yamlOf = (dir: string, loc: string, rel: string) => parse(read(join(dir, loc, 'stages', rel)));

describe('parseArgs / file name', () => {
  test('reads --stage and --module', () => {
    expect(parseArgs(['--stage', 'eft'])).toMatchObject({ stage: 'eft', module: undefined });
    expect(parseArgs(['--stage', 'eft', '--module', 'eft-attunement'])).toMatchObject({ stage: 'eft', module: 'eft-attunement' });
  });
  test('needs --stage', () => {
    expect(() => parseArgs([])).toThrow(/--stage/);
  });
  test('file name is <stage>[-<module>].html', () => {
    expect(workbenchFileName('eft')).toBe('eft.html');
    expect(workbenchFileName('eft', 'eft-attunement')).toBe('eft-eft-attunement.html');
  });
});

describe('buildWorkbench', () => {
  const build = (opts: { stage: string; module?: string; contentDir?: string; reviewsDir?: string }) => {
    const outDir = tmp();
    const r = buildWorkbench({ contentDir: MULTI, reviewsDir: tmp(), outDir, ...opts });
    return { ...r, outDir, html: read(r.file) };
  };

  test('writes review/<stage>.html and the page contains every item id of the stage', () => {
    const { file, outDir, html } = build({ stage: 'demo' });
    expect(file).toBe(join(outDir, 'demo.html'));
    const dir = join(MULTI);
    const drills = yamlOf(dir, 'en', 'demo/demo-intro/drills.yaml') as { id: string }[];
    expect(drills.length).toBeGreaterThan(0);
    for (const d of drills) expect(html).toContain(`data-id="${d.id}"`);
    const wt = yamlOf(dir, 'en', 'demo/demo-intro/walkthrough.yaml');
    const decisions = wt.sessions.flatMap((s: any) => s.turns.filter((t: any) => 'type' in t).map((t: any) => `${s.id}-${t.id}`));
    expect(decisions.length).toBeGreaterThan(0);
    for (const id of decisions) expect(html).toContain(`data-id="${id}"`);
    expect(html).toContain('data-id="demo-intro"'); // the module itself
  });

  test('shows English and Chinese side by side', () => {
    const { html } = build({ stage: 'demo' });
    expect(html).toContain('Fixture client statement for demo-intro-e01.');
    const zh = read(join(MULTI, 'zh-Hant', 'stages', 'demo', 'demo-intro', 'drills.yaml'));
    const clientLine = zh.split('\n').find((l) => l.trim().startsWith('client:'))!.split(/client:\s*/)[1].replace(/^["']|["']$/g, '');
    expect(html).toContain(clientLine);
  });

  test('--module builds a single-module page named <stage>-<module>.html', () => {
    const { file, html } = build({ stage: 'foundations', module: 'alliance' });
    expect(file.endsWith('foundations-alliance.html')).toBe(true);
    expect(html).toContain('data-id="alliance"');
    expect(html).not.toContain('data-id="intake"');
  });

  test('is self-contained: no network, no external files', () => {
    const { html } = build({ stage: 'demo' });
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toMatch(/<link\b/i);
    expect(html).not.toMatch(/<script[^>]+src=/i);
    expect(html).not.toMatch(/@import|url\(/i);
    expect(html).not.toMatch(/<img\b/i);
  });

  test('escapes content, so text from a YAML file cannot become markup', () => {
    const dir = tmp();
    cpSync(MULTI, dir, { recursive: true });
    const f = join(dir, 'en', 'stages', 'demo', 'demo-intro', 'module.yaml');
    writeFileSync(f, read(f).replace('Intro for', '<script>alert(1)</script> Intro for'));
    const { html } = build({ stage: 'demo', contentDir: dir });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  test('flags a forbidden term next to the item it is in', () => {
    const dir = tmp();
    cpSync(MULTI, dir, { recursive: true });
    const f = join(dir, 'en', 'stages', 'demo', 'demo-intro', 'drills.yaml');
    writeFileSync(f, read(f).replace('Fixture client statement for demo-intro-e01.', 'My doctor said it is PTSD and gave me sertraline.'));
    const { html } = build({ stage: 'demo', contentDir: dir });
    const card = html.split('data-id="demo-intro-e01"')[1].split('</article>')[0];
    expect(card).toContain('data-flag="forbidden-term"');
    expect(card).toContain('PTSD');
    expect(card).toContain('sertraline');
  });

  test('flags a model response longer than the task asks for', () => {
    const dir = tmp();
    cpSync(MULTI, dir, { recursive: true });
    for (const [loc, ctx] of [['en', 'Task: write one sentence.'], ['zh-Hant', '任務：寫一句話。']] as const) {
      const f = join(dir, loc, 'stages', 'demo', 'demo-intro', 'drills.yaml');
      const docs = parse(read(f));
      docs[0].context = ctx;
      writeFileSync(f, stringify(docs));
    }
    const mf = join(dir, 'en', 'stages', 'demo', 'demo-intro', 'models.yaml');
    const models = parse(read(mf));
    models['demo-intro-e01'].model_response = 'One. Two. Three.';
    writeFileSync(mf, stringify(models));
    const { html } = build({ stage: 'demo', contentDir: dir });
    const card = html.split('data-id="demo-intro-e01"')[1].split('</article>')[0];
    expect(card).toContain('data-flag="sentence-count"');
  });

  test('a clean fixture item has no flags', () => {
    const { html } = build({ stage: 'demo' });
    const card = html.split('data-id="demo-intro-e02"')[1].split('</article>')[0];
    expect(card).not.toContain('data-flag=');
  });

  const reportCard = (md: string, id = 'demo-intro-e02') => {
    const reviewsDir = tmp();
    writeFileSync(join(reviewsDir, '2026-01-01-demo-prereview.md'), md);
    const r = build({ stage: 'demo', reviewsDir });
    return { ...r, card: r.html.split(`data-id="${id}"`)[1].split('</article>')[0] };
  };

  test('a report line that leaves an id to the owner is a prominent flag with the report text and line', () => {
    const { card } = reportCard(['# Demo 預審', '', '## 模組 1：`demo-intro`', '', '- e02：沒有猜測語氣。我沒有改，請擁有人確認。', ''].join('\n'));
    expect(card).toContain('data-flag="report-ref"');
    expect(card).toContain('預審留給你判斷');
    expect(card).toContain('沒有猜測語氣');
    expect(card).toContain('2026-01-01-demo-prereview.md');
    expect(card).toContain('第 5 行');
    expect(card).toMatch(/^[^>]*data-flagged/);
  });

  test('a report line that says it was fixed is collapsed, grey, and not flagged', () => {
    const { card } = reportCard(['# Demo 預審（`demo-intro`）', '', '## 已修正', '', '- 模組 1 e02：加了「也許」。', ''].join('\n'));
    expect(card).toContain('class="prenote"');
    expect(card).toContain('預審已修正或只是說明');
    expect(card).toContain('加了「也許」');
    expect(card).not.toContain('data-flag="report-ref"');
    expect(card).not.toContain('預審留給你判斷');
    expect(card).not.toMatch(/^[^>]*data-flagged/);
    expect(card).not.toContain('<details class="prenote" open');
  });

  test('a plain mention (no fix, no request) is also grey and not flagged', () => {
    const { card } = reportCard(['# Demo 預審', '', '## 模組 1：`demo-intro`', '', '- e02：符合標準。', ''].join('\n'));
    expect(card).toContain('class="prenote"');
    expect(card).not.toMatch(/^[^>]*data-flagged/);
  });

  test('the top shows one summary line: items to judge; automatic warnings; the rest are notes', () => {
    const md = [
      '# Demo 預審',
      '',
      '## 模組 1：`demo-intro`',
      '',
      '- e02：我沒有改，請擁有人確認。',
      '- e03：沒有改，建議看一下。',
      '',
      '## 已修正',
      '',
      '- 模組 1 e04：縮短。',
      '- 模組 1 e05：縮短。',
      '- 模組 1 e06：縮短。',
    ].join('\n');
    const r = reportCard(md);
    expect(r.judgeItems).toBe(2);
    expect(r.quietNotes).toBe(3);
    expect(r.autoItems).toBe(0);
    expect(r.html).toContain('要你判斷的 2 項；自動預檢警告 0 項；其餘是說明');
    expect(r.html).toContain('id="summary-line"');
  });

  test('automatic warnings are counted in the summary line, once per item', () => {
    const dir = tmp();
    cpSync(MULTI, dir, { recursive: true });
    const mf = join(dir, 'en', 'stages', 'demo', 'demo-intro', 'models.yaml');
    const models = parse(read(mf));
    models['demo-intro-e01'].model_response = 'Zoloft helped her. Then she stopped. Then more.';
    writeFileSync(mf, stringify(models));
    const r = build({ stage: 'demo', contentDir: dir });
    expect(r.autoItems).toBeGreaterThanOrEqual(1);
    expect(r.html).toContain(`自動預檢警告 ${r.autoItems} 項`);
  });

  test('embeds the data the page script needs: stage, module versions and every item id', () => {
    const { html } = build({ stage: 'demo' });
    const json = /<script type="application\/json" id="wb-data">([\s\S]*?)<\/script>/.exec(html)![1];
    const data = JSON.parse(json);
    expect(data.stage).toBe('demo');
    expect(data.modules).toEqual([expect.objectContaining({ slug: 'demo-intro', version: '1.0.0' })]);
    expect(data.modules[0].ids).toContain('demo-intro');
    expect(data.modules[0].ids).toContain('demo-intro-e01');
    expect(new Set(data.modules[0].ids).size).toBe(data.modules[0].ids.length);
  });

  test('errors name what is wrong', () => {
    expect(() => buildWorkbench({ contentDir: MULTI, reviewsDir: tmp(), outDir: tmp(), stage: 'nope' })).toThrow(/nope.*demo|demo.*nope/s);
    expect(() => buildWorkbench({ contentDir: MULTI, reviewsDir: tmp(), outDir: tmp(), stage: 'demo', module: 'zzz' })).toThrow(/zzz/);
  });

  test('works when the reviews directory does not exist', () => {
    const outDir = tmp();
    const r = buildWorkbench({ contentDir: MULTI, reviewsDir: join(tmp(), 'missing'), outDir, stage: 'demo' });
    expect(existsSync(r.file)).toBe(true);
  });
});

describe('page CSS', () => {
  test('the storage warning stays hidden until the page script shows it', () => {
    const outDir = tmp();
    const r = buildWorkbench({ contentDir: MULTI, reviewsDir: tmp(), outDir, stage: 'demo' });
    const html = read(r.file);
    expect(html).toMatch(/\[hidden\]\s*\{\s*display:\s*none\s*!important/);
    expect(html).toMatch(/id="storage-warning" hidden/);
  });
});
