import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { defaultAiClient } from '../../ai/AiContext';
import { en } from '../../i18n/en';
import { buildFixture, renderCloud, serve } from '../../test/appHarness';
import { createFakeDb, type FakeDb } from '../../test/fakeDb';
import { createFakeBackend, type FakeBackend } from '../../test/fakeSupabase';
import { addAttempt, ALICE, BEA, SUP, seedCohort } from '../../test/seedCohort';

// All names and text are fictional.
const t = en.aiFeedback.supervisor;
const u = en.aiFeedback.usage;
let built = '';
beforeAll(async () => { built = await buildFixture('ok-reviewed'); });
let db: FakeDb;
let fake: FakeBackend;
beforeEach(() => {
  sessionStorage.clear();
  serve(built);
  db = createFakeDb();
  seedCohort(db);
  fake = createFakeBackend({ userId: SUP, db });
});
afterEach(() => vi.unstubAllGlobals());

const AI = { aiEnabled: true, aiClient: defaultAiClient };
const AI_TABLES = ['ai_feedback', 'ai_disagreements', 'ai_usage', 'ai_budget'];
const aiReads = () => db.reads.filter((r) => AI_TABLES.includes(r.table));
const switchOn = () => { db.tables.cohorts![0]!.ai_enabled = true; };
const attemptOf = (user: string, n = 0) => (db.tables.attempts!.filter((a) => a.user_id === user)[n]!.id as string);
const evaluation = (attempt: string, user: string, item: string, concern: string | null = null) =>
  db.tables.ai_feedback!.push({ id: `f-${attempt}`, attempt_id: attempt, status: 'done', created_at: '2026-04-01T00:00:00Z', concern, attempt: { user_id: user, item_id: item } });
const differ = (attempt: string, user: string, item: string, criterion: number, selfMet: boolean) =>
  db.tables.ai_disagreements!.push({ attempt_id: attempt, user_id: user, item_id: item, criterion_index: criterion, self_met: selfMet, ai_met: !selfMet });

describe('class page: AI blocks', () => {
  test('cohort switch off: no AI blocks and no AI table is read', async () => {
    evaluation(attemptOf(ALICE), ALICE, 'intake-e01', 'risk-content');
    renderCloud('/supervisor', fake, AI);
    await screen.findByRole('table', { name: en.supervisor.progressCaption('Spring cohort') });
    expect(screen.queryByRole('heading', { name: t.heading })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: u.heading })).not.toBeInTheDocument();
    expect(aiReads()).toEqual([]);
  });

  test('build switch off, even with the cohort switch on: still no AI blocks and no AI table is read', async () => {
    switchOn();
    renderCloud('/supervisor', fake);
    await screen.findByRole('table', { name: en.supervisor.progressCaption('Spring cohort') });
    expect(screen.queryByRole('heading', { name: t.heading })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: u.heading })).not.toBeInTheDocument();
    expect(aiReads()).toEqual([]);
  });

  test('lists students by count of differences, the two directions in separate columns', async () => {
    switchOn();
    const a1 = attemptOf(ALICE, 0), a2 = attemptOf(ALICE, 1);
    addAttempt(db, { user: BEA, item: 'intake-e01', response: 'Bea answer that is long enough.', at: '2026-04-02T10:00:00.000Z' });
    evaluation(a1, ALICE, 'intake-e01'); evaluation(a2, ALICE, 'intake-e02'); evaluation(attemptOf(BEA, 0), BEA, 'intake-e01');
    differ(a1, ALICE, 'intake-e01', 1, true);   // student ticked, AI did not
    differ(a1, ALICE, 'intake-e01', 2, true);
    differ(a2, ALICE, 'intake-e02', 3, false);  // AI found it, student did not tick
    renderCloud('/supervisor', fake, AI);
    const table = await screen.findByRole('table', { name: t.caption });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByRole('link', { name: 'Alice' })).toBeInTheDocument();
    const cells = within(rows[0]!).getAllByRole('cell').map((c) => c.textContent);
    expect(cells).toEqual(['2', '2', '1']); // checked, student-only, AI-only
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual([t.colStudent, t.colTotal, t.colSelfOnly, t.colAiOnly]);
    expect(within(rows[1]!).getAllByRole('cell').map((c) => c.textContent)).toEqual(['1', '0', '0']);
  });

  test('risk-content responses are flagged at the top of the cohort section', async () => {
    switchOn();
    const a1 = attemptOf(ALICE, 0);
    evaluation(a1, ALICE, 'intake-e01', 'risk-content');
    renderCloud('/supervisor', fake, AI);
    const risk = await screen.findByRole('region', { name: t.riskHeading });
    expect(within(risk).getByRole('link', { name: t.riskItem('Alice', 'intake-e01') })).toHaveAttribute('href', `/supervisor/students/${ALICE}`);
    // above the progress table
    const table = screen.getByRole('table', { name: en.supervisor.progressCaption('Spring cohort') });
    expect(risk.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // a risk response is not counted as an ordinary check
    expect(screen.getByText(t.none)).toBeInTheDocument();
  });

  test('another cohort’s students never appear in this cohort’s lists', async () => {
    switchOn();
    db.tables.profiles!.push({ id: 'stu-other', role: 'student', display_name: 'Outsider', cohort_id: 'c-other', created_at: '2026-01-05T00:00:00.000Z' });
    evaluation('att-x', 'stu-other', 'intake-e01', 'risk-content');
    differ('att-x', 'stu-other', 'intake-e01', 1, true);
    renderCloud('/supervisor', fake, AI);
    await screen.findByRole('heading', { name: t.heading });
    await waitFor(() => expect(screen.getByText(t.none)).toBeInTheDocument());
    expect(screen.queryByText(/Outsider/)).not.toBeInTheDocument();
    expect(screen.getByText(t.riskNone)).toBeInTheDocument();
  });

  test('a failed read of the AI results shows an error there and leaves the rest of the page working', async () => {
    switchOn();
    db.failReads.add('ai_feedback');
    renderCloud('/supervisor', fake, AI);
    expect(await screen.findByText(t.loadError)).toBeInTheDocument();
    expect(await screen.findByRole('table', { name: en.supervisor.progressCaption('Spring cohort') })).toBeInTheDocument();
  });
});

