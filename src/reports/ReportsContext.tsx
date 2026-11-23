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
  | { ok: false; status: number; message: string; /** The Edge Function's error code, when it gave one. */ code?: string };
export type ReportSubmitter = (r: { title: string; body: string }) => Promise<SubmitResult>;

export type ReportRow = { id: string; title: string; createdAt: string };
export type ReportContent = { ok: true; title: string; body: string } | { ok: false; status: 404 | 410 | number };

/** The six dimensions of the report rubric (spec §9), in display order. */
export const DIMENSIONS = ['picture', 'formulation', 'link', 'process', 'self', 'ethics'] as const;
export type Dimension = (typeof DIMENSIONS)[number];
export type Score = 1 | 2 | 3 | 4;
export type Scores = Partial<Record<Dimension, Score>>;
export type FeedbackInput = { scores: Scores; comments: string };
export type FeedbackRecord = { id: string; scores: Scores; comments: string; status: 'draft' | 'released'; releasedAt: string | null };

/** One row of the supervisor's list. `summary` is counts per rule, computed by the server; never text. */
export type ReviewRow = {
  id: string;
  title: string;
  createdAt: string;
  studentName: string;
  status: 'submitted' | 'reviewed';
  deleteAfter: string;
  summary: Record<string, { found: number }>;
};
export type DriveStatus = 'ok' | 'auth' | 'quota' | 'unavailable' | 'not_configured';
export type PurgeResult =
  | { ok: true; purged: number; failed: number; more: boolean; driveError: string | null }
  | { ok: false; status: number };

export type ReportsApi = {
  submit: ReportSubmitter;
  list: () => Promise<ReportRow[]>;
  get: (id: string) => Promise<ReportContent>;
  remove: (id: string) => Promise<boolean>;
  /** Student: the released feedback on one of their own reports, or null. Never a draft. */
  releasedFeedback: (reportId: string) => Promise<FeedbackRecord | null>;
  /** Supervisor: every report of their cohorts, newest first. */
  listForReview: () => Promise<ReviewRow[]>;
  /** Supervisor: their own feedback on a report (draft or released), or null. */
  myFeedback: (reportId: string) => Promise<FeedbackRecord | null>;
  /** Supervisor: save as a draft, or release (which the database refuses unless all six scores and a comment are present). */
  saveFeedback: (reportId: string, input: FeedbackInput, release: boolean) => Promise<{ ok: true; record: FeedbackRecord } | { ok: false }>;
  /** Supervisor: delete the reports that are past their date, with their Drive files. */
  purgeExpired: () => Promise<PurgeResult>;
  /** Supervisor: does the saved Google authorisation still work? 'error' when the question itself failed. */
  driveStatus: () => Promise<DriveStatus | 'error'>;
};

/** Status used by the default implementations: the feature has no backend yet. */
export const NOT_OPEN = 503;

export const defaultSubmitter: ReportSubmitter = async () => ({ ok: false, status: NOT_OPEN, message: 'Reports are not open yet.' });

export const defaultReportsApi: ReportsApi = {
  submit: defaultSubmitter,
  list: async () => { throw new Error('reports not open'); },
  get: async () => ({ ok: false, status: NOT_OPEN }),
  remove: async () => false,
  releasedFeedback: async () => null,
  listForReview: async () => { throw new Error('reports not open'); },
  myFeedback: async () => { throw new Error('reports not open'); },
  saveFeedback: async () => ({ ok: false }),
  purgeExpired: async () => ({ ok: false, status: NOT_OPEN }),
  driveStatus: async () => 'error',
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
export const reportsFlag = (env: Record<string, unknown>): boolean => env.VITE_REPORTS_ENABLED === 'true';
