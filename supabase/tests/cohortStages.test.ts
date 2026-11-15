// @vitest-environment node
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createDb, type Client, type TestDb } from './harness';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const S1 = id(1), S2 = id(2), A = id(11), B = id(12), X = id(21), ORPHAN = id(31);
const C1 = id(101), C2 = id(102);

let db: TestDb;
let admin: Client;
const as = (u: string | null) => db.as(u);
const rows = async (c: Client, sql: string, p?: unknown[]) => (await c.query(sql, p)).rows;
const denied = async (p: Promise<unknown>) => { await expect(p).rejects.toThrow(); };
const open = (who: string, cohort: string, stage: string) =>
  as(who).query(`insert into cohort_stages (cohort_id, stage, opened_by) values ($1,$2,$3)`, [cohort, stage, who]);

beforeAll(async () => {
  db = await createDb();
  admin = db.admin;
  for (const u of [S1, S2, A, B, X, ORPHAN]) await admin.query(`insert into auth.users (id) values ($1)`, [u]);
  await admin.query(`insert into profiles (id, role, display_name) values ($1,'supervisor','S1'),($2,'supervisor','S2')`, [S1, S2]);
  await admin.query(
    `insert into cohorts (id, name, supervisor_id, invite_code, term_end) values ($1,'C1',$3,'AAAAAAAAAA',current_date+30),($2,'C2',$4,'BBBBBBBBBB',current_date+30)`,
    [C1, C2, S1, S2],
  );
  await admin.query(
    `insert into profiles (id, role, display_name, cohort_id) values ($1,'student','A',$4),($2,'student','B',$4),($3,'student','X',$5),($6,'student','Orphan',null)`,
    [A, B, X, C1, C2, ORPHAN],
  );
});
afterAll(() => db.close());

describe('cohort_stages: who may open and close a stage', () => {
  test('a supervisor opens a stage for their own cohort', async () => {
    await open(S1, C1, 'eft');
    expect(await rows(admin, `select cohort_id, stage, opened_by from cohort_stages`)).toEqual([{ cohort_id: C1, stage: 'eft', opened_by: S1 }]);
  });
  test('a supervisor cannot open a stage for another supervisor’s cohort', async () => {
    await denied(open(S1, C2, 'eft'));
    await denied(open(S2, C1, 'dbt'));
    expect((await rows(admin, `select count(*)::int n from cohort_stages`))[0]!.n).toBe(1);
  });
  test('opened_by cannot name someone else', async () => {
    await denied(as(S1).query(`insert into cohort_stages (cohort_id, stage, opened_by) values ($1,'dbt',$2)`, [C1, S2]));
  });
  test('opening the same stage twice is harmless', async () => {
    await as(S1).query(`insert into cohort_stages (cohort_id, stage, opened_by) values ($1,'eft',$2) on conflict do nothing`, [C1, S1]);
    expect((await rows(admin, `select count(*)::int n from cohort_stages where cohort_id=$1`, [C1]))[0]!.n).toBe(1);
  });
  test('foundations is never listed: it is always open', async () => {
    await denied(open(S1, C1, 'foundations'));
  });
  test.each(['', 'EFT', 'e ft', '../x', 'a/b', '-x'])('stage name %j is refused', async (name) => {
    await denied(open(S1, C1, name));
  });
  test('students, orphans and anon cannot open, close or change a stage', async () => {
    await denied(open(A, C1, 'dbt'));
    await denied(open(ORPHAN, C1, 'dbt'));
    await denied(as(null).query(`insert into cohort_stages (cohort_id, stage, opened_by) values ($1,'dbt',$2)`, [C1, S1]));
    // A delete or update by a student matches no row (or is refused outright); either way the row stays.
    await as(A).query(`delete from cohort_stages`).catch(() => {});
    await as(A).query(`update cohort_stages set stage = 'dbt'`).catch(() => {});
    expect(await rows(admin, `select stage from cohort_stages`)).toEqual([{ stage: 'eft' }]);
  });
  test('a supervisor cannot change a row once made (open and close only)', async () => {
    await as(S1).query(`update cohort_stages set stage = 'dbt'`).catch(() => {});
    expect(await rows(admin, `select stage from cohort_stages`)).toEqual([{ stage: 'eft' }]);
  });
});

describe('cohort_stages: who can read', () => {
  test('a student reads their own cohort’s stages, a classmate reads the same', async () => {
    expect(await rows(as(A), `select stage from cohort_stages`)).toEqual([{ stage: 'eft' }]);
    expect(await rows(as(B), `select stage from cohort_stages`)).toEqual([{ stage: 'eft' }]);
  });
  test('a student of another cohort sees nothing of it', async () => {
    expect(await rows(as(X), `select * from cohort_stages`)).toEqual([]);
  });
  test('a student with no cohort sees nothing', async () => {
    expect(await rows(as(ORPHAN), `select * from cohort_stages`)).toEqual([]);
  });
  test('a supervisor sees their own cohorts’ stages only', async () => {
    expect(await rows(as(S1), `select stage from cohort_stages`)).toEqual([{ stage: 'eft' }]);
    expect(await rows(as(S2), `select * from cohort_stages`)).toEqual([]);
  });
  test('anon cannot read', async () => {
    await denied(as(null).query(`select * from cohort_stages`));
  });
  test('each cohort has its own list', async () => {
    await open(S2, C2, 'dbt');
    expect(await rows(as(A), `select stage from cohort_stages`)).toEqual([{ stage: 'eft' }]);
    expect(await rows(as(X), `select stage from cohort_stages`)).toEqual([{ stage: 'dbt' }]);
  });
});

describe('cohort_stages: closing', () => {
  test('a supervisor cannot close another supervisor’s stage', async () => {
    await as(S1).query(`delete from cohort_stages where cohort_id = $1`, [C2]);
    expect((await rows(admin, `select count(*)::int n from cohort_stages where cohort_id=$1`, [C2]))[0]!.n).toBe(1);
  });
  test('a supervisor closes a stage of their own cohort; students stop seeing it', async () => {
    await as(S1).query(`delete from cohort_stages where cohort_id = $1 and stage = 'eft'`, [C1]);
    expect(await rows(as(A), `select * from cohort_stages`)).toEqual([]);
  });
  test('deleting a cohort removes its stages', async () => {
    await admin.query(`insert into cohorts (id, name, supervisor_id, invite_code, term_end) values ($1,'C3',$2,'CCCCCCCCCC',current_date+30)`, [id(103), S1]);
    await open(S1, id(103), 'eft');
    await admin.query(`delete from cohorts where id = $1`, [id(103)]);
    expect((await rows(admin, `select count(*)::int n from cohort_stages where cohort_id=$1`, [id(103)]))[0]!.n).toBe(0);
  });
});

describe('cohort_stages: audit', () => {
  test('opening and closing each leave one audit row without content', async () => {
    const log = await rows(admin, `select actor_id, action, target_table from audit_log where action in ('open_stage','close_stage') order by created_at, action`);
    const actions = log.map((r) => r.action);
    expect(actions.filter((a) => a === 'open_stage').length).toBeGreaterThanOrEqual(2);
    // One close by the supervisor; deleting a whole cohort also removes its rows, logged with no actor.
    expect(log.filter((r) => r.action === 'close_stage' && r.actor_id === S1)).toHaveLength(1);
    expect(log.every((r) => r.target_table === 'cohort_stages')).toBe(true);
  });
});
