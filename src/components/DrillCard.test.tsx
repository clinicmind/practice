import { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import type { Drill, Model } from '../content/schema';
import type { Attempt, NewAttempt } from '../progress/types';
import { DrillCard } from './DrillCard';

const drill: Drill = {
  id: 'intake-e01', level: 'easy', skill: 'open-question', context: 'First session.',
  client: "I'm not sure where to start.", criteria: ['Asks an open question', 'Stays brief', 'Invites the client'],
};
const model: Model = { model_response: 'MODEL TEXT', why: 'WHY TEXT', avoid: 'AVOID TEXT' };
const LONG = 'A response that is long enough.';

function setup(over: { onSubmit?: (a: NewAttempt) => Promise<void>; getModel?: () => Promise<Model>; onNext?: () => void } = {}) {
  const onSubmit = vi.fn(over.onSubmit ?? (async () => {}));
  const getModel = vi.fn(over.getModel ?? (async () => model));
  const user = userEvent.setup();
  function Wrapper() {
    const [attempts, setAttempts] = useState<Attempt[]>([]);
    return (
      <DrillCard
        drill={drill}
        attempts={attempts}
        onSubmit={async (a) => {
          await onSubmit(a);
          setAttempts((x) => [...x, { ...a, id: String(x.length), createdAt: new Date(x.length).toISOString() }]);
        }}
        getModel={getModel}
        onNext={over.onNext}
      />
    );
  }
  render(<Wrapper />);
  return { user, onSubmit, getModel };
}
const box = () => screen.getByRole('textbox', { name: /your response/i });
const submit = () => screen.getByRole('button', { name: /submit response/i });
const save = () => screen.getByRole('button', { name: /save self-check/i });

describe('DrillCard', () => {
  test('submit is disabled until the response has non-blank text', async () => {
    const { user } = setup();
    expect(submit()).toBeDisabled();
    await user.type(box(), '   ');
    expect(submit()).toBeDisabled();
    await user.type(box(), 'hi');
    expect(submit()).toBeEnabled();
  });

  test('getModel is not called before an attempt is saved', async () => {
    const { user, onSubmit, getModel } = setup();
    await user.type(box(), LONG);
    expect(getModel).not.toHaveBeenCalled();
    await user.click(submit());
    expect(getModel).not.toHaveBeenCalled(); // rating step: still nothing
    await user.click(screen.getByRole('checkbox', { name: /asks an open question/i }));
    await user.click(save());
    expect(onSubmit).toHaveBeenCalledWith({ itemId: 'intake-e01', response: LONG, criteriaMet: [true, false, false] });
    expect(getModel).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('MODEL TEXT')).toBeVisible();
    expect(screen.getByText('WHY TEXT')).toBeVisible();
    expect(screen.getByText('AVOID TEXT')).toBeVisible();
  });

  test('model text is not in the document before saving', async () => {
    const { user } = setup();
    await user.type(box(), LONG);
    await user.click(submit());
    expect(screen.queryByText('MODEL TEXT')).not.toBeInTheDocument();
  });

  test('shows a hint when fewer than 2 criteria are ticked or the response is under 20 characters', async () => {
    const { user } = setup();
    await user.type(box(), 'short');
    await user.click(submit());
    expect(screen.getByText(/2 criteria.*20 characters/i)).toBeVisible();
    await user.click(save());
    expect(await screen.findByText(/not counted as met/i)).toBeVisible();
  });

  test('a long response with 2 criteria is shown as met', async () => {
    const { user } = setup();
    await user.type(box(), LONG);
    await user.click(submit());
    await user.click(screen.getByRole('checkbox', { name: /asks an open question/i }));
    await user.click(screen.getByRole('checkbox', { name: /stays brief/i }));
    await user.click(save());
    expect(await screen.findByText(/counted as met/i)).toBeVisible();
    expect(screen.queryByText(/not counted as met/i)).not.toBeInTheDocument();
  });

  test('retry clears the text box and keeps earlier attempts listed', async () => {
    const { user } = setup();
    await user.type(box(), LONG);
    await user.click(submit()); await user.click(save());
    await screen.findByText('MODEL TEXT');
    await user.click(screen.getByRole('button', { name: /try again/i }));
    expect(box()).toHaveValue('');
    const list = screen.getByRole('list', { name: /earlier attempts/i });
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);
    expect(within(list).getByText(LONG)).toBeVisible();
    expect(screen.queryByText('MODEL TEXT')).not.toBeInTheDocument();
  });

  test('next button appears only when onNext is given and calls it', async () => {
    const onNext = vi.fn();
    const { user } = setup({ onNext });
    await user.type(box(), LONG);
    await user.click(submit()); await user.click(save());
    await user.click(await screen.findByRole('button', { name: /next question/i }));
    expect(onNext).toHaveBeenCalled();
  });

  test('if saving fails the typed response stays in the box and an error is shown', async () => {
    const { user, getModel } = setup({ onSubmit: async () => { throw new Error('quota'); } });
    await user.type(box(), LONG);
    await user.click(submit());
    await user.click(save());
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not save/i);
    expect(getModel).not.toHaveBeenCalled();
    // still on the rating step with the response visible, and savable again
    expect(box()).toHaveValue(LONG);
    expect(save()).toBeEnabled();
  });

  test('double clicking save saves once', async () => {
    let resolve!: () => void;
    const { user, onSubmit } = setup({ onSubmit: () => new Promise<void>((r) => { resolve = r; }) });
    await user.type(box(), LONG);
    await user.click(submit());
    await user.click(save());
    const busy = screen.getByRole('button', { name: /saving/i });
    expect(busy).toBeDisabled();
    await user.click(busy);
    resolve();
    await screen.findByText('MODEL TEXT');
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  test('if the model fails to load, a retry button is shown and the attempt is still saved', async () => {
    let calls = 0;
    const { user, onSubmit, getModel } = setup({
      getModel: async () => { if (calls++ === 0) throw new Error('offline'); return model; },
    });
    await user.type(box(), LONG);
    await user.click(submit()); await user.click(save());
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not load the example/i);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: /retry loading/i }));
    expect(await screen.findByText('MODEL TEXT')).toBeVisible();
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(getModel).toHaveBeenCalledTimes(2);
  });

  test('every input has an accessible name', async () => {
    const { user } = setup();
    expect(screen.getByRole('textbox', { name: /your response/i })).toBeVisible();
    await user.type(box(), LONG);
    await user.click(submit());
    for (const c of drill.criteria) expect(screen.getByRole('checkbox', { name: c })).toBeVisible();
    expect(screen.getByRole('group', { name: /self-check/i })).toBeVisible();
  });
});
