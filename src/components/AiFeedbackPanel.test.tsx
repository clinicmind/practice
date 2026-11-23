import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import { AiError, AiProvider, type AiFeedbackClient, type AiResult } from '../ai/AiContext';
import { en } from '../i18n/en';
import { zhHant } from '../i18n/zh-Hant';
import { LocaleProvider } from '../i18n';
import { AiFeedbackPanel } from './AiFeedbackPanel';

// All text is fictional.
const CRITERIA = ['Asks an open question', 'Stays brief', 'Invites the client'];
const RESPONSE = 'What brought you here today? Take your time.';
const OK: AiResult = {
  status: 'ok', unsupported: [],
  output: {
    criteria: [{ met: true, evidence: 'What brought you here today?' }, { met: true, evidence: 'Take your time' }, { met: false, evidence: '' }],
    suggestion: 'You could try inviting the client to say more.', concern: 'none',
  },
};
const t = en.aiFeedback;

function client(over: Partial<AiFeedbackClient> = {}) {
  const c = { get: vi.fn(async () => null as AiResult | null), request: vi.fn(async () => OK), ...over };
  return c as AiFeedbackClient & { get: ReturnType<typeof vi.fn>; request: ReturnType<typeof vi.fn> };
}
function setup(c: AiFeedbackClient | undefined, opts: { enabled?: boolean; mode?: 'ask' | 'stored'; selfMet?: boolean[]; zh?: boolean } = {}) {
  const ui = (
    <LocaleProvider initial={opts.zh ? 'zh-Hant' : 'en'}>
      <AiProvider enabled={opts.enabled ?? true} client={c}>
        <AiFeedbackPanel attemptId="att-1" response={RESPONSE} criteria={CRITERIA} selfMet={opts.selfMet ?? [true, false, false]} mode={opts.mode ?? 'ask'} />
      </AiProvider>
    </LocaleProvider>
  );
  return { user: userEvent.setup(), ...render(ui) };
}

