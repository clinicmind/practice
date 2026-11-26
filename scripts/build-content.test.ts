// @vitest-environment node
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse, stringify } from 'yaml';
import { beforeEach, describe, expect, test } from 'vitest';
import { buildContent } from './build-content';
import { FIXTURE_VERSION, makeDrills, FIXTURE_MODULES } from '../tests/fixtures/makeContent';

const OK = join(__dirname, '..', 'tests', 'fixtures', 'content', 'ok');
let outDir: string;
beforeEach(() => {
  outDir = mkdtempSync(join(tmpdir(), 'build-out-'));
});
const readJson = (p: string) => JSON.parse(readFileSync(join(outDir, p), 'utf8'));

/** Copy the ok fixture, then let `edit` change one thing via helpers. */
function variant(edit: (h: Helpers) => void): string {
  const dir = mkdtempSync(join(tmpdir(), 'fx-'));
  cpSync(OK, dir, { recursive: true });
  const stage = join(dir, 'en', 'stages', 'foundations');
  const h: Helpers = {
    dir,
    edit(rel, fn) {
      const f = join(stage, rel);
      const data = parse(readFileSync(f, 'utf8'));
      writeFileSync(f, stringify(fn(data) ?? data));
    },
  };
  edit(h);
  return dir;
}
interface Helpers {
  dir: string;
  edit(rel: string, fn: (data: any) => any): void;
}

