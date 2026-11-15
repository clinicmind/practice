import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { ModuleBundle } from '../content/schema';
import { createLocalStore } from '../progress/localStore';
import { StoreProvider } from '../StoreContext';
import { WalkthroughPage } from './WalkthroughPage';

const bundle: ModuleBundle = {
  meta: { slug: 'intake', title: 'Intake', version: '1.0.0', intro: 'i', skills: ['a', 'b'], reflection_prompts: [{ id: 'r1', text: 'p' }] },
  drills: [],
  sessions: [
    {
      id: 'intake-s1', title: 'Session 1',
      turns: [
        { id: 't1', speaker: 'therapist', text: 'TURN-ONE welcome' },
        { id: 't2', speaker: 'client', text: 'TURN-TWO client opens' },
        {
          id: 'd1', type: 'choice', prompt: 'What next?',
          options: [
            { id: 'a', text: 'OPT-A text', fit: 'strong', note: 'NOTE-A' },
            { id: 'b', text: 'OPT-B text', fit: 'workable', note: 'NOTE-B' },
            { id: 'c', text: 'OPT-C text', fit: 'weak', note: 'NOTE-C' },
          ],
          actual: 'ACTUAL-D1', rationale: 'RATIONALE-D1',
        },
        { id: 't3', speaker: 'client', text: 'TURN-THREE after d1' },
        { id: 'd2', type: 'free', prompt: 'Say it yourself', actual: 'ACTUAL-D2', rationale: 'RATIONALE-D2' },
        { id: 't4', speaker: 'therapist', text: 'TURN-FOUR closing' },
      ],
      notes: { goals: 'GOALS-NOTE', alliance: 'ALLIANCE-NOTE', formulation_update: 'FORM-NOTE' },
    },
  ],
};

vi.mock('../content/client', () => ({ loadModule: vi.fn(async () => bundle) }));

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
beforeEach(() => { storage = new Mem(); });

function renderPage(store = createLocalStore(storage)) {
  render(
    <StoreProvider store={store}>
      <MemoryRouter initialEntries={['/m/intake/walkthrough/intake-s1']}>
        <Routes>
          <Route path="/m/:slug/walkthrough/:sessionId" element={<WalkthroughPage />} />
        </Routes>
      </MemoryRouter>
    </StoreProvider>,
  );
  return store;
}

