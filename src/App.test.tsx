import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { buildContent } from '../scripts/build-content';
import { App } from './App';
import { resetContentCache } from './content/client';
import { en } from './i18n/en';
import { createLocalStore } from './progress/localStore';
import type { ProgressStore } from './progress/types';

const FX = join(__dirname, '..', 'tests', 'fixtures', 'content');
const built: Record<string, string> = {};
beforeAll(async () => {
  for (const name of ['ok', 'ok-reviewed']) {
    built[name] = mkdtempSync(join(tmpdir(), `app-${name}-`));
    await buildContent({ contentDir: join(FX, name), outDir: built[name], locale: 'en' });
  }
});

/** Serve the built fixture over a stubbed fetch, as the static host would. */
function serve(name: 'ok' | 'ok-reviewed') {
  vi.stubGlobal('fetch', async (url: string) => {
    const m = String(url).match(/content\/(.*)$/);
    const file = m ? join(built[name], m[1]) : '';
    if (!m || !existsSync(file)) return new Response('not found', { status: 404 });
    return new Response(readFileSync(file, 'utf8'), { status: 200 });
  });
}

class Mem implements Storage {
  m = new Map<string, string>();
  get length() { return this.m.size; }
  clear() { this.m.clear(); }
  getItem(k: string) { return this.m.get(k) ?? null; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  removeItem(k: string) { this.m.delete(k); }
  setItem(k: string, v: string) { this.m.set(k, v); }
}
let storage: Mem;
beforeEach(() => { storage = new Mem(); resetContentCache(); serve('ok-reviewed'); });
afterEach(() => vi.unstubAllGlobals());

let path = '';
function PathSpy() { path = useLocation().pathname; return null; }
function renderAt(url: string, store: ProgressStore & { wasReset?: boolean } = createLocalStore(storage)) {
  render(
    <MemoryRouter initialEntries={[url]}>
      <App store={store} wasReset={store.wasReset} />
      <PathSpy />
    </MemoryRouter>,
  );
  return store;
}

const LONG = 'A response that is long enough to count.';
async function passLevel(store: ProgressStore, slug: string, code: 'e' | 'm' | 'h', count = 8) {
  for (let i = 1; i <= count; i++) {
    await store.saveAttempt({ itemId: `${slug}-${code}${String(i).padStart(2, '0')}`, response: LONG, criteriaMet: [true, true, false] });
  }
}
async function finishWalkthrough(store: ProgressStore, slug: string) {
  await store.saveDecision({ sessionId: `${slug}-s1`, decisionId: 'd1', optionId: 'a' });
  await store.saveDecision({ sessionId: `${slug}-s1`, decisionId: 'd2', response: 'x' });
}

describe('stage page', () => {
  test('lists modules; locked ones are marked and not links', async () => {
    renderAt('/');
    expect(await screen.findByRole('link', { name: /Intake \(fixture\)/ })).toBeVisible();
    const locked = screen.getByText(/Alliance \(fixture\)/);
    expect(locked.closest('a')).toBeNull();
    expect(within(locked.closest('li')!).getByText(/locked/i)).toBeVisible();
  });
  test('next module opens once the previous walkthrough is finished', async () => {
    const store = createLocalStore(storage);
    await finishWalkthrough(store, 'intake');
    renderAt('/', store);
    expect(await screen.findByRole('link', { name: /Alliance \(fixture\)/ })).toBeVisible();
  });
  test('unreviewed module is hidden from the stage page', async () => {
    serve('ok');
    renderAt('/');
    await screen.findByRole('link', { name: /Intake \(fixture\)/ });
    expect(screen.queryByText(/Alliance/)).not.toBeInTheDocument();
  });
  test('an unreviewed module blocks later modules and cannot be opened by URL', async () => {
    serve('ok');
    const store = createLocalStore(storage);
    await finishWalkthrough(store, 'intake');
    renderAt('/m/alliance', store);
    expect(await screen.findByRole('heading', { name: en.notFound.heading })).toBeVisible();
  });
  test('shows a retryable error rather than a blank page when content cannot load', async () => {
    vi.stubGlobal('fetch', async () => new Response('x', { status: 500 }));
    renderAt('/');
    expect(await screen.findByRole('alert')).toBeVisible();
    expect(screen.getByRole('button', { name: /try again/i })).toBeVisible();
  });
});

describe('module page', () => {
  test('shows per-level progress as "n / 10 met" and lock state', async () => {
    const store = createLocalStore(storage);
    await passLevel(store, 'intake', 'e', 3);
    renderAt('/m/intake', store);
    expect(await screen.findByRole('heading', { name: /Intake \(fixture\)/ })).toBeVisible();
    const easy = screen.getByRole('link', { name: /easy/i });
    expect(within(easy.closest('li')!).getByText('3 / 10 met')).toBeVisible();
    const medium = screen.getByText(/^Medium/).closest('li')!;
    expect(within(medium).getByText(/locked/i)).toBeVisible();
    expect(within(medium).queryByRole('link')).toBeNull();
    expect(screen.getByRole('link', { name: /session 1/i })).toBeVisible();
    expect(screen.getByRole('link', { name: /reflect/i })).toBeVisible();
  });
  test('medium unlocks after easy is passed', async () => {
    const store = createLocalStore(storage);
    await passLevel(store, 'intake', 'e');
    renderAt('/m/intake', store);
    expect(await screen.findByRole('link', { name: /medium/i })).toBeVisible();
  });
});

describe('route guards', () => {
  test('deep link to a locked level redirects to the module page with the reason', async () => {
    renderAt('/m/intake/drills/hard');
    expect(await screen.findByRole('status')).toHaveTextContent(/pass medium first/i);
    expect(path).toBe('/s/foundations/m/intake');
  });
  test('deep link to medium before easy is passed is redirected too', async () => {
    renderAt('/m/intake/drills/medium');
    expect(await screen.findByRole('status')).toHaveTextContent(/pass easy first/i);
    expect(path).toBe('/s/foundations/m/intake');
  });
  test('a level that is skipped (medium passed, easy not) stays locked', async () => {
    const store = createLocalStore(storage);
    await passLevel(store, 'intake', 'm');
    renderAt('/m/intake/drills/hard', store);
    expect(await screen.findByRole('status')).toHaveTextContent(/pass medium first/i);
    expect(path).toBe('/s/foundations/m/intake');
  });
  test('deep link to a locked module redirects to / with the reason', async () => {
    for (const url of ['/m/alliance', '/m/alliance/drills/easy', '/m/alliance/reflect', '/m/alliance/walkthrough/alliance-s1']) {
      resetContentCache();
      const { unmount } = (() => {
        const r = render(
          <MemoryRouter initialEntries={[url]}><App store={createLocalStore(new Mem())} /><PathSpy /></MemoryRouter>,
        );
        return r;
      })();
      expect(await screen.findByRole('status')).toHaveTextContent(/finish the intake.*walkthrough first/i);
      expect(path).toBe('/s/foundations');
      unmount();
    }
  });
  test('an unlocked level opens', async () => {
    renderAt('/m/intake/drills/easy');
    expect(await screen.findByRole('textbox', { name: /your response/i })).toBeVisible();
    expect(path).toBe('/s/foundations/m/intake/drills/easy');
  });
  test('unknown slug, level or session shows the not-found page', async () => {
    for (const url of ['/m/nope', '/m/intake/drills/impossible', '/m/intake/walkthrough/nope', '/totally/unknown']) {
      resetContentCache();
      const { unmount } = render(
        <MemoryRouter initialEntries={[url]}><App store={createLocalStore(new Mem())} /></MemoryRouter>,
      );
      expect(await screen.findByRole('heading', { name: en.notFound.heading })).toBeVisible();
      unmount();
    }
  });
  test('path-traversal style slug is not-found, not an error page', async () => {
    renderAt('/m/..%2Fsecret');
    expect(await screen.findByRole('heading', { name: en.notFound.heading })).toBeVisible();
  });
});

describe('fresh data after navigation', () => {
  test('module page shows the new count after answering a drill and going back via the link', async () => {
    const user = userEvent.setup();
    renderAt('/m/intake/drills/easy');
    await user.type(await screen.findByRole('textbox', { name: /your response/i }), LONG);
    await user.click(screen.getByRole('button', { name: /submit response/i }));
    await user.click(screen.getByRole('checkbox', { name: /criterion one/i }));
    await user.click(screen.getByRole('checkbox', { name: /criterion two/i }));
    await user.click(screen.getByRole('button', { name: /save self-check/i }));
    await screen.findByText('Example response');
    await user.click(screen.getByRole('link', { name: /back to module/i }));
    expect(await screen.findByText('1 / 10 met')).toBeVisible();
  });
});

describe('reflection', () => {
  test('saves text per prompt and lists earlier entries newest first', async () => {
    const user = userEvent.setup();
    renderAt('/m/intake/reflect');
    const box = await screen.findByRole('textbox', { name: /what stood out/i });
    const save = screen.getAllByRole('button', { name: /save reflection/i })[0];
    expect(save).toBeDisabled();
    await user.type(box, 'first thought');
    await user.click(save);
    await user.type(await screen.findByRole('textbox', { name: /what stood out/i }), 'second thought');
    await user.click(screen.getAllByRole('button', { name: /save reflection/i })[0]);
    const list = await screen.findByRole('list', { name: /earlier reflections.*what stood out/i });
    const items = within(list).getAllByRole('listitem').map((li) => li.textContent);
    expect(items[0]).toMatch(/second thought/);
    expect(items[1]).toMatch(/first thought/);
    // the other prompt is untouched
    expect(screen.getByRole('textbox', { name: /what will you try next/i })).toHaveValue('');
  });
  test('a failed save keeps the text and shows an error', async () => {
    const user = userEvent.setup();
    const store = createLocalStore(storage);
    vi.spyOn(store, 'saveReflection').mockRejectedValueOnce(new Error('quota'));
    renderAt('/m/intake/reflect', store);
    const box = await screen.findByRole('textbox', { name: /what stood out/i });
    await user.type(box, 'keep this');
    await user.click(screen.getAllByRole('button', { name: /save reflection/i })[0]);
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not save/i);
    expect(box).toHaveValue('keep this');
  });
});