describe('buildContent', () => {
  test('valid fixture builds three kinds of file', async () => {
    await buildContent({ contentDir: OK, outDir, locale: 'en' });
    const idx = readJson('en/foundations/index.json');
    expect(idx.modules.map((m: any) => m.slug)).toEqual(['intake', 'alliance']);
    const mod = readJson('en/foundations/intake/module.json');
    expect(mod.drills).toHaveLength(30);
    expect(JSON.stringify(mod)).not.toContain('model_response');
    expect(Object.keys(readJson('en/foundations/intake/models.json'))).toHaveLength(30);
  });

  test('reviewed flag comes from REVIEW.md with exact version match', async () => {
    await buildContent({ contentDir: OK, outDir, locale: 'en' });
    const idx = readJson('en/foundations/index.json');
    expect(idx.modules.map((m: any) => [m.slug, m.reviewed])).toEqual([
      ['intake', true],
      ['alliance', false],
    ]);
    // version bump without re-review → no longer reviewed
    const dir = variant((h) => h.edit('intake/module.yaml', (d) => ({ ...d, version: '1.0.1' })));
    await buildContent({ contentDir: dir, outDir, locale: 'en' });
    expect(readJson('en/foundations/index.json').modules[0].reviewed).toBe(false);
    expect(FIXTURE_VERSION).toBe('1.0.0');
  });

  test('unreviewed modules get no module or models file unless asked', async () => {
    await buildContent({ contentDir: OK, outDir, locale: 'en' });
    expect(existsSync(join(outDir, 'en/foundations/alliance/module.json'))).toBe(false);
    expect(existsSync(join(outDir, 'en/foundations/alliance/models.json'))).toBe(false);
    const out2 = mkdtempSync(join(tmpdir(), 'build-out-'));
    await buildContent({ contentDir: OK, outDir: out2, locale: 'en', includeUnreviewed: true });
    expect(existsSync(join(out2, 'en/foundations/alliance/module.json'))).toBe(true);
  });

  test('empty content dir (no modules yet) builds an empty index instead of failing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'empty-'));
    writeFileSync(join(dir, 'REVIEW.md'), '# Review\n');
    await buildContent({ contentDir: dir, outDir, locale: 'en' });
    expect(readJson('en/foundations/index.json').modules).toEqual([]);
    // directory with a stage but zero modules also works
    const dir2 = mkdtempSync(join(tmpdir(), 'empty-'));
    mkdirSync(join(dir2, 'en', 'stages', 'foundations'), { recursive: true });
    writeFileSync(
      join(dir2, 'en', 'stages', 'foundations', 'stage.yaml'),
      'stage: foundations\ntitle: Foundations\nmodules: []\n',
    );
    await buildContent({ contentDir: dir2, outDir, locale: 'en' });
    expect(readJson('en/foundations/index.json').modules).toEqual([]);
  });

  test('generated drills match the fixture helper (30 per module)', () => {
    expect(makeDrills(FIXTURE_MODULES[0])).toHaveLength(30);
  });

  const cases: [string, (h: Helpers) => void, RegExp][] = [
    ['nine-easy', (h) => h.edit('intake/drills.yaml', (d) => d.filter((x: any) => x.id !== 'intake-e02')), /intake: easy: expected 10 drills, got 9/],
    ['skill-uneven', (h) => h.edit('intake/drills.yaml', (d) => { d.find((x: any) => x.id === 'intake-e01').skill = 'open-question'; }), /intake: skill "restatement" at level easy: expected 5, got 4/],
    ['model-missing', (h) => h.edit('intake/models.yaml', (d) => { delete d['intake-m03']; }), /models\.yaml: no entry for "intake-m03"/],
    ['model-extra', (h) => h.edit('intake/models.yaml', (d) => { d['intake-x99'] = d['intake-e01']; }), /models\.yaml: "intake-x99" has no drill/],
    ['dup-id', (h) => h.edit('intake/drills.yaml', (d) => { d[1].id = 'intake-e01'; }), /duplicate id "intake-e01"/],
    ['bad-drill-id', (h) => h.edit('intake/drills.yaml', (d) => { d[0].id = 'alliance-e01'; }), /id "alliance-e01" does not belong to module "intake"/],
    ['two-options', (h) => h.edit('intake/walkthrough.yaml', (d) => { d.sessions[0].turns[2].options.pop(); }), /decision "d1": expected 3 options, got 2/],
    ['no-strong', (h) => h.edit('intake/walkthrough.yaml', (d) => { d.sessions[0].turns[2].options[0].fit = 'weak'; }), /decision "d1": needs at least one option with fit "strong"/],
    ['no-decision', (h) => h.edit('intake/walkthrough.yaml', (d) => { d.sessions[0].turns = d.sessions[0].turns.filter((t: any) => !t.type); }), /session "intake-s1": needs at least one decision point/],
    ['two-criteria', (h) => h.edit('intake/drills.yaml', (d) => { d[0].criteria.pop(); }), /criteria/],
    ['unknown-skill', (h) => h.edit('intake/drills.yaml', (d) => { d[0].skill = 'small-talk'; }), /skill "small-talk" is not one of the module skills/],
    ['bad-session-id', (h) => h.edit('intake/walkthrough.yaml', (d) => { d.sessions[0].id = 'alliance-s1'; }), /session id "alliance-s1" does not belong to module "intake"/],
    ['slug-mismatch', (h) => h.edit('intake/module.yaml', (d) => { d.slug = 'other'; }), /module\.yaml: slug "other" does not match directory "intake"/],
    ['id-level-mismatch', (h) => h.edit('intake/drills.yaml', (d) => { d[0].id = 'intake-h01'; d[0].level = 'easy'; }), /intake-h01/],
  ];
  test.each(cases)('invalid fixture %s fails with a clear message', async (_name, edit, re) => {
    const dir = variant(edit);
    await expect(buildContent({ contentDir: dir, outDir, locale: 'en' })).rejects.toThrow(re);
  });

  test('stage lists a module whose directory is missing → clear error', async () => {
    const dir = variant((h) => h.edit('stage.yaml', (d) => ({ ...d, modules: [...d.modules, 'ghost'] })));
    await expect(buildContent({ contentDir: dir, outDir, locale: 'en' })).rejects.toThrow(/module "ghost".*not found/);
  });
});

