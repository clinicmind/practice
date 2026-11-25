import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { en } from '../../i18n/en';
import { LOCALE_KEY } from '../../i18n';
import { zhHant } from '../../i18n/zh-Hant';
import { buildFixture, renderCloud, serve } from '../../test/appHarness';
import { createFakeDb, type FakeDb } from '../../test/fakeDb';
import { createFakeBackend, type FakeBackend } from '../../test/fakeSupabase';
import { addAttempt, ALICE, BEA, SUP, seedCohort } from '../../test/seedCohort';

// All names and text are made up.
const t = en.supervisorTriage;
let built = '';
beforeAll(async () => { built = await buildFixture('ok-reviewed'); });
let db: FakeDb;
let fake: FakeBackend;
beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  serve(built);
  db = createFakeDb();
  fake = createFakeBackend({ userId: SUP, db });
  seedCohort(db); // Alice has old activity (March 2026); Bea has none
});
afterEach(() => vi.unstubAllGlobals());

const ago = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
function addStudent(id: string, name: string, joinedDaysAgo = 60) {
  db.tables.profiles!.push({ id, role: 'student', display_name: name, cohort_id: 'c1', created_at: ago(joinedDaysAgo) });
}
const region = async (name: string) => within(await screen.findByRole('region', { name }));

describe('hardest criteria', () => {
  test('lists the three lowest criteria of the week with module, rate and number of answers', async () => {
    const ids = ['s1', 's2', 's3', 's4', 's5'];
    ids.forEach((id) => addStudent(id, id.toUpperCase()));
    ids.forEach((id, i) => addAttempt(db, { user: id, item: 'intake-e01', response: `${id} wrote a careful reply here.`, met: [true, i < 1, i < 3], at: ago(2) }));
    renderCloud('/supervisor', fake);
    const r = await region(t.hardest.heading);
    const items = await r.findAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent('intake-e01 criterion two'); // 1 of 5
    expect(items[0]).toHaveTextContent(t.hardest.rate(1, 5, 20));
    expect(items[0]).toHaveTextContent('Intake (fixture)');
    expect(items[0]).toHaveTextContent('Fixture client statement for intake-e01.');
    expect(items[1]).toHaveTextContent('intake-e01 criterion three'); // 3 of 5
    expect(items[2]).toHaveTextContent('intake-e01 criterion one'); // 5 of 5
  });
  test('with no answers this week it says nothing is ranked', async () => {
    renderCloud('/supervisor', fake);
    expect(await (await region(t.hardest.heading)).findByText(t.hardest.none)).toBeVisible();
  });
  test('says how many criteria were left out for having too few answers', async () => {
    addAttempt(db, { user: ALICE, item: 'intake-e01', response: 'Alice wrote a careful reply here.', at: ago(1) });
    renderCloud('/supervisor', fake);
    const r = await region(t.hardest.heading);
    expect(await r.findByText(t.hardest.tooFew(3, 5))).toBeVisible();
  });
});

describe('students to check in with', () => {
  test('lists stale and never-active students by name, in neutral words', async () => {
    renderCloud('/supervisor', fake);
    const r = await region(t.checkIn.heading);
    const items = await r.findAllByRole('listitem');
    expect(items.map((i) => i.textContent)).toEqual([
      expect.stringContaining('Alice'), expect.stringContaining('Bea'),
    ]);
    expect(items[0]).toHaveTextContent(t.checkIn.inactive);
    expect(items[1]).toHaveTextContent(t.checkIn.neverStarted);
    expect(document.body.textContent).not.toMatch(/cheat|lazy|fail|bad/i);
  });
  test('a student with a recent attempt is not listed', async () => {
    addAttempt(db, { user: ALICE, item: 'intake-e01', response: 'Alice wrote a careful reply here.', at: ago(1) });
    renderCloud('/supervisor', fake);
    const r = await region(t.checkIn.heading);
    await r.findByText('Bea');
    expect(r.queryByText('Alice')).toBeNull();
  });
  test('lists a student who went through the level twice without passing', async () => {
    for (let round = 0; round < 2; round++) {
      for (let i = 1; i <= 10; i++) {
        addAttempt(db, { user: BEA, item: `intake-e${String(i).padStart(2, '0')}`, response: `Bea round ${round} reply ${i} to the client.`, met: [true, false, false], at: ago(5 - round) });
      }
    }
    renderCloud('/supervisor', fake);
    const r = await region(t.checkIn.heading);
    const bea = (await r.findByText('Bea')).closest('li')!;
    expect(bea).toHaveTextContent(t.checkIn.stuck('Intake (fixture)', 'Easy', 2));
  });
  test('says nothing is listed when everyone practised', async () => {
    for (const id of [ALICE, BEA]) addAttempt(db, { user: id, item: 'intake-e01', response: `${id} wrote a careful reply here.`, at: ago(1) });
    renderCloud('/supervisor', fake);
    expect(await (await region(t.checkIn.heading)).findByText(t.checkIn.none)).toBeVisible();
  });
  test('a finished term does not list anyone', async () => {
    db.tables.cohorts![0]!.term_end = '2020-01-01';
    renderCloud('/supervisor', fake);
    expect(await (await region(t.checkIn.heading)).findByText(t.checkIn.termOver)).toBeVisible();
  });
});

