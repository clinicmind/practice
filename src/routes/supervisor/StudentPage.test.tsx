import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { en } from '../../i18n/en';
import { zhHant } from '../../i18n/zh-Hant';
import { LOCALE_KEY } from '../../i18n';
import { buildFixture, renderCloud, serve, spy } from '../../test/appHarness';
import { createFakeDb, type FakeDb } from '../../test/fakeDb';
import { createFakeBackend, type FakeBackend } from '../../test/fakeSupabase';
import { addAttempt, ALICE, BEA, SUP, seedCohort } from '../../test/seedCohort';

let built = '';
beforeAll(async () => { built = await buildFixture('ok-reviewed'); });
let db: FakeDb;
let fake: FakeBackend;
beforeEach(() => {
  sessionStorage.clear();
  serve(built);
  db = createFakeDb();
  seedCohort(db);
  fake = createFakeBackend({ userId: SUP, db });
});
afterEach(() => vi.unstubAllGlobals());

describe('student page', () => {
  test('lists attempts newest first with response, criteria and flags', async () => {
    // Bea: an old plain attempt, then a newer one that ticks everything with almost nothing written,
    // then one that copies the example response word for word.
    addAttempt(db, { user: BEA, item: 'intake-e01', response: 'A considered and fairly detailed reply here.', at: '2026-04-01T10:00:00.000Z' });
    addAttempt(db, { user: BEA, item: 'intake-e02', response: 'ok fine', met: [true, true, true], at: '2026-04-02T10:00:00.000Z' });
    addAttempt(db, { user: BEA, item: 'intake-e03', response: 'FIXTURE DEMONSTRATION FOR intake-e03!!', at: '2026-04-03T10:00:00.000Z' });
    renderCloud(`/supervisor/students/${BEA}`, fake);
    expect(await screen.findByRole('heading', { name: 'Bea' })).toBeVisible();

    const items = Array.from((await screen.findByRole('list', { name: en.supervisor.attemptsHeading })).children) as HTMLElement[];
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent('FIXTURE DEMONSTRATION FOR intake-e03!!');
    expect(items[1]).toHaveTextContent('ok fine');
    expect(items[2]).toHaveTextContent('A considered and fairly detailed reply here.');

    // criteria: the three statements with their met / not met state
    expect(items[2]).toHaveTextContent('intake-e01 criterion one');
    expect(within(items[2]).getAllByText(en.supervisor.criterionMet)).toHaveLength(2);
    expect(within(items[2]).getAllByText(en.supervisor.criterionNotMet)).toHaveLength(1);

    // flags
    expect(items[0]).toHaveTextContent(en.supervisor.flags['copied-model']);
    expect(items[1]).toHaveTextContent(en.supervisor.flags['all-met-but-short']);
    expect(items[2]).not.toHaveTextContent(en.supervisor.flagPrefix);
  });

  test('copied-model also recognises the zh-Hant example response, and a missing Chinese file is not an error', async () => {
    addAttempt(db, { user: BEA, item: 'intake-e03', response: '測試用示範回應（intake-e03）。', at: '2026-04-03T10:00:00.000Z' });
    addAttempt(db, { user: BEA, item: 'alliance-e01', response: 'Fixture demonstration for alliance-e01.', at: '2026-04-04T10:00:00.000Z' });
    renderCloud(`/supervisor/students/${BEA}`, fake);
    const items = Array.from((await screen.findByRole('list', { name: en.supervisor.attemptsHeading })).children) as HTMLElement[];
    // alliance has no reviewed zh-Hant module, so there is no zh models file; the English one still matches.
    expect(items[0]).toHaveTextContent(en.supervisor.flags['copied-model']);
    expect(items[1]).toHaveTextContent(en.supervisor.flags['copied-model']);
    expect(screen.queryByText(en.supervisor.modelsMissing)).not.toBeInTheDocument();
  });

  test('the supervisor pages have a Chinese interface, including flag text', async () => {
    localStorage.setItem(LOCALE_KEY, 'zh-Hant');
    addAttempt(db, { user: BEA, item: 'intake-e03', response: 'FIXTURE DEMONSTRATION FOR intake-e03!!', at: '2026-04-03T10:00:00.000Z' });
    try {
      renderCloud(`/supervisor/students/${BEA}`, fake);
      expect(await screen.findByRole('heading', { name: 'Bea' })).toBeVisible();
      const items = Array.from((await screen.findByRole('list', { name: zhHant.supervisor.attemptsHeading })).children) as HTMLElement[];
      expect(items[0]).toHaveTextContent(zhHant.supervisor.flags['copied-model']);
      expect(screen.getByRole('link', { name: zhHant.supervisor.backToCohort })).toBeVisible();
      expect(screen.getByText(zhHant.supervisor.flagsNote)).toBeVisible();
    } finally {
      localStorage.clear();
    }
  });

  test('flags a repeated identical response', async () => {
    const same = 'The very same words, long enough to look like a real answer.';
    addAttempt(db, { user: BEA, item: 'intake-e01', response: same, at: '2026-04-01T10:00:00.000Z' });
    addAttempt(db, { user: BEA, item: 'intake-e01', response: same, at: '2026-04-02T10:00:00.000Z' });
    renderCloud(`/supervisor/students/${BEA}`, fake);
    const items = Array.from((await screen.findByRole('list', { name: en.supervisor.attemptsHeading })).children) as HTMLElement[];
    expect(items[0]).toHaveTextContent(en.supervisor.flags['identical-to-previous']);
    expect(items[1]).not.toHaveTextContent(en.supervisor.flagPrefix);
  });

  test('shows progress per module and level, and decisions', async () => {
    renderCloud(`/supervisor/students/${ALICE}`, fake);
    await screen.findByRole('heading', { name: 'Alice' });
    expect(await screen.findByText(en.module.met(8, 10), { exact: false })).toBeVisible();
    expect(screen.getByText(en.supervisor.walkthroughDone, { exact: false })).toBeVisible();
    expect(screen.getByText('my own words')).toBeVisible(); // her free-text decision
  });

  test('an unknown student shows a not-found message', async () => {
    renderCloud('/supervisor/students/nobody', fake);
    expect(await screen.findByText(en.supervisor.studentNotFound)).toBeVisible();
  });

  test('granting an unlock writes the grant, and the level shows as opened by hand', async () => {
    const user = userEvent.setup();
    renderCloud(`/supervisor/students/${BEA}`, fake);
    const btn = await screen.findByRole('button', { name: en.supervisor.unlockButton('Medium', 'Intake (fixture)') });
    await user.click(btn);
    await waitFor(() => expect(db.tables.unlocks).toHaveLength(1));
    expect(db.tables.unlocks[0]).toMatchObject({ user_id: BEA, module_slug: 'intake', level: 'medium', granted_by: SUP });
    expect(await screen.findByText(en.supervisor.grantedByHand('Medium', 'Intake (fixture)'))).toBeVisible();
    expect(screen.queryByRole('button', { name: en.supervisor.unlockButton('Medium', 'Intake (fixture)') })).toBeNull();
    // Hard is still behind medium: not granted, so still offered.
    expect(screen.getByRole('button', { name: en.supervisor.unlockButton('Hard', 'Intake (fixture)') })).toBeVisible();
    // Easy is always open: no button for it.
    expect(screen.queryByRole('button', { name: en.supervisor.unlockButton('Easy', 'Intake (fixture)') })).toBeNull();
  });

  test('a failed grant says so and offers it again', async () => {
    const user = userEvent.setup();
    renderCloud(`/supervisor/students/${BEA}`, fake);
    const btn = await screen.findByRole('button', { name: en.supervisor.unlockButton('Medium', 'Intake (fixture)') });
    db.networkDown = true;
    await user.click(btn);
    expect(await screen.findByRole('alert')).toHaveTextContent(en.supervisor.grantError);
    expect(db.tables.unlocks).toHaveLength(0);
  });
});