describe('buildContent zh-Hant', () => {
  const OKR = join(__dirname, '..', 'tests', 'fixtures', 'content', 'ok-reviewed');
  const build = (dir: string, extra: object = {}) => buildContent({ contentDir: dir, outDir, locale: 'zh-Hant', ...extra });
  const zhStage = (dir: string) => join(dir, 'zh-Hant', 'stages', 'foundations');
  /** Copy ok-reviewed (en: both modules; zh-Hant: intake reviewed, alliance unreviewed) and edit it. */
  function copy(edit: (dir: string, editZh: (rel: string, fn: (data: any) => any) => void) => void = () => {}): string {
    const dir = mkdtempSync(join(tmpdir(), 'fxzh-'));
    cpSync(OKR, dir, { recursive: true });
    edit(dir, (rel, fn) => {
      const f = join(zhStage(dir), rel);
      const data = parse(readFileSync(f, 'utf8'));
      writeFileSync(f, stringify(fn(data) ?? data));
    });
    return dir;
  }

  test('no zh-Hant directory at all: builds an empty index and does not fail', async () => {
    await build(OK);
    const idx = readJson('zh-Hant/foundations/index.json');
    expect(idx.modules).toEqual([]);
  });

  test('only some modules: lists the ones present, reviewed flag comes from the zh-Hant rows', async () => {
    await build(OKR);
    const idx = readJson('zh-Hant/foundations/index.json');
    expect(idx.modules.map((m: any) => [m.slug, m.reviewed])).toEqual([['intake', true], ['alliance', false]]);
    expect(readJson('zh-Hant/foundations/intake/module.json').meta.title).toContain('測試');
    expect(existsSync(join(outDir, 'zh-Hant/foundations/alliance/module.json'))).toBe(false);
    expect(existsSync(join(outDir, 'zh-Hant/foundations/alliance/models.json'))).toBe(false);
  });

  test('a module directory that is missing is skipped, even if stage.yaml lists it', async () => {
    const dir = copy((d, editZh) => {
      rmSync(join(zhStage(d), 'alliance'), { recursive: true });
      editZh('stage.yaml', (s) => s);
    });
    await build(dir);
    expect(readJson('zh-Hant/foundations/index.json').modules.map((m: any) => m.slug)).toEqual(['intake']);
  });

  test('stage.yaml may be absent while module folders exist', async () => {
    const dir = copy((d) => rmSync(join(zhStage(d), 'stage.yaml')));
    await build(dir);
    expect(readJson('zh-Hant/foundations/index.json').modules.map((m: any) => m.slug)).toEqual(['intake', 'alliance']);
  });

  test('all present and reviewed', async () => {
    const dir = copy((d) => {
      writeFileSync(join(d, 'REVIEW.md'), readFileSync(join(d, 'REVIEW.md'), 'utf8') + '| alliance | zh-Hant | 1.0.0 | 2026-01-01 |\n');
    });
    await build(dir);
    expect(readJson('zh-Hant/foundations/index.json').modules.map((m: any) => m.reviewed)).toEqual([true, true]);
    expect(existsSync(join(outDir, 'zh-Hant/foundations/alliance/models.json'))).toBe(true);
  });

  test('an English review row does not review the zh-Hant module, and versions are counted separately', async () => {
    const dir = copy((d, editZh) => editZh('intake/module.yaml', (m) => ({ ...m, version: '1.0.1' })));
    await build(dir);
    expect(readJson('zh-Hant/foundations/index.json').modules[0].reviewed).toBe(false);
    // building en from the same tree is unaffected by the zh version
    await buildContent({ contentDir: dir, outDir, locale: 'en' });
    expect(readJson('en/foundations/index.json').modules[0].reviewed).toBe(true);
  });

  const mismatches: [string, (editZh: (rel: string, fn: (d: any) => any) => void) => void, RegExp][] = [
    ['drill id', (e) => e('intake/drills.yaml', (d) => { d[0].id = 'intake-e11'; }), /zh-Hant.*intake.*"intake-e11"|"intake-e01".*(not|missing)/s],
    ['drill level', (e) => e('intake/drills.yaml', (d) => { const x = d.find((y: any) => y.id === 'intake-e01'); x.level = 'medium'; x.id = 'intake-m11'; }), /intake/],
    ['skill', (e) => e('intake/drills.yaml', (d) => { for (const x of d) if (x.skill === 'open-question') x.skill = 'restatement'; }), /intake/],
    ['module skills list', (e) => e('intake/module.yaml', (d) => { d.skills = ['restatement', 'open-question']; }), /zh-Hant intake.*skills/],
    ['session id', (e) => e('intake/walkthrough.yaml', (d) => { d.sessions[0].id = 'intake-s2'; }), /zh-Hant intake.*session "intake-s1"/],
    ['decision id', (e) => e('intake/walkthrough.yaml', (d) => { d.sessions[0].turns[2].id = 'dx'; }), /zh-Hant intake.*intake-s1.*"d1"/],
    ['option id', (e) => e('intake/walkthrough.yaml', (d) => { d.sessions[0].turns[2].options[1].id = 'z'; }), /zh-Hant intake.*"d1".*option/],
    ['fit', (e) => e('intake/walkthrough.yaml', (d) => { d.sessions[0].turns[2].options[1].fit = 'weak'; }), /zh-Hant intake.*"d1".*option "b".*fit.*"weak".*"workable"/],
    ['decision type', (e) => e('intake/walkthrough.yaml', (d) => { const t = d.sessions[0].turns[4]; t.type = 'choice'; t.options = d.sessions[0].turns[2].options; }), /zh-Hant intake.*"d2"/],
    ['reflection prompt id', (e) => e('intake/module.yaml', (d) => { d.reflection_prompts[0].id = 'rx'; }), /zh-Hant intake.*reflection/],
  ];
  test.each(mismatches)('structure differs from English (%s): build fails and names the module', async (_n, edit, re) => {
    const dir = copy((_d, editZh) => edit(editZh));
    await expect(build(dir)).rejects.toThrow(re);
  });

  test('a zh-Hant module with no English counterpart fails', async () => {
    const dir = copy((d) => cpSync(join(zhStage(d), 'intake'), join(zhStage(d), 'ghost'), { recursive: true }));
    await expect(build(dir)).rejects.toThrow(/zh-Hant.*"ghost".*English/);
  });

  test('English build is unaffected by a broken zh-Hant tree', async () => {
    const dir = copy((_d, editZh) => editZh('intake/drills.yaml', (d) => { d[0].id = 'intake-e11'; }));
    await buildContent({ contentDir: dir, outDir, locale: 'en' });
    expect(readJson('en/foundations/index.json').modules).toHaveLength(2);
  });
});