describe('class page: AI use and cost', () => {
  const row = (cost: number, over: Record<string, unknown> = {}) => db.tables.ai_usage!.push({
    id: `u-${db.tables.ai_usage!.length}`, kind: 'practice', input_tokens: 100, output_tokens: 50, cache_write_tokens: 0, cache_read_tokens: 0,
    cost_usd: cost, outcome: 'ok', created_at: new Date().toISOString(), ...over,
  });

  test('shows spent against the limit and the share used', async () => {
    switchOn();
    db.tables.ai_budget!.push({ id: true, monthly_limit_usd: 10, warn_at: 0.8 });
    row(2); row(2.5, { kind: 'report_draft' });
    renderCloud('/supervisor', fake, AI);
    const panel = await screen.findByRole('region', { name: u.heading });
    await within(panel).findByText(u.spent('US$4.50', 'US$10.00'));
    expect(within(panel).getByText(u.percent(45))).toBeInTheDocument();
    expect(within(panel).getByRole('progressbar', { name: u.barLabel })).toHaveAttribute('aria-valuenow', '45');
    expect(within(panel).getByText(u.calls(2))).toBeInTheDocument();
    expect(within(panel).getByText(u.kindPractice(1))).toBeInTheDocument();
    expect(within(panel).getByText(u.kindReport(1))).toBeInTheDocument();
    expect(within(panel).queryByText(u.warn)).not.toBeInTheDocument();
  });

  test('warns from 80% and says "stopped" at 100%', async () => {
    switchOn();
    db.tables.ai_budget!.push({ id: true, monthly_limit_usd: 10, warn_at: 0.8 });
    row(8.5);
    const first = renderCloud('/supervisor', fake, AI);
    expect(await screen.findByText(u.warn)).toBeInTheDocument();
    first.unmount();
    row(1.5);
    renderCloud('/supervisor', fake, AI);
    expect(await screen.findByText(u.stopped)).toBeInTheDocument();
    expect(screen.queryByText(u.warn)).not.toBeInTheDocument();
  });

  test('cache hit rate and discard rate come from the rows', async () => {
    switchOn();
    db.tables.ai_budget!.push({ id: true, monthly_limit_usd: 10, warn_at: 0.8 });
    row(0.01, { input_tokens: 100, cache_read_tokens: 800, cache_write_tokens: 100 });
    row(0.01, { outcome: 'refusal', input_tokens: 0 });
    row(0.01, { outcome: 'invalid', input_tokens: 0 });
    row(0.01, { outcome: 'ok', input_tokens: 0 });
    renderCloud('/supervisor', fake, AI);
    expect(await screen.findByText(u.cacheHit('80%'))).toBeInTheDocument(); // 800 / (800 + 100 + 100)
    expect(screen.getByText(u.discarded('50%'))).toBeInTheDocument();
  });

  test('only this month’s rows are counted', async () => {
    switchOn();
    db.tables.ai_budget!.push({ id: true, monthly_limit_usd: 10, warn_at: 0.8 });
    row(5, { created_at: '2020-01-01T00:00:00Z' });
    row(1);
    renderCloud('/supervisor', fake, AI);
    expect(await screen.findByText(u.spent('US$1.00', 'US$10.00'))).toBeInTheDocument();
  });

  test('no budget row, or a limit of 0: says the budget is not set and AI is off', async () => {
    switchOn();
    renderCloud('/supervisor', fake, AI);
    expect(await screen.findByText(u.budgetUnset)).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  test('a limit of 0 (the value the migration starts with) also says not set', async () => {
    switchOn();
    db.tables.ai_budget!.push({ id: true, monthly_limit_usd: 0, warn_at: 0.8 });
    renderCloud('/supervisor', fake, AI);
    expect(await screen.findByText(u.budgetUnset)).toBeInTheDocument();
  });
});

describe('student page: AI check per response', () => {
  test('cohort switch off: nothing about AI and no AI table is read', async () => {
    renderCloud(`/supervisor/students/${ALICE}`, fake, AI);
    await screen.findByRole('list', { name: en.supervisor.attemptsHeading });
    expect(screen.queryByText(t.agreeFlag)).not.toBeInTheDocument();
    expect(aiReads()).toEqual([]);
  });

  test('build switch off: no AI table is read even if the cohort switch is on', async () => {
    switchOn();
    renderCloud(`/supervisor/students/${ALICE}`, fake);
    await screen.findByRole('list', { name: en.supervisor.attemptsHeading });
    expect(aiReads()).toEqual([]);
  });

  test('each checked response shows its differences by direction, risk, or agreement; unchecked ones show nothing', async () => {
    switchOn();
    const [a0, a1, a2] = [attemptOf(ALICE, 0), attemptOf(ALICE, 1), attemptOf(ALICE, 2)];
    evaluation(a0, ALICE, 'intake-e01');
    differ(a0, ALICE, 'intake-e01', 1, true);
    differ(a0, ALICE, 'intake-e01', 3, false);
    evaluation(a1, ALICE, 'intake-e02', 'risk-content');
    evaluation(a2, ALICE, 'intake-e03');
    renderCloud(`/supervisor/students/${ALICE}`, fake, AI);
    const list = await screen.findByRole('list', { name: en.supervisor.attemptsHeading });
    const items = Array.from(list.children) as HTMLElement[]; // newest first
    const byItem = (id: string) => items.find((i) => i.textContent?.includes(id))!;
    await waitFor(() => expect(byItem('intake-e01')).toHaveTextContent(t.selfOnly('intake-e01 criterion one')));
    expect(byItem('intake-e01')).toHaveTextContent(t.aiOnly('intake-e01 criterion three'));
    expect(byItem('intake-e01')).not.toHaveTextContent(t.agreeFlag);
    expect(byItem('intake-e02')).toHaveTextContent(t.riskFlag);
    expect(byItem('intake-e03')).toHaveTextContent(t.agreeFlag);
    expect(byItem('intake-e04')).not.toHaveTextContent(en.aiFeedback.supervisor.agreeFlag);
    expect(byItem('intake-e04')).not.toHaveTextContent(t.riskFlag);
  });

  test('the three mechanical flags still show beside the AI marks', async () => {
    switchOn();
    addAttempt(db, { user: BEA, item: 'intake-e02', response: 'ok fine', met: [true, true, true], at: '2026-04-02T10:00:00.000Z' });
    evaluation(attemptOf(BEA, 0), BEA, 'intake-e02');
    renderCloud(`/supervisor/students/${BEA}`, fake, AI);
    const list = await screen.findByRole('list', { name: en.supervisor.attemptsHeading });
    await waitFor(() => expect(list).toHaveTextContent(t.agreeFlag));
    expect(list).toHaveTextContent(en.supervisor.flags['all-met-but-short']);
  });

  test('a failed read of the AI results leaves the page working and says so', async () => {
    switchOn();
    db.failReads.add('ai_disagreements');
    renderCloud(`/supervisor/students/${ALICE}`, fake, AI);
    expect(await screen.findByText(t.loadError)).toBeInTheDocument();
    expect(await screen.findByRole('list', { name: en.supervisor.attemptsHeading })).toBeInTheDocument();
  });
});
