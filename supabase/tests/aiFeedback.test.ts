// @vitest-environment node
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createDb, type Client, type TestDb } from './harness';

// Phase 4 (AI feedback): who can read what, and that nobody but the service role can write.
// All names and text are fictional.
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const S1 = id(1), S2 = id(2), A = id(11), B = id(12), X = id(21);
const C1 = id(101), C2 = id(102);
const TA = id(301), TA2 = id(302), TB = id(303), TX = id(304); // attempts
const FULL = '{"picture":3,"formulation":2,"link":3,"process":4,"self":2,"ethics":3}';

const out = (met: [boolean, boolean, boolean], concern = 'none') =>
  JSON.stringify({ criteria: met.map((m) => ({ met: m, evidence: m ? 'fictional quote' : '' })), suggestion: 'fictional suggestion', concern });

let db: TestDb;
let admin: Client;
const as = (u: string | null) => db.as(u);
const rows = async (c: Client, sql: string, p?: unknown[]) => (await c.query(sql, p)).rows;
const denied = async (p: Promise<unknown>) => { await expect(p).rejects.toThrow(); };

beforeAll(async () => {
  db = await createDb();
  admin = db.admin;
  for (const u of [S1, S2, A, B, X]) await admin.query(`insert into auth.users (id) values ($1)`, [u]);
  await admin.query(`insert into profiles (id, role, display_name) values ($1,'supervisor','S1'),($2,'supervisor','S2')`, [S1, S2]);
  await admin.query(
    `insert into cohorts (id, name, supervisor_id, invite_code, term_end) values ($1,'C1',$3,'AAAAAAAAAA',current_date+30),($2,'C2',$4,'BBBBBBBBBB',current_date+30)`,
    [C1, C2, S1, S2],
  );
  await admin.query(
    `insert into profiles (id, role, display_name, cohort_id) values ($1,'student','A',$4),($2,'student','B',$4),($3,'student','X',$5)`,
    [A, B, X, C1, C2],
  );
  const attempt = (aid: string, uid: string, met: string) =>
    admin.query(`insert into attempts (id, user_id, client_id, item_id, response, criteria_met) values ($1,$2,gen_random_uuid(),'item-1','fictional response text here',$3)`, [aid, uid, met]);
  await attempt(TA, A, '{true,true,false}');
  await attempt(TA2, A, '{true,true,true}');
  await attempt(TB, B, '{true,false,false}');
  await attempt(TX, X, '{true,true,true}');
  const fb = (aid: string, status: string, o: string | null) =>
    admin.query(`insert into ai_feedback (attempt_id, status, model, prompt_version, settings, output) values ($1,$2,'claude-haiku-5-5','p1','{}',$3)`, [aid, status, o]);
  await fb(TA, 'done', out([true, false, false]));          // criterion 2: self true, AI false; criterion 3 agrees
  await fb(TA2, 'pending', null);
  await fb(TB, 'done', out([true, false, true], 'risk-content')); // criterion 3: self false, AI true
  await fb(TX, 'done', out([true, true, true]));            // fully agrees
});
afterAll(() => db.close());

describe('ai_enabled', () => {
  test('defaults to false for every cohort', async () => {
    expect(await rows(admin, `select ai_enabled from cohorts`)).toEqual([{ ai_enabled: false }, { ai_enabled: false }]);
  });
  test('neither a supervisor nor a student can change it through the app', async () => {
    await as(S1).query(`update cohorts set ai_enabled = true`).catch(() => {});
    await as(A).query(`update cohorts set ai_enabled = true`).catch(() => {});
    expect(await rows(admin, `select 1 from cohorts where ai_enabled`)).toEqual([]);
  });
});