describe('WalkthroughPage', () => {
  test('turns after an unanswered decision point are not in the DOM', async () => {
    renderPage();
    expect(await screen.findByText(/TURN-TWO/)).toBeVisible();
    expect(screen.getByText(/TURN-ONE/)).toBeVisible();
    expect(screen.queryByText(/TURN-THREE/)).not.toBeInTheDocument();
    expect(screen.queryByText(/TURN-FOUR/)).not.toBeInTheDocument();
    expect(screen.queryByText('ACTUAL-D1')).not.toBeInTheDocument();
    expect(screen.queryByText('NOTE-A')).not.toBeInTheDocument();
    expect(screen.queryByText(/GOALS-NOTE/)).not.toBeInTheDocument();
  });

  test('choosing an option saves { sessionId, decisionId, optionId } and reveals fit, note, actual, rationale', async () => {
    const user = userEvent.setup();
    const store = renderPage();
    const confirm = await screen.findByRole('button', { name: /confirm choice/i });
    expect(confirm).toBeDisabled();
    await user.click(screen.getByRole('radio', { name: /OPT-B text/ }));
    await user.click(confirm);
    expect(await screen.findByText('NOTE-B')).toBeVisible();
    expect(screen.getByText('Workable')).toBeVisible();
    expect(screen.getByText('ACTUAL-D1')).toBeVisible();
    expect(screen.getByText('RATIONALE-D1')).toBeVisible();
    const saved = await store.listDecisions('intake-s1');
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ sessionId: 'intake-s1', decisionId: 'd1', optionId: 'b' });
    // flow continues to the next turn, up to the next decision
    expect(screen.getByText(/TURN-THREE/)).toBeVisible();
    expect(screen.queryByText(/TURN-FOUR/)).not.toBeInTheDocument();
  });

  test('free decision requires non-blank text, saves { response }, then reveals actual and rationale', async () => {
    const user = userEvent.setup();
    const store = createLocalStore(storage);
    await store.saveDecision({ sessionId: 'intake-s1', decisionId: 'd1', optionId: 'a' });
    renderPage(store);
    const submit = await screen.findByRole('button', { name: /submit response/i });
    expect(submit).toBeDisabled();
    const box = screen.getByRole('textbox', { name: /your response/i });
    await user.type(box, '   ');
    expect(submit).toBeDisabled();
    expect(screen.queryByText('ACTUAL-D2')).not.toBeInTheDocument();
    await user.clear(box);
    await user.type(box, 'my own words');
    await user.click(submit);
    expect(await screen.findByText('ACTUAL-D2')).toBeVisible();
    expect(screen.getByText('RATIONALE-D2')).toBeVisible();
    const d2 = (await store.listDecisions('intake-s1')).find((d) => d.decisionId === 'd2')!;
    expect(d2.response).toBe('my own words');
    expect(d2.optionId).toBeUndefined();
  });

  test('fit is shown as a text label, not colour alone', async () => {
    const store = createLocalStore(storage);
    await store.saveDecision({ sessionId: 'intake-s1', decisionId: 'd1', optionId: 'c' });
    renderPage(store);
    expect(await screen.findByText('Weak fit')).toBeVisible();
  });

  test('strong choice is labelled "Strong fit"', async () => {
    const store = createLocalStore(storage);
    await store.saveDecision({ sessionId: 'intake-s1', decisionId: 'd1', optionId: 'a' });
    renderPage(store);
    expect(await screen.findByText('Strong fit')).toBeVisible();
  });

  test('session notes appear only after the last decision is answered', async () => {
    const user = userEvent.setup();
    const store = createLocalStore(storage);
    await store.saveDecision({ sessionId: 'intake-s1', decisionId: 'd1', optionId: 'a' });
    renderPage(store);
    await screen.findByText(/TURN-THREE/);
    expect(screen.queryByText(/GOALS-NOTE/)).not.toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: /your response/i }), 'answer');
    await user.click(screen.getByRole('button', { name: /submit response/i }));
    expect(await screen.findByText(/GOALS-NOTE/)).toBeVisible();
    expect(screen.getByText(/ALLIANCE-NOTE/)).toBeVisible();
    expect(screen.getByText(/FORM-NOTE/)).toBeVisible();
    expect(screen.getByText(/TURN-FOUR/)).toBeVisible();
  });

  test('returning to a finished session shows everything and no submit controls', async () => {
    const store = createLocalStore(storage);
    await store.saveDecision({ sessionId: 'intake-s1', decisionId: 'd1', optionId: 'a' });
    await store.saveDecision({ sessionId: 'intake-s1', decisionId: 'd2', response: 'earlier answer' });
    renderPage(store);
    expect(await screen.findByText(/GOALS-NOTE/)).toBeVisible();
    for (const s of ['TURN-ONE', 'TURN-THREE', 'TURN-FOUR', 'ACTUAL-D1', 'ACTUAL-D2', 'earlier answer', 'NOTE-A']) {
      expect(screen.getByText(new RegExp(s))).toBeVisible();
    }
    expect(screen.queryByRole('button', { name: /confirm|submit/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  test('a failed save shows an error and keeps the typed text', async () => {
    const user = userEvent.setup();
    const store = createLocalStore(storage);
    await store.saveDecision({ sessionId: 'intake-s1', decisionId: 'd1', optionId: 'a' });
    vi.spyOn(store, 'saveDecision').mockRejectedValueOnce(new Error('quota'));
    renderPage(store);
    const box = await screen.findByRole('textbox', { name: /your response/i });
    await user.type(box, 'keep me');
    await user.click(screen.getByRole('button', { name: /submit response/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not save/i);
    expect(box).toHaveValue('keep me');
    expect(screen.queryByText('ACTUAL-D2')).not.toBeInTheDocument();
  });
});
