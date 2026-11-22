import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { en } from '../../i18n/en';
import { zhHant } from '../../i18n/zh-Hant';
import { LOCALE_KEY } from '../../i18n';
import { buildFixture, renderCloud, serve } from '../../test/appHarness';
import { createFakeDb, type FakeDb } from '../../test/fakeDb';
import { createFakeBackend, type FakeBackend } from '../../test/fakeSupabase';
import { addAttempt, BEA, SUP, seedCohort } from '../../test/seedCohort';

const t = en.stageAdmin;
let multi = '';
let single = '';
beforeAll(async () => {
  multi = await buildFixture('multi');
  single = await buildFixture('ok-reviewed');
});
let db: FakeDb;
let fake: FakeBackend;
beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  db = createFakeDb();
  db.tables.cohort_stages = [];
  seedCohort(db);
  fake = createFakeBackend({ userId: SUP, db });
});
afterEach(() => vi.unstubAllGlobals());

const stagesRegion = async () => within(await screen.findByRole('region', { name: t.heading }));

describe('stage controls on the cohort page', () => {
  test('with only foundations, says there is nothing to open and never reads cohort_stages', async () => {
    serve(single);
    renderCloud('/supervisor', fake);
    const region = await stagesRegion();
    expect(await region.findByText(t.onlyFoundations)).toBeVisible();
    expect(region.queryByRole('checkbox')).toBeNull();
    expect(region.queryByRole('table')).toBeNull();
    expect(db.reads.some((r) => r.table === 'cohort_stages')).toBe(false);
  });

  test('lists every stage except foundations, closed by default, and no control for foundations', async () => {
    serve(multi);
    renderCloud('/supervisor', fake);
    const region = await stagesRegion();
    const box = await region.findByRole('checkbox', { name: t.toggleLabel('Demo stage (fixture)') });
    expect(box).not.toBeChecked();
    expect(region.getAllByRole('checkbox')).toHaveLength(1);
    expect(region.queryByRole('checkbox', { name: /foundations/i })).toBeNull();
  });

  test('a stage with a row is shown as open', async () => {
    db.tables.cohort_stages.push({ id: 'cs1', cohort_id: 'c1', stage: 'demo', opened_by: SUP, created_at: '2026-02-01T00:00:00.000Z' });
    serve(multi);
    renderCloud('/supervisor', fake);
    const region = await stagesRegion();
    expect(await region.findByRole('checkbox', { name: t.toggleLabel('Demo stage (fixture)') })).toBeChecked();
  });

  test('opening adds one row signed by the supervisor; closing deletes it', async () => {
    const user = userEvent.setup();
    serve(multi);
    renderCloud('/supervisor', fake);
    const region = await stagesRegion();
    const box = await region.findByRole('checkbox', { name: t.toggleLabel('Demo stage (fixture)') });
    await user.click(box);
    await waitFor(() => expect(box).toBeChecked());
    expect(db.tables.cohort_stages).toHaveLength(1);
    expect(db.tables.cohort_stages[0]).toMatchObject({ cohort_id: 'c1', stage: 'demo', opened_by: SUP });
    await user.click(box);
    await waitFor(() => expect(box).not.toBeChecked());
    expect(db.tables.cohort_stages).toHaveLength(0);
  });

  test('is operable with the keyboard', async () => {
    const user = userEvent.setup();
    serve(multi);
    renderCloud('/supervisor', fake);
    const region = await stagesRegion();
    const box = await region.findByRole('checkbox', { name: t.toggleLabel('Demo stage (fixture)') });
    box.focus();
    await user.keyboard(' ');
    await waitFor(() => expect(db.tables.cohort_stages).toHaveLength(1));
  });

  test('a failed write says so and leaves the checkbox as it was', async () => {
    const user = userEvent.setup();
    serve(multi);
    renderCloud('/supervisor', fake);
    const region = await stagesRegion();
    const box = await region.findByRole('checkbox', { name: t.toggleLabel('Demo stage (fixture)') });
    db.failWritesAfter(0);
    await user.click(box);
    expect(await region.findByRole('alert')).toHaveTextContent(t.saveError);
    expect(box).not.toBeChecked();
    expect(db.tables.cohort_stages).toHaveLength(0);
  });

  test('before 0004 is applied, explains it and the rest of the cohort page still works', async () => {
    db.missingTables.add('cohort_stages');
    serve(multi);
    renderCloud('/supervisor', fake);
    const region = await stagesRegion();
    expect(await region.findByText(t.needsMigration)).toBeVisible();
    expect(region.queryByRole('checkbox')).toBeNull();
    // the rest of the page: invite code and the progress table
    expect(await screen.findByText('ABCDEFGHJK')).toBeVisible();
    const table = await screen.findByRole('table', { name: en.supervisor.progressCaption('Spring cohort') });
    expect(within(table).getByRole('link', { name: 'Alice' })).toBeVisible();
    expect(screen.queryByText(en.supervisor.loadError)).toBeNull();
  });

  test('any other read error shows a retryable message, again leaving the rest of the page alone', async () => {
    const user = userEvent.setup();
    db.failReads.add('cohort_stages');
    serve(multi);
    renderCloud('/supervisor', fake);
    const region = await stagesRegion();
    expect(await region.findByRole('alert')).toHaveTextContent(t.loadError);
    expect(region.queryByText(t.needsMigration)).toBeNull();
    expect(await screen.findByRole('table', { name: en.supervisor.progressCaption('Spring cohort') })).toBeVisible();
    db.failReads.clear();
    await user.click(region.getByRole('button', { name: en.common.retry }));
    expect(await region.findByRole('checkbox', { name: t.toggleLabel('Demo stage (fixture)') })).toBeVisible();
  });

  test('writing before 0004 is applied also explains it', async () => {
    const user = userEvent.setup();
    serve(multi);
    renderCloud('/supervisor', fake);
    const region = await stagesRegion();
    const box = await region.findByRole('checkbox', { name: t.toggleLabel('Demo stage (fixture)') });
    db.missingTables.add('cohort_stages');
    await user.click(box);
    expect(await region.findByText(t.needsMigration)).toBeVisible();
  });

  test('the progress table gets a column for each reviewed module of every stage', async () => {
    serve(multi);
    renderCloud('/supervisor', fake);
    const table = await screen.findByRole('table', { name: en.supervisor.progressCaption('Spring cohort') });
    const headers = within(table).getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toEqual([en.supervisor.colStudent, en.supervisor.colLastActive, 'Intake (fixture)', 'Alliance (fixture)', 'Demo intro (fixture)']);
  });

  test('the stage section has a Chinese interface', async () => {
    localStorage.setItem(LOCALE_KEY, 'zh-Hant');
    serve(multi);
    renderCloud('/supervisor', fake);
    const region = within(await screen.findByRole('region', { name: zhHant.stageAdmin.heading }));
    expect(await region.findByRole('checkbox', { name: zhHant.stageAdmin.toggleLabel('Demo stage (fixture)') })).toBeVisible();
  });
});