describe('ai_feedback', () => {
  test('a student cannot insert, update or delete', async () => {
    await denied(as(A).query(`insert into ai_feedback (attempt_id, status) values ($1,'pending')`, [TB]));
    await denied(as(A).query(`update ai_feedback set output = '{}'`));
    await denied(as(A).query(`delete from ai_feedback`));
    await denied(as(S1).query(`update ai_feedback set output = '{}'`));
    await denied(as(S1).query(`delete from ai_feedback`));
    expect(await rows(admin, `select count(*)::int n from ai_feedback`)).toEqual([{ n: 4 }]);
  });
  test('a student reads their own done feedback only: not a classmate’s, not a pending row', async () => {
    expect((await rows(as(A), `select attempt_id from ai_feedback`)).map((r) => r.attempt_id)).toEqual([TA]);
    expect((await rows(as(B), `select attempt_id from ai_feedback`)).map((r) => r.attempt_id)).toEqual([TB]);
    expect(await rows(as(A), `select 1 from ai_feedback where attempt_id = $1`, [TA2])).toEqual([]);
  });
  test('a supervisor reads their own cohort’s feedback and not another cohort’s', async () => {
    expect((await rows(as(S1), `select attempt_id from ai_feedback order by attempt_id`)).map((r) => r.attempt_id)).toEqual([TA, TB]);
    expect((await rows(as(S2), `select attempt_id from ai_feedback`)).map((r) => r.attempt_id)).toEqual([TX]);
  });
  test('one row per attempt: a second insert for the same attempt fails', async () => {
    await denied(admin.query(`insert into ai_feedback (attempt_id, status) values ($1,'pending')`, [TA]));
  });
  test('status and output agree: done has output, pending has none; status is one of two values', async () => {
    await denied(admin.query(`insert into ai_feedback (attempt_id, status) values ($1,'done')`, [TB]));
    await denied(admin.query(`insert into ai_feedback (attempt_id, status, output) values ($1,'pending','{}')`, [TB]));
    await denied(admin.query(`insert into ai_feedback (attempt_id, status) values ($1,'draft')`, [TB]));
  });
  test('the row goes when its attempt goes', async () => {
    const t = id(399);
    await admin.query(`insert into attempts (id, user_id, client_id, item_id, response, criteria_met) values ($1,$2,gen_random_uuid(),'item-1','x','{true,true,true}')`, [t, A]);
    await admin.query(`insert into ai_feedback (attempt_id, status) values ($1,'pending')`, [t]);
    await admin.query(`delete from attempts where id = $1`, [t]);
    expect(await rows(admin, `select 1 from ai_feedback where attempt_id = $1`, [t])).toEqual([]);
  });
});

describe('ai_usage', () => {
  let U1: string;
  beforeAll(async () => {
    U1 = (await rows(admin, `insert into ai_usage (user_id, cohort_id, kind, model, prompt_version, input_tokens, output_tokens, cache_write_tokens, cache_read_tokens, cost_usd, outcome, counted) values ($1,$2,'practice','claude-haiku-5-5','p1',100,50,0,900,0.0003,'ok',true) returning id`, [A, C1]))[0]!.id as string;
    await admin.query(`insert into ai_usage (user_id, cohort_id, kind, model, prompt_version, input_tokens, output_tokens, cache_write_tokens, cache_read_tokens, cost_usd, outcome, counted) values ($1,$2,'practice','claude-haiku-5-5','p1',100,50,0,900,0.0003,'ok',true)`, [X, C2]);
  });
  test('has no text column', async () => {
    const cols = (await rows(admin, `select column_name from information_schema.columns where table_name = 'ai_usage'`)).map((r) => r.column_name as string);
    expect(cols.sort()).toEqual(['cache_read_tokens', 'cache_write_tokens', 'cohort_id', 'cost_usd', 'counted', 'created_at', 'id', 'input_tokens', 'kind', 'model', 'outcome', 'output_tokens', 'prompt_version', 'user_id']);
    // The only text-typed columns are short labels, each bounded by a check constraint.
    const text = (await rows(admin, `select column_name from information_schema.columns where table_name = 'ai_usage' and data_type in ('text','character varying','json','jsonb')`)).map((r) => r.column_name as string);
    expect(text.sort()).toEqual(['kind', 'model', 'outcome', 'prompt_version']);
    await denied(admin.query(`insert into ai_usage (kind, model, outcome) values ('practice', repeat('x', 61), 'ok')`));
  });
  test('kind and outcome only take the listed values', async () => {
    await denied(admin.query(`insert into ai_usage (kind, model, outcome) values ('chat','m','ok')`));
    await denied(admin.query(`insert into ai_usage (kind, model, outcome) values ('practice','m','whatever')`));
  });
  test('a student cannot read it and cannot write it', async () => {
    expect(await rows(as(A), `select * from ai_usage`)).toEqual([]);
    await denied(as(A).query(`insert into ai_usage (kind, model, outcome) values ('practice','m','ok')`));
  });
  test('a supervisor reads their own cohort’s rows only and cannot write', async () => {
    expect((await rows(as(S1), `select id from ai_usage`)).map((r) => r.id)).toEqual([U1]);
    expect(await rows(as(S2), `select 1 from ai_usage where id = $1`, [U1])).toEqual([]);
    await denied(as(S1).query(`insert into ai_usage (kind, model, outcome) values ('practice','m','ok')`));
    await denied(as(S1).query(`update ai_usage set cost_usd = 0`));
    await denied(as(S1).query(`delete from ai_usage`));
  });
  test('a supervisor also reads the eval rows they wrote themselves', async () => {
    await admin.query(`insert into ai_usage (user_id, kind, model, outcome, counted) values ($1,'eval','claude-haiku-5-5','ok',false)`, [S2]);
    expect((await rows(as(S2), `select kind from ai_usage order by kind`)).map((r) => r.kind)).toEqual(['eval', 'practice']);
    expect((await rows(as(S1), `select kind from ai_usage`)).map((r) => r.kind)).toEqual(['practice']);
  });
});

