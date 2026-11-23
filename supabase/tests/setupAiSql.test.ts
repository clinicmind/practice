// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { createDb, type TestDb } from './harness';

// The SQL printed in docs/SETUP-ai.md is what the owner pastes. Run exactly that text against the migrated schema.
const doc = readFileSync(join(__dirname, '..', '..', 'docs', 'SETUP-ai.md'), 'utf8');
const blocks = [...doc.matchAll(/```sql\n([\s\S]*?)```/g)].map((m) => m[1]!);
let db: TestDb;
beforeAll(async () => { db = await createDb(); });
afterAll(() => db.close());

test('the document has the SQL the plan asks for: check, budget, switch on and off, usage, one-click off', () => {
  const all = blocks.join('\n');
  for (const needle of ['select * from ai_budget', 'update ai_budget set monthly_limit_usd =', 'update cohorts set ai_enabled = true where name', 'update cohorts set ai_enabled = false', 'from ai_usage']) expect(all, needle).toContain(needle);
});

test('every SQL block runs on the migrated schema, as the owner would paste it', async () => {
  const sup = '00000000-0000-4000-8000-000000000001';
  await db.admin.query(`insert into auth.users (id) values ($1)`, [sup]);
  await db.admin.query(`insert into profiles (id, role, display_name) values ($1,'supervisor','S')`, [sup]);
  await db.admin.query(`insert into cohorts (name, supervisor_id, invite_code, term_end) values ('測試班名稱', $1, 'AAAAAAAAAA', current_date + 30)`, [sup]);
  await db.admin.query(`insert into ai_usage (kind, model, outcome, cost_usd, counted) values ('practice','claude-haiku-5-5','ok',0.0004,true),('report_draft','claude-sonnet-5-5','invalid',0.08,false)`);
  expect(blocks.length).toBeGreaterThanOrEqual(6);
  for (const b of blocks) {
    for (const stmt of b.split(/;\s*\n/).map((x) => x.trim()).filter(Boolean)) await db.admin.query(stmt); // throws if it does not run
  }
  // After all blocks the last ones (switch off, one-click off) leave everything off and the budget at 0.
  expect((await db.admin.query(`select ai_enabled from cohorts`)).rows).toEqual([{ ai_enabled: false }]);
  expect((await db.admin.query(`select monthly_limit_usd::float as v from ai_budget`)).rows).toEqual([{ v: 0 }]);
});

test('the first usage query adds up this month and reports the budget', async () => {
  await db.admin.query(`update ai_budget set monthly_limit_usd = 10`);
  const q = blocks.find((b) => b.includes('spent_usd'))!;
  const r = (await db.admin.query(q)).rows[0]!;
  expect(Number(r.spent_usd)).toBeCloseTo(0.0804, 4);
  expect(Number(r.limit_usd)).toBe(10);
  expect(Number(r.requests)).toBe(2);
});
