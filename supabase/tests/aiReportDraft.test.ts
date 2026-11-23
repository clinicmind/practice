// @vitest-environment node
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createDb, type Client, type TestDb } from './harness';

// Phase 4, task 12 (migration 0008): the AI report draft is visible to the supervisor of that cohort only,
// can never be released, and cannot be edited through the app. All names and text are fictional.
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const S1 = id(1), S2 = id(2), A = id(11), X = id(21);
const C1 = id(101), C2 = id(102);
const RA = id(401), RX = id(402); // reports
const FULL = '{"picture":3,"formulation":2,"link":3,"process":4,"self":2,"ethics":3}';

let db: TestDb;
let admin: Client;
const as = (u: string | null) => db.as(u);
const rows = async (c: Client, sql: string, p?: unknown[]) => (await c.query(sql, p)).rows;
const denied = async (p: Promise<unknown>) => { await expect(p).rejects.toThrow(); };

beforeAll(async () => {
  db = await createDb();
  admin = db.admin;
  for (const u of [S1, S2, A, X]) await admin.query(`insert into auth.users (id) values ($1)`, [u]);
  await admin.query(`insert into profiles (id, role, display_name) values ($1,'supervisor','S1'),($2,'supervisor','S2')`, [S1, S2]);
  await admin.query(
    `insert into cohorts (id, name, supervisor_id, invite_code, term_end) values ($1,'C1',$3,'AAAAAAAAAA',current_date+30),($2,'C2',$4,'BBBBBBBBBB',current_date+30)`,
    [C1, C2, S1, S2],
  );
  await admin.query(`insert into profiles (id, role, display_name, cohort_id) values ($1,'student','A',$3),($2,'student','X',$4)`, [A, X, C1, C2]);
  await admin.query(
    `insert into reports (id, user_id, title, drive_file_id, delete_after) values ($1,$2,'fictional report A','file-a',current_date+90),($3,$4,'fictional report X','file-x',current_date+90)`,
    [RA, A, RX, X],
  );
});
afterAll(() => db.close());

// The function writes with the service role (the admin client here).
const aiDraft = (report: string, comments = 'fictional draft comment') =>
  admin.query(`insert into feedback (report_id, author_id, ai_draft, scores, comments, status) values ($1, null, true, $2, $3, 'draft')`, [report, FULL, comments]);

describe('the AI draft row', () => {
  test('exists as a row with ai_draft true and no author', async () => {
    await aiDraft(RA);
    await aiDraft(RX);
    expect(await rows(admin, `select ai_draft, author_id, status from feedback where report_id = $1`, [RA])).toEqual([{ ai_draft: true, author_id: null, status: 'draft' }]);
  });
  test('only one AI draft per report', async () => {
    await denied(aiDraft(RA));
  });
  test('it can never be released, even by the service role', async () => {
    await denied(admin.query(`update feedback set status = 'released', released_at = now() where report_id = $1 and ai_draft`, [RA]));
    await denied(admin.query(`insert into feedback (report_id, author_id, ai_draft, scores, comments, status, released_at) values ($1, null, true, $2, 'x', 'released', now())`, [RX, FULL]));
  });
  test('it cannot be given an author (it would then look like the supervisor’s own)', async () => {
    await denied(admin.query(`update feedback set author_id = $1 where report_id = $2 and ai_draft`, [S1, RA]));
  });
});

describe('who can see it', () => {
  test('the supervisor of the cohort reads it', async () => {
    expect(await rows(as(S1), `select comments from feedback where report_id = $1`, [RA])).toEqual([{ comments: 'fictional draft comment' }]);
  });
  test('the supervisor of another cohort does not', async () => {
    expect(await rows(as(S2), `select 1 from feedback where report_id = $1`, [RA])).toEqual([]);
  });
  test('the student who wrote the report never does, by the table, by its columns, or by counting', async () => {
    expect(await rows(as(A), `select * from feedback`)).toEqual([]);
    expect(await rows(as(A), `select count(*)::int as n from feedback where report_id = $1`, [RA])).toEqual([{ n: 0 }]);
    expect(await rows(as(A), `select comments from feedback where ai_draft`)).toEqual([]);
  });
  test('another student does not', async () => {
    expect(await rows(as(X), `select 1 from feedback where report_id = $1`, [RA])).toEqual([]);
  });
  test('the reports list gives the student no hint of a draft (the row has the same columns as before)', async () => {
    const cols = Object.keys((await rows(as(A), `select * from reports`))[0]!).sort();
    expect(cols).toEqual(['created_at', 'deid_summary', 'delete_after', 'drive_file_id', 'id', 'status', 'title', 'user_id']);
  });
  test('nobody who is not signed in reads it', async () => {
    await denied(as(null).query(`select 1 from feedback`));
  });
});

