// @vitest-environment node
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createDb, type Client, type TestDb } from './harness';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const S1 = id(1), S2 = id(2), A = id(11), B = id(12), X = id(21), NEWBIE = id(31);
const C1 = id(101), C2 = id(102), CPAST = id(103);
const CLIENT = (n: number) => id(1000 + n);

let db: TestDb;
let admin: Client;
const as = (u: string | null) => db.as(u);
const rows = async (c: Client, sql: string, p?: unknown[]) => (await c.query(sql, p)).rows;
const denied = async (p: Promise<unknown>) => { await expect(p).rejects.toThrow(); };
const insertAttempt = (c: Client, o: { user_id: string; client_id: string; response?: string }) =>
  c.query(
    `insert into attempts (user_id, client_id, item_id, response, criteria_met) values ($1,$2,'intake-e01',$3,'{t,t,f}')`,
    [o.user_id, o.client_id, o.response ?? 'hello there'],
  );

beforeAll(async () => {
  db = await createDb();
  admin = db.admin;
  for (const u of [S1, S2, A, B, X, NEWBIE]) await admin.query(`insert into auth.users (id) values ($1)`, [u]);
  await admin.query(`insert into profiles (id, role, display_name) values ($1,'supervisor','S1'),($2,'supervisor','S2')`, [S1, S2]);
  await admin.query(
    `insert into cohorts (id, name, supervisor_id, invite_code, term_end) values
     ($1,'C1',$3,'AAAAAAAAAA', current_date + 30),
     ($2,'C2',$4,'BBBBBBBBBB', current_date + 30),
     ($5,'Old',$3,'CCCCCCCCCC', current_date - 1)`,
    [C1, C2, S1, S2, CPAST],
  );
  await admin.query(
    `insert into profiles (id, role, display_name, cohort_id) values ($1,'student','A',$4),($2,'student','B',$4),($3,'student','X',$5)`,
    [A, B, X, C1, C2],
  );
  let n = 0;
  for (const u of [A, B, X]) {
    await insertAttempt(admin, { user_id: u, client_id: CLIENT(++n), response: `secret from ${u}` });
    await admin.query(`insert into decisions (user_id, client_id, session_id, decision_id, response) values ($1,$2,'s','d','x')`, [u, CLIENT(++n)]);
    await admin.query(`insert into reflections (user_id, client_id, module_slug, prompt_id, text) values ($1,$2,'intake','p','x')`, [u, CLIENT(++n)]);
  }
});
afterAll(() => db.close());

describe('students', () => {
  test('student reads only own attempts', async () => {
    expect(await rows(as(A), 'select user_id from attempts')).toEqual([{ user_id: A }]);
  });
  test('student cannot insert an attempt for someone else', () =>
    denied(insertAttempt(as(A), { user_id: B, client_id: CLIENT(900) })));
  test('student can insert own attempt, decision and reflection', async () => {
    await insertAttempt(as(A), { user_id: A, client_id: CLIENT(901) });
    await as(A).query(`insert into decisions (user_id, client_id, session_id, decision_id) values ($1,$2,'s','d2')`, [A, CLIENT(902)]);
    await as(A).query(`insert into reflections (user_id, client_id, module_slug, prompt_id, text) values ($1,$2,'intake','p2','t')`, [A, CLIENT(903)]);
  });
  test('student cannot update or delete attempts, decisions or reflections', async () => {
    for (const t of ['attempts', 'decisions', 'reflections']) {
      const col = t === 'attempts' ? 'response' : t === 'decisions' ? 'response' : 'text';
      await as(A).query(`update ${t} set ${col}='tampered' where user_id=$1`, [A]).catch(() => ({ affectedRows: 0 }));
      await as(A).query(`delete from ${t} where user_id=$1`, [A]).catch(() => ({ affectedRows: 0 }));
      const n = (await rows(admin, `select count(*)::int as n from ${t} where user_id=$1`, [A]))[0]!.n as number;
      expect(n).toBeGreaterThan(0);
      expect(await rows(admin, `select ${col} from ${t} where user_id=$1 and ${col}='tampered'`, [A])).toEqual([]);
    }
  });
  test('student cannot change own role or cohort', async () => {
    await as(A).query(`update profiles set role='supervisor' where id=$1`, [A]).catch(() => {});
    expect((await rows(admin, `select role from profiles where id=$1`, [A]))[0]!.role).toBe('student');
    await as(A).query(`update profiles set cohort_id=$1 where id=$2`, [C2, A]).catch(() => {});
    expect((await rows(admin, `select cohort_id from profiles where id=$1`, [A]))[0]!.cohort_id).toBe(C1);
  });
  test('role and cohort cannot change even if column privileges were widened', async () => {
    // Defence in depth: the trigger must refuse on its own.
    await admin.query(`grant update on profiles to authenticated`);
    try {
      await denied(as(A).query(`update profiles set role='supervisor' where id=$1`, [A]));
      await denied(as(A).query(`update profiles set cohort_id=$1 where id=$2`, [C2, A]));
    } finally {
      await admin.query(`revoke update on profiles from authenticated`);
      await admin.query(`grant update (display_name) on profiles to authenticated`);
    }
  });
  test('student can change own display_name', async () => {
    await as(A).query(`update profiles set display_name='Pseudonym' where id=$1`, [A]);
    expect((await rows(admin, `select display_name from profiles where id=$1`, [A]))[0]!.display_name).toBe('Pseudonym');
  });
  test('display_name must be 1-40 characters', async () => {
    await denied(as(A).query(`update profiles set display_name='' where id=$1`, [A]));
    await denied(as(A).query(`update profiles set display_name=$2 where id=$1`, [A, 'x'.repeat(41)]));
  });
  test('student cannot read cohorts, so the invite code stays private', async () => {
    expect(await rows(as(A), 'select * from cohorts')).toEqual([]);
  });
  test('student cannot read other profiles', async () => {
    expect(new Set((await rows(as(A), 'select id from profiles')).map((r) => r.id))).toEqual(new Set([A]));
  });
});