describe('buildContent multi-stage', () => {
  const MULTI = join(__dirname, '..', 'tests', 'fixtures', 'content', 'multi');
  const buildBoth = async (dir = MULTI) => {
    await buildContent({ contentDir: dir, outDir, locale: 'en' });
    await buildContent({ contentDir: dir, outDir, locale: 'zh-Hant' });
  };
  function copyMulti(edit: (dir: string) => void): string {
    const dir = mkdtempSync(join(tmpdir(), 'fxmulti-'));
    cpSync(MULTI, dir, { recursive: true });
    edit(dir);
    return dir;
  }
  const editYaml = (file: string, fn: (d: any) => any) => {
    const data = parse(readFileSync(file, 'utf8'));
    writeFileSync(file, stringify(fn(data) ?? data));
  };

  test('every stage directory gets its own index and modules, in both languages', async () => {
    await buildBoth();
    expect(readJson('en/foundations/index.json').modules.map((m: any) => m.slug)).toEqual(['intake', 'alliance']);
    expect(readJson('en/demo/index.json')).toMatchObject({ stage: 'demo', title: 'Demo stage (fixture)' });
    expect(readJson('en/demo/index.json').modules).toEqual([{ slug: 'demo-intro', title: 'Demo intro (fixture)', reviewed: true }]);
    expect(existsSync(join(outDir, 'en/demo/demo-intro/module.json'))).toBe(true);
    expect(existsSync(join(outDir, 'en/demo/demo-intro/models.json'))).toBe(true);
    expect(readJson('zh-Hant/demo/index.json').title).toBe('示範階段（測試）');
    expect(existsSync(join(outDir, 'zh-Hant/demo/demo-intro/module.json'))).toBe(true);
  });

  test('stages.json lists the stages: foundations first, then the others by name', async () => {
    await buildBoth();
    expect(readJson('en/stages.json')).toEqual([
      { stage: 'foundations', title: 'Foundations (fixture)' },
      { stage: 'demo', title: 'Demo stage (fixture)' },
    ]);
    expect(readJson('zh-Hant/stages.json').map((s: any) => s.stage)).toEqual(['foundations', 'demo']);
  });

  test('a content tree with only foundations still lists one stage', async () => {
    await buildContent({ contentDir: OK, outDir, locale: 'en' });
    expect(readJson('en/stages.json').map((s: any) => s.stage)).toEqual(['foundations']);
  });

  test('an empty content tree still lists foundations', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'empty-'));
    await buildContent({ contentDir: dir, outDir, locale: 'en' });
    expect(readJson('en/stages.json').map((s: any) => s.stage)).toEqual(['foundations']);
  });

  test('zh-Hant lists the English stages even when it has no tree for one', async () => {
    const dir = copyMulti((d) => rmSync(join(d, 'zh-Hant', 'stages', 'demo'), { recursive: true }));
    await buildContent({ contentDir: dir, outDir, locale: 'zh-Hant' });
    expect(readJson('zh-Hant/stages.json').map((s: any) => s.stage)).toEqual(['foundations', 'demo']);
    expect(readJson('zh-Hant/demo/index.json').modules).toEqual([]);
  });

  test('a module slug in a non-foundations stage must carry the stage prefix', async () => {
    const dir = copyMulti((d) => {
      editYaml(join(d, 'en/stages/demo/stage.yaml'), (s) => ({ ...s, modules: ['intro'] }));
      cpSync(join(d, 'en/stages/demo/demo-intro'), join(d, 'en/stages/demo/intro'), { recursive: true });
      rmSync(join(d, 'en/stages/demo/demo-intro'), { recursive: true });
    });
    await expect(buildContent({ contentDir: dir, outDir, locale: 'en' })).rejects.toThrow(/module "intro".*must start with "demo-"/);
  });

  test('the same module slug in two stages is rejected', async () => {
    const dir = copyMulti((d) => {
      // a foundations module named like the demo module
      editYaml(join(d, 'en/stages/demo/stage.yaml'), (s) => s);
      cpSync(join(d, 'en/stages/foundations/intake'), join(d, 'en/stages/demo/intake'), { recursive: true });
      editYaml(join(d, 'en/stages/demo/stage.yaml'), (s) => ({ ...s, modules: [...s.modules, 'intake'] }));
    });
    await expect(buildContent({ contentDir: dir, outDir, locale: 'en' })).rejects.toThrow(/module "intake" is used in more than one stage/);
  });

  test('a skill code reused in another stage is rejected', async () => {
    const dir = copyMulti((d) => {
      const f = join(d, 'en/stages/demo/demo-intro');
      editYaml(join(f, 'module.yaml'), (m) => ({ ...m, skills: ['open-question', 'demo-skill-b'] }));
      editYaml(join(f, 'drills.yaml'), (ds) => { for (const x of ds) if (x.skill === 'demo-skill-a') x.skill = 'open-question'; });
    });
    await expect(buildContent({ contentDir: dir, outDir, locale: 'en' })).rejects.toThrow(/skill "open-question" is used in stages "demo" and "foundations"/);
  });

  test('stage.yaml must name its own directory', async () => {
    const dir = copyMulti((d) => editYaml(join(d, 'en/stages/demo/stage.yaml'), (s) => ({ ...s, stage: 'other' })));
    await expect(buildContent({ contentDir: dir, outDir, locale: 'en' })).rejects.toThrow(/demo\/stage\.yaml: stage "other" does not match directory "demo"/);
  });

  test('a stage that exists only in zh-Hant is rejected', async () => {
    const dir = copyMulti((d) => rmSync(join(d, 'en', 'stages', 'demo'), { recursive: true }));
    await expect(buildContent({ contentDir: dir, outDir, locale: 'zh-Hant' })).rejects.toThrow(/stage "demo" has no English counterpart/);
  });

  test('an error in one stage names the stage', async () => {
    const dir = copyMulti((d) => editYaml(join(d, 'en/stages/demo/demo-intro/drills.yaml'), (ds) => ds.slice(1)));
    await expect(buildContent({ contentDir: dir, outDir, locale: 'en' })).rejects.toThrow(/\[demo\].*demo-intro/s);
  });
});

