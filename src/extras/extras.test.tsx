import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { App } from '../App';
import { en } from '../i18n/en';
import { zhHant } from '../i18n/zh-Hant';
import { itemMet } from '../progress/rules';
import { STORAGE_KEY, createLocalStore } from '../progress/localStore';
import { createFakeBackend } from '../test/fakeSupabase';
import { Mem, buildFixture, serve } from '../test/appHarness';
import { REVIEW_KEY } from './review';

const x = en.practiceExtras;
let built: string;
beforeAll(async () => { built = await buildFixture('ok-reviewed'); });
let storage: Mem;
beforeEach(() => {
  storage = new Mem();
  localStorage.clear();
  sessionStorage.clear();
  vi.spyOn(window.navigator, 'languages', 'get').mockReturnValue(['en-US']);
  serve(built);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
const LONG = 'A response that is long enough to count.';
function seed(attempts: { itemId: string; ticks: number; ago: number }[], reflections: { moduleSlug: string; promptId: string; text: string }[] = []) {
  storage.setItem(STORAGE_KEY, JSON.stringify({
    version: 1,
    attempts: attempts.map((a, i) => ({
      id: `att-${i}`, itemId: a.itemId, response: `${LONG} (${a.itemId})`, createdAt: daysAgo(a.ago),
      criteriaMet: [0, 1, 2].map((k) => k < a.ticks),
    })),
    decisions: [],
    reflections: reflections.map((r, i) => ({ id: `ref-${i}`, ...r, createdAt: daysAgo(1) })),
  }));
}
function mount(url: string, extras: boolean) {
  const store = createLocalStore(storage);
  render(
    <MemoryRouter initialEntries={[url]}>
      <App store={store} storage={storage} extrasEnabled={extras} />
    </MemoryRouter>,
  );
  return store;
}
async function answerFirstDrill(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByRole('textbox', { name: 'Your response' }), LONG);
  await user.click(screen.getByRole('button', { name: 'Submit response' }));
  await user.click(screen.getByRole('checkbox', { name: /criterion one/ }));
  await user.click(screen.getByRole('checkbox', { name: /criterion two/ }));
  await user.click(screen.getByRole('button', { name: 'Save self-check' }));
  await screen.findByText('Fixture demonstration for intake-e01.');
}

describe('with the switch off (what students get today)', () => {
  test('no revise box, no home cards, and no extras routes', async () => {
    const user = userEvent.setup();
    mount('/s/foundations/m/intake/drills/easy', false);
    await answerFirstDrill(user);
    expect(screen.queryByText(x.revise.heading)).not.toBeInTheDocument();
    expect(localStorage.getItem(REVIEW_KEY)).toBeNull();
    expect(storage.getItem(REVIEW_KEY)).toBeNull();
  });
  test('home shows no prep link or review card, even when a review is due', async () => {
    seed([{ itemId: 'intake-e01', ticks: 2, ago: 5 }]);
    mount('/', false);
    await screen.findByRole('heading', { name: 'Foundations (fixture)' });
    expect(screen.queryByText(x.review.cardHeading)).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: x.prep.nav })).not.toBeInTheDocument();
  });
  test.each(['/review', '/supervision-prep'])('%s is a page that does not exist', async (url) => {
    mount(url, false);
    expect(await screen.findByRole('heading', { name: en.notFound.heading })).toBeInTheDocument();
  });
});