describe('supervisors', () => {
  test('supervisor reads own cohort only', async () => {
    const got = new Set((await rows(as(S1), 'select user_id from attempts')).map((r) => r.user_id));
    expect(got).toEqual(new Set([A, B]));
  });
  test('supervisor of another cohort reads nothing of A', async () => {
    for (const t of ['attempts', 'decisions', 'reflections', 'profiles']) {
      const col = t === 'profiles' ? 'id' : 'user_id';
      expect(await rows(as(S2), `select * from ${t} where ${col}=$1`, [A])).toEqual([]);
    }
  });
  test('supervisor cannot write student attempts', async () => {
    await denied(insertAttempt(as(S1), { user_id: A, client_id: CLIENT(910) }));
    await as(S1).query(`update attempts set response='x' where user_id=$1`, [A]).catch(() => {});
    await as(S1).query(`delete from attempts where user_id=$1`, [A]).catch(() => {});
    expect((await rows(admin, `select count(*)::int n from attempts where user_id=$1 and response='x'`, [A]))[0]!.n).toBe(0);
  });
  test('supervisor cannot promote a student or move them to another cohort', async () => {
    await as(S1).query(`update profiles set role='supervisor' where id=$1`, [B]).catch(() => {});
    await as(S1).query(`update profiles set cohort_id=$1 where id=$2`, [C2, B]).catch(() => {});
    const r = (await rows(admin, `select role, cohort_id from profiles where id=$1`, [B]))[0]!;
    expect(r).toEqual({ role: 'student', cohort_id: C1 });
  });
  test('supervisor reads own cohorts only', async () => {
    expect(new Set((await rows(as(S1), 'select id from cohorts')).map((r) => r.id))).toEqual(new Set([C1, CPAST]));
  });
  test('supervisor cannot insert, update or delete cohorts directly', async () => {
    await denied(as(S1).query(`insert into cohorts (name, supervisor_id, invite_code, term_end) values ('n',$1,'ZZZZZZZZZZ',current_date+1)`, [S1]));
    await as(S1).query(`update cohorts set term_end=current_date+999 where id=$1`, [C1]).catch(() => {});
    await as(S1).query(`delete from cohorts where id=$1`, [C1]).catch(() => {});
    expect((await rows(admin, `select count(*)::int n from cohorts where id=$1 and term_end < current_date+100`, [C1]))[0]!.n).toBe(1);
  });
});

describe('anon', () => {
  test('anon reads nothing from any table', async () => {
    const tables = (await rows(admin, `select tablename from pg_tables where schemaname='public'`)).map((r) => r.tablename as string);
    expect(tables.length).toBeGreaterThanOrEqual(7);
    for (const t of tables) {
      const got = await as(null).query(`select * from ${t}`).then((r) => r.rows, () => []);
      expect(got, t).toEqual([]);
    }
  });
  test('anon cannot call join_cohort or create_cohort', async () => {
    await denied(as(null).query(`select * from join_cohort('AAAAAAAAAA','x')`));
    await denied(as(null).query(`select * from create_cohort('x', current_date+1)`));
  });
});