describe('buildContent: a stage with nothing reviewed is not built out', () => {
  const FX = join(__dirname, '..', 'tests', 'fixtures', 'content');
  const REVIEWED = join(FX, 'ok-reviewed');
  const DRAFT = join(FX, 'draft-stage'); // ok-reviewed + an unreviewed "demo" stage
  const MULTI = join(FX, 'multi'); // ok-reviewed + a reviewed "demo" stage

  /** Every emitted file with its bytes, keyed by path relative to `dir`. */
  function tree(dir: string, base = dir): Record<string, string> {
    const out: Record<string, string> = {};
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) Object.assign(out, tree(p, base));
      else out[p.slice(base.length + 1)] = readFileSync(p, 'utf8');
    }
    return out;
  }
  const buildBoth = async (contentDir: string, out: string, includeUnreviewed = false) => {
    await buildContent({ contentDir, outDir: out, locale: 'en', includeUnreviewed });
    await buildContent({ contentDir, outDir: out, locale: 'zh-Hant', includeUnreviewed });
  };
  const buildTo = async (contentDir: string, includeUnreviewed = false) => {
    const out = mkdtempSync(join(tmpdir(), 'build-out-'));
    await buildBoth(contentDir, out, includeUnreviewed);
    return out;
  };

  test('the output is byte-for-byte what it is without that stage', async () => {
    const without = await buildTo(REVIEWED);
    const withDraft = await buildTo(DRAFT);
    expect(tree(withDraft)).toEqual(tree(without));
    expect(Object.keys(tree(withDraft)).some((f) => f.includes('demo'))).toBe(false);
  });

  test('stages.json in both languages lists only foundations', async () => {
    const out = await buildTo(DRAFT);
    for (const loc of ['en', 'zh-Hant']) {
      expect(JSON.parse(readFileSync(join(out, loc, 'stages.json'), 'utf8')).map((s: any) => s.stage)).toEqual(['foundations']);
    }
  });

  test('a hidden stage is still validated, so a content error does not slip through', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'draft-'));
    cpSync(DRAFT, dir, { recursive: true });
    const f = join(dir, 'en/stages/demo/demo-intro/drills.yaml');
    writeFileSync(f, stringify(parse(readFileSync(f, 'utf8')).slice(1)));
    await expect(buildContent({ contentDir: dir, outDir, locale: 'en' })).rejects.toThrow(/\[demo\].*demo-intro/s);
  });

  test('the authoring preview (includeUnreviewed) builds the stage and its modules', async () => {
    const out = await buildTo(DRAFT, true);
    expect(JSON.parse(readFileSync(join(out, 'en/stages.json'), 'utf8')).map((s: any) => s.stage)).toEqual(['foundations', 'demo']);
    expect(JSON.parse(readFileSync(join(out, 'en/demo/index.json'), 'utf8')).modules).toEqual([{ slug: 'demo-intro', title: 'Demo intro (fixture)', reviewed: false }]);
    expect(existsSync(join(out, 'en/demo/demo-intro/module.json'))).toBe(true);
    expect(existsSync(join(out, 'zh-Hant/demo/demo-intro/module.json'))).toBe(true);
  });

  test('one reviewed English module is enough to build the stage in both languages', async () => {
    const out = await buildTo(MULTI);
    for (const loc of ['en', 'zh-Hant']) {
      expect(JSON.parse(readFileSync(join(out, loc, 'stages.json'), 'utf8')).map((s: any) => s.stage)).toEqual(['foundations', 'demo']);
    }
  });

  test('a stage reviewed only in zh-Hant stays hidden (English decides, as it does for the stage list)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'draft-'));
    cpSync(DRAFT, dir, { recursive: true });
    const review = join(dir, 'REVIEW.md');
    writeFileSync(review, readFileSync(review, 'utf8') + '| demo-intro | zh-Hant | 1.0.0 | 2026-01-01 |\n');
    const out = await buildTo(dir);
    for (const loc of ['en', 'zh-Hant']) {
      expect(JSON.parse(readFileSync(join(out, loc, 'stages.json'), 'utf8')).map((s: any) => s.stage)).toEqual(['foundations']);
    }
    expect(existsSync(join(out, 'zh-Hant/demo'))).toBe(false);
  });

  test('foundations is always built, even with nothing reviewed', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'none-'));
    cpSync(DRAFT, dir, { recursive: true });
    writeFileSync(join(dir, 'REVIEW.md'), '# Review\n');
    const out = await buildTo(dir);
    expect(JSON.parse(readFileSync(join(out, 'en/stages.json'), 'utf8')).map((s: any) => s.stage)).toEqual(['foundations']);
    expect(existsSync(join(out, 'en/foundations/index.json'))).toBe(true);
  });
});

