import { screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { en } from '../i18n/en';
import { buildFixture, renderCloud, serve } from '../test/appHarness';
import { createFakeDb } from '../test/fakeDb';
import { createFakeBackend, type ProfileRow } from '../test/fakeSupabase';

const STUDENT: ProfileRow = { id: 'stu', role: 'student', display_name: 'Pat', cohort_id: 'c1' };
const SUPERVISOR: ProfileRow = { id: 'sup', role: 'supervisor', display_name: 'Dr S', cohort_id: null };

// "ok": intake is reviewed, alliance is not. Production builds ship only reviewed modules;
// a preview build (INCLUDE_UNREVIEWED=1) also ships alliance's content.
let production = '';
let preview = '';
beforeAll(async () => {
  production = await buildFixture('ok');
  preview = await buildFixture('ok', { includeUnreviewed: true });
});
afterEach(() => vi.unstubAllGlobals());
beforeEach(() => sessionStorage.clear());

const as = (profile: ProfileRow) => createFakeBackend({ userId: profile.id, profile, db: createFakeDb() });

describe('unreviewed modules', () => {
  test('a student does not see an unreviewed module on the stage page', async () => {
    serve(preview);
    renderCloud('/', as(STUDENT));
    await screen.findByRole('link', { name: /Intake \(fixture\)/ });
    expect(screen.queryByText(/Alliance/)).not.toBeInTheDocument();
    expect(screen.queryByText(en.stage.unreviewed)).not.toBeInTheDocument();
  });

  test('a student cannot open an unreviewed module by URL, even when its content is shipped', async () => {
    serve(preview);
    renderCloud('/m/alliance', as(STUDENT));
    expect(await screen.findByRole('heading', { name: en.notFound.heading })).toBeVisible();
    expect(screen.queryByText(/Alliance \(fixture\)/)).not.toBeInTheDocument();
  });

  test('a supervisor sees the unreviewed module, marked Unreviewed, and it is open without finishing intake', async () => {
    serve(production);
    renderCloud('/', as(SUPERVISOR));
    const link = await screen.findByRole('link', { name: /Alliance \(fixture\)/ });
    expect(link.closest('li')).toHaveTextContent(en.stage.unreviewed);
    expect(link.closest('li')).not.toHaveTextContent(en.stage.locked);
    const intake = screen.getByRole('link', { name: /Intake \(fixture\)/ });
    expect(intake.closest('li')).not.toHaveTextContent(en.stage.unreviewed);
  });

  test('in a build that ships its content, a supervisor can open the module and sees the Unreviewed marker', async () => {
    serve(preview);
    renderCloud('/m/alliance', as(SUPERVISOR));
    expect(await screen.findByRole('heading', { name: /Alliance \(fixture\)/ })).toBeVisible();
    expect(screen.getByText(en.stage.unreviewed)).toBeVisible();
    expect(screen.getByRole('link', { name: /Session 1/ })).toBeVisible();
  });

  test('in a production build the unreviewed module says its content is not in this build, not a blank page', async () => {
    serve(production);
    renderCloud('/m/alliance', as(SUPERVISOR));
    expect(await screen.findByText(en.stage.unreviewedNotShipped)).toBeVisible();
    expect(screen.getByText(en.stage.unreviewed)).toBeVisible();
  });

  test('an unknown module is not found for a supervisor too', async () => {
    serve(production);
    renderCloud('/m/nope', as(SUPERVISOR));
    expect(await screen.findByRole('heading', { name: en.notFound.heading })).toBeVisible();
    await waitFor(() => expect(screen.queryByText(en.common.loading)).toBeNull());
  });
});

describe('stage notice', () => {
  afterEach(() => localStorage.clear());
  test('a stage with a notice shows it above the module list, and a stage without one does not', async () => {
    const { mkdtempSync, cpSync, readFileSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { parse, stringify } = await import('yaml');
    const { buildContent } = await import('../../scripts/build-content');
    const src = join(__dirname, '..', '..', 'tests', 'fixtures', 'content', 'multi');
    const dir = mkdtempSync(join(tmpdir(), 'notice-'));
    cpSync(src, dir, { recursive: true });
    const f = join(dir, 'en/stages/demo/stage.yaml');
    writeFileSync(f, stringify({ ...parse(readFileSync(f, 'utf8')), notice: 'This stage touches on loss. Pause whenever you need to.' }));
    const fz = join(dir, 'zh-Hant/stages/demo/stage.yaml');
    writeFileSync(fz, stringify({ ...parse(readFileSync(fz, 'utf8')), notice: '這個階段涉及喪失。需要時可以隨時暫停。' }));
    const out = mkdtempSync(join(tmpdir(), 'notice-out-'));
    for (const locale of ['en', 'zh-Hant'] as const) await buildContent({ contentDir: dir, outDir: out, locale });
    serve(out);
    renderCloud('/s/demo', as(SUPERVISOR));
    const note = await screen.findByText(/This stage touches on loss/);
    expect(note.closest('aside')).toHaveAccessibleName(en.eft.noticeLabel);
    expect(screen.getByRole('link', { name: /Demo intro/ })).toBeVisible();
  });

  test('in Traditional Chinese the notice is the Chinese one', async () => {
    const { mkdtempSync, cpSync, readFileSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { parse, stringify } = await import('yaml');
    const { buildContent } = await import('../../scripts/build-content');
    const dir = mkdtempSync(join(tmpdir(), 'notice-zh-'));
    cpSync(join(__dirname, '..', '..', 'tests', 'fixtures', 'content', 'multi'), dir, { recursive: true });
    for (const [loc, text] of [['en', 'English notice.'], ['zh-Hant', '中文提示。']] as const) {
      const f = join(dir, loc, 'stages/demo/stage.yaml');
      writeFileSync(f, stringify({ ...parse(readFileSync(f, 'utf8')), notice: text }));
    }
    const out = mkdtempSync(join(tmpdir(), 'notice-zh-out-'));
    for (const locale of ['en', 'zh-Hant'] as const) await buildContent({ contentDir: dir, outDir: out, locale });
    serve(out);
    localStorage.setItem('cm.practice.locale', 'zh-Hant');
    renderCloud('/s/demo', as(SUPERVISOR));
    expect(await screen.findByText('中文提示。')).toBeVisible();
    expect(screen.queryByText('English notice.')).not.toBeInTheDocument();
  });

  test('the foundations page has no notice block', async () => {
    serve(await buildFixture('multi'));
    renderCloud('/s/foundations', as(SUPERVISOR));
    await screen.findByRole('link', { name: /Intake \(fixture\)/ });
    expect(document.querySelector('aside')).toBeNull();
  });
});
