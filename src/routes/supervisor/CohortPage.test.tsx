import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { en } from '../../i18n/en';
import { buildFixture, renderCloud, serve, spy } from '../../test/appHarness';
import { createFakeDb, type FakeDb } from '../../test/fakeDb';
import { createFakeBackend, type FakeBackend } from '../../test/fakeSupabase';
import { ALICE, BEA, CODE, SUP, seedCohort } from '../../test/seedCohort';

let built = '';
beforeAll(async () => { built = await buildFixture('ok-reviewed'); });
let db: FakeDb;
let fake: FakeBackend;
beforeEach(() => {
  sessionStorage.clear();
  serve(built);
  db = createFakeDb();
  fake = createFakeBackend({ userId: SUP, db });
});
afterEach(() => vi.unstubAllGlobals());

const isoDay = (offset: number) => {
  const d = new Date(); d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

describe('cohort page', () => {
  beforeEach(() => seedCohort(db));

  test('shows one row per student with per-module progress and last active date', async () => {
    renderCloud('/supervisor', fake);
    const table = await screen.findByRole('table', { name: en.supervisor.progressCaption('Spring cohort') });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);

    const alice = rows.find((r) => within(r).queryByRole('link', { name: 'Alice' }))!;
    expect(alice).toHaveTextContent('2026-03-20'); // her latest decision
    const aliceIntake = within(alice).getAllByRole('cell')[1];
    expect(aliceIntake).toHaveTextContent(en.supervisor.walkthroughDone);
    expect(aliceIntake).toHaveTextContent(en.supervisor.passed(['Easy']));

    const bea = rows.find((r) => within(r).queryByRole('link', { name: 'Bea' }))!;
    expect(bea).toHaveTextContent(en.supervisor.neverActive);
    const beaIntake = within(bea).getAllByRole('cell')[1];
    expect(beaIntake).toHaveTextContent(en.supervisor.walkthroughNotDone);
    expect(beaIntake).toHaveTextContent(en.supervisor.passed([]));

    const headers = within(table).getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toEqual([en.supervisor.colStudent, en.supervisor.colLastActive, 'Intake (fixture)', 'Alliance (fixture)']);
  });

  test('shows the invite code and a copy button that copies it', async () => {
    const user = userEvent.setup();
    renderCloud('/supervisor', fake);
    expect(await screen.findByText(CODE)).toBeVisible();
    await user.click(screen.getByRole('button', { name: en.supervisor.copyCode }));
    expect(await navigator.clipboard.readText()).toBe(CODE);
    expect(await screen.findByText(en.supervisor.copied)).toBeVisible();
  });

  test('shows the term end, and marks a finished term', async () => {
    renderCloud('/supervisor', fake);
    expect(await screen.findByText(en.supervisor.termEnds('2099-12-31'))).toBeVisible();
  });

  test('shows an empty message when nobody has joined yet', async () => {
    db.tables.profiles = db.tables.profiles.filter((p) => p.role === 'supervisor');
    renderCloud('/supervisor', fake);
    expect(await screen.findByText(en.supervisor.noStudents)).toBeVisible();
  });

  test('the invite code is not shown to students', async () => {
    const student = createFakeBackend({ userId: ALICE, db });
    renderCloud('/supervisor', student);
    expect(await screen.findByRole('heading', { name: en.notFound.heading })).toBeVisible();
    expect(document.body).not.toHaveTextContent(CODE);
    expect(db.reads.some((r) => r.table === 'cohorts')).toBe(false);
  });

  test('a student name opens that student', async () => {
    renderCloud('/supervisor', fake);
    await userEvent.click(await screen.findByRole('link', { name: 'Bea' }));
    await waitFor(() => expect(spy.path).toBe(`/supervisor/students/${BEA}`));
  });

  test('an error reading the cohort shows a retryable message, then recovers', async () => {
    db.failReads.add('cohorts');
    renderCloud('/supervisor', fake);
    expect(await screen.findByRole('alert')).toHaveTextContent(en.supervisor.loadError);
    db.failReads.clear();
    await userEvent.click(screen.getByRole('button', { name: en.common.retry }));
    expect(await screen.findByRole('table')).toBeVisible();
  });
});

describe('a supervisor with no cohort', () => {
  beforeEach(() => seedCohort(db, { withCohort: false }));

  test('sees a create-cohort form', async () => {
    renderCloud('/supervisor', fake);
    expect(await screen.findByRole('heading', { name: en.supervisor.createHeading })).toBeVisible();
    expect(screen.getByLabelText(en.supervisor.cohortName)).toBeVisible();
    expect(screen.getByLabelText(en.supervisor.termEnd)).toBeVisible();
  });

  test('term end must be a future date', async () => {
    const user = userEvent.setup();
    renderCloud('/supervisor', fake);
    await user.type(await screen.findByLabelText(en.supervisor.cohortName), 'Autumn');
    for (const bad of [isoDay(-1), isoDay(0)]) {
      await user.clear(screen.getByLabelText(en.supervisor.termEnd));
      await user.type(screen.getByLabelText(en.supervisor.termEnd), bad);
      await user.click(screen.getByRole('button', { name: en.supervisor.createSubmit }));
      expect(await screen.findByRole('alert')).toHaveTextContent(en.supervisor.termEndFuture);
    }
    expect(fake.calls.rpc.filter((c) => c.name === 'create_cohort')).toHaveLength(0);
  });

  test('requires a name and a date', async () => {
    const user = userEvent.setup();
    renderCloud('/supervisor', fake);
    await user.click(await screen.findByRole('button', { name: en.supervisor.createSubmit }));
    expect(await screen.findByRole('alert')).toBeVisible();
    expect(fake.calls.rpc).toHaveLength(0);
  });

  test('creating a cohort shows its invite code', async () => {
    const user = userEvent.setup();
    renderCloud('/supervisor', fake);
    await user.type(await screen.findByLabelText(en.supervisor.cohortName), '  Autumn cohort ');
    await user.type(screen.getByLabelText(en.supervisor.termEnd), isoDay(30));
    await user.click(screen.getByRole('button', { name: en.supervisor.createSubmit }));
    expect(await screen.findByText('KMNPQRSTUV')).toBeVisible();
    expect(fake.calls.rpc).toEqual([{ name: 'create_cohort', args: { name: 'Autumn cohort', term_end: isoDay(30) } }]);
    expect(screen.getByRole('heading', { name: 'Autumn cohort' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: en.supervisor.createHeading })).toBeNull();
  });

  test('a failed create keeps the form and says so', async () => {
    const user = userEvent.setup();
    fake.createCohortError = 'boom';
    renderCloud('/supervisor', fake);
    await user.type(await screen.findByLabelText(en.supervisor.cohortName), 'Autumn');
    await user.type(screen.getByLabelText(en.supervisor.termEnd), isoDay(30));
    await user.click(screen.getByRole('button', { name: en.supervisor.createSubmit }));
    expect(await screen.findByRole('alert')).toHaveTextContent(en.supervisor.createError);
    expect(screen.getByLabelText(en.supervisor.cohortName)).toHaveValue('Autumn');
  });
});