describe('the real course content', () => {
  const CONTENT = join(__dirname, '..', 'content');
  const reviewRows = readFileSync(join(CONTENT, 'REVIEW.md'), 'utf8');

  test('while no eft-* module is registered in REVIEW.md, the default build has no EFT stage', async () => {
    const out = mkdtempSync(join(tmpdir(), 'real-'));
    for (const locale of ['en', 'zh-Hant'] as const) await buildContent({ contentDir: CONTENT, outDir: out, locale });
    const eftReviewed = /^\|\s*eft-/m.test(reviewRows);
    for (const loc of ['en', 'zh-Hant']) {
      const stages = JSON.parse(readFileSync(join(out, loc, 'stages.json'), 'utf8')).map((s: any) => s.stage);
      expect(stages.includes('eft')).toBe(eftReviewed);
      if (!eftReviewed) {
        expect(stages).toEqual(['foundations']);
        expect(existsSync(join(out, loc, 'eft'))).toBe(false);
      }
    }
  });

  test('the EFT stage is authored and valid in both languages (checked by the authoring preview)', async () => {
    const out = mkdtempSync(join(tmpdir(), 'real-'));
    for (const locale of ['en', 'zh-Hant'] as const) await buildContent({ contentDir: CONTENT, outDir: out, locale, includeUnreviewed: true });
    for (const loc of ['en', 'zh-Hant']) {
      const idx = JSON.parse(readFileSync(join(out, loc, 'eft/index.json'), 'utf8'));
      expect(idx.modules.map((m: any) => m.slug)).toEqual(['eft-attunement', 'eft-emotion-types', 'eft-focusing', 'eft-two-chair', 'eft-empty-chair', 'eft-transformation']);
      expect(existsSync(join(out, loc, 'eft/eft-attunement/module.json'))).toBe(true);
    }
  });
});

