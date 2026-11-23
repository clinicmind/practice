import { test, expect } from 'vitest';
import {
  decide, budgetState, claimAction, rollingWindowStart, LIMITS, PENDING_STALE_MS, type DecideState,
} from '../src/index';

const ok: DecideState = {
  enabled: true, usedToday: 0, dailyCap: LIMITS.practicePerDay, sameItemToday: 0, itemCap: LIMITS.itemPerDay,
  monthSpent: 0, monthLimit: 25,
};

test('defaults are the plan’s: 30 a day, 3 per drill per day, 2 report drafts a week', () => {
  expect(LIMITS).toEqual({ practicePerDay: 30, itemPerDay: 3, reportPerWeek: 2 });
});

test('decide: allowed when everything is within limits', () => {
  expect(decide(ok, 'practice')).toEqual({ allow: true });
});

test('decide: disabled wins over everything', () => {
  const worst = { ...ok, enabled: false, monthLimit: null, monthSpent: 99, usedToday: 99, sameItemToday: 99 };
  expect(decide(worst, 'practice')).toEqual({ allow: false, reason: 'disabled' });
  expect(decide({ ...worst, reportsThisWeek: 9 }, 'report_draft')).toEqual({ allow: false, reason: 'disabled' });
});

test('decide: no budget row → refused (fail closed); order is budget_unset before budget_exhausted before caps', () => {
  expect(decide({ ...ok, monthLimit: null }, 'practice')).toEqual({ allow: false, reason: 'budget_unset' });
  expect(decide({ ...ok, monthLimit: null, usedToday: 99 }, 'practice')).toEqual({ allow: false, reason: 'budget_unset' });
  expect(decide({ ...ok, monthSpent: 25, usedToday: 99 }, 'practice')).toEqual({ allow: false, reason: 'budget_exhausted' });
});

test('decide: a limit of 0 (the migration default) stops everything', () => {
  expect(decide({ ...ok, monthLimit: 0 }, 'practice')).toEqual({ allow: false, reason: 'budget_exhausted' });
});

test('decide: exactly at the monthly limit is exhausted; one cent under is allowed', () => {
  expect(decide({ ...ok, monthLimit: 25, monthSpent: 25 }, 'practice')).toEqual({ allow: false, reason: 'budget_exhausted' });
  expect(decide({ ...ok, monthLimit: 25, monthSpent: 24.99 }, 'practice')).toEqual({ allow: true });
});

test('decide: NaN or negative numbers fail closed', () => {
  expect(decide({ ...ok, monthSpent: NaN }, 'practice').allow).toBe(false);
  expect(decide({ ...ok, monthLimit: NaN }, 'practice').allow).toBe(false);
  expect(decide({ ...ok, usedToday: NaN }, 'practice').allow).toBe(false);
  expect(decide({ ...ok, monthLimit: -1 }, 'practice').allow).toBe(false);
});

test('decide: 30th call of the day is allowed, the 31st is refused', () => {
  expect(decide({ ...ok, usedToday: 29 }, 'practice')).toEqual({ allow: true });
  expect(decide({ ...ok, usedToday: 30 }, 'practice')).toEqual({ allow: false, reason: 'daily_cap' });
});

test('decide: 4th retry of the same drill in a day is refused with item_cap (cap 3)', () => {
  expect(decide({ ...ok, sameItemToday: 2 }, 'practice')).toEqual({ allow: true });
  expect(decide({ ...ok, sameItemToday: 3 }, 'practice')).toEqual({ allow: false, reason: 'item_cap' });
  expect(decide({ ...ok, usedToday: 30, sameItemToday: 3 }, 'practice')).toEqual({ allow: false, reason: 'daily_cap' });
});

test('decide: 3rd report draft in a week for one student is refused; 2nd is allowed', () => {
  expect(decide({ ...ok, reportsThisWeek: 1 }, 'report_draft')).toEqual({ allow: true });
  expect(decide({ ...ok, reportsThisWeek: 2 }, 'report_draft')).toEqual({ allow: false, reason: 'weekly_cap' });
});

test('decide: report drafts ignore the practice daily and per-drill caps', () => {
  expect(decide({ ...ok, usedToday: 30, sameItemToday: 9, reportsThisWeek: 0 }, 'report_draft')).toEqual({ allow: true });
});

test('decide: a report draft without a weekly count is a programming error', () => {
  expect(() => decide(ok, 'report_draft')).toThrow();
});

test('budgetState thresholds at 80% and 100%', () => {
  expect(budgetState(0, 25, 0.8)).toBe('ok');
  expect(budgetState(19.99, 25, 0.8)).toBe('ok');
  expect(budgetState(20, 25, 0.8)).toBe('warn');
  expect(budgetState(24.99, 25, 0.8)).toBe('warn');
  expect(budgetState(25, 25, 0.8)).toBe('exhausted');
  expect(budgetState(30, 25, 0.8)).toBe('exhausted');
  expect(budgetState(0, 0, 0.8)).toBe('exhausted');
  expect(budgetState(NaN, 25, 0.8)).toBe('exhausted');
});

test('rolling windows: 24 hours and 7 days back from now (ISO, UTC)', () => {
  const now = new Date('2026-12-01T10:00:00.000Z');
  expect(rollingWindowStart(now, 'day')).toBe('2026-11-30T10:00:00.000Z');
  expect(rollingWindowStart(now, 'week')).toBe('2026-11-24T10:00:00.000Z');
});

test('idempotency: no row → insert', () => {
  expect(claimAction(null, new Date())).toBe('insert');
});

test('idempotency: done → return the stored result', () => {
  const now = new Date('2026-12-01T10:00:00Z');
  expect(claimAction({ status: 'done', createdAt: '2026-12-01T09:00:00Z' }, now)).toBe('return_done');
});

test('idempotency: pending under 2 minutes → in_progress; over 2 minutes → reclaim', () => {
  const now = new Date('2026-12-01T10:00:00Z');
  expect(PENDING_STALE_MS).toBe(120_000);
  expect(claimAction({ status: 'pending', createdAt: '2026-12-01T09:59:30Z' }, now)).toBe('in_progress');
  expect(claimAction({ status: 'pending', createdAt: '2026-12-01T09:57:00Z' }, now)).toBe('reclaim');
  expect(claimAction({ status: 'pending', createdAt: '2026-12-01T09:58:00Z' }, now)).toBe('reclaim'); // 剛好 2 分鐘
});

test('idempotency: an unreadable timestamp is not treated as stale', () => {
  const now = new Date('2026-12-01T10:00:00Z');
  expect(claimAction({ status: 'pending', createdAt: 'garbage' }, now)).toBe('in_progress');
});
