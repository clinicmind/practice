// @vitest-environment node
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createDb, type Client, type TestDb } from './harness';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const S1 = id(1), A = id(11), ORPHAN = id(12);
const C1 = id(101);
let db: TestDb;
let admin: Client;
const as = (u: string | null) => db.as(u);
const denied = async (p: Promise<unknown>) => { await expect(p).rejects.toThrow(); };

beforeAll(async () => {
  db = await createDb();
  admin = db.admin;
  for (const u of [S1, A, ORPHAN]) await admin.query(`insert into auth.users (id) values ($1)`, [u]);
  await admin.query(`insert into profiles (id, role, display_name) values ($1,'supervisor','S1')`, [S1]);
  await admin.query(`insert into cohorts (id, name, supervisor_id, invite_code, term_end) values ($1,'C1',$2,'AAAAAAAAAA', current_date + 30)`, [C1, S1]);
  await admin.query(`insert into profiles (id, role, display_name, cohort_id) values ($1,'student','A',$2)`, [A, C1]);
  await admin.query(`insert into profiles (id, role, display_name, cohort_id) values ($1,'student','Orphan',null)`, [ORPHAN]);
});
afterAll(() => db.close());

describe('timestamps', () => {
  // "Latest attempt wins", so a future timestamp would pin one attempt as the latest for ever.
  test.each([
    ['attempts', `insert into attempts (user_id, client_id, item_id, response, criteria_met, created_at) values ($1,$2,'i','r','{t,t,f}','2099-01-01') returning created_at`],
    ['decisions', `insert into decisions (user_id, client_id, session_id, decision_id, created_at) values ($1,$2,'s','d','2099-01-01') returning created_at`],
    ['reflections', `insert into reflections (user_id, client_id, module_slug, prompt_id, text, created_at) values ($1,$2,'m','p','t','2099-01-01') returning created_at`],
  ])('%s clamps a future created_at to now', async (_t, sql) => {
    const r = await as(A).query(sql, [A, id(Math.floor(Math.random() * 1e6) + 5000)]);
    const t = new Date(r.rows[0].created_at as string).getTime();
    expect(t).toBeGreaterThan(Date.now() - 60_000);
    expect(t).toBeLessThan(Date.now() + 60_000);
  });
  test('a past created_at is kept, so imported local progress keeps its dates', async () => {
    const r = await as(A).query(
      `insert into attempts (user_id, client_id, item_id, response, criteria_met, created_at) values ($1,$2,'i','r','{t,t,f}','2026-10-01T10:00:00Z') returning created_at`,
      [A, id(6999)]);
    expect(new Date(r.rows[0].created_at as string).toISOString()).toBe('2026-10-01T10:00:00.000Z');
  });
});

describe('size limits', () => {
  test('response over 5000 characters is refused; 5000 is accepted', async () => {
    const ins = (n: number, c: number) => as(A).query(
      `insert into attempts (user_id, client_id, item_id, response, criteria_met) values ($1,$2,'i',$3,'{t,t,f}')`, [A, id(c), 'x'.repeat(n)]);
    await ins(5000, 7001);
    await denied(ins(5001, 7002));
  });
  test('reflection text and decision response over 5000 characters are refused', async () => {
    await denied(as(A).query(`insert into reflections (user_id, client_id, module_slug, prompt_id, text) values ($1,$2,'m','p',$3)`, [A, id(7003), 'x'.repeat(5001)]));
    await denied(as(A).query(`insert into decisions (user_id, client_id, session_id, decision_id, response) values ($1,$2,'s','d',$3)`, [A, id(7004), 'x'.repeat(5001)]));
  });
  test('identifiers over 100 characters are refused', async () => {
    await denied(as(A).query(`insert into attempts (user_id, client_id, item_id, response, criteria_met) values ($1,$2,$3,'r','{t,t,f}')`, [A, id(7005), 'i'.repeat(101)]));
    await denied(as(A).query(`insert into decisions (user_id, client_id, session_id, decision_id) values ($1,$2,$3,'d')`, [A, id(7006), 's'.repeat(101)]));
    await denied(as(A).query(`insert into reflections (user_id, client_id, module_slug, prompt_id, text) values ($1,$2,'m',$3,'t')`, [A, id(7007), 'p'.repeat(101)]));
  });
  test('criteria_met must be a flat array of three', async () => {
    await denied(as(A).query(`insert into attempts (user_id, client_id, item_id, response, criteria_met) values ($1,$2,'i','r','{{t,t},{f,f},{t,f}}')`, [A, id(7008)]));
  });
});

describe('anon', () => {
  test('anon holds no privilege on any public table or view', async () => {
    const r = await admin.query(
      `select table_name, privilege_type from information_schema.role_table_grants where grantee = 'anon' and table_schema = 'public'`);
    expect(r.rows).toEqual([]);
  });
});

describe('join_cohort', () => {
  test('a student whose cohort was removed can join again', async () => {
    const r = await as(ORPHAN).query(`select * from join_cohort('AAAAAAAAAA', 'Orphan')`);
    expect(r.rows[0]).toMatchObject({ cohort_id: C1, error_code: null });
    const p = await admin.query(`select cohort_id, role from profiles where id=$1`, [ORPHAN]);
    expect(p.rows[0]).toEqual({ cohort_id: C1, role: 'student' });
  });
  test('a student already in a cohort still keeps the first one', async () => {
    const C2 = id(102);
    await admin.query(`insert into cohorts (id, name, supervisor_id, invite_code, term_end) values ($1,'C2',$2,'BBBBBBBBBB', current_date + 30)`, [C2, S1]);
    const r = await as(A).query(`select * from join_cohort('BBBBBBBBBB', 'A')`);
    expect(r.rows[0]).toMatchObject({ cohort_id: C1 });
  });
  test('a supervisor without a cohort is not turned into a student', async () => {
    await as(S1).query(`select * from join_cohort('AAAAAAAAAA', 'S1')`);
    const p = await admin.query(`select role, cohort_id from profiles where id=$1`, [S1]);
    expect(p.rows[0]).toEqual({ role: 'supervisor', cohort_id: null });
  });
});