describe('layout', () => {
  test('footer safety line is on every route', async () => {
    for (const url of ['/', '/m/intake', '/m/intake/drills/easy', '/m/intake/walkthrough/intake-s1', '/m/intake/reflect', '/nope', '/m/alliance']) {
      resetContentCache();
      const { unmount } = render(
        <MemoryRouter initialEntries={[url]}><App store={createLocalStore(new Mem())} /></MemoryRouter>,
      );
      expect(screen.getByText(en.footer)).toBeVisible();
      await screen.findByRole('main');
      unmount();
    }
    expect(en.footer).toBe(
      "Training tool. Not for use with clients in crisis. If someone is at risk, follow your placement's policy and contact your supervisor.",
    );
  });
  test('a one-time notice is shown when the local store was reset', async () => {
    const user = userEvent.setup();
    storage.setItem('cm.practice.v1', '{broken');
    renderAt('/');
    expect(await screen.findByRole('status')).toHaveTextContent(/could not be read/i);
    await user.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(screen.queryByText(/could not be read/i)).not.toBeInTheDocument();
  });
  test('no notice on a healthy start', async () => {
    renderAt('/');
    await screen.findByRole('link', { name: /Intake/ });
    expect(screen.queryByText(/could not be read/i)).not.toBeInTheDocument();
  });
});
