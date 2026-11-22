import { createContext, useContext, useMemo, type ReactNode } from 'react';

/**
 * Everything the report screens need from a backend, injected so the screens work (and are tested)
 * without one. The real implementation arrives with the submit-report / get-report / delete-report
 * Edge Functions. Until then the defaults say "not open yet" and the feature stays hidden.
 */
export type ReportFinding = { rule: string; start: number; end: number };
export type SubmitResult =
  | { ok: true; id: string }
  | { ok: false; status: 422; findings: ReportFinding[] }
  | { ok: false; status: number; message: string };
export type ReportSubmitter = (r: { title: string; body: string }) => Promise<SubmitResult>;

export type ReportRow = { id: string; title: string; createdAt: string };
export type ReportContent = { ok: true; title: string; body: string } | { ok: false; status: 404 | 410 | number };

export type ReportsApi = {
  submit: ReportSubmitter;
  list: () => Promise<ReportRow[]>;
  get: (id: string) => Promise<ReportContent>;
  remove: (id: string) => Promise<boolean>;
};

/** Status used by the default implementations: the feature has no backend yet. */
export const NOT_OPEN = 503;

export const defaultSubmitter: ReportSubmitter = async () => ({ ok: false, status: NOT_OPEN, message: 'Reports are not open yet.' });

export const defaultReportsApi: ReportsApi = {
  submit: defaultSubmitter,
  list: async () => { throw new Error('reports not open'); },
  get: async () => ({ ok: false, status: NOT_OPEN }),
  remove: async () => false,
};

type Value = { enabled: boolean; api: ReportsApi };
/** Off by default: with no provider the report links and routes do not exist. */
const ReportsContext = createContext<Value>({ enabled: false, api: defaultReportsApi });

export function ReportsProvider({ enabled = false, api, children }: { enabled?: boolean; api?: Partial<ReportsApi>; children: ReactNode }) {
  const value = useMemo<Value>(() => ({ enabled, api: { ...defaultReportsApi, ...api } }), [enabled, api]);
  return <ReportsContext.Provider value={value}>{children}</ReportsContext.Provider>;
}

export const useReportsEnabled = (): boolean => useContext(ReportsContext).enabled;
export const useReportsApi = (): ReportsApi => useContext(ReportsContext).api;

/** The build-time switch. Only the exact string "true" turns reports on. */
export const reportsFlag = (env: { VITE_REPORTS_ENABLED?: string }): boolean => env.VITE_REPORTS_ENABLED === 'true';
