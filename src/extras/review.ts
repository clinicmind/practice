import { z } from 'zod';
import type { Attempt } from '../progress/types';

/** Days after the last practice (or review) before an item comes back: the 1st, 2nd and 3rd time. */
export const INTERVAL_DAYS = [1, 4, 14] as const;
export const REVIEW_COUNT = 3;
export const REVIEW_KEY = 'cm.review.v1';
const MAX_ENTRIES = 500;

export type ReviewEntry = { itemId: string; at: string; kind: 'done' | 'skipped'; response?: string };
const EntrySchema = z.object({
  itemId: z.string().min(1), at: z.string().min(1), kind: z.enum(['done', 'skipped']), response: z.string().optional(),
});

/**
 * Review notes live in this browser only (localStorage). They are a separate record from attempts:
 * nothing here is read by the pass rules, so a review can never change whether a level is passed.
 */
export function loadReviewLog(storage: Storage = globalThis.localStorage): ReviewEntry[] {
  try {
    const raw = storage.getItem(REVIEW_KEY);
    if (!raw) return [];
    const parsed = z.array(z.unknown()).parse(JSON.parse(raw));
    return parsed.flatMap((e) => { const r = EntrySchema.safeParse(e); return r.success ? [r.data] : []; });
  } catch {
    return [];
  }
}

export function appendReview(entry: ReviewEntry, storage: Storage = globalThis.localStorage): void {
  try {
    const next = [...loadReviewLog(storage), entry].slice(-MAX_ENTRIES);
    storage.setItem(REVIEW_KEY, JSON.stringify(next));
  } catch { /* best effort: the review itself still worked */ }
}

/** Calendar days (local time) between two instants: yesterday evening to this morning is 1. */
export function dayGap(from: Date, to: Date): number {
  const d = (x: Date) => Date.UTC(x.getFullYear(), x.getMonth(), x.getDate());
  return Math.round((d(to) - d(from)) / 86_400_000);
}

export interface Candidate { itemId: string; moduleKey: string }

/**
 * Which earlier questions to bring back. An item is due when enough days passed since it was last touched
 * (last attempt, review or skip) for the number of reviews it has had: 1, 4, then 14 days. After three reviews it retires.
 * Items the student only just passed (exactly 2 of 3 criteria) come first, then the most overdue. The pick spreads
 * over different modules where it can, because mixing is the point.
 */
export function pickReviewItems(opts: {
  candidates: Candidate[]; attempts: Attempt[]; log: ReviewEntry[]; now: Date; count?: number;
}): string[] {
  const { candidates, attempts, log, now, count = REVIEW_COUNT } = opts;
  const scored: { c: Candidate; two: boolean; overdue: number }[] = [];
  for (const c of candidates) {
    const mine = attempts.filter((a) => a.itemId === c.itemId);
    if (mine.length === 0) continue;
    const last = mine.reduce((m, a) => (a.createdAt >= m.createdAt ? a : m));
    const entries = log.filter((e) => e.itemId === c.itemId);
    const done = entries.filter((e) => e.kind === 'done').length;
    if (done >= INTERVAL_DAYS.length) continue;
    const touches = [last.createdAt, ...entries.map((e) => e.at)].map((t) => Date.parse(t)).filter((t) => !Number.isNaN(t));
    const touched = new Date(Math.max(...touches));
    const gap = dayGap(touched, now);
    const need = INTERVAL_DAYS[done];
    if (gap < need) continue;
    scored.push({ c, two: last.criteriaMet.filter(Boolean).length === 2, overdue: gap - need });
  }
  scored.sort((a, b) => Number(b.two) - Number(a.two) || b.overdue - a.overdue || a.c.itemId.localeCompare(b.c.itemId));
  const picked: typeof scored = [];
  const seen = new Set<string>();
  for (const s of scored) {
    if (picked.length >= count) break;
    if (seen.has(s.c.moduleKey)) continue;
    seen.add(s.c.moduleKey);
    picked.push(s);
  }
  for (const s of scored) {
    if (picked.length >= count) break;
    if (!picked.includes(s)) picked.push(s);
  }
  return picked.map((s) => s.c.itemId);
}
