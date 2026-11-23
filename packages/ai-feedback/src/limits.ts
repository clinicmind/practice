/**
 * 限額、預算、冪等。純函式，沒有 DOM／Node 依賴；資料庫讀寫由 Edge Function（T6）做。
 *
 * 冪等協定（T6 實作，這裡只放「判斷」）：
 *   1. 先 insert ai_feedback(attempt_id, status = 'pending')。attempt_id 唯一，所以兩個請求只有一個能插入。
 *   2. 衝突時讀既有的列，交給 claimAction：
 *        done                      → 'return_done'：回傳已存的結果，不呼叫模型、不扣額度。
 *        pending，建立不到 2 分鐘   → 'in_progress'：回 409，另一個請求正在處理。
 *        pending，建立滿 2 分鐘     → 'reclaim'：前一次當掉了，刪除後重新聲明。
 *   3. 呼叫失敗或輸出被丟棄 → 刪除 pending 列，讓學生可以重試。
 * 「每日」是滾動 24 小時（和報告的每 24 小時 5 次一致）；「每週」是滾動 7 天。
 */

/** D5 的預設值（每日重做上限 3 是建議，擁有人可改）。 */
export const LIMITS = { practicePerDay: 30, itemPerDay: 3, reportPerWeek: 2 } as const;

export type DecideKind = 'practice' | 'report_draft';
export type DecideState = {
  enabled: boolean;
  usedToday: number;
  dailyCap: number;
  sameItemToday: number;
  itemCap: number;
  monthSpent: number;
  /** null ＝ 資料庫沒有預算列。沒設預算就不呼叫（fail closed）。 */
  monthLimit: number | null;
  reportsThisWeek?: number;
  weeklyReportCap?: number;
};
export type DecideReason = 'disabled' | 'budget_unset' | 'budget_exhausted' | 'daily_cap' | 'item_cap' | 'weekly_cap';
export type Decision = { allow: true } | { allow: false; reason: DecideReason };

const deny = (reason: DecideReason): Decision => ({ allow: false, reason });

/**
 * 順序：disabled → budget_unset → budget_exhausted → （練習）daily_cap → item_cap ／（報告）weekly_cap。
 * 比較一律寫成「!(a < b)」，這樣 NaN 也會被擋下（fail closed）。
 */
export function decide(state: DecideState, kind: DecideKind): Decision {
  if (!state.enabled) return deny('disabled');
  if (state.monthLimit === null) return deny('budget_unset');
  if (!(state.monthLimit > 0) || !(state.monthSpent < state.monthLimit)) return deny('budget_exhausted');
  if (kind === 'report_draft') {
    if (state.reportsThisWeek === undefined) throw new Error('reportsThisWeek is required for report_draft');
    const cap = state.weeklyReportCap ?? LIMITS.reportPerWeek;
    return state.reportsThisWeek < cap ? { allow: true } : deny('weekly_cap');
  }
  if (!(state.usedToday < state.dailyCap)) return deny('daily_cap');
  if (!(state.sameItemToday < state.itemCap)) return deny('item_cap');
  return { allow: true };
}

export type BudgetState = 'ok' | 'warn' | 'exhausted';

export function budgetState(spent: number, limit: number, warnAt: number): BudgetState {
  if (!(limit > 0) || !(spent < limit)) return 'exhausted';
  return spent >= limit * warnAt ? 'warn' : 'ok';
}

const HOUR_MS = 3_600_000;
export function rollingWindowStart(now: Date, span: 'day' | 'week'): string {
  return new Date(now.getTime() - (span === 'day' ? 24 : 24 * 7) * HOUR_MS).toISOString();
}

export const PENDING_STALE_MS = 120_000;
export type ClaimAction = 'insert' | 'return_done' | 'in_progress' | 'reclaim';

export function claimAction(existing: { status: 'pending' | 'done'; createdAt: string } | null, now: Date): ClaimAction {
  if (!existing) return 'insert';
  if (existing.status === 'done') return 'return_done';
  const age = now.getTime() - new Date(existing.createdAt).getTime();
  // 讀不懂的時間戳（NaN）不當作過期：寧可請學生等，也不重複呼叫模型。
  return age >= PENDING_STALE_MS ? 'reclaim' : 'in_progress';
}
