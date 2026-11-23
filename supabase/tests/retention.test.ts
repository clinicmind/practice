// @vitest-environment node
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createDb, type Client, type TestDb } from './harness';

// All names and text are fictional. Covers 0006: expiry dates that follow the term, who may see
// expired reports, and the rules that make a released review complete and permanent.
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const S1 = id(1), S2 = id(2), A = id(11), B = id(12), X = id(21);
const C1 = id(101), C2 = id(102);
const RA = id(201), RB = id(202), RX = id(203);
const FULL = '{"picture":3,"formulation":2,"link":3,"process":4,"self":2,"ethics":3}';

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
    `insert into cohorts (id, name, supervisor_id, invite_code, term_end) values ($1,'C1',$3,'AAAAAAAAAA','2027-01-01'),($2,'C2',$4,'BBBBBBBBBB','2027-01-01')`,
    [C1, C2, S1, S2],
  );
  await admin.query(
    `insert into profiles (id, role, display_name, cohort_id) values ($1,'student','A',$4),($2,'student','B',$4),($3,'student','X',$5)`,
    [A, B, X, C1, C2],
  );
  // RA and RX are past their date on 2027-04-02; RB is not.
  const ins = (rid: string, uid: string, after: string) =>
    admin.query(`insert into reports (id, user_id, title, drive_file_id, delete_after) values ($1,$2,'Week 3',$3,$4)`, [rid, uid, `drive-${rid}`, after]);
  await ins(RA, A, '2027-04-01');
  await ins(RB, B, '2027-06-01');
  await ins(RX, X, '2027-04-01');
});
afterAll(() => db.close());

const expired = (c: Client, today: string) => rows(c, `select id, drive_file_id from reports where delete_after < $1::date order by id`, [today]);

describe('expired reports: who can see them', () => {
  test('a report is kept through its delete_after date and expires the day after', async () => {
    expect((await expired(admin, '2027-04-01')).map((r) => r.id)).toEqual([]);
    expect((await expired(admin, '2027-04-02')).map((r) => r.id)).toEqual([RA, RX]);
  });
  test('a supervisor sees only their own cohort’s expired reports', async () => {
    expect((await expired(as(S1), '2027-04-02')).map((r) => r.id)).toEqual([RA]);
    expect((await expired(as(S2), '2027-04-02')).map((r) => r.id)).toEqual([RX]);
  });
  test('a student sees only their own, and anon sees nothing', async () => {
    expect((await expired(as(A), '2027-04-02')).map((r) => r.id)).toEqual([RA]);
    expect(await expired(as(B), '2027-04-02')).toEqual([]);
    await denied(expired(as(null), '2027-04-02'));
  });
  test('nobody but the service role can delete a report or write the audit log', async () => {
    await as(S1).query(`delete from reports`).catch(() => {});
    await as(A).query(`delete from reports`).catch(() => {});
    expect((await rows(admin, `select count(*)::int n from reports`))[0]!.n).toBe(3);
    await denied(as(S1).query(`insert into audit_log (actor_id, action, target_table) values ($1,'purge_report','reports')`, [S1]));
  });
});

describe('delete_after follows the term', () => {
  test('changing term_end moves delete_after by 90 days for that cohort only', async () => {
    await admin.query(`update cohorts set term_end = '2027-02-01' where id = $1`, [C1]);
    expect(await rows(admin, `select id, delete_after::text d from reports order by id`)).toEqual([
      { id: RA, d: '2027-05-02' }, { id: RB, d: '2027-05-02' }, { id: RX, d: '2027-04-01' },
    ]);
  });
  test('a change to something else leaves delete_after alone', async () => {
    await admin.query(`update reports set delete_after = '2027-09-09' where id = $1`, [RB]);
    await admin.query(`update cohorts set name = 'C1 renamed' where id = $1`, [C1]);
    expect((await rows(admin, `select delete_after::text d from reports where id = $1`, [RB]))[0]!.d).toBe('2027-09-09');
  });
  test('a supervisor cannot change term_end through the app', async () => {
    await as(S1).query(`update cohorts set term_end = '2030-01-01'`).catch(() => {});
    expect((await rows(admin, `select term_end::text t from cohorts where id = $1`, [C1]))[0]!.t).toBe('2027-02-01');
  });
});