describe('unlocks', () => {
  test('supervisor grants for own student only; student reads own; student cannot insert', async () => {
    await as(S1).query(`insert into unlocks (user_id, module_slug, level, granted_by) values ($1,'intake','medium',$2)`, [A, S1]);
    await denied(as(S1).query(`insert into unlocks (user_id, module_slug, level, granted_by) values ($1,'intake','medium',$2)`, [X, S1]));
    await denied(as(S2).query(`insert into unlocks (user_id, module_slug, level, granted_by) values ($1,'intake','hard',$2)`, [A, S2]));
    await denied(as(A).query(`insert into unlocks (user_id, module_slug, level, granted_by) values ($1,'intake','hard',$1)`, [A]));
    expect(await rows(as(A), 'select user_id, module_slug, level from unlocks')).toEqual([{ user_id: A, module_slug: 'intake', level: 'medium' }]);
    expect(await rows(as(B), 'select * from unlocks')).toEqual([]);
    expect(await rows(as(S2), 'select * from unlocks')).toEqual([]);
  });
  test('granted_by cannot be forged', async () => {
    await denied(as(S1).query(`insert into unlocks (user_id, module_slug, level, granted_by) values ($1,'intake','hard',$2)`, [B, S2]));
  });
});

describe('join_cohort', () => {
  const join = (u: string, code: string, name = 'Newbie') =>
    as(u).query(`select cohort_id, error_code from join_cohort($1,$2)`, [code, name]).then((r) => r.rows[0]!);

  test('valid code creates a student profile', async () => {
    const r = await join(NEWBIE, 'aaaaaaaaaa'); // case-insensitive
    expect(r).toEqual({ cohort_id: C1, error_code: null });
    expect(await rows(admin, `select role, cohort_id, display_name from profiles where id=$1`, [NEWBIE])).toEqual([
      { role: 'student', cohort_id: C1, display_name: 'Newbie' },
    ]);
  });
  test('joining twice is a no-op and keeps the first cohort', async () => {
    const r = await join(NEWBIE, 'BBBBBBBBBB', 'Other');
    expect(r.error_code).toBeNull();
    expect(r.cohort_id).toBe(C1);
    expect((await rows(admin, `select cohort_id, display_name from profiles where id=$1`, [NEWBIE]))[0]).toEqual({ cohort_id: C1, display_name: 'Newbie' });
  });
  test('a supervisor calling it stays a supervisor', async () => {
    await join(S2, 'AAAAAAAAAA');
    expect((await rows(admin, `select role from profiles where id=$1`, [S2]))[0]!.role).toBe('supervisor');
  });
  test('display name is trimmed and must be 1-40 characters', async () => {
    const U = id(40);
    await admin.query(`insert into auth.users (id) values ($1)`, [U]);
    expect((await join(U, 'AAAAAAAAAA', '   ')).error_code).toBe('invalid_display_name');
    expect((await join(U, 'AAAAAAAAAA', 'x'.repeat(41))).error_code).toBe('invalid_display_name');
    expect((await rows(admin, `select 1 from profiles where id=$1`, [U]))).toEqual([]);
    expect((await join(U, 'AAAAAAAAAA', '  Pat  ')).error_code).toBeNull();
    expect((await rows(admin, `select display_name from profiles where id=$1`, [U]))[0]!.display_name).toBe('Pat');
  });
  test('past term_end returns cohort_closed and creates no profile', async () => {
    const U = id(41);
    await admin.query(`insert into auth.users (id) values ($1)`, [U]);
    expect(await join(U, 'CCCCCCCCCC')).toEqual({ cohort_id: null, error_code: 'cohort_closed' });
    expect(await rows(admin, `select 1 from profiles where id=$1`, [U])).toEqual([]);
  });
  test('wrong code returns invalid_code', async () => {
    const U = id(42);
    await admin.query(`insert into auth.users (id) values ($1)`, [U]);
    expect(await join(U, 'NOPE')).toEqual({ cohort_id: null, error_code: 'invalid_code' });
    expect(await rows(admin, `select 1 from profiles where id=$1`, [U])).toEqual([]);
  });
  test('11th failure within an hour returns rate_limited, even with a right code', async () => {
    const U = id(43);
    await admin.query(`insert into auth.users (id) values ($1)`, [U]);
    for (let i = 0; i < 10; i++) expect((await join(U, `WRONG${i}`)).error_code).toBe('invalid_code');
    expect((await join(U, 'WRONG10')).error_code).toBe('rate_limited');
    expect((await join(U, 'AAAAAAAAAA')).error_code).toBe('rate_limited');
    expect(await rows(admin, `select 1 from profiles where id=$1`, [U])).toEqual([]);
  });
  test('failures are counted per account and expire after an hour', async () => {
    const U = id(44), V = id(45);
    for (const u of [U, V]) await admin.query(`insert into auth.users (id) values ($1)`, [u]);
    for (let i = 0; i < 10; i++) await join(U, `WRONG${i}`);
    expect((await join(V, 'AAAAAAAAAA')).error_code).toBeNull();
    await admin.query(`update join_attempts set created_at = now() - interval '61 minutes' where user_id=$1`, [U]);
    expect((await join(U, 'AAAAAAAAAA')).error_code).toBeNull();
  });
  test('users cannot read or write join_attempts', async () => {
    await denied(as(A).query('select * from join_attempts'));
    await denied(as(A).query(`delete from join_attempts`));
    await denied(as(A).query(`insert into join_attempts (user_id, ok) values ($1, true)`, [A]));
  });
});

