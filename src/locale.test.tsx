import { cpSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { buildContent } from '../scripts/build-content';
import { App } from './App';
import { resetContentCache } from './content/client';
import { en } from './i18n/en';
import { LOCALE_KEY } from './i18n';
import { zhHant } from './i18n/zh-Hant';
import { createLocalStore } from './progress/localStore';
import { Mem, buildFixture, serve } from './test/appHarness';

const FIXTURE = join(__dirname, '..', 'tests', 'fixtures', 'content', 'ok-reviewed');
let built: string;
let builtNoZhAlliance: string;
beforeAll(async () => {
  built = await buildFixture('ok-reviewed');
  // Same course, but alliance has no zh-Hant module at all.
  const dir = mkdtempSync(join(tmpdir(), 'nozh-'));
  cpSync(FIXTURE, dir, { recursive: true });
  rmSync(join(dir, 'zh-Hant', 'stages', 'foundations', 'alliance'), { recursive: true });
  builtNoZhAlliance = mkdtempSync(join(tmpdir(), 'nozh-out-'));
  for (const locale of ['en', 'zh-Hant'] as const) await buildContent({ contentDir: dir, outDir: builtNoZhAlliance, locale });
});

let storage: Mem;
function mount(url = '/', store = createLocalStore(storage)) {
  return {
    store,
    ...render(
      <MemoryRouter initialEntries={[url]}>
        <App store={store} storage={storage} />
      </MemoryRouter>,
    ),
  };
}
const setBrowser = (...langs: string[]) => vi.spyOn(window.navigator, 'languages', 'get').mockReturnValue(langs);

beforeEach(() => {
  storage = new Mem();
  localStorage.clear();
  sessionStorage.clear();
  document.documentElement.lang = '';
  setBrowser('en-US');
  serve(built);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('language choice', () => {
  test('starts in English, and the button offers the other language by its own name', async () => {
    mount();
    expect(await screen.findByRole('heading', { name: 'Foundations (fixture)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '繁體中文' })).toBeInTheDocument();
    expect(document.documentElement.lang).toBe('en');
  });

  test('switching changes the text, <html lang> and is remembered after a reload', async () => {
    const user = userEvent.setup();
    const first = mount();
    await user.click(await screen.findByRole('button', { name: '繁體中文' }));
    expect(await screen.findByRole('heading', { name: '基礎（測試）' })).toBeInTheDocument();
    expect(screen.getByText(zhHant.footer)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'English' })).toBeInTheDocument();
    expect(document.documentElement.lang).toBe('zh-Hant');
    expect(localStorage.getItem(LOCALE_KEY)).toBe('zh-Hant');

    first.unmount();
    resetContentCache();
    mount();
    expect(await screen.findByRole('heading', { name: '基礎（測試）' })).toBeInTheDocument();
    expect(document.documentElement.lang).toBe('zh-Hant');

    await user.click(screen.getByRole('button', { name: 'English' }));
    expect(await screen.findByRole('heading', { name: 'Foundations (fixture)' })).toBeInTheDocument();
    expect(screen.getByText(en.footer)).toBeInTheDocument();
    expect(document.documentElement.lang).toBe('en');
    expect(localStorage.getItem(LOCALE_KEY)).toBe('en');
  });

  test('with no saved choice, a zh browser gets Traditional Chinese', async () => {
    setBrowser('zh-HK', 'en');
    mount();
    expect(await screen.findByRole('heading', { name: '基礎（測試）' })).toBeInTheDocument();
    expect(document.documentElement.lang).toBe('zh-Hant');
  });

  test('a saved choice beats the browser language', async () => {
    setBrowser('zh-TW');
    localStorage.setItem(LOCALE_KEY, 'en');
    mount();
    expect(await screen.findByRole('heading', { name: 'Foundations (fixture)' })).toBeInTheDocument();
  });

  test('the switch button works from the keyboard (Tab, then Enter or Space)', async () => {
    const user = userEvent.setup();
    mount();
    const btn = await screen.findByRole('button', { name: '繁體中文' });
    expect(btn.tagName).toBe('BUTTON');
    for (let i = 0; i < 10 && document.activeElement !== btn; i++) await user.tab();
    expect(btn).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('button', { name: 'English' })).toBeInTheDocument();
    expect(document.documentElement.lang).toBe('zh-Hant');
    expect(screen.getByRole('button', { name: 'English' })).toHaveFocus();
    await user.keyboard(' ');
    expect(await screen.findByRole('button', { name: '繁體中文' })).toBeInTheDocument();
    expect(document.documentElement.lang).toBe('en');
  });
});

describe('module content by language', () => {
  test('a reviewed zh-Hant module shows Chinese content with no notice', async () => {
    localStorage.setItem(LOCALE_KEY, 'zh-Hant');
    mount('/m/intake');
    expect(await screen.findByRole('heading', { name: /intake.*測試/i })).toBeInTheDocument();
    expect(screen.getByText('intake 模組的簡介。')).toBeInTheDocument();
    expect(screen.queryByText(zhHant.contentFallback)).not.toBeInTheDocument();
  });

  test('a zh-Hant module that is not reviewed shows the English module and the notice', async () => {
    const store = createLocalStore(storage);
    await store.saveDecision({ sessionId: 'intake-s1', decisionId: 'd1', optionId: 'a' });
    await store.saveDecision({ sessionId: 'intake-s1', decisionId: 'd2', response: 'x' });
    localStorage.setItem(LOCALE_KEY, 'zh-Hant');
    mount('/m/alliance', store);
    expect(await screen.findByText(zhHant.contentFallback)).toBeInTheDocument();
    expect(screen.getByText('Intro for Alliance (fixture).')).toBeInTheDocument(); // English content
    expect(screen.getByRole('link', { name: zhHant.levels.easy })).toBeInTheDocument(); // Chinese chrome
  });

  test('a zh-Hant module that does not exist shows the English module and the notice', async () => {
    serve(builtNoZhAlliance);
    const store = createLocalStore(storage);
    await store.saveDecision({ sessionId: 'intake-s1', decisionId: 'd1', optionId: 'a' });
    await store.saveDecision({ sessionId: 'intake-s1', decisionId: 'd2', response: 'x' });
    localStorage.setItem(LOCALE_KEY, 'zh-Hant');
    mount('/m/alliance', store);
    expect(await screen.findByText(zhHant.contentFallback)).toBeInTheDocument();
    expect(screen.getByText('Intro for Alliance (fixture).')).toBeInTheDocument();
  });

  test('English never shows the notice', async () => {
    const store = createLocalStore(storage);
    await store.saveDecision({ sessionId: 'intake-s1', decisionId: 'd1', optionId: 'a' });
    await store.saveDecision({ sessionId: 'intake-s1', decisionId: 'd2', response: 'x' });
    mount('/m/alliance', store);
    expect(await screen.findByText('Intro for Alliance (fixture).')).toBeInTheDocument();
    expect(screen.queryByText(zhHant.contentFallback)).not.toBeInTheDocument();
    expect(screen.queryByText(en.contentFallback)).not.toBeInTheDocument();
  });

  test('the walkthrough and practice pages also show the notice for an English fallback', async () => {
    const store = createLocalStore(storage);
    await store.saveDecision({ sessionId: 'intake-s1', decisionId: 'd1', optionId: 'a' });
    await store.saveDecision({ sessionId: 'intake-s1', decisionId: 'd2', response: 'x' });
    localStorage.setItem(LOCALE_KEY, 'zh-Hant');
    const first = mount('/m/alliance/walkthrough/alliance-s1', store);
    expect(await screen.findByText(zhHant.contentFallback)).toBeInTheDocument();
    first.unmount();
    mount('/m/alliance/drills/easy', store);
    expect(await screen.findByText(zhHant.contentFallback)).toBeInTheDocument();
    expect(await screen.findByText('Fixture client statement for alliance-e01.', { exact: false })).toBeInTheDocument();
  });

  test('switching language on a module page swaps the content and the notice', async () => {
    const user = userEvent.setup();
    const store = createLocalStore(storage);
    await store.saveDecision({ sessionId: 'intake-s1', decisionId: 'd1', optionId: 'a' });
    await store.saveDecision({ sessionId: 'intake-s1', decisionId: 'd2', response: 'x' });
    mount('/m/intake', store);
    expect(await screen.findByText('Intro for Intake (fixture).')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '繁體中文' }));
    expect(await screen.findByText('intake 模組的簡介。')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'English' }));
    expect(await screen.findByText('Intro for Intake (fixture).')).toBeInTheDocument();
  });

  test('stage page: zh titles for Chinese modules, English titles for the rest', async () => {
    localStorage.setItem(LOCALE_KEY, 'zh-Hant');
    const store = createLocalStore(storage);
    await store.saveDecision({ sessionId: 'intake-s1', decisionId: 'd1', optionId: 'a' });
    await store.saveDecision({ sessionId: 'intake-s1', decisionId: 'd2', response: 'x' });
    mount('/', store);
    expect(await screen.findByRole('link', { name: /intake.*測試/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Alliance (fixture)' })).toBeInTheDocument();
  });
});

describe('input and progress survive a language switch', () => {
  test('text typed in a practice response is kept', async () => {
    const user = userEvent.setup();
    mount('/m/intake/drills/easy');
    const box = await screen.findByRole('textbox', { name: en.drill.responseLabel });
    await user.type(box, 'half written answer');
    await user.click(screen.getByRole('button', { name: '繁體中文' }));
    const after = await screen.findByRole('textbox', { name: zhHant.drill.responseLabel });
    expect(after).toHaveValue('half written answer');
    expect(screen.getByText('測試用個案說的話（intake-e01）。', { exact: false })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'English' }));
    expect(await screen.findByRole('textbox', { name: en.drill.responseLabel })).toHaveValue('half written answer');
  });

  test('text typed in a reflection is kept', async () => {
    const user = userEvent.setup();
    mount('/m/intake/reflect');
    const box = await screen.findByRole('textbox', { name: 'What stood out for you in this module?' });
    await user.type(box, 'my reflection');
    await user.click(screen.getByRole('button', { name: '繁體中文' }));
    expect(await screen.findByRole('textbox', { name: '這個模組中，什麼讓你印象最深？' })).toHaveValue('my reflection');
  });

  test('text typed in a free walkthrough answer is kept', async () => {
    const user = userEvent.setup();
    const store = createLocalStore(storage);
    await store.saveDecision({ sessionId: 'intake-s1', decisionId: 'd1', optionId: 'a' });
    mount('/m/intake/walkthrough/intake-s1', store);
    const box = await screen.findByRole('textbox', { name: en.walkthrough.responseLabel });
    await user.type(box, 'what I would say');
    await user.click(screen.getByRole('button', { name: '繁體中文' }));
    expect(await screen.findByRole('textbox', { name: zhHant.walkthrough.responseLabel })).toHaveValue('what I would say');
    expect(screen.getByText('寫下你自己的回應。')).toBeInTheDocument();
  });

  test('both languages share progress: one store, keyed by item id', async () => {
    const store = createLocalStore(storage);
    for (let i = 1; i <= 8; i++) {
      await store.saveAttempt({ itemId: `intake-e${String(i).padStart(2, '0')}`, response: 'A response long enough to count.', criteriaMet: [true, true, false] });
    }
    await store.saveDecision({ sessionId: 'intake-s1', decisionId: 'd1', optionId: 'a' });
    await store.saveDecision({ sessionId: 'intake-s1', decisionId: 'd2', response: 'x' });
    const user = userEvent.setup();
    mount('/m/intake', store);
    expect(await screen.findByText('8 / 10 met')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: en.levels.medium })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '繁體中文' }));
    expect(await screen.findByText('8 / 10 達標')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: zhHant.levels.medium })).toBeInTheDocument();
    // the completed walkthrough shows as done in Chinese too
    expect(screen.getByRole('link', { name: zhHant.module.sessionLabel('第一次會談', true) })).toBeInTheDocument();
  });
});
