/** What the supervisor's usage panel and the offline report script both compute. Only counts and money: no text exists in ai_usage. */
export type UsageRow = {
  kind: 'practice' | 'report_draft' | 'eval';
  inputTokens: number; outputTokens: number; cacheWriteTokens: number; cacheReadTokens: number;
  costUsd: number;
  outcome: 'ok' | 'invalid' | 'refusal' | 'error' | 'blocked';
  createdAt: string;
};
export type AiBudget = { monthlyLimitUsd: number; warnAt: number };
export type BudgetLevel = 'unset' | 'ok' | 'warn' | 'exhausted';

export type UsageSummary = {
  spent: number;
  calls: number;
  byKind: Record<UsageRow['kind'], number>;
  /** cache_read / (cache_read + cache_write + input); null when there is nothing to divide. */
  cacheHitRate: number | null;
  /** invalid + refusal + error, out of all calls; null with no calls. */
  discardedRate: number | null;
  /** Average cost of one practice call that was kept ('ok'); null with none. */
  avgPracticeCostUsd: number | null;
};

const DISCARDED: readonly UsageRow['outcome'][] = ['invalid', 'refusal', 'error'];

export function summarizeUsage(rows: UsageRow[]): UsageSummary {
  const byKind: UsageSummary['byKind'] = { practice: 0, report_draft: 0, eval: 0 };
  let spent = 0, read = 0, write = 0, input = 0, discarded = 0, okPractice = 0, okPracticeCost = 0;
  for (const r of rows) {
    spent += r.costUsd; read += r.cacheReadTokens; write += r.cacheWriteTokens; input += r.inputTokens;
    byKind[r.kind]++;
    if (DISCARDED.includes(r.outcome)) discarded++;
    if (r.kind === 'practice' && r.outcome === 'ok') { okPractice++; okPracticeCost += r.costUsd; }
  }
  const denom = read + write + input;
  return {
    spent, calls: rows.length, byKind,
    cacheHitRate: denom > 0 ? read / denom : null,
    discardedRate: rows.length > 0 ? discarded / rows.length : null,
    avgPracticeCostUsd: okPractice > 0 ? okPracticeCost / okPractice : null,
  };
}

/** No budget row, or a limit of 0, means everything is stopped; it is shown as 'unset', not as 100% used. */
export function budgetLevel(spent: number, budget: AiBudget | null): BudgetLevel {
  if (!budget || !(budget.monthlyLimitUsd > 0)) return 'unset';
  if (!(spent < budget.monthlyLimitUsd)) return 'exhausted';
  return spent >= budget.monthlyLimitUsd * budget.warnAt ? 'warn' : 'ok';
}

/** The start of the current month in UTC, which is how the function counts a month. */
export const monthStartIso = (now: Date): string => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();

export const usd = (n: number): string => `US$${n.toFixed(n < 1 ? 4 : 2)}`;
export const percent = (n: number | null): string | null => (n === null ? null : `${Math.round(n * 100)}%`);
