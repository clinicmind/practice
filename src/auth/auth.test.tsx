import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { buildContent } from '../../scripts/build-content';
import { App } from '../App';
import { resetContentCache } from '../content/client';
import { en } from '../i18n/en';
import { createLocalStore } from '../progress/localStore';
import { createFakeBackend, type FakeBackend, type ProfileRow } from '../test/fakeSupabase';

const FX = join(__dirname, '..', '..', 'tests', 'fixtures', 'content', 'ok-reviewed');
let built = '';
beforeAll(async () => {
  built = mkdtempSync(join(tmpdir(), 'auth-'));
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

beforeEach(() => {
  resetContentCache();
  localStorage.clear();
  sessionStorage.clear();
  vi.stubGlobal('fetch', async (url: string) => {
    const m = String(url).match(/content\/(.*)$/);
    const file = m ? join(built, m[1]) : '';
    if (!m || !existsSync(file)) return new Response('not found', { status: 404 });
    return new Response(readFileSync(file, 'utf8'), { status: 200 });
  });
});
afterEach(() => vi.unstubAllGlobals());

let path = '';
function PathSpy() { path = useLocation().pathname; return null; }
function renderApp(url: string, fake: FakeBackend | null) {
  render(
    <MemoryRouter initialEntries={[url]}>
      <App store={createLocalStore(new Mem())} backend={fake?.backend ?? null} />
      <PathSpy />
    </MemoryRouter>,
  );
}

const STUDENT: ProfileRow = { id: 'u-student', role: 'student', display_name: 'Pat', cohort_id: 'c1' };
const SUPERVISOR: ProfileRow = { id: 'u-sup', role: 'supervisor', display_name: 'Dr S', cohort_id: null };

describe('route guards', () => {
  test('signed-out user is sent to /login from any app route, and back after sign-in', async () => {
    const fake = createFakeBackend();
    fake.profiles.set(STUDENT.id, STUDENT);
    renderApp('/m/intake', fake);
    await waitFor(() => expect(path).toBe('/login'));
    expect(screen.getByRole('heading', { name: en.auth.loginHeading })).toBeInTheDocument();
    act(() => fake.emit('SIGNED_IN', STUDENT.id));
    await waitFor(() => expect(path).toBe('/m/intake'));
  });

  test('after a magic link in a new tab, /auth/callback returns to the remembered page', async () => {
    const fake = createFakeBackend();
    fake.profiles.set(STUDENT.id, STUDENT);
    renderApp('/m/intake/drills/easy', fake);
    await waitFor(() => expect(path).toBe('/login'));
    // The link opens a fresh tab: no router state, only what was stored.
    document.body.innerHTML = '';
    resetContentCache();
    const fake2 = createFakeBackend({ userId: STUDENT.id });
    fake2.profiles.set(STUDENT.id, STUDENT);
    renderApp('/auth/callback', fake2);
    await waitFor(() => expect(path).toBe('/m/intake/drills/easy'));
  });

  test('a remembered return path that is not a local path is ignored', async () => {
    localStorage.setItem('cm.returnTo', '//evil.example/x');
    const fake = createFakeBackend({ userId: STUDENT.id });
    fake.profiles.set(STUDENT.id, STUDENT);
    renderApp('/auth/callback', fake);
    await waitFor(() => expect(path).toBe('/'));
  });

  test('signed-in user without a profile is sent to /join', async () => {
    const fake = createFakeBackend({ userId: 'u-new' });
    renderApp('/', fake);
    await waitFor(() => expect(path).toBe('/join'));
    expect(screen.getByRole('heading', { name: en.auth.joinHeading })).toBeInTheDocument();
  });

  test('student opening /supervisor sees the not-found page', async () => {
    const fake = createFakeBackend({ userId: STUDENT.id, profile: STUDENT });
    renderApp('/supervisor', fake);
    expect(await screen.findByRole('heading', { name: en.notFound.heading })).toBeInTheDocument();
  });

  test('student opening /supervisor/students/x sees the not-found page', async () => {
    const fake = createFakeBackend({ userId: STUDENT.id, profile: STUDENT });
    renderApp('/supervisor/students/x', fake);
    expect(await screen.findByRole('heading', { name: en.notFound.heading })).toBeInTheDocument();
  });

  test('supervisor lands on /supervisor after sign-in', async () => {
    const fake = createFakeBackend();
    fake.profiles.set(SUPERVISOR.id, SUPERVISOR);
    renderApp('/login', fake);
    await screen.findByRole('heading', { name: en.auth.loginHeading });
    act(() => fake.emit('SIGNED_IN', SUPERVISOR.id));
    await waitFor(() => expect(path).toBe('/supervisor'));
  });

  test('signed-in student does not see the login page', async () => {
    const fake = createFakeBackend({ userId: STUDENT.id, profile: STUDENT });
    renderApp('/login', fake);
    await waitFor(() => expect(path).toBe('/'));
  });

  test('sign out returns to /login', async () => {
    const fake = createFakeBackend({ userId: STUDENT.id, profile: STUDENT });
    renderApp('/', fake);
    await userEvent.click(await screen.findByRole('button', { name: en.auth.signOut }));
    await waitFor(() => expect(path).toBe('/login'));
    expect(fake.calls.signOut).toBe(1);
  });
});

describe('sign-in form', () => {
  test('shows "check your email" and does not reveal whether the address is registered', async () => {
    const fake = createFakeBackend();
    fake.profiles.set(STUDENT.id, STUDENT);
    renderApp('/login', fake);
    const input = await screen.findByLabelText(en.auth.emailLabel);
    await userEvent.type(input, 'known@example.com');
    await userEvent.click(screen.getByRole('button', { name: en.auth.sendLink }));
    const first = (await screen.findByRole('status')).textContent;
    expect(first).toBe(en.auth.checkEmail);

    // A second, unknown address gets the identical message.
    await userEvent.click(screen.getByRole('button', { name: en.auth.useAnotherEmail }));
    await userEvent.type(screen.getByLabelText(en.auth.emailLabel), 'nobody@example.com');
    await userEvent.click(screen.getByRole('button', { name: en.auth.sendLink }));
    expect((await screen.findByRole('status')).textContent).toBe(first);

    expect(fake.calls.signInWithOtp.map((c) => c.email)).toEqual(['known@example.com', 'nobody@example.com']);
    expect(fake.calls.signInWithOtp[0].redirectTo).toMatch(/\/auth\/callback$/);
    expect(screen.queryByText(/registered|no account|not found/i)).toBeNull();
  });

  test('a failed send shows a generic error and keeps the form usable', async () => {
    const fake = createFakeBackend();
    fake.failOtp = new Error('network down');
    renderApp('/login', fake);
    await userEvent.type(await screen.findByLabelText(en.auth.emailLabel), 'a@example.com');
    await userEvent.click(screen.getByRole('button', { name: en.auth.sendLink }));
    expect(await screen.findByRole('alert')).toHaveTextContent(en.auth.sendError);
    expect(screen.getByLabelText(en.auth.emailLabel)).toHaveValue('a@example.com');
  });

  test('requires an email address', async () => {
    const fake = createFakeBackend();
    renderApp('/login', fake);
    await userEvent.click(await screen.findByRole('button', { name: en.auth.sendLink }));
    expect(await screen.findByRole('alert')).toHaveTextContent(en.auth.emailRequired);
    expect(fake.calls.signInWithOtp).toHaveLength(0);
  });
});

describe('join', () => {
  async function openJoin(fake: FakeBackend) {
    renderApp('/join', fake);
    await screen.findByRole('heading', { name: en.auth.joinHeading });
  }
  async function fill(code: string, name: string) {
    await userEvent.clear(screen.getByLabelText(en.auth.codeLabel));
    await userEvent.type(screen.getByLabelText(en.auth.codeLabel), code);
    await userEvent.clear(screen.getByLabelText(en.auth.displayNameLabel));
    if (name) await userEvent.type(screen.getByLabelText(en.auth.displayNameLabel), name);
    await userEvent.click(screen.getByRole('button', { name: en.auth.joinSubmit }));
  }

  test.each([
    ['invalid_code', en.auth.joinErrors.invalid_code],
    ['cohort_closed', en.auth.joinErrors.cohort_closed],
    ['rate_limited', en.auth.joinErrors.rate_limited],
  ])('join shows a specific message for %s', async (code, message) => {
    const fake = createFakeBackend({ userId: 'u-new' });
    fake.joinResult = { cohort_id: null, error_code: code };
    await openJoin(fake);
    await fill('ABCDEFGHJK', 'Sam');
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(path).toBe('/join');
  });

  test('the three error messages are all different', () => {
    const m = en.auth.joinErrors;
    expect(new Set([m.invalid_code, m.cohort_closed, m.rate_limited]).size).toBe(3);
  });

  test('display name field explains that a pseudonym is fine; 1–40 chars; trimmed', async () => {
    const fake = createFakeBackend({ userId: 'u-new' });
    await openJoin(fake);
    const field = screen.getByLabelText(en.auth.displayNameLabel);
    expect(field).toHaveAccessibleDescription(en.auth.displayNameHelp);
    expect(en.auth.displayNameHelp).toMatch(/pseudonym/i);

    await fill('ABCDEFGHJK', '   ');
    expect(await screen.findByRole('alert')).toHaveTextContent(en.auth.displayNameInvalid);
    await fill('ABCDEFGHJK', 'x'.repeat(41));
    expect(await screen.findByRole('alert')).toHaveTextContent(en.auth.displayNameInvalid);
    expect(fake.calls.rpc).toHaveLength(0);

    await fill('abcdefghjk', '  Pat  ');
    await waitFor(() => expect(path).toBe('/'));
    expect(fake.calls.rpc).toEqual([{ name: 'join_cohort', args: { code: 'abcdefghjk', display_name: 'Pat' } }]);
  });

  test('a signed-in student is sent away from /join', async () => {
    const fake = createFakeBackend({ userId: STUDENT.id, profile: STUDENT });
    renderApp('/join', fake);
    await waitFor(() => expect(path).toBe('/'));
  });

  test('a signed-out visitor to /join is sent to /login', async () => {
    renderApp('/join', createFakeBackend());
    await waitFor(() => expect(path).toBe('/login'));
  });
});

describe('local mode', () => {
  test('without Supabase env the app runs in local mode with no login screen', async () => {
    renderApp('/', null);
    expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(path).toBe('/');
    expect(screen.queryByRole('button', { name: en.auth.signOut })).toBeNull();
    expect(screen.queryByText(en.auth.loginHeading)).toBeNull();
  });

  test.each(['/login', '/join', '/auth/callback', '/supervisor'])('%s is not found in local mode', async (url) => {
    renderApp(url, null);
    expect(await screen.findByRole('heading', { name: en.notFound.heading })).toBeInTheDocument();
  });
});
