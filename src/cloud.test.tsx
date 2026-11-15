import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { buildContent } from '../scripts/build-content';
import { App } from './App';
import { resetContentCache } from './content/client';
import { en } from './i18n/en';
import { createLocalStore, STORAGE_KEY } from './progress/localStore';
import { createSupabaseStore } from './progress/supabaseStore';
import { createFakeDb, type FakeDb } from './test/fakeDb';
import { createFakeBackend, type FakeBackend, type ProfileRow } from './test/fakeSupabase';

const FX = join(__dirname, '..', 'tests', 'fixtures', 'content', 'ok-reviewed');
let built = '';
beforeAll(async () => {
  built = mkdtempSync(join(tmpdir(), 'cloud-'));
  await buildContent({ contentDir: FX, outDir: built, locale: 'en' });
});

class Mem implements Storage {
  m = new Map<string, string>();
  get length() { return this.m.size; }
  clear() { this.m.clear(); }
  getItem(k: string) { return this.m.get(k) ?? null; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  removeItem(k: string) { this.m.delete(k); }
  setItem(k: string, v: string) { this.m.set(k, v); }
}

const ME = '11111111-1111-4111-8111-111111111111';
const STUDENT: ProfileRow = { id: ME, role: 'student', display_name: 'Pat', cohort_id: 'c1' };
/** The old bookmark form: still opens, and is redirected to the canonical path below. */
const DRILLS = '/m/intake/drills/easy';
const DRILLS_NOW = '/s/foundations/m/intake/drills/easy';
const TEXT = 'I can hear how hard it is to know where to begin.';

let db: FakeDb;
let fake: FakeBackend;
let local: Mem;
let path = '';
function PathSpy() { path = useLocation().pathname; return null; }

beforeEach(() => {
  resetContentCache();
  sessionStorage.clear();
  localStorage.clear();
  db = createFakeDb();
  local = new Mem();
  fake = createFakeBackend({ userId: ME, profile: STUDENT, db });
  vi.stubGlobal('fetch', async (url: string) => {
    const m = String(url).match(/content\/(.*)$/);
    const file = m ? join(built, m[1]) : '';
    if (!m || !existsSync(file)) return new Response('not found', { status: 404 });
    return new Response(readFileSync(file, 'utf8'), { status: 200 });
  });
});
afterEach(() => vi.unstubAllGlobals());

function renderApp(url: string) {
  render(
    <MemoryRouter initialEntries={[url]}>
      <App store={createLocalStore(local)} storage={local} backend={fake.backend} />
      <PathSpy />
    </MemoryRouter>,
  );
}
const box = () => screen.getByRole('textbox', { name: /your response/i });
async function writeAndRate(user: ReturnType<typeof userEvent.setup>, text = TEXT) {
  await user.type(await screen.findByRole('textbox', { name: /your response/i }), text);
  await user.click(screen.getByRole('button', { name: en.drill.submit }));
  await user.click(screen.getByRole('checkbox', { name: /criterion one/i }));
  await user.click(screen.getByRole('checkbox', { name: /criterion two/i }));
}
const saveBtn = () => screen.getByRole('button', { name: en.drill.saveSelfCheck });

describe('cloud mode', () => {
  test('answers are written to the cloud store, not to the browser', async () => {
    const user = userEvent.setup();
    renderApp(DRILLS);
    await writeAndRate(user);
    await user.click(saveBtn());
    await screen.findByText(en.drill.met);
    expect(db.tables.attempts).toHaveLength(1);
    expect(db.tables.attempts[0]).toMatchObject({ user_id: ME, item_id: 'intake-e01', response: TEXT });
    expect(local.getItem(STORAGE_KEY)).toBeNull();
  });

  test('progress made on one device appears on another', async () => {
    const remote = createSupabaseStore(db.client as never, ME);
    for (let i = 1; i <= 8; i++) {
      await remote.saveAttempt({ itemId: `intake-e0${i}`, response: TEXT, criteriaMet: [true, true, false] });
    }
    renderApp('/m/intake');
    const row = await screen.findByText('Medium');
    expect(row.closest('li')).not.toHaveTextContent(en.module.levelLocked); // easy passed on the other device
    expect(screen.getByText('8 / 10 met')).toBeInTheDocument();
  });
});

describe('Review focus 3: saving while offline never loses the text', () => {
  test('text stays, an error with retry shows, and a retry saves exactly once', async () => {
    const user = userEvent.setup();
    renderApp(DRILLS);
    await writeAndRate(user);
    db.networkDown = true;
    await user.click(saveBtn());
    expect(await screen.findByRole('alert')).toHaveTextContent(en.drill.saveError);
    expect(saveBtn()).toBeEnabled();
    expect(box()).toHaveValue(TEXT);
    expect(db.tables.attempts).toHaveLength(0);

    db.restore();
    await user.click(saveBtn());
    await screen.findByText(en.drill.met);
    expect(db.tables.attempts).toHaveLength(1);
  });
});

describe('Review focus 5: sign-in expires mid-answer', () => {
  test('prompts to sign in again, and after sign-in returns to the same question with the text', async () => {
    const user = userEvent.setup();
    renderApp(DRILLS);
    // Answer question 1, move on to question 2, and start question 2.
    await writeAndRate(user);
    await user.click(saveBtn());
    await user.click(await screen.findByRole('button', { name: en.drill.next }));
    await screen.findByText(en.drill.questionOf(2, 10));
    await writeAndRate(user, 'Second answer typed before the session ran out.');

    db.authExpired = true;
    await user.click(saveBtn());
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(en.drill.sessionExpired);
    expect(box()).toHaveValue('Second answer typed before the session ran out.');
    expect(sessionStorage.getItem('cm.draft.intake-e02')).not.toBeNull();

    // Supabase gives up refreshing the token.
    act(() => fake.emit('SIGNED_OUT', null));
    await waitFor(() => expect(path).toBe('/login'));

    db.restore();
    act(() => fake.emit('SIGNED_IN', ME));
    await waitFor(() => expect(path).toBe(DRILLS_NOW));
    expect(await screen.findByText(en.drill.questionOf(2, 10))).toBeInTheDocument();
    expect(box()).toHaveValue('Second answer typed before the session ran out.');

    // Finishing the answer saves it and removes the draft.
    await user.click(screen.getByRole('button', { name: en.drill.submit }));
    // The self-check ticks were kept too.
    expect(screen.getByRole('checkbox', { name: /criterion one/i })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /criterion two/i })).toBeChecked();
    await user.click(saveBtn());
    await screen.findByText(en.drill.met);
    expect(sessionStorage.getItem('cm.draft.intake-e02')).toBeNull();
    expect(db.tables.attempts.map((a) => a.item_id)).toEqual(['intake-e01', 'intake-e02']);
  });

