import type { Backend } from '../auth/supabase';
import { createFakeDb } from '../test/fakeDb';
import { createFakeBackend } from '../test/fakeSupabase';
import { addAttempt, ALICE, BEA, SUP, seedCohort } from '../test/seedCohort';

/**
 * A seeded stand-in for Supabase, used only by the end-to-end build (VITE_AI_FAKE_API=true) and only when the page
 * sets sessionStorage `e2e-fake-user` to "sup-triage". It gives the supervisor page a week of practice to summarise.
 * Everything is fictional. Never part of a normal build.
 */
export const TRIAGE_BACKEND_MARKER = 'e2e-fake-triage-backend';

export function createTriageSupervisorBackend(): Backend {
  const db = createFakeDb();
  seedCohort(db);
  db.tables.audit_log!.push({ id: 'marker', note: TRIAGE_BACKEND_MARKER });
  const ago = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
  const more = [['stu-cho', 'Cho'], ['stu-dan', 'Dan'], ['stu-eve', 'Eve'], ['stu-fay', 'Fay']] as const;
  for (const [id, name] of more) {
    db.tables.profiles!.push({ id, role: 'student', display_name: name, cohort_id: 'c1', created_at: ago(60) });
  }
  // Five students answer intake-e01 this week. Criterion 2 is ticked by one of five, criterion 3 by three of five.
  const week = [ALICE, BEA, 'stu-cho', 'stu-dan', 'stu-fay'];
  week.forEach((user, i) => {
    addAttempt(db, {
      user, item: 'intake-e01', at: ago(2),
      response: i % 2 === 0 ? `Fictional careful reply ${i} to the client.` : `虛構的回應第 ${i} 份，請多說一些。`,
      met: [true, i < 1, i < 3],
    });
  });
  // Bea: a very short reply with everything ticked (marked). Eve: last practised 30 days ago.
  addAttempt(db, { user: BEA, item: 'intake-e02', response: 'ok', met: [true, true, true], at: ago(1) });
  addAttempt(db, { user: 'stu-eve', item: 'intake-e03', response: 'Fictional older reply by Eve to the client.', at: ago(30) });
  return createFakeBackend({ userId: SUP, db }).backend;
}
