import { createContext, useContext, type ReactNode } from 'react';

/**
 * Optional student extras: revise once more, the supervision prep sheet, mixed review.
 * They are off unless the build sets VITE_PRACTICE_EXTRAS=true (owner approval is needed before students get them).
 * With no provider, or enabled=false, nothing renders, nothing is loaded and nothing is stored.
 */
const ExtrasContext = createContext(false);

export function ExtrasProvider({ enabled = false, children }: { enabled?: boolean; children: ReactNode }) {
  return <ExtrasContext.Provider value={enabled}>{children}</ExtrasContext.Provider>;
}

export const useExtrasEnabled = (): boolean => useContext(ExtrasContext);

/** The build-time switch. Only the exact string "true" turns the extras on. */
export const extrasFlag = (env: Record<string, unknown>): boolean => env.VITE_PRACTICE_EXTRAS === 'true';