describe('the DBT stage (modules 1-3)', () => {
  const CONTENT = join(__dirname, '..', 'content');
  const reviewRows = readFileSync(join(CONTENT, 'REVIEW.md'), 'utf8');
  const SLUGS = ['dbt-validation', 'dbt-commitment', 'dbt-chain'];

  test('while no dbt-* module is registered in REVIEW.md, the default build has no DBT stage', async () => {
    const out = mkdtempSync(join(tmpdir(), 'real-'));
    for (const locale of ['en', 'zh-Hant'] as const) await buildContent({ contentDir: CONTENT, outDir: out, locale });
    const dbtReviewed = /^\|\s*dbt-/m.test(reviewRows);
    for (const loc of ['en', 'zh-Hant']) {
      const stages = JSON.parse(readFileSync(join(out, loc, 'stages.json'), 'utf8')).map((s: any) => s.stage);
      expect(stages.includes('dbt')).toBe(dbtReviewed);
      if (!dbtReviewed) expect(existsSync(join(out, loc, 'dbt'))).toBe(false);
    }
  });

  test('the DBT stage is authored and valid in both languages, with the scope notice (authoring preview)', async () => {
    const out = mkdtempSync(join(tmpdir(), 'real-'));
    for (const locale of ['en', 'zh-Hant'] as const) await buildContent({ contentDir: CONTENT, outDir: out, locale, includeUnreviewed: true });
    for (const loc of ['en', 'zh-Hant']) {
      const idx = JSON.parse(readFileSync(join(out, loc, 'dbt/index.json'), 'utf8'));
      expect(idx.modules.map((m: any) => m.slug)).toEqual(SLUGS);
      expect(idx.notice).toMatch(/\S/);
      for (const slug of SLUGS) expect(existsSync(join(out, loc, 'dbt', slug, 'module.json'))).toBe(true);
    }
  });

  test('each DBT module has 30 drills (10 per level, 5 per skill per level), 2 skills and 3 reflections, in both languages', async () => {
    const out = mkdtempSync(join(tmpdir(), 'real-'));
    for (const locale of ['en', 'zh-Hant'] as const) await buildContent({ contentDir: CONTENT, outDir: out, locale, includeUnreviewed: true });
    for (const loc of ['en', 'zh-Hant']) {
      for (const slug of SLUGS) {
        const mod = JSON.parse(readFileSync(join(out, loc, 'dbt', slug, 'module.json'), 'utf8'));
        expect(mod.meta.skills).toHaveLength(2);
        expect(mod.meta.reflection_prompts).toHaveLength(3);
        expect(mod.drills).toHaveLength(30);
        for (const level of ['easy', 'medium', 'hard']) {
          for (const skill of mod.meta.skills) {
            expect(mod.drills.filter((d: any) => d.level === level && d.skill === skill)).toHaveLength(5);
          }
        }
      }
    }
  });
});

