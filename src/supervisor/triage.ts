import { LEVELS, type Drill, type Level } from '../content/schema';
import { levelPassed, MIN_RESPONSE } from '../progress/rules';
import type { Attempt } from '../progress/types';
import { flagAttempts, type FlagReason } from './flags';

/**
 * What the supervisor should look at first, worked out from attempts the app already stores.
 * Everything here is a pure function of its inputs (`now` is passed in), so it is easy to test.
 * These are prompts for a person to look, not judgements about any student.
 */

export const WINDOW_DAYS = 7;
/** A pass rate over fewer answers than this says too little to rank. */
export const MIN_ANSWERS = 5;
export const HARDEST_LIMIT = 3;
/** Full rounds of a level, without passing it, before a student is listed. */
export const STUCK_ROUNDS = 2;
/** Ordinary replies picked each week for discussion. */
export const PICKS_PER_WEEK = 3;

const DAY = 86_400_000;

export type CohortAttempt = Attempt & { userId: string };
export type TriageStudent = { id: string; displayName: string; lastActiveAt: string | null; joinedAt: string | null };
type Bundles = Record<string, { drills: Drill[] }>;
type Models = Record<string, { model_response: string }>;

const windowStart = (now: Date) => new Date(now.getTime() - WINDOW_DAYS * DAY).toISOString();
const recent = (a: { createdAt: string }, now: Date) => a.createdAt >= windowStart(now);

/** The latest attempt of each student at each item. */
function latestPerStudentItem(attempts: CohortAttempt[]): CohortAttempt[] {
  const best = new Map<string, CohortAttempt>();
  for (const a of attempts) {
    const k = `${a.userId}\u0000${a.itemId}`;
    const cur = best.get(k);
    if (!cur || a.createdAt >= cur.createdAt) best.set(k, a);
  }
  return [...best.values()];
}

// ---------- 1. the hardest criteria this week ----------

export type HardCriterion = {
  itemId: string;
  /** 1, 2 or 3, as the drill lists its criteria. */
  criterion: 1 | 2 | 3;
  met: number;
  answers: number;
  passRate: number;
};

/**
 * Self-rated pass rate per question and criterion over the last 7 days, lowest first.
 * Each student counts once per question (their latest attempt in the window).
 * Pairs with fewer than MIN_ANSWERS answers are not ranked; `pending` counts them.
 * An item id is the same in both languages, so answers in either language add up together.
 */
export function hardestCriteria(attempts: CohortAttempt[], now: Date, limit = HARDEST_LIMIT): { rows: HardCriterion[]; pending: number } {
  const tally = new Map<string, { itemId: string; criterion: 1 | 2 | 3; met: number; answers: number }>();
  for (const a of latestPerStudentItem(attempts.filter((x) => recent(x, now) && x.criteriaMet.length === 3))) {
    a.criteriaMet.forEach((ok, i) => {
      const criterion = (i + 1) as 1 | 2 | 3;
      const k = `${a.itemId}\u0000${criterion}`;
      const t = tally.get(k) ?? { itemId: a.itemId, criterion, met: 0, answers: 0 };
      t.answers += 1;
      if (ok) t.met += 1;
      tally.set(k, t);
    });
  }
  const all = [...tally.values()];
  const rows = all
    .filter((t) => t.answers >= MIN_ANSWERS)
    .map((t): HardCriterion => ({ ...t, passRate: t.met / t.answers }))
    .sort((a, b) => a.passRate - b.passRate || b.answers - a.answers || a.itemId.localeCompare(b.itemId) || a.criterion - b.criterion)
    .slice(0, limit);
  return { rows, pending: all.filter((t) => t.answers < MIN_ANSWERS).length };
}

// ---------- 2. students to check in with ----------

export type CheckInReason =
  | { kind: 'inactive'; never: boolean }
  | { kind: 'stuck'; slug: string; level: Level; rounds: number };
export type CheckIn = { userId: string; displayName: string; reasons: CheckInReason[] };

/**
 * Students who have not practised for 7 days, or who went through a whole level twice without passing it.
 * A new member who has not started yet is left alone for their first 7 days.
 */
