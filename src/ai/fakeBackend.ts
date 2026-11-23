import type { Backend } from '../auth/supabase';
import { createFakeDb } from '../test/fakeDb';
import { createFakeBackend } from '../test/fakeSupabase';
import { addAttempt, ALICE, BEA, SUP, seedCohort } from '../test/seedCohort';

/**
 * A seeded stand-in for Supabase, used only by the end-to-end build (VITE_AI_FAKE_API=true) and only when the page
 * sets sessionStorage `e2e-fake-user` to "sup". It lets the supervisor screens, which need a signed-in supervisor
 * and a database, be driven in a real browser. All names and text are fictional. Never part of a normal build.
 */
export const FAKE_BACKEND_MARKER = 'e2e-fake-supervisor-backend';

export function createSeededSupervisorBackend(): Backend {
  const db = createFakeDb();
  seedCohort(db);
  db.tables.cohorts![0]!.ai_enabled = true;
  db.tables.audit_log!.push({ id: 'marker', note: FAKE_BACKEND_MARKER }); // lets a test find this in a bundle
  addAttempt(db, { user: BEA, item: 'intake-e01', response: 'Tell me more about what has been hard lately.', met: [true, true, true], at: '2026-04-02T10:00:00.000Z' });
  addAttempt(db, { user: BEA, item: 'intake-e02', response: 'ok fine', met: [true, true, true], at: '2026-04-03T10:00:00.000Z' });
  const mine = (user: string) => db.tables.attempts!.filter((a) => a.user_id === user).map((a) => a.id as string);
  const [a1, a2, a3] = mine(ALICE);
  const [b1, b2] = mine(BEA);
  const evaluation = (attempt: string | undefined, user: string, item: string, concern: string | null = null) =>
    db.tables.ai_feedback!.push({ id: `f-${attempt}`, attempt_id: attempt, status: 'done', created_at: '2026-04-05T00:00:00Z', concern, attempt: { user_id: user, item_id: item } });
  const differ = (attempt: string | undefined, user: string, item: string, criterion: number, selfMet: boolean) =>
    db.tables.ai_disagreements!.push({ attempt_id: attempt, user_id: user, item_id: item, criterion_index: criterion, self_met: selfMet, ai_met: !selfMet });
  evaluation(a1, ALICE, 'intake-e01'); differ(a1, ALICE, 'intake-e01', 3, false);
  evaluation(a2, ALICE, 'intake-e02'); differ(a2, ALICE, 'intake-e02', 1, true); differ(a2, ALICE, 'intake-e02', 2, true);
  evaluation(a3, ALICE, 'intake-e03');
  evaluation(b1, BEA, 'intake-e01');
  evaluation(b2, BEA, 'intake-e02', 'risk-content');
  db.tables.ai_budget!.push({ id: true, monthly_limit_usd: 10, warn_at: 0.8 });
  const now = new Date().toISOString();
  for (let i = 0; i < 12; i++) {
    db.tables.ai_usage!.push({
      id: `u-${i}`, kind: i === 11 ? 'report_draft' : 'practice', input_tokens: 120, output_tokens: 60, cache_write_tokens: i % 3 === 0 ? 900 : 0,
      cache_read_tokens: i % 3 === 0 ? 0 : 900, cost_usd: i === 11 ? 0.9 : 0.0004, outcome: i === 5 ? 'refusal' : 'ok', created_at: now,
    });
  }
  return createFakeBackend({ userId: SUP, db }).backend;
}
