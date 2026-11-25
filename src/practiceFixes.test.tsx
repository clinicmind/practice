import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { App } from './App';
import { DrillCard } from './components/DrillCard';
import type { Drill, Model } from './content/schema';
import { createLocalStore } from './progress/localStore';
import { Mem, buildFixture, serve } from './test/appHarness';

// Phone and accessibility fixes (task 1). These are live for every student: no build switch.

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

describe('switching language in the middle of an answer', () => {
  test('the typed answer is still there afterwards, in the other language', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/s/foundations/m/intake/drills/easy']}>
        <App store={createLocalStore(storage)} storage={storage} />
      </MemoryRouter>,
    );
    const box = await screen.findByRole('textbox', { name: 'Your response' });
    await user.type(box, 'Half written answer');
    await user.click(screen.getByRole('button', { name: '繁體中文' }));
    const after = await screen.findByRole('textbox', { name: '你的回應' });
    expect(after).toHaveValue('Half written answer');
    await user.click(screen.getByRole('button', { name: 'English' }));
    expect(await screen.findByRole('textbox', { name: 'Your response' })).toHaveValue('Half written answer');
  });

  test('ticked criteria survive too', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/s/foundations/m/intake/drills/easy']}>
        <App store={createLocalStore(storage)} storage={storage} />
      </MemoryRouter>,
    );
    await user.type(await screen.findByRole('textbox', { name: 'Your response' }), 'Half written answer');
    await user.click(screen.getByRole('button', { name: 'Submit response' }));
    await user.click(screen.getByRole('checkbox', { name: /criterion one/ }));
    await user.click(screen.getByRole('button', { name: '繁體中文' }));
    expect(await screen.findByRole('textbox', { name: '你的回應' })).toHaveValue('Half written answer');
    expect(await screen.findByRole('checkbox', { name: /標準一/ })).toBeChecked();
  });

  test('a half-written walkthrough answer survives too', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/s/foundations/m/intake/walkthrough/intake-s1']}>
        <App store={createLocalStore(storage)} storage={storage} />
      </MemoryRouter>,
    );
    // answer the first (choice) decision to reach the free one
    const radios = await screen.findAllByRole('radio');
    await user.click(radios[0]);
    await user.click(screen.getByRole('button', { name: 'Confirm choice' }));
    const box = await screen.findByRole('textbox', { name: 'Your response' });
    await user.type(box, 'My own words so far');
    await user.click(screen.getByRole('button', { name: '繁體中文' }));
    expect(await screen.findByRole('textbox', { name: '你的回應' })).toHaveValue('My own words so far');
  });
});

const drill: Drill = {
  id: 'intake-e01', level: 'easy', skill: 'open-question', context: 'First session.',
  client: "I'm not sure where to start.", criteria: ['Asks an open question', 'Stays brief', 'Invites the client'],
};
const model: Model = { model_response: 'MODEL TEXT', why: 'WHY TEXT', avoid: 'AVOID TEXT' };

async function toReview(user: ReturnType<typeof userEvent.setup>, ticks: RegExp[]) {
  render(<DrillCard drill={drill} attempts={[]} onSubmit={async () => {}} getModel={async () => model} />);
  await user.type(screen.getByRole('textbox', { name: /your response/i }), 'A response that is long enough.');
  await user.click(screen.getByRole('button', { name: /submit response/i }));
  for (const t of ticks) await user.click(screen.getByRole('checkbox', { name: t }));
  await user.click(screen.getByRole('button', { name: /save self-check/i }));
  await screen.findByText('MODEL TEXT');
}

describe('the result is told in words, not only in colour', () => {
  test('each criterion says in text whether it was ticked', async () => {
    const user = userEvent.setup();
    await toReview(user, [/open question/i, /invites/i]);
    const list = screen.getByRole('list', { name: /your self-check/i });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent(/ticked/i);
    expect(items[0]).not.toHaveTextContent(/not ticked/i);
    expect(items[1]).toHaveTextContent(/not ticked/i);
    expect(items[2]).toHaveTextContent(/^(?!.*not ticked).*ticked/i);
  });

  test('the verdict is a sentence, with or without the colour', async () => {
    const user = userEvent.setup();
    await toReview(user, [/open question/i, /invites/i]);
    expect(screen.getByText('Counted as met.')).toBeInTheDocument();
  });
});

describe('after the example is shown, the keyboard can reach the reason', () => {
  test('Tab from the heading of your response lands in the example section, which holds the reason', async () => {
    const user = userEvent.setup();
    await toReview(user, [/open question/i, /invites/i]);
    const mine = screen.getByRole('heading', { name: 'Your response' });
    expect(mine).toHaveFocus();
    await user.tab();
    const region = screen.getByRole('region', { name: 'Example response' });
    expect(region).toHaveFocus();
    expect(region).toHaveTextContent('WHY TEXT');
    expect(region).toHaveTextContent('AVOID TEXT');
  });
});

describe('the client\'s words stay in view on a phone', () => {
  test('they sit in a top bar that can be folded and unfolded', async () => {
    const user = userEvent.setup();
    render(<DrillCard drill={drill} attempts={[]} onSubmit={async () => {}} getModel={async () => model} />);
    const toggle = screen.getByRole('button', { name: /client's words/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const bar = toggle.closest('.client-bar') as HTMLElement;
    expect(bar).not.toBeNull();
    expect(within(bar).getByText(/I'm not sure where to start/)).toBeInTheDocument();
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(bar).toHaveClass('folded');
    // Folded is a look, not a removal: the words stay in the page for a screen reader and for printing.
    expect(within(bar).getByText(/I'm not sure where to start/)).toBeInTheDocument();
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(bar).not.toHaveClass('folded');
  });
});

// keep waitFor imported for future async assertions
void waitFor;
