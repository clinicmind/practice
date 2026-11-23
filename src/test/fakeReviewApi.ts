import { vi } from 'vitest';
import { canRelease } from '../reports/rubric';
import type { DriveStatus, FeedbackInput, FeedbackRecord, PurgeResult, ReportsApi, ReviewRow } from '../reports/ReportsContext';

/**
 * An in-memory stand-in for the review half of the backend, with the same rules the database has:
 * a release needs six scores and a comment, and a student never gets a draft. All data is fictional.
 */
export function createFakeReviewApi(init: { rows?: ReviewRow[]; bodies?: Record<string, { title: string; body: string } | number>; drive?: DriveStatus | 'error'; purge?: PurgeResult } = {}) {
  const rows = [...(init.rows ?? [])];
  const feedback = new Map<string, FeedbackRecord>();
  const state = { drive: init.drive ?? 'ok', purge: init.purge ?? ({ ok: true, purged: 0, failed: 0, more: false, driveError: null } as PurgeResult), saveFails: false, listFails: false };
  const api = {
    submit: vi.fn(async () => ({ ok: false as const, status: 503, message: 'x' })),
    list: vi.fn(async () => rows.map((r) => ({ id: r.id, title: r.title, createdAt: r.createdAt }))),
    get: vi.fn(async (id: string) => {
      const b = init.bodies?.[id];
      if (typeof b === 'number') return { ok: false as const, status: b };
      return b ? { ok: true as const, ...b } : { ok: false as const, status: 404 };
    }),
    remove: vi.fn(async (id: string) => { const i = rows.findIndex((r) => r.id === id); if (i >= 0) rows.splice(i, 1); feedback.delete(id); return true; }),
    listForReview: vi.fn(async () => { if (state.listFails) throw new Error('boom'); return [...rows]; }),
    myFeedback: vi.fn(async (id: string) => feedback.get(id) ?? null),
    releasedFeedback: vi.fn(async (id: string) => { const f = feedback.get(id); return f?.status === 'released' ? f : null; }),
    saveFeedback: vi.fn(async (id: string, input: FeedbackInput, release: boolean) => {
      if (state.saveFails) return { ok: false as const };
      const old = feedback.get(id);
      const wantRelease = release || old?.status === 'released';
      if (wantRelease && !canRelease(input.scores, input.comments)) return { ok: false as const };
      const record: FeedbackRecord = {
        id: old?.id ?? `fb-${id}`, scores: input.scores, comments: input.comments,
        status: wantRelease ? 'released' : 'draft', releasedAt: wantRelease ? (old?.releasedAt ?? '2026-11-23T08:00:00Z') : null,
      };
      feedback.set(id, record);
      if (wantRelease) { const r = rows.find((x) => x.id === id); if (r) r.status = 'reviewed'; }
      return { ok: true as const, record };
    }),
    purgeExpired: vi.fn(async () => state.purge),
    driveStatus: vi.fn(async () => state.drive),
  } satisfies ReportsApi;
  return { api, rows, feedback, state };
}

export const reviewRow = (over: Partial<ReviewRow> = {}): ReviewRow => ({
  id: 'r1', title: 'Week 3 summary', createdAt: '2026-11-20T09:00:00Z', studentName: 'Alice', status: 'submitted', deleteAfter: '2027-04-01', summary: {}, ...over,
});