describe('feedback: scores and release', () => {
  const draft = (c: Client, report: string, author: string, scores: string, comments = 'fictional comment') =>
    c.query(`insert into feedback (report_id, author_id, scores, comments) values ($1,$2,$3,$4) returning id`, [report, author, scores, comments]);

  test('a draft may have some scores blank', async () => {
    await draft(as(S1), RA, S1, '{"picture":3}', '');
  });
  test('scores must be 1 to 4 for the six known dimensions', async () => {
    await denied(draft(as(S1), RB, S1, '{"picture":5}'));
    await denied(draft(as(S1), RB, S1, '{"picture":0}'));
    await denied(draft(as(S1), RB, S1, '{"picture":2.5}'));
    await denied(draft(as(S1), RB, S1, '{"picture":"3"}'));
    await denied(draft(as(S1), RB, S1, '{"vibes":3}'));
    await denied(draft(as(S1), RB, S1, '[3]'));
  });
  test('release needs all six scores and a comment', async () => {
    const fid = (await rows(admin, `select id from feedback where report_id = $1`, [RA]))[0]!.id;
    await denied(as(S1).query(`update feedback set status = 'released', released_at = now() where id = $1`, [fid]));
    await as(S1).query(`update feedback set scores = $2 where id = $1`, [fid, FULL]);
    await denied(as(S1).query(`update feedback set status = 'released', released_at = now() where id = $1`, [fid])); // comment is blank
    await as(S1).query(`update feedback set comments = '   ' where id = $1`, [fid]);
    await denied(as(S1).query(`update feedback set status = 'released', released_at = now() where id = $1`, [fid])); // blank is not a comment
    expect((await rows(admin, `select status from feedback where id = $1`, [fid]))[0]!.status).toBe('draft');
  });
  test('releasing marks the report reviewed and writes one audit row without any text', async () => {
    const fid = (await rows(admin, `select id from feedback where report_id = $1`, [RA]))[0]!.id as string;
    expect((await rows(admin, `select status from reports where id = $1`, [RA]))[0]!.status).toBe('submitted');
    await as(S1).query(`update feedback set comments = 'Fictional comment for release', status = 'released', released_at = now() where id = $1`, [fid]);
    expect((await rows(admin, `select status from reports where id = $1`, [RA]))[0]!.status).toBe('reviewed');
    const audit = await rows(admin, `select actor_id, action, target_table, target_id from audit_log where action = 'release_feedback'`);
    expect(audit).toEqual([{ actor_id: S1, action: 'release_feedback', target_table: 'feedback', target_id: fid }]);
    // Editing the released text afterwards is allowed and does not write a second release row.
    await as(S1).query(`update feedback set comments = 'Fictional comment, corrected' where id = $1`, [fid]);
    expect(await rows(admin, `select 1 from audit_log where action = 'release_feedback'`)).toHaveLength(1);
  });
  test('released feedback cannot be turned back into a draft', async () => {
    await denied(as(S1).query(`update feedback set status = 'draft' where report_id = $1`, [RA]));
  });
  test('the student sees it once released; the other student sees nothing', async () => {
    expect(await rows(as(A), `select comments from feedback`)).toEqual([{ comments: 'Fictional comment, corrected' }]);
    expect(await rows(as(B), `select 1 from feedback`)).toEqual([]);
  });
  test('releasing one report does not mark another reviewed', async () => {
    expect((await rows(admin, `select status from reports where id = $1`, [RB]))[0]!.status).toBe('submitted');
  });
  test('a supervisor of another cohort cannot release or even see it', async () => {
    await as(S2).query(`update feedback set comments = 'hijack'`).catch(() => {});
    expect(await rows(admin, `select 1 from feedback where comments = 'hijack'`)).toEqual([]);
    expect(await rows(as(S2), `select 1 from feedback`)).toEqual([]);
  });
  test('a student cannot mark their own report reviewed by any route', async () => {
    await denied(as(B).query(`insert into feedback (report_id, author_id, scores, comments, status, released_at) values ($1,$2,$3,'x','released',now())`, [RB, B, FULL]));
    await as(B).query(`update reports set status = 'reviewed'`).catch(() => {});
    expect((await rows(admin, `select status from reports where id = $1`, [RB]))[0]!.status).toBe('submitted');
  });
  test('the release trigger function cannot be called directly', async () => {
    await denied(as(S1).query(`select release_feedback_effects()`));
  });
});