describe('AI feedback panel', () => {
  test('with the feature off nothing renders and no request is made, even when a client is given', async () => {
    const c = client();
    const { container } = setup(c, { enabled: false });
    await new Promise((r) => setTimeout(r, 20));
    expect(container).toBeEmptyDOMElement();
    expect(c.get).not.toHaveBeenCalled();
    expect(c.request).not.toHaveBeenCalled();
  });

  test('with no client at all nothing renders', async () => {
    const { container } = setup(undefined);
    await new Promise((r) => setTimeout(r, 20));
    expect(container).toBeEmptyDOMElement();
  });

  test('shows a button; the AI is not asked until it is pressed (reading a stored result is allowed)', async () => {
    const c = client();
    const { user } = setup(c);
    const button = await screen.findByRole('button', { name: t.askButton });
    expect(c.get).toHaveBeenCalledTimes(1);
    expect(c.request).not.toHaveBeenCalled();
    await user.click(button);
    expect(c.request).toHaveBeenCalledWith('att-1', 'en');
  });

  test('a double click sends one request', async () => {
    let release: (r: AiResult) => void = () => {};
    const c = client({ request: vi.fn(() => new Promise<AiResult>((res) => { release = res; })) });
    const { user } = setup(c);
    const button = await screen.findByRole('button', { name: t.askButton });
    await user.dblClick(button);
    expect(c.request).toHaveBeenCalledTimes(1);
    release(OK);
    await screen.findByText(t.caveat);
    expect(c.request).toHaveBeenCalledTimes(1);
  });

  test('shows self and AI side by side per criterion and marks the differences', async () => {
    const { user } = setup(client(), { selfMet: [true, false, false] });
    await user.click(await screen.findByRole('button', { name: t.askButton }));
    const rows = within(await screen.findByRole('list', { name: t.tableCaption })).getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    // 1: you met, AI met -> same. 2: you not met, AI met -> different. 3: you not met, AI not met -> same.
    expect(rows[0]).toHaveTextContent(`${t.colYou}: ${t.met}`);
    expect(rows[0]).toHaveTextContent(`${t.colAi}: ${t.met}`);
    expect(within(rows[0]!).getByText(t.agrees)).toBeInTheDocument();
    expect(rows[1]).toHaveTextContent(`${t.colYou}: ${t.notMet}`);
    expect(rows[1]).toHaveTextContent(`${t.colAi}: ${t.met}`);
    expect(within(rows[1]!).getByText(t.differs)).toBeInTheDocument();
    expect(within(rows[2]!).getByText(t.agrees)).toBeInTheDocument();
    expect(screen.getByText(OK.status === 'ok' ? OK.output.suggestion : '')).toBeInTheDocument();
    expect(screen.getByText(t.caveat)).toBeInTheDocument();
  });

  test('the words the AI pointed to are marked inside the student’s own response', async () => {
    const { user, container } = setup(client());
    await user.click(await screen.findByRole('button', { name: t.askButton }));
    await screen.findByText(t.caveat);
    const marks = Array.from(container.querySelectorAll('.ai-response mark')).map((m) => m.textContent);
    expect(marks).toEqual(['What brought you here today?', 'Take your time']);
    expect(container.querySelector('.ai-response')!.textContent).toBe(RESPONSE);
  });

  test('a criterion called met without quoted words gets a caution', async () => {
    const r: AiResult = { ...OK, unsupported: [1] } as AiResult;
    const c = client({ request: vi.fn(async () => r) });
    const { user } = setup(c);
    await user.click(await screen.findByRole('button', { name: t.askButton }));
    expect(await screen.findByText(t.unsupported)).toBeInTheDocument();
  });

  test('risk-content shows only the safety line: no criteria, no suggestion', async () => {
    const c = client({ request: vi.fn(async () => ({ status: 'concern', concern: 'risk-content' }) as AiResult) });
    const { user } = setup(c);
    await user.click(await screen.findByRole('button', { name: t.askButton }));
    expect(await screen.findByText(t.riskNote)).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    expect(screen.queryByText(t.suggestionHeading)).not.toBeInTheDocument();
  });

  test('off-task says there is no evaluation', async () => {
    const c = client({ request: vi.fn(async () => ({ status: 'concern', concern: 'off-task' }) as AiResult) });
    const { user } = setup(c);
    await user.click(await screen.findByRole('button', { name: t.askButton }));
    expect(await screen.findByText(t.offTask)).toBeInTheDocument();
  });

  test.each(Object.keys(en.aiFeedback.errors))('error %s maps to its message in both languages', async (code) => {
    for (const lang of ['en', 'zh'] as const) {
      const c = client({ request: vi.fn(async () => { throw new AiError(code); }) });
      const { user, unmount } = setup(c, { zh: lang === 'zh' });
      const strings = lang === 'zh' ? zhHant.aiFeedback : en.aiFeedback;
      await user.click(await screen.findByRole('button', { name: strings.askButton }));
      expect(await screen.findByRole('alert')).toHaveTextContent(strings.errors[code]!);
      unmount();
    }
  });

  test('every error code has a message in both languages', () => {
    expect(Object.keys(zhHant.aiFeedback.errors).sort()).toEqual(Object.keys(en.aiFeedback.errors).sort());
    for (const m of Object.values(zhHant.aiFeedback.errors)) expect(m).not.toBe('');
  });

  test('an unknown error code falls back to "not available right now"', async () => {
    const c = client({ request: vi.fn(async () => { throw new Error('boom'); }) });
    const { user } = setup(c);
    await user.click(await screen.findByRole('button', { name: t.askButton }));
    expect(await screen.findByRole('alert')).toHaveTextContent(t.errors.unavailable!);
  });

  test('after an error the student can press the button again', async () => {
    const request = vi.fn().mockRejectedValueOnce(new AiError('unavailable')).mockResolvedValueOnce(OK);
    const { user } = setup(client({ request }));
    await user.click(await screen.findByRole('button', { name: t.askButton }));
    await screen.findByRole('alert');
    await user.click(screen.getByRole('button', { name: t.askButton }));
    expect(await screen.findByText(t.caveat)).toBeInTheDocument();
    expect(request).toHaveBeenCalledTimes(2);
  });

  test('a stored result is shown straight away through get(), without calling request()', async () => {
    const c = client({ get: vi.fn(async () => OK) });
    setup(c);
    expect(await screen.findByText(t.caveat)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t.askButton })).not.toBeInTheDocument();
    expect(c.request).not.toHaveBeenCalled();
  });

  test('when the class has AI off, the panel disappears and shows no button', async () => {
    const c = client({ get: vi.fn(async () => { throw new AiError('ai_disabled'); }) });
    const { container } = setup(c);
    await waitFor(() => expect(c.get).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(container).toBeEmptyDOMElement();
    expect(c.request).not.toHaveBeenCalled();
  });

  test('stored mode shows a stored result only, never a button', async () => {
    const none = client();
    const { container } = setup(none, { mode: 'stored' });
    await waitFor(() => expect(none.get).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(container).toBeEmptyDOMElement();
    const some = client({ get: vi.fn(async () => OK) });
    setup(some, { mode: 'stored' });
    expect(await screen.findByText(t.caveat)).toBeInTheDocument();
  });

  test('the Chinese interface shows the same panel in Chinese', async () => {
    const { user } = setup(client(), { zh: true });
    await user.click(await screen.findByRole('button', { name: zhHant.aiFeedback.askButton }));
    expect(await screen.findByText(zhHant.aiFeedback.caveat)).toBeInTheDocument();
    expect(screen.getAllByText(zhHant.aiFeedback.differs).length).toBeGreaterThan(0);
  });
});