describe('revise once more', () => {
  test('appears only after the example is shown; needs a criterion and text; shows the two versions side by side', async () => {
    const user = userEvent.setup();
    mount('/s/foundations/m/intake/drills/easy', true);
    await answerFirstDrill(user);
    const box = await screen.findByRole('textbox', { name: x.revise.textLabel });
    const show = screen.getByRole('button', { name: x.revise.show });
    expect(show).toBeDisabled();
    await user.type(box, 'Second try, with the example in mind.');
    expect(show).toBeDisabled(); // still no criterion chosen
    await user.click(screen.getByRole('radio', { name: /criterion three/ }));
    expect(show).toBeEnabled();
    await user.click(show);
    const pair = screen.getByRole('group', { name: x.revise.compareLabel });
    expect(within(pair).getByText(`${LONG}`)).toBeInTheDocument();
    expect(within(pair).getByText('Second try, with the example in mind.')).toBeInTheDocument();
    expect(screen.getByText(x.revise.focusLabel('intake-e01 criterion three'))).toBeInTheDocument();
    // can go back and change it
    await user.click(screen.getByRole('button', { name: x.revise.edit }));
    expect(screen.getByRole('textbox', { name: x.revise.textLabel })).toHaveValue('Second try, with the example in mind.');
  });

  test('is not saved: the stored attempt is unchanged and the pass result does not move', async () => {
    const user = userEvent.setup();
    const store = mount('/s/foundations/m/intake/drills/easy', true);
    await answerFirstDrill(user);
    const before = await store.listAttempts();
    expect(before).toHaveLength(1);
    expect(itemMet(before, 'intake-e01')).toBe(true);
    const saveAttempt = vi.spyOn(store, 'saveAttempt');
    await user.type(await screen.findByRole('textbox', { name: x.revise.textLabel }), 'x');
    await user.click(screen.getByRole('radio', { name: /criterion one/ }));
    await user.click(screen.getByRole('button', { name: x.revise.show }));
    expect(saveAttempt).not.toHaveBeenCalled();
    const after = await store.listAttempts();
    expect(after).toEqual(before);
    expect(itemMet(after, 'intake-e01')).toBe(true);
    expect(storage.getItem(STORAGE_KEY)).not.toContain('"x"');
    expect(sessionStorage.length).toBe(0);
  });

  test('is not shown before the example is shown', async () => {
    mount('/s/foundations/m/intake/drills/easy', true);
    await screen.findByRole('textbox', { name: 'Your response' });
    expect(screen.queryByText(x.revise.heading)).not.toBeInTheDocument();
  });
});

describe('supervision prep sheet', () => {
  const six = ['intake-e01', 'intake-e02', 'intake-e03', 'intake-e04'].map((itemId) => ({ itemId, ticks: 3, ago: 2 }));

  test('lists finished questions only, caps the choice at three, and builds the sheet in the workbook order', async () => {
    const user = userEvent.setup();
    seed([...six, { itemId: 'intake-e05', ticks: 1, ago: 2 }], [{ moduleSlug: 'intake', promptId: 'r1', text: 'My reflection text.' }]);
    mount('/supervision-prep', true);
    const boxes = await screen.findAllByRole('checkbox');
    expect(boxes).toHaveLength(4); // e05 was not finished
    expect(screen.getByText(x.prep.itemsCount(0))).toBeInTheDocument();
    for (const b of boxes.slice(0, 3)) await user.click(b);
    expect(boxes[3]).toBeDisabled();
    expect(screen.getByText(x.prep.itemsFull)).toBeInTheDocument();
    await user.click(boxes[0]); // clear one
    expect(boxes[3]).toBeEnabled();
    await user.click(screen.getByRole('radio', { name: /My reflection text/ }));

    const sheet = screen.getByRole('article', { name: x.prep.sheet.title });
    const heads = within(sheet).getAllByRole('heading').map((h) => h.textContent);
    expect(heads).toEqual([x.prep.sheet.title, x.prep.sheet.practised, x.prep.sheet.tried, x.prep.sheet.toPractise]);
    expect(within(sheet).getAllByText(x.prep.sheet.myResponse + ':')).toHaveLength(2);
    expect(within(sheet).getByText('My reflection text.')).toBeInTheDocument();
    expect(within(sheet).getByRole('textbox', { name: x.prep.sheet.tried })).toHaveValue('');
    expect(within(sheet).getByRole('textbox', { name: x.prep.sheet.toPractise })).toHaveValue('');
  });

  test('the header carries the fictional-case warning in both languages', () => {
    expect(en.practiceExtras.prep.sheet.title).toBe('Deliberate practice reflection (fictional client: do not write real client information)');
    expect(zhHant.practiceExtras.prep.sheet.title).toBe('刻意練習反思（虛構個案，不要寫真實個案資料）');
    expect(zhHant.practiceExtras.prep.sheet.practised).toBe('本週練了什麼');
    expect(zhHant.practiceExtras.prep.sheet.tried).toBe('我嘗試了什麼');
    expect(zhHant.practiceExtras.prep.sheet.toPractise).toBe('我想在督導中練習什麼');
  });

  test('the print button prints, and the sheet shows nothing about the account', async () => {
    const user = userEvent.setup();
    const print = vi.fn();
    vi.stubGlobal('print', print);
    const fake = createFakeBackend({ userId: 'u1', profile: { id: 'u1', role: 'student', display_name: 'Pat Example', cohort_id: 'c1' } });
    const st = new Mem();
    render(
      <MemoryRouter initialEntries={['/supervision-prep']}>
        <App store={createLocalStore(st)} storage={st} backend={fake.backend} extrasEnabled />
      </MemoryRouter>,
    );
    const sheet = await screen.findByRole('article', { name: x.prep.sheet.title });
    expect(sheet).not.toHaveTextContent('Pat Example');
    expect(sheet).not.toHaveTextContent(/@/);
    await user.click(screen.getByRole('button', { name: x.prep.print }));
    expect(print).toHaveBeenCalledTimes(1);
  });
});

