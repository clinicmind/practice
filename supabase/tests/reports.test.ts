// @vitest-environment node
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createDb, type Client, type TestDb } from './harness';

// All names and text are fictional.
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const S1 = id(1), S2 = id(2), A = id(11), B = id(12), X = id(21);
const C1 = id(101), C2 = id(102);
const RA = id(201), RB = id(202), RX = id(203);

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
  // Reports are written by the Edge Function, which uses the service role: here, the owner connection.
  for (const [rid, uid] of [[RA, A], [RB, B], [RX, X]] as const) {
    await admin.query(
      `insert into reports (id, user_id, title, drive_file_id, deid_summary, delete_after) values ($1,$2,'Week 3',$3,'{"cjk-name":{"found":1,"rewritten":1,"notIdentifying":0}}',current_date+120)`,
      [rid, uid, `drive-${rid}`],
    );
  }
});
afterAll(() => db.close());

describe('reports: schema', () => {
  test('reports_enabled is off by default', async () => {
    expect(await rows(admin, `select reports_enabled from cohorts order by name`)).toEqual([{ reports_enabled: false }, { reports_enabled: false }]);
  });
  test('the table has no column for the report text', async () => {
    const cols = (await rows(admin, `select column_name from information_schema.columns where table_name = 'reports'`)).map((r) => r.column_name);
    expect(cols).toEqual(expect.arrayContaining(['id', 'user_id', 'title', 'drive_file_id', 'deid_summary', 'status', 'created_at', 'delete_after']));
    expect(cols).not.toContain('body');
    expect(cols).not.toContain('text');
  });
  test('status is submitted or reviewed; title and file id are bounded', async () => {
    await denied(admin.query(`insert into reports (user_id, title, drive_file_id, delete_after, status) values ($1,'t','f',current_date,'draft')`, [A]));
    await denied(admin.query(`insert into reports (user_id, title, drive_file_id, delete_after) values ($1,'','f',current_date)`, [A]));
    await denied(admin.query(`insert into reports (user_id, title, drive_file_id, delete_after) values ($1,repeat('x',101),'f',current_date)`, [A]));
    await denied(admin.query(`insert into reports (user_id, title, drive_file_id, delete_after) values ($1,'t','',current_date)`, [A]));
  });
});

describe('reports: who can read', () => {
  test('a student reads only their own reports', async () => {
    expect((await rows(as(A), `select id from reports`)).map((r) => r.id)).toEqual([RA]);
    expect((await rows(as(B), `select id from reports`)).map((r) => r.id)).toEqual([RB]);
  });
  test('a supervisor reads their own cohort only', async () => {
    expect((await rows(as(S1), `select id from reports order by id`)).map((r) => r.id)).toEqual([RA, RB]);
    expect((await rows(as(S2), `select id from reports`)).map((r) => r.id)).toEqual([RX]);
  });
  test('anon has no access at all', async () => {
    await denied(as(null).query(`select * from reports`));
    await denied(as(null).query(`select * from feedback`));
  });
});

describe('reports: students cannot write', () => {
  test('insert is refused', async () => {
    await denied(as(A).query(`insert into reports (user_id, title, drive_file_id, delete_after) values ($1,'t','f',current_date)`, [A]));
  });
  test('update and delete change nothing', async () => {
    await as(A).query(`update reports set title = 'changed', status = 'reviewed'`).catch(() => {});
    await as(A).query(`delete from reports`).catch(() => {});
    await as(S1).query(`update reports set title = 'changed'`).catch(() => {});
    await as(S1).query(`delete from reports`).catch(() => {});
    expect((await rows(admin, `select count(*)::int n from reports where title = 'Week 3'`))[0]!.n).toBe(3);
  });
  test('a student cannot enable reports for a cohort', async () => {
    await as(A).query(`update cohorts set reports_enabled = true`).catch(() => {});
    expect(await rows(admin, `select reports_enabled from cohorts where reports_enabled`)).toEqual([]);
  });
});

describe('feedback', () => {
  let FB_DRAFT: string, FB_RELEASED: string, FB_RB: string;
  beforeAll(async () => {
    const ins = async (report: string, status: string) =>
      (await rows(admin, `insert into feedback (report_id, author_id, scores, comments, status, released_at) values ($1,$2,'{"picture":3}','fictional comment',$3, case when $3='released' then now() end) returning id`, [report, S1, status]))[0]!.id as string;
    FB_DRAFT = await ins(RA, 'draft');
    FB_RELEASED = await ins(RA, 'released');
    FB_RB = await ins(RB, 'released');
  });
  test('a student sees released feedback on their own report only; drafts stay hidden', async () => {
    expect((await rows(as(A), `select id from feedback`)).map((r) => r.id)).toEqual([FB_RELEASED]);
    expect((await rows(as(A), `select id from feedback where id = $1`, [FB_DRAFT]))).toEqual([]);
  });
  test('a student cannot see released feedback on a classmate’s report', async () => {
    expect((await rows(as(B), `select id from feedback`)).map((r) => r.id)).toEqual([FB_RB]);
    expect(await rows(as(X), `select id from feedback`)).toEqual([]);
  });
  test('a supervisor reads, writes and releases feedback for their own cohort', async () => {
    expect((await rows(as(S1), `select id from feedback`))).toHaveLength(3);
    await as(S1).query(`insert into feedback (report_id, author_id, scores, comments) values ($1,$2,'{}','x')`, [RA, S1]);
    await as(S1).query(`update feedback set status = 'released', released_at = now() where id = $1`, [FB_DRAFT]);
    expect((await rows(as(A), `select id from feedback`))).toHaveLength(2);
  });
  test('a supervisor cannot touch another cohort’s feedback, nor sign as someone else', async () => {
    await denied(as(S1).query(`insert into feedback (report_id, author_id, scores, comments) values ($1,$2,'{}','x')`, [RX, S1]));
    await denied(as(S1).query(`insert into feedback (report_id, author_id, scores, comments) values ($1,$2,'{}','x')`, [RA, S2]));
    expect(await rows(as(S2), `select id from feedback where report_id = $1`, [RA])).toEqual([]);
    await as(S2).query(`update feedback set comments = 'hijack'`).catch(() => {});
    expect(await rows(admin, `select 1 from feedback where comments = 'hijack'`)).toEqual([]);
  });
  test('a student cannot write feedback', async () => {
    await denied(as(A).query(`insert into feedback (report_id, author_id, scores, comments, status) values ($1,$2,'{}','x','released')`, [RA, A]));
    await as(A).query(`update feedback set comments = 'mine'`).catch(() => {});
    expect(await rows(admin, `select 1 from feedback where comments = 'mine'`)).toEqual([]);
  });
  test('feedback goes when its report goes', async () => {
    await admin.query(`delete from reports where id = $1`, [RB]);
    expect(await rows(admin, `select 1 from feedback where report_id = $1`, [RB])).toEqual([]);
  });
});
