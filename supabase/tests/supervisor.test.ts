// @vitest-environment node
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createDb, type Client, type TestDb } from './harness';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const S1 = id(1), S2 = id(2), A = id(11), B = id(12), X = id(21);
const C1 = id(101), C2 = id(102);
const SECRET = 'a very private response text';

let db: TestDb;
let admin: Client;
const as = (u: string | null) => db.as(u);
const rows = async (c: Client, sql: string, p?: unknown[]) => (await c.query(sql, p)).rows;

beforeAll(async () => {
  db = await createDb();
  admin = db.admin;
  for (const u of [S1, S2, A, B, X]) await admin.query(`insert into auth.users (id) values ($1)`, [u]);
  await admin.query(`insert into profiles (id, role, display_name) values ($1,'supervisor','S1'),($2,'supervisor','S2')`, [S1, S2]);
  await admin.query(
    `insert into cohorts (id, name, supervisor_id, invite_code, term_end) values ($1,'C1',$3,'AAAAAAAAAA',current_date+30),($2,'C2',$4,'BBBBBBBBBB',current_date+30)`,
    [C1, C2, S1, S2],
  );
  await admin.query(`insert into profiles (id, role, display_name, cohort_id) values ($1,'student','A',$4),($2,'student','B',$4),($3,'student','X',$5)`, [A, B, X, C1, C2]);
  await admin.query(`insert into attempts (user_id, client_id, item_id, response, criteria_met, created_at) values ($1,$4,'i1',$5,'{t,t,t}','2026-03-01T10:00:00Z'), ($1,$6,'i1','later','{t,t,t}','2026-03-05T10:00:00Z'), ($2,$7,'i1','b','{t,t,t}','2026-02-01T00:00:00Z'), ($3,$8,'i1','x','{t,t,t}','2026-04-01T00:00:00Z')`,
    [A, B, X, id(901), SECRET, id(902), id(903), id(904)]);
  await admin.query(`insert into reflections (user_id, client_id, module_slug, prompt_id, text, created_at) values ($1,$2,'intake','p','t','2026-03-10T00:00:00Z')`, [A, id(905)]);
});
afterAll(() => db.close());

describe('unlocks', () => {
  test('a supervisor grant is visible to that student (and only them)', async () => {
    await as(S1).query(`insert into unlocks (user_id, module_slug, level, granted_by) values ($1,'intake','hard',$2)`, [A, S1]);
    expect(await rows(as(A), `select module_slug, level from unlocks`)).toEqual([{ module_slug: 'intake', level: 'hard' }]);
    expect(await rows(as(B), `select * from unlocks`)).toEqual([]);
    expect(await rows(as(S1), `select user_id from unlocks`)).toEqual([{ user_id: A }]);
  });
  test('a repeated grant is ignored without error', async () => {
    await as(S1).query(`insert into unlocks (user_id, module_slug, level, granted_by) values ($1,'intake','hard',$2) on conflict do nothing`, [A, S1]);
    expect((await rows(admin, `select count(*)::int n from unlocks where user_id=$1`, [A]))[0]!.n).toBe(1);
  });
  test('an invalid level is rejected', async () => {
    await expect(as(S1).query(`insert into unlocks (user_id, module_slug, level, granted_by) values ($1,'intake','expert',$2)`, [A, S1])).rejects.toThrow();
  });
});

describe('audit_log', () => {
  test('grant_unlock and create_cohort each leave one row, with no response text', async () => {
    const created = (await rows(as(S1), `select id from create_cohort('Audit me', current_date + 9)`))[0]!;
    const log = await rows(admin, `select actor_id, action, target_table, target_id from audit_log order by created_at, action`);
    const actions = log.map((r) => r.action);
    expect(actions.filter((a) => a === 'grant_unlock')).toHaveLength(1);
    expect(actions.filter((a) => a === 'create_cohort')).toHaveLength(1);
    const grant = log.find((r) => r.action === 'grant_unlock')!;
    expect(grant.actor_id).toBe(S1);
    expect(grant.target_table).toBe('unlocks');
    expect(grant.target_id).toBe((await rows(admin, `select id from unlocks where user_id=$1`, [A]))[0]!.id);
    expect(log.find((r) => r.action === 'create_cohort')!.target_id).toBe(created.id);
    const everything = JSON.stringify(await rows(admin, `select * from audit_log`));
    expect(everything).not.toContain(SECRET);
    expect(Object.keys((await rows(admin, `select * from audit_log limit 1`))[0]!).sort()).toEqual(
      ['action', 'actor_id', 'created_at', 'id', 'target_id', 'target_table'],
    );
  });
  test('a supervisor reads only their own audit rows; students and anon read none', async () => {
    expect((await rows(as(S1), `select actor_id from audit_log`)).every((r) => r.actor_id === S1)).toBe(true);
    expect(await rows(as(S2), `select * from audit_log`)).toEqual([]);
    expect(await rows(as(A), `select * from audit_log`)).toEqual([]);
    await expect(as(null).query(`select * from audit_log`)).rejects.toThrow();
  });
  test('nobody can write audit_log directly', async () => {
    await expect(as(S1).query(`insert into audit_log (actor_id, action, target_table) values ($1,'x','y')`, [S1])).rejects.toThrow();
    await expect(as(A).query(`insert into audit_log (actor_id, action, target_table) values ($1,'x','y')`, [A])).rejects.toThrow();
    await as(S1).query(`delete from audit_log`).catch(() => {});
    expect((await rows(admin, `select count(*)::int n from audit_log`))[0]!.n).toBeGreaterThan(0);
  });
});

describe('student_activity view', () => {
  test('supervisor sees the latest activity of own cohort only', async () => {
    const got = await rows(as(S1), `select user_id, last_active_at from student_activity order by user_id`);
    expect(got.map((r) => r.user_id)).toEqual([A, B]);
    expect(new Date(got[0]!.last_active_at as string).toISOString()).toBe('2026-03-10T00:00:00.000Z'); // the reflection
    expect(new Date(got[1]!.last_active_at as string).toISOString()).toBe('2026-02-01T00:00:00.000Z');
  });
  test('another supervisor sees none of them; a student sees only own; anon is denied', async () => {
    expect((await rows(as(S2), `select user_id from student_activity`)).map((r) => r.user_id)).toEqual([X]);
    expect((await rows(as(A), `select user_id from student_activity`)).map((r) => r.user_id)).toEqual([A]);
    await expect(as(null).query(`select * from student_activity`)).rejects.toThrow();
  });
});