describe('student page groups progress by stage', () => {
  test('with several stages, each module sits under its stage, with progress from every stage', async () => {
    addAttempt(db, { user: BEA, item: 'demo-intro-e01', response: 'A considered reply for the demo stage.', at: '2026-04-01T10:00:00.000Z' });
    serve(multi);
    renderCloud(`/supervisor/students/${BEA}`, fake);
    const progress = within(await screen.findByRole('region', { name: en.supervisor.progressHeading }));
    const stageHeads = progress.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(stageHeads).toEqual(['Foundations (fixture)', 'Demo stage (fixture)']);
    const demoGroup = within(progress.getByRole('group', { name: 'Demo stage (fixture)' }));
    expect(demoGroup.getByRole('heading', { level: 4, name: 'Demo intro (fixture)' })).toBeVisible();
    expect(demoGroup.getByText(new RegExp(`^${en.levels.easy}: 1 / \\d+`))).toBeVisible();
    // The attempt is not "unknown" now that the demo stage is read
    expect(screen.queryByText(new RegExp(en.supervisor.unknownItem))).toBeNull();
  });

  test('with one stage, the page looks as it always did (no stage headings)', async () => {
    serve(single);
    renderCloud(`/supervisor/students/${BEA}`, fake);
    const progress = within(await screen.findByRole('region', { name: en.supervisor.progressHeading }));
    expect(progress.getAllByRole('heading', { level: 3 }).length).toBeGreaterThan(0);
    expect(progress.queryByRole('heading', { level: 4 })).toBeNull();
    expect(progress.queryByRole('group')).toBeNull();
  });

  test('a copied example response is flagged for a module outside foundations', async () => {
    addAttempt(db, { user: BEA, item: 'demo-intro-e01', response: 'Fixture demonstration for demo-intro-e01.', at: '2026-04-01T10:00:00.000Z' });
    serve(multi);
    renderCloud(`/supervisor/students/${BEA}`, fake);
    const list = await screen.findByRole('list', { name: en.supervisor.attemptsHeading });
    expect(await within(list).findByText(new RegExp(en.supervisor.flags['copied-model']))).toBeVisible();
  });
});
