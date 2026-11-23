import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import { AiProvider, type AiFeedbackClient, type AiResult } from '../ai/AiContext';
import type { Drill, Model } from '../content/schema';
import { en } from '../i18n/en';
import type { Attempt, NewAttempt } from '../progress/types';
import { DrillCard } from './DrillCard';

// All text is fictional.
const drill: Drill = {
  id: 'intake-e01', level: 'easy', skill: 'open-question', context: 'First session.',
  client: "I'm not sure where to start.", criteria: ['Asks an open question', 'Stays brief', 'Invites the client'],
};
const model: Model = { model_response: 'MODEL TEXT', why: 'WHY TEXT', avoid: 'AVOID TEXT' };
const RESULT: AiResult = {
  status: 'ok', unsupported: [],
  output: { criteria: [{ met: true, evidence: '' }, { met: false, evidence: '' }, { met: false, evidence: '' }], suggestion: 'You could try x.', concern: 'none' },
};
const t = en.aiFeedback;

function setup(opts: { enabled: boolean; stored?: AiResult; previous?: Attempt }) {
  const client = { get: vi.fn(async () => opts.stored ?? null), request: vi.fn(async () => RESULT) } as AiFeedbackClient & { get: ReturnType<typeof vi.fn>; request: ReturnType<typeof vi.fn> };
  const onSubmit = vi.fn(async (a: NewAttempt): Promise<Attempt> => ({ ...a, id: 'att-9', createdAt: '2026-01-01T00:00:00Z' }));
  const user = userEvent.setup();
  render(
    <AiProvider enabled={opts.enabled} client={client}>
      <DrillCard drill={drill} attempts={opts.previous ? [opts.previous] : []} onSubmit={onSubmit} getModel={async () => model} />
    </AiProvider>,
  );
  const saveSelf = async () => {
    await user.type(screen.getByRole('textbox', { name: /your response/i }), 'What brings you here today? Say as much as you like.');
    await user.click(screen.getByRole('button', { name: /submit response/i }));
    await user.click(screen.getByLabelText('Asks an open question'));
    await user.click(screen.getByLabelText('Invites the client'));
    await user.click(screen.getByRole('button', { name: /save self-check/i }));
  };
  return { client, onSubmit, user, saveSelf };
}

describe('drill card with AI feedback', () => {
  test('feature off: after saving there is no AI button and the client is never touched', async () => {
    const { client, saveSelf } = setup({ enabled: false });
    await saveSelf();
    expect(await screen.findByText('MODEL TEXT')).toBeInTheDocument();
    expect(screen.queryByText(t.panelHeading)).not.toBeInTheDocument();
    expect(client.get).not.toHaveBeenCalled();
    expect(client.request).not.toHaveBeenCalled();
  });

  test('feature on: nothing before the self-check is saved; then a button; the AI is asked only when it is pressed', async () => {
    const { client, saveSelf, user } = setup({ enabled: true });
    expect(screen.queryByText(t.panelHeading)).not.toBeInTheDocument();
    await saveSelf();
    const button = await screen.findByRole('button', { name: t.askButton });
    expect(client.request).not.toHaveBeenCalled();
    await user.click(button);
    expect(client.request).toHaveBeenCalledWith('att-9', 'en');
    expect(await screen.findByText(t.caveat)).toBeInTheDocument();
  });

  test('the panel changes nothing about passing: one save, and the result shown is the self-check’s', async () => {
    const { onSubmit, saveSelf, user } = setup({ enabled: true });
    await saveSelf();
    await user.click(await screen.findByRole('button', { name: t.askButton }));
    await screen.findByText(t.caveat);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ criteriaMet: [true, false, true] }));
    expect(screen.getByText(en.drill.met)).toBeInTheDocument(); // 2 ticks and a long enough response, from the self-check alone
  });

  test('the example response still shows after saving, whatever the AI does', async () => {
    const { client, saveSelf } = setup({ enabled: true });
    client.get.mockRejectedValue(new Error('down'));
    await saveSelf();
    expect(await screen.findByText('MODEL TEXT')).toBeInTheDocument();
  });

  test('back on the question, the last attempt’s stored AI check is shown without a button or a request', async () => {
    const previous: Attempt = { id: 'att-1', itemId: 'intake-e01', response: 'An earlier answer that is long enough.', criteriaMet: [true, true, false], createdAt: '2026-01-01T00:00:00Z' };
    const { client } = setup({ enabled: true, stored: RESULT, previous });
    expect(await screen.findByText(t.previousSummary)).toBeInTheDocument();
    expect(client.get).toHaveBeenCalledWith('att-1', 'en');
    expect(client.request).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: t.askButton })).not.toBeInTheDocument();
  });
});