  test('the sign-in again button leads to /login', async () => {
    const user = userEvent.setup();
    renderApp(DRILLS);
    await writeAndRate(user);
    db.authExpired = true;
    await user.click(saveBtn());
    await user.click(await screen.findByRole('button', { name: en.drill.signInAgain }));
    await waitFor(() => expect(path).toBe('/login'));
    expect(localStorage.getItem('cm.returnTo')).toBe(DRILLS_NOW);
  });
});

describe('Review focus 4: importing local progress', () => {
  async function seedLocal() {
    const l = createLocalStore(local);
    await l.saveAttempt({ itemId: 'intake-e01', response: TEXT, criteriaMet: [true, true, true] });
    await l.saveAttempt({ itemId: 'intake-e02', response: TEXT, criteriaMet: [true, true, true] });
    await l.saveDecision({ sessionId: 'intake-s1', decisionId: 'd1', optionId: 'a' });
  }

  test('local progress moves to the account on sign-in, once', async () => {
    await seedLocal();
    renderApp('/');
    await screen.findByRole('heading', { level: 1 });
    expect(db.tables.attempts).toHaveLength(2);
    expect(db.tables.decisions).toHaveLength(1);
    expect(local.getItem(STORAGE_KEY)).toBeNull();
  });

  test('a failed import shows an error with retry, keeps local data, and the retry makes no duplicates', async () => {
    await seedLocal();
    db.failWritesAfter(1);
    renderApp('/');
    expect(await screen.findByRole('alert')).toHaveTextContent(en.auth.importError);
    expect(local.getItem(STORAGE_KEY)).not.toBeNull();
    expect(db.tables.attempts).toHaveLength(1);

    db.restore();
    await userEvent.click(screen.getByRole('button', { name: en.common.retry }));
    await screen.findByRole('heading', { level: 1 });
    expect(db.tables.attempts).toHaveLength(2);
    expect(db.tables.decisions).toHaveLength(1);
    expect(local.getItem(STORAGE_KEY)).toBeNull();
  });

  test('with nothing to import the app opens straight away', async () => {
    renderApp('/');
    expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(screen.queryByText(en.auth.importing)).toBeNull();
    expect(within(document.body).queryByRole('alert')).toBeNull();
  });
});
