import type { FakeDb } from './fakeDb';

export const SUP = 'sup-1';
export const ALICE = 'stu-alice';
export const BEA = 'stu-bea';
export const CODE = 'ABCDEFGHJK';

let n = 0;
type Att = { user: string; item: string; response: string; met?: boolean[]; at: string };

export function addAttempt(db: FakeDb, a: Att) {
  db.tables.attempts.push({
    id: `att-${++n}`, user_id: a.user, client_id: `c-${n}`, item_id: a.item, response: a.response,
    criteria_met: a.met ?? [true, true, false], created_at: a.at,
  });
}

/** One supervisor with one cohort of two students. Alice has real progress; Bea has none. */
export function seedCohort(db: FakeDb, opts: { withCohort?: boolean } = {}) {
  db.tables.profiles.push(
    { id: SUP, role: 'supervisor', display_name: 'Dr Supervisor', cohort_id: null, created_at: '2026-01-01T00:00:00.000Z' },
  );
  if (opts.withCohort === false) return;
  db.tables.cohorts.push({
    id: 'c1', name: 'Spring cohort', supervisor_id: SUP, invite_code: CODE, term_end: '2099-12-31', created_at: '2026-01-02T00:00:00.000Z',
  });
  db.tables.profiles.push(
    { id: ALICE, role: 'student', display_name: 'Alice', cohort_id: 'c1', created_at: '2026-01-03T00:00:00.000Z' },
    { id: BEA, role: 'student', display_name: 'Bea', cohort_id: 'c1', created_at: '2026-01-04T00:00:00.000Z' },
  );
  for (let i = 1; i <= 8; i++) {
    addAttempt(db, { user: ALICE, item: `intake-e0${i}`, response: `Alice's thoughtful reply number ${i} to the client.`, at: `2026-03-0${i}T10:00:00.000Z` });
  }
  const dec = (id: string, decision: string, at: string, extra: Record<string, unknown>) =>
    db.tables.decisions.push({ id, user_id: ALICE, client_id: id, session_id: 'intake-s1', decision_id: decision, created_at: at, ...extra });
  dec('dec-1', 'd1', '2026-03-10T09:00:00.000Z', { option_id: 'a', response: null });
  dec('dec-2', 'd2', '2026-03-20T09:00:00.000Z', { option_id: null, response: 'my own words' });
}
