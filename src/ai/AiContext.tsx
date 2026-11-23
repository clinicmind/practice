import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

/**
 * The student side of AI feedback (stage 4). The screens get everything from a client that is injected,
 * so they work and are tested without a backend. With no provider the feature does not exist: nothing
 * renders and no request is made.
 */
export type AiOutput = {
  criteria: { met: boolean; evidence: string }[]; // exactly 3
  suggestion: string;
  concern: 'none';
};
export type AiResult =
  | { status: 'ok'; output: AiOutput; /** Criterion indexes (0 to 2) the AI called met without quoting any words. */ unsupported: number[] }
  | { status: 'concern'; concern: 'risk-content' | 'off-task' };

/** What the Edge Function can refuse with. `code` is its `error` field; see `aiFeedback.errors`. */
export class AiError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

export type AiLocale = 'en' | 'zh-Hant';
export interface AiFeedbackClient {
  /** The stored result, or null if there is none. Never makes the AI run. Throws AiError (`ai_disabled` when the class has it off). */
  get(attemptId: string, locale: AiLocale): Promise<AiResult | null>;
  /** Makes the AI run (and costs money) unless a result is already stored. Throws AiError. */
  request(attemptId: string, locale: AiLocale): Promise<AiResult>;
}

/** Used when nothing real is plugged in. It sends nothing anywhere. */
export const defaultAiClient: AiFeedbackClient = {
  get: async () => { throw new AiError('ai_disabled'); },
  request: async () => { throw new AiError('ai_disabled'); },
};

type Value = {
  enabled: boolean;
  client: AiFeedbackClient;
  /** Set when the server says this class has AI off: every panel then disappears and stops asking. */
  classOff: boolean;
  markClassOff: () => void;
};
const AiContext = createContext<Value>({ enabled: false, client: defaultAiClient, classOff: true, markClassOff: () => {} });

export function AiProvider({ enabled = false, client, children }: { enabled?: boolean; client?: AiFeedbackClient; children: ReactNode }) {
  const [classOff, setClassOff] = useState(false);
  const markClassOff = useCallback(() => setClassOff(true), []);
  const value = useMemo<Value>(
    () => ({ enabled: enabled && !!client, client: client ?? defaultAiClient, classOff, markClassOff }),
    [enabled, client, classOff, markClassOff],
  );
  return <AiContext.Provider value={value}>{children}</AiContext.Provider>;
}

/** True only when the build switch is on, a client is plugged in, and the server has not said "off for this class". */
export const useAiAvailable = (): boolean => { const v = useContext(AiContext); return v.enabled && !v.classOff; };
export const useAi = (): Value => useContext(AiContext);

/** The build-time switch. Only the exact string "true" turns AI feedback on. */
export const aiFlag = (env: Record<string, unknown>): boolean => env.VITE_AI_ENABLED === 'true';