describe('granting an unlock makes that level available to the student (rules layer)', () => {
  test('without the grant medium is locked for Bea; with it she can open it', async () => {
    const bea = createFakeBackend({ userId: BEA, db });
    const { unmount } = renderCloud('/m/intake', bea);
    const heading = await screen.findByRole('heading', { name: /Intake \(fixture\)/ });
    expect(heading).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Medium' })).toBeNull();
    unmount();

    db.tables.unlocks.push({ id: 'u1', user_id: BEA, module_slug: 'intake', level: 'medium', granted_by: SUP, created_at: '2026-04-01T00:00:00.000Z' });
    renderCloud('/m/intake/drills/medium', bea);
    expect(await screen.findByRole('heading', { name: /Medium practice/ })).toBeVisible();
  });

  test('a grant for another module or another student changes nothing', async () => {
    db.tables.unlocks.push(
      { id: 'u1', user_id: BEA, module_slug: 'alliance', level: 'medium', granted_by: SUP, created_at: 'x' },
      { id: 'u2', user_id: ALICE, module_slug: 'intake', level: 'hard', granted_by: SUP, created_at: 'x' },
    );
    renderCloud('/m/intake/drills/medium', createFakeBackend({ userId: BEA, db }));
    // Locked: sent back to the module page.
    await waitFor(() => expect(spy.path).toBe('/m/intake'));
  });
});