describe('create_cohort', () => {
  test('denied for students', async () => {
    await denied(as(A).query(`select * from create_cohort('x', current_date + 5)`));
  });
  test('code is 10 chars from the allowed set and unique', async () => {
    const codes = new Set<string>();
    for (let i = 0; i < 30; i++) {
      const r = (await rows(as(S1), `select id, invite_code from create_cohort('Gen ' || $1::text, current_date + 5)`, [i]))[0]!;
      const code = r.invite_code as string;
      expect(code).toMatch(/^[A-HJ-NP-Z2-9]{10}$/);
      expect(code).not.toMatch(/[0O1Il]/);
      codes.add(code);
    }
    expect(codes.size).toBe(30);
  });
  test('rejects past term end and empty name', async () => {
    await denied(as(S1).query(`select * from create_cohort('x', current_date - 1)`));
    await denied(as(S1).query(`select * from create_cohort('   ', current_date + 1)`));
  });
  test('writes an audit_log row without any response text', async () => {
    const r = (await rows(as(S1), `select id from create_cohort('Audited', current_date + 5)`))[0]!;
    const log = await rows(admin, `select actor_id, action, target_table, target_id from audit_log where target_id=$1`, [r.id]);
    expect(log).toEqual([{ actor_id: S1, action: 'create_cohort', target_table: 'cohorts', target_id: r.id }]);
  });
});

describe('idempotent import', () => {
  test('same client_id inserted twice yields one row', async () => {
    const sql = `insert into attempts (user_id, client_id, item_id, response, criteria_met) values ($1,$2,'intake-e02','r','{t,t,t}') on conflict (user_id, client_id) do nothing`;
    await as(A).query(sql, [A, CLIENT(950)]);
    await as(A).query(sql, [A, CLIENT(950)]);
    expect((await rows(admin, `select count(*)::int n from attempts where client_id=$1`, [CLIENT(950)]))[0]!.n).toBe(1);
  });
  test('the same client_id from two users is two rows', async () => {
    await insertAttempt(as(B), { user_id: B, client_id: CLIENT(951) });
    await insertAttempt(as(A), { user_id: A, client_id: CLIENT(951) });
    expect((await rows(admin, `select count(*)::int n from attempts where client_id=$1`, [CLIENT(951)]))[0]!.n).toBe(2);
  });
  test('criteria_met must have exactly 3 entries', async () => {
    await denied(as(A).query(`insert into attempts (user_id, client_id, item_id, response, criteria_met) values ($1,$2,'i','r','{t,t}')`, [A, CLIENT(952)]));
  });
});

describe('structure', () => {
  test('every public table has RLS enabled', async () => {
    expect(await rows(admin, `select relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity`)).toEqual([]);
  });
  test('every security definer function sets search_path', async () => {
    const bad = await rows(admin, `
      select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.prosecdef
        and not exists (select 1 from unnest(coalesce(p.proconfig,'{}')) c where c like 'search_path=%')`);
    expect(bad).toEqual([]);
    const defs = await rows(admin, `select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef`);
    expect(defs.length).toBeGreaterThanOrEqual(3);
  });
  test('attempts, decisions and reflections have no update or delete policy or privilege', async () => {
    expect(await rows(admin, `select tablename, cmd from pg_policies where schemaname='public' and tablename in ('attempts','decisions','reflections') and cmd in ('UPDATE','DELETE','ALL')`)).toEqual([]);
    for (const t of ['attempts', 'decisions', 'reflections']) {
      for (const priv of ['UPDATE', 'DELETE', 'TRUNCATE']) {
        expect((await rows(admin, `select has_table_privilege('authenticated', $1, $2) as ok`, [t, priv]))[0]!.ok, `${t} ${priv}`).toBe(false);
      }
    }
  });
  test('anon has no privileges on any public table', async () => {
    expect(await rows(admin, `select table_name from information_schema.role_table_grants where grantee='anon' and table_schema='public'`)).toEqual([]);
  });
});