describe('ai_budget', () => {
  test('exactly one row, preset to 0 (everything stopped until the owner sets a number)', async () => {
    expect(await rows(admin, `select monthly_limit_usd::float8 as l, warn_at::float8 as w from ai_budget`)).toEqual([{ l: 0, w: 0.8 }]);
    await denied(admin.query(`insert into ai_budget (id, monthly_limit_usd) values (false, 5)`));
    await denied(admin.query(`insert into ai_budget (id, monthly_limit_usd) values (true, 5)`));
  });
  test('a supervisor reads it; a student does not; nobody writes through the app', async () => {
    expect(await rows(as(S1), `select monthly_limit_usd::float8 as l from ai_budget`)).toEqual([{ l: 0 }]);
    expect(await rows(as(A), `select 1 from ai_budget`).catch(() => [])).toEqual([]);
    await denied(as(S1).query(`update ai_budget set monthly_limit_usd = 1000`));
    await denied(as(A).query(`update ai_budget set monthly_limit_usd = 1000`));
    expect(await rows(admin, `select monthly_limit_usd::float8 as l from ai_budget`)).toEqual([{ l: 0 }]);
  });
  test('the limit cannot be negative', async () => {
    await denied(admin.query(`update ai_budget set monthly_limit_usd = -1`));
  });
});

describe('anon', () => {
  test('has no privilege on any of the new tables or the view', async () => {
    for (const t of ['ai_feedback', 'ai_usage', 'ai_budget', 'ai_disagreements']) {
      await denied(as(null).query(`select * from ${t}`));
    }
    await denied(as(null).query(`insert into ai_feedback (attempt_id, status) values ($1,'pending')`, [TB]));
  });
});

describe('ai_disagreements', () => {
  test('lists only criteria where the self-rating and the AI differ, with their direction', async () => {
    const r = await rows(as(S1), `select user_id, criterion_index, self_met, ai_met from ai_disagreements order by user_id, criterion_index`);
    expect(r).toEqual([
      { user_id: A, criterion_index: 2, self_met: true, ai_met: false },
      { user_id: B, criterion_index: 3, self_met: false, ai_met: true },
    ]);
  });
  test('a pending row produces nothing', async () => {
    expect(await rows(as(S1), `select 1 from ai_disagreements where attempt_id = $1`, [TA2])).toEqual([]);
  });
  test('scoped to the caller: a supervisor sees their cohort, a student sees only their own, anon nothing', async () => {
    expect(await rows(as(S2), `select 1 from ai_disagreements`)).toEqual([]); // X agrees fully
    expect(await rows(as(A), `select user_id from ai_disagreements`)).toEqual([{ user_id: A }]);
    expect(await rows(as(B), `select user_id from ai_disagreements`)).toEqual([{ user_id: B }]);
  });
  test('carries no response text and no evidence', async () => {
    const cols = (await rows(admin, `select column_name from information_schema.columns where table_name = 'ai_disagreements'`)).map((r) => r.column_name as string).sort();
    expect(cols).toEqual(['ai_met', 'attempt_id', 'criterion_index', 'item_id', 'self_met', 'user_id']);
  });
});

describe('report feedback drafts (author_id null) stay invisible to students', () => {
  test('even after the report is marked reviewed and other feedback is released', async () => {
    const R = id(401);
    await admin.query(`insert into reports (id, user_id, title, drive_file_id, delete_after) values ($1,$2,'Week 3','drive-1',current_date+120)`, [R, A]);
    const draft = (await rows(admin, `insert into feedback (report_id, author_id, scores, comments, status) values ($1,null,'{}','fictional AI draft','draft') returning id`, [R]))[0]!.id as string;
    expect(await rows(as(A), `select 1 from feedback where id = $1`, [draft])).toEqual([]);
    await admin.query(`insert into feedback (report_id, author_id, scores, comments, status, released_at) values ($1,$2,'${FULL}','supervisor text','released', now())`, [R, S1]);
    expect((await rows(admin, `select status from reports where id = $1`, [R]))[0]).toEqual({ status: 'reviewed' });
    expect(await rows(as(A), `select 1 from feedback where id = $1`, [draft])).toEqual([]);
    expect(await rows(as(A), `select comments from feedback`)).toEqual([{ comments: 'supervisor text' }]);
  });
});