describe('stage notice', () => {
  const MULTI = join(__dirname, '..', 'tests', 'fixtures', 'content', 'multi');
  function withNotice(zhToo: boolean): string {
    const dir = mkdtempSync(join(tmpdir(), 'notice-'));
    cpSync(MULTI, dir, { recursive: true });
    const set = (loc: string, text: string) => {
      const f = join(dir, loc, 'stages/demo/stage.yaml');
      writeFileSync(f, stringify({ ...parse(readFileSync(f, 'utf8')), notice: text }));
    };
    set('en', 'English notice.');
    if (zhToo) set('zh-Hant', '中文提示。');
    return dir;
  }

  test('a notice in stage.yaml reaches the stage index, per language', async () => {
    const dir = withNotice(true);
    await buildContent({ contentDir: dir, outDir, locale: 'en' });
    await buildContent({ contentDir: dir, outDir, locale: 'zh-Hant' });
    expect(readJson('en/demo/index.json').notice).toBe('English notice.');
    expect(readJson('zh-Hant/demo/index.json').notice).toBe('中文提示。');
  });

  test('a stage without a notice has no notice key at all (existing output is unchanged)', async () => {
    await buildContent({ contentDir: MULTI, outDir, locale: 'en' });
    expect('notice' in readJson('en/demo/index.json')).toBe(false);
    expect('notice' in readJson('en/foundations/index.json')).toBe(false);
  });

  test('an empty notice is rejected', async () => {
    const dir = withNotice(false);
    const f = join(dir, 'en/stages/demo/stage.yaml');
    writeFileSync(f, stringify({ ...parse(readFileSync(f, 'utf8')), notice: ' ' }));
    await expect(buildContent({ contentDir: dir, outDir, locale: 'en' })).rejects.toThrow(/notice/);
  });
});

describe('stage order', () => {
  test('foundations, then the course order (eft before dbt), then others by name', async () => {
    const { orderStages } = await import('./build-content');
    expect(orderStages(['dbt', 'zeta', 'eft', 'foundations', 'alpha'])).toEqual(['foundations', 'eft', 'dbt', 'alpha', 'zeta']);
  });
});