export function studentsToCheckIn(students: TriageStudent[], attempts: CohortAttempt[], bundles: Bundles, now: Date): CheckIn[] {
  const start = windowStart(now);
  const byUser = new Map<string, CohortAttempt[]>();
  for (const a of attempts) byUser.set(a.userId, [...(byUser.get(a.userId) ?? []), a]);

  const out: CheckIn[] = [];
  for (const s of students) {
    const mine = byUser.get(s.id) ?? [];
    const reasons: CheckInReason[] = [];

    const lastAttempt = mine.reduce<string | null>((m, a) => (m === null || a.createdAt > m ? a.createdAt : m), null);
    const last = [s.lastActiveAt, lastAttempt].reduce<string | null>((m, t) => (t && (m === null || t > m) ? t : m), null);
    const since = last ?? s.joinedAt;
    if (since === null || since < start) reasons.push({ kind: 'inactive', never: last === null });

    for (const [slug, b] of Object.entries(bundles)) {
      for (const level of LEVELS) {
        const items = b.drills.filter((d) => d.level === level);
        if (items.length === 0 || levelPassed(mine, b.drills, level)) continue;
        const rounds = Math.min(...items.map((d) => mine.filter((a) => a.itemId === d.id).length));
        if (rounds >= STUCK_ROUNDS) reasons.push({ kind: 'stuck', slug, level, rounds });
      }
    }
    if (reasons.length) out.push({ userId: s.id, displayName: s.displayName, reasons });
  }
  return out.sort((a, b) => a.displayName.localeCompare(b.displayName) || a.userId.localeCompare(b.userId));
}

// ---------- 3. replies worth talking about ----------

export type DiscussionPick = { attemptId: string; userId: string; itemId: string; response: string };
export type FlaggedPick = DiscussionPick & { reasons: FlagReason[] };

/** Weeks since the epoch (UTC). The rotation moves on one place per week. */
export const weekIndex = (now: Date): number => Math.floor(now.getTime() / (7 * DAY));

/**
 * `flagged`: this week's attempts that the existing marks point at (spotted over each student's whole history,
 * so a repeat of an older reply is still seen).
 * `rotation`: PICKS_PER_WEEK ordinary replies. The turn order is the students sorted by id; the starting place moves
 * on by PICKS_PER_WEEK each week, and students with nothing usable this week are passed over. It is a way to
 * choose material, not a ranking.
 */
export function discussionPicks(
  students: Pick<TriageStudent, 'id'>[],
  attempts: CohortAttempt[],
  models: readonly Models[],
  now: Date,
  perWeek = PICKS_PER_WEEK,
): { flagged: FlaggedPick[]; rotation: DiscussionPick[] } {
  const byUser = new Map<string, CohortAttempt[]>();
  for (const a of attempts) byUser.set(a.userId, [...(byUser.get(a.userId) ?? []), a]);

  const flaggedIds = new Set<string>();
  const flagged: FlaggedPick[] = [];
  for (const [userId, mine] of byUser) {
    const reasons = new Map<string, FlagReason[]>();
    for (const f of flagAttempts(mine, models)) reasons.set(f.attemptId, [...(reasons.get(f.attemptId) ?? []), f.reason]);
    for (const a of mine) {
      const r = reasons.get(a.id);
      if (!r || !recent(a, now)) continue;
      flaggedIds.add(a.id);
      flagged.push({ attemptId: a.id, userId, itemId: a.itemId, response: a.response, reasons: r });
    }
  }
  flagged.sort((a, b) => a.userId.localeCompare(b.userId) || a.attemptId.localeCompare(b.attemptId));

  const order = [...students].map((s) => s.id).sort();
  const usable = (userId: string): CohortAttempt | undefined =>
    (byUser.get(userId) ?? [])
      .filter((a) => recent(a, now) && !flaggedIds.has(a.id) && a.response.trim().length >= MIN_RESPONSE)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : b.id.localeCompare(a.id)))[0];

  const rotation: DiscussionPick[] = [];
  if (order.length > 0) {
    const first = (weekIndex(now) * perWeek) % order.length;
    for (let i = 0; i < order.length && rotation.length < perWeek; i++) {
      const userId = order[(first + i) % order.length]!;
      const a = usable(userId);
      if (a) rotation.push({ attemptId: a.id, userId, itemId: a.itemId, response: a.response });
    }
  }
  return { flagged, rotation };
}
