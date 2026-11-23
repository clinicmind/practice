import { AiError, type AiFeedbackClient, type AiResult } from './AiContext';

/**
 * Stand-in for the real backend, used only by the end-to-end build (VITE_AI_FAKE_API=true).
 * It judges nothing for real: the answer depends on a few words in the response, so a test can steer it.
 * Results are kept in memory only, so a reload would lose them; the end-to-end test keeps them in
 * sessionStorage under this key instead, to show "reload keeps it".
 */
export const AI_FAKE_MARKER = 'e2e-fake-ai-feedback-api';
const KEY = `${AI_FAKE_MARKER}-results`;

type Stored = Record<string, AiResult>;
const load = (): Stored => { try { return JSON.parse(sessionStorage.getItem(KEY) ?? '{}') as Stored; } catch { return {}; } };
const save = (s: Stored) => sessionStorage.setItem(KEY, JSON.stringify(s));

export function createFakeAiClient(responseOf: (attemptId: string) => Promise<string | null>): AiFeedbackClient {
  return {
    async get(id) { return load()[id] ?? null; },
    async request(id) {
      const stored = load()[id];
      if (stored) return stored;
      const response = (await responseOf(id)) ?? '';
      let result: AiResult;
      if (/risk-words/i.test(response)) result = { status: 'concern', concern: 'risk-content' };
      else if (/off-task-words/i.test(response)) result = { status: 'concern', concern: 'off-task' };
      else if (/budget-gone/i.test(response)) throw new AiError('budget_exhausted');
      else {
        const quote = response.split(/\s+/).slice(0, 4).join(' ');
        result = {
          status: 'ok',
          output: {
            criteria: [{ met: true, evidence: quote }, { met: false, evidence: '' }, { met: true, evidence: quote }],
            suggestion: 'You could try asking one open question and then waiting.',
            concern: 'none',
          },
          unsupported: [],
        };
      }
      save({ ...load(), [id]: result });
      return result;
    },
  };
}