describe('mixed review', () => {
  test('the home card offers up to 3 due questions; nothing due, no card', async () => {
    seed([{ itemId: 'intake-e01', ticks: 3, ago: 0 }]);
    mount('/', true);
    await screen.findByRole('heading', { name: 'Foundations (fixture)' });
    expect(await screen.findByRole('link', { name: x.prep.nav })).toBeInTheDocument();
    expect(screen.queryByText(x.review.cardHeading)).not.toBeInTheDocument();
  });

  test('flow: module names hidden, answer first, then the earlier answer and the example; progress untouched', async () => {
    const user = userEvent.setup();
    seed([
      { itemId: 'intake-e01', ticks: 2, ago: 5 }, { itemId: 'intake-e02', ticks: 3, ago: 5 }, { itemId: 'intake-e03', ticks: 3, ago: 9 },
      { itemId: 'intake-e04', ticks: 3, ago: 5 },
    ]);
    const store = mount('/', true);
    const before = await store.listAttempts();
    expect(await screen.findByText(x.review.cardText(3))).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: x.review.start }));

    expect(await screen.findByRole('heading', { name: x.review.heading })).toBeInTheDocument();
    expect(screen.getByText(x.review.itemOf(1, 3))).toBeInTheDocument();
    expect(screen.queryByText(/Intake \(fixture\)/)).not.toBeInTheDocument(); // no module name before the answer
    // the barely passed item (2 criteria) comes first, and its earlier answer is hidden until the student answers
    expect(screen.getByText('Fixture client statement for intake-e01.', { exact: false })).toBeInTheDocument();
    expect(screen.queryByText(new RegExp(`${LONG} \\(intake-e01\\)`))).not.toBeInTheDocument();
    const reveal = screen.getByRole('button', { name: x.review.reveal });
    expect(reveal).toBeDisabled();
    await user.type(screen.getByRole('textbox', { name: x.review.yourAnswerNow }), 'From memory.');
    await user.click(reveal);
    expect(await screen.findByText(`${LONG} (intake-e01)`)).toBeInTheDocument();
    expect(screen.getByText('From memory.')).toBeInTheDocument();
    expect(await screen.findByText('Fixture demonstration for intake-e01.')).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(REVIEW_KEY)!)).toMatchObject([{ itemId: 'intake-e01', kind: 'done', response: 'From memory.' }]);

    await user.click(screen.getByRole('button', { name: x.review.next }));
    // skipping is allowed
    await user.click(await screen.findByRole('button', { name: x.review.skip }));
    expect(JSON.parse(localStorage.getItem(REVIEW_KEY)!).map((e: { kind: string }) => e.kind)).toEqual(['done', 'skipped']);
    await user.click(await screen.findByRole('button', { name: x.review.skip }));
    expect(await screen.findByText(x.review.doneText(1, 2))).toBeInTheDocument();

    // not one attempt was written, so the pass calculation has nothing new
    const after = await store.listAttempts();
    expect(after).toEqual(before);
    for (const id of ['intake-e01', 'intake-e02', 'intake-e03']) expect(itemMet(after, id)).toBe(true);
  });

  test('a reviewed question does not come back the same day', async () => {
    const user = userEvent.setup();
    seed([{ itemId: 'intake-e01', ticks: 3, ago: 5 }]);
    mount('/review', true);
    await user.type(await screen.findByRole('textbox', { name: x.review.yourAnswerNow }), 'Again.');
    await user.click(screen.getByRole('button', { name: x.review.reveal }));
    await user.click(await screen.findByRole('button', { name: x.review.finish }));
    expect(await screen.findByText(x.review.doneText(1, 0))).toBeInTheDocument();
    document.body.innerHTML = '';
    mount('/review', true);
    expect(await screen.findByText(x.review.nothingDue)).toBeInTheDocument();
  });

  test('only open questions are offered: a hard-level item is not, before the level is unlocked', async () => {
    seed([{ itemId: 'intake-h01', ticks: 3, ago: 5 }]);
    mount('/review', true);
    await waitFor(() => expect(screen.getByText(x.review.nothingDue)).toBeInTheDocument());
  });
});