describe('replies worth discussing', () => {
  test('lists a marked reply with its reason, and says it is not a ranking', async () => {
    addAttempt(db, { user: BEA, item: 'intake-e01', response: 'ok', met: [true, true, true], at: ago(1) });
    renderCloud('/supervisor', fake);
    const r = await region(t.discuss.heading);
    expect(await r.findByText('ok')).toBeVisible();
    expect(r.getByText(en.supervisor.flags['all-met-but-short']!, { exact: false })).toBeVisible();
    expect(r.getByText(t.discuss.intro)).toBeVisible();
    expect(r.getByRole('link', { name: t.discuss.student('Bea') })).toHaveAttribute('href', `/supervisor/students/${BEA}`);
  });
  test('offers ordinary replies by turn, as a separate list', async () => {
    addAttempt(db, { user: BEA, item: 'intake-e02', response: 'Bea wrote a careful reply here.', met: [true, true, false], at: ago(1) });
    renderCloud('/supervisor', fake);
    const r = await region(t.discuss.heading);
    expect(await r.findByText('Bea wrote a careful reply here.')).toBeVisible();
    expect(r.getByText(t.discuss.rotationNote)).toBeVisible();
    expect(r.getByText(t.discuss.noneFlagged)).toBeVisible();
  });
  test('with no replies this week both lists say so', async () => {
    renderCloud('/supervisor', fake);
    const r = await region(t.discuss.heading);
    expect(await r.findByText(t.discuss.noneRotation)).toBeVisible();
    expect(r.getByText(t.discuss.noneFlagged)).toBeVisible();
  });
  test('a reply that copies the example in the other language is marked', async () => {
    // The Chinese fixture model for intake-e01
    const zhModel = await (await fetch('/content/zh-Hant/foundations/intake/models.json')).json() as Record<string, { model_response: string }>;
    addAttempt(db, { user: BEA, item: 'intake-e01', response: zhModel['intake-e01']!.model_response, met: [true, true, false], at: ago(1) });
    renderCloud('/supervisor', fake);
    const r = await region(t.discuss.heading);
    expect(await r.findByText(en.supervisor.flags['copied-model']!, { exact: false })).toBeVisible();
  });
});

describe('failures stay inside the new blocks', () => {
  test('if the attempts cannot be read for the summary, the progress table still shows', async () => {
    // The first read of attempts is the progress table's; the summary reads them again afterwards, and that read fails.
    const orig = db.client.from;
    let reads = 0;
    db.client.from = (name: string) => { if (name === 'attempts' && ++reads === 2) db.failReads.add('attempts'); return orig(name); };
    renderCloud('/supervisor', fake);
    expect((await screen.findAllByText(t.loadError)).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('table').length).toBeGreaterThan(0);
  });
});

describe('in Traditional Chinese', () => {
  test('the blocks and the guide use the Chinese strings', async () => {
    localStorage.setItem(LOCALE_KEY, 'zh-Hant');
    renderCloud('/supervisor', fake);
    const z = zhHant.supervisorTriage;
    expect(await screen.findByRole('region', { name: z.hardest.heading })).toBeVisible();
    expect(screen.getByRole('region', { name: z.checkIn.heading })).toBeVisible();
    expect(screen.getByRole('region', { name: z.discuss.heading })).toBeVisible();
    expect(screen.getByText(zhHant.supervisorGuide.summary)).toBeVisible();
  });
});

describe('how-to guide', () => {
  test('opens to numbered steps for the four tasks', async () => {
    const user = userEvent.setup();
    renderCloud('/supervisor', fake);
    await user.click(await screen.findByText(en.supervisorGuide.summary));
    for (const s of en.supervisorGuide.sections) {
      const h = screen.getByRole('heading', { name: s.title });
      const list = h.parentElement!.querySelector('ol')!;
      expect(list.tagName).toBe('OL');
      expect(within(list as HTMLElement).getAllByRole('listitem')).toHaveLength(s.steps.length);
    }
    expect(en.supervisorGuide.sections.map((s) => s.title)).toEqual(['Set up a cohort', 'Send the invite code', 'Open a stage', 'At the end of the term']);
  });
  test('the guide only names buttons that exist on this page', () => {
    const named = [en.supervisor.createSubmit, en.supervisor.createAnother, en.supervisor.copyCode, en.supervisor.copied, en.supervisor.termClosed, en.stageAdmin.heading];
    const text = en.supervisorGuide.sections.flatMap((s) => s.steps).join('\n');
    for (const n of named) expect(text).toContain(n);
  });
});

describe('other screens are unchanged', () => {
  test('with no students the summary blocks are not shown', async () => {
    db.tables.profiles = db.tables.profiles!.filter((p) => p.role === 'supervisor');
    renderCloud('/supervisor', fake);
    expect(await screen.findByText(en.supervisor.noStudents)).toBeVisible();
    await waitFor(() => expect(screen.queryByRole('region', { name: t.hardest.heading })).toBeNull());
  });
});
