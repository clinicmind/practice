import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { createLocalStore } from '../progress/localStore';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { App } from '../App';
import { en } from '../i18n/en';
import { buildFixture, Mem, PathSpy, serve, spy } from '../test/appHarness';

let multi = '';
let single = '';
beforeAll(async () => {
  multi = await buildFixture('multi');
  single = await buildFixture('ok-reviewed');
});
afterEach(() => vi.unstubAllGlobals());
beforeEach(() => { sessionStorage.clear(); localStorage.clear(); });

let storage: Mem;
function renderLocal(url: string, seed?: (s: ReturnType<typeof createLocalStore>) => Promise<void>) {
  storage = new Mem();
  const store = createLocalStore(storage);
  const ready = seed ? seed(store) : Promise.resolve();
  return ready.then(() => render(
    <MemoryRouter initialEntries={[url]}>
      <App store={store} storage={storage} />
      <PathSpy />
    </MemoryRouter>,
  ));
}

describe('stage routes', () => {
  test('/s/foundations/m/:slug opens a foundations module', async () => {
    serve(multi);
    await renderLocal('/s/foundations/m/intake');
    expect(await screen.findByRole('heading', { name: /Intake \(fixture\)/ })).toBeVisible();
  });

  test('/s/demo/m/:slug opens a module of another stage', async () => {
    serve(multi);
    await renderLocal('/s/demo/m/demo-intro');
    expect(await screen.findByRole('heading', { name: /Demo intro \(fixture\)/ })).toBeVisible();
  });

  test('/s/:stage shows that stage\'s modules', async () => {
    serve(multi);
    await renderLocal('/s/demo');
    expect(await screen.findByRole('heading', { name: 'Demo stage (fixture)' })).toBeVisible();
    expect(screen.getByRole('link', { name: /Demo intro \(fixture\)/ })).toHaveAttribute('href', '/s/demo/m/demo-intro');
  });

  test('a module is not found under another stage', async () => {
    serve(multi);
    await renderLocal('/s/demo/m/intake');
    expect(await screen.findByRole('heading', { name: en.notFound.heading })).toBeVisible();
  });

  test('an unknown stage is not found', async () => {
    serve(multi);
    await renderLocal('/s/nowhere');
    expect(await screen.findByRole('heading', { name: en.notFound.heading })).toBeVisible();
  });

  test('module pages link within their stage', async () => {
    serve(multi);
    await renderLocal('/s/demo/m/demo-intro');
    const walk = await screen.findByRole('link', { name: /Session 1/ });
    expect(walk).toHaveAttribute('href', '/s/demo/m/demo-intro/walkthrough/demo-intro-s1');
    expect(screen.getByRole('link', { name: en.module.reflectLink })).toHaveAttribute('href', '/s/demo/m/demo-intro/reflect');
  });

  test('deep pages of another stage work: walkthrough, drills, reflect', async () => {
    serve(multi);
    await renderLocal('/s/demo/m/demo-intro/walkthrough/demo-intro-s1');
    expect(await screen.findByText(/Welcome \(demo-intro\)/)).toBeVisible();
    expect(screen.getByRole('link', { name: en.walkthrough.backToModule })).toHaveAttribute('href', '/s/demo/m/demo-intro');
  });
});

describe('old bookmarks keep working', () => {
  const cases: [string, string][] = [
    ['/m/intake', '/s/foundations/m/intake'],
    ['/m/intake/walkthrough/intake-s1', '/s/foundations/m/intake/walkthrough/intake-s1'],
    ['/m/intake/drills/easy', '/s/foundations/m/intake/drills/easy'],
    ['/m/intake/reflect', '/s/foundations/m/intake/reflect'],
  ];
  test.each(cases)('%s goes to %s', async (from, to) => {
    serve(single);
    await renderLocal(from);
    await waitFor(() => expect(spy.path).toBe(to));
    expect(screen.queryByRole('heading', { name: en.notFound.heading })).not.toBeInTheDocument();
  });

  test('an old module link in a multi-stage build still lands on foundations', async () => {
    serve(multi);
    await renderLocal('/m/intake');
    await waitFor(() => expect(spy.path).toBe('/s/foundations/m/intake'));
    expect(await screen.findByRole('heading', { name: /Intake \(fixture\)/ })).toBeVisible();
  });

  test('an old link to an unknown module is not found', async () => {
    serve(single);
    await renderLocal('/m/ghost');
    expect(await screen.findByRole('heading', { name: en.notFound.heading })).toBeVisible();
  });

  test('progress saved under the old layout still counts at the old and new path (ids are unchanged)', async () => {
    serve(single);
    const LONG = 'A response that is long enough to count.';
    await renderLocal('/m/intake', async (s) => {
      for (let i = 1; i <= 3; i++) {
        await s.saveAttempt({ itemId: `intake-e${String(i).padStart(2, '0')}`, response: LONG, criteriaMet: [true, true, false] });
      }
    });
    expect(await screen.findByText(en.module.met(3, 10))).toBeVisible();
  });
});

describe('the user can move between stage pages', () => {
  test('brand link goes home', async () => {
    serve(multi);
    await renderLocal('/s/demo/m/demo-intro');
    await userEvent.click(await screen.findByRole('link', { name: en.appName }));
    await waitFor(() => expect(spy.path).toBe('/'));
  });
});
