// @vitest-environment node
import { cpSync, mkdtempSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
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