describe('what a supervisor can do to it through the app', () => {
  test('cannot edit it', async () => {
    await as(S1).query(`update feedback set comments = 'changed', scores = '{}' where report_id = $1 and ai_draft`, [RA]);
    expect(await rows(admin, `select comments from feedback where report_id = $1 and ai_draft`, [RA])).toEqual([{ comments: 'fictional draft comment' }]);
  });
  test('cannot take it over by setting themselves as author, nor release it', async () => {
    await as(S1).query(`update feedback set author_id = $1, status = 'released', released_at = now() where report_id = $2 and ai_draft`, [S1, RA]).catch(() => {});
    expect(await rows(admin, `select author_id, status from feedback where report_id = $1 and ai_draft`, [RA])).toEqual([{ author_id: null, status: 'draft' }]);
  });
  test('cannot create a row flagged as an AI draft', async () => {
    await denied(as(S1).query(`insert into feedback (report_id, author_id, ai_draft, scores, comments) values ($1, $2, true, '{}', 'x')`, [RA, S1]));
  });
  test('releases their own, new row; the student then sees that row and not the AI draft', async () => {
    await as(S1).query(`insert into feedback (report_id, author_id, scores, comments, status, released_at) values ($1, $2, $3, 'supervisor words', 'released', now())`, [RA, S1, FULL]);
    expect(await rows(as(A), `select comments, author_id from feedback`)).toEqual([{ comments: 'supervisor words', author_id: S1 }]);
    expect(await rows(admin, `select status from feedback where report_id = $1 and ai_draft`, [RA])).toEqual([{ status: 'draft' }]);
  });
  test('an existing supervisor row can still be edited by that supervisor', async () => {
    await as(S1).query(`update feedback set comments = 'supervisor words, edited' where report_id = $1 and not ai_draft`, [RA]);
    expect(await rows(admin, `select comments from feedback where report_id = $1 and not ai_draft`, [RA])).toEqual([{ comments: 'supervisor words, edited' }]);
  });
  test('deleting a supervisor’s account is not blocked by their feedback (author becomes null; it is not flagged as AI)', async () => {
    const S3 = id(3);
    await admin.query(`insert into auth.users (id) values ($1)`, [S3]);
    await admin.query(`insert into feedback (report_id, author_id, scores, comments) values ($1, $2, '{}', 'fictional')`, [RX, S3]);
    await admin.query(`delete from auth.users where id = $1`, [S3]);
    expect(await rows(admin, `select author_id, ai_draft from feedback where comments = 'fictional'`)).toEqual([{ author_id: null, ai_draft: false }]);
  });
});

describe('ai_usage.subject_id (whose report the draft was for)', () => {
  test('is stored, readable by the supervisor of that cohort, and not by the student', async () => {
    await admin.query(`insert into ai_usage (user_id, cohort_id, subject_id, kind, model, outcome, counted) values ($1,$2,$3,'report_draft','claude-sonnet-5-5','ok',true)`, [S1, C1, A]);
    expect(await rows(as(S1), `select subject_id from ai_usage where kind = 'report_draft'`)).toEqual([{ subject_id: A }]);
    expect(await rows(as(A), `select 1 from ai_usage`)).toEqual([]);
  });
  test('is cleared, not the row, when the student account goes away (the month’s total stays right)', async () => {
    await admin.query(`delete from auth.users where id = $1`, [A]);
    expect(await rows(admin, `select subject_id from ai_usage where kind = 'report_draft'`)).toEqual([{ subject_id: null }]);
  });
  test('there is still no column that could hold text', async () => {
    const cols = (await rows(admin, `select column_name, data_type from information_schema.columns where table_name = 'ai_usage'`)).filter((c) => c.data_type === 'text');
    expect(cols.map((c) => c.column_name).sort()).toEqual(['kind', 'model', 'outcome', 'prompt_version']);
  });
});
