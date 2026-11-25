import { beforeEach, describe, expect, test } from 'vitest';
import { Mem } from '../test/appHarness';
import type { Attempt } from '../progress/types';
import { REVIEW_KEY, appendReview, dayGap, loadReviewLog, pickReviewItems, type Candidate, type ReviewEntry } from './review';

const NOW = new Date(2026, 5, 20, 9, 0, 0); // local time, 20 June 2026, morning
const daysAgo = (n: number, hour = 21) => new Date(2026, 5, 20 - n, hour, 0, 0).toISOString();
const att = (itemId: string, ticks: number, ago: number): Attempt => ({
  id: `a-${itemId}-${ago}`, itemId, response: 'a response long enough to count', createdAt: daysAgo(ago),
  criteriaMet: [true, true, true].map((_, i) => i < ticks),
});
const cand = (itemId: string, moduleKey = 'm1'): Candidate => ({ itemId, moduleKey });
const pick = (candidates: Candidate[], attempts: Attempt[], log: ReviewEntry[] = [], count?: number) =>
  pickReviewItems({ candidates, attempts, log, now: NOW, count });

describe('dayGap', () => {
  test('counts calendar days: last evening to this morning is one day', () => {
    expect(dayGap(new Date(2026, 5, 19, 23, 30), NOW)).toBe(1);
    expect(dayGap(new Date(2026, 5, 20, 1, 0), NOW)).toBe(0);
    expect(dayGap(new Date(2026, 5, 6, 12, 0), NOW)).toBe(14);
  });
});

describe('which items come back', () => {
  test('first review after 1 day, second after 4 more, third after 14 more', () => {
    expect(pick([cand('a')], [att('a', 3, 0)])).toEqual([]);
    expect(pick([cand('a')], [att('a', 3, 1)])).toEqual(['a']);
    const one: ReviewEntry[] = [{ itemId: 'a', at: daysAgo(3), kind: 'done' }];
    expect(pick([cand('a')], [att('a', 3, 9)], one)).toEqual([]); // 3 days since the first review
    expect(pick([cand('a')], [att('a', 3, 9)], [{ itemId: 'a', at: daysAgo(4), kind: 'done' }])).toEqual(['a']);
    const two: ReviewEntry[] = [{ itemId: 'a', at: daysAgo(20), kind: 'done' }, { itemId: 'a', at: daysAgo(13), kind: 'done' }];
    expect(pick([cand('a')], [att('a', 3, 30)], two)).toEqual([]);
    expect(pick([cand('a')], [att('a', 3, 30)], [{ itemId: 'a', at: daysAgo(30), kind: 'done' }, { itemId: 'a', at: daysAgo(20), kind: 'done' }])).toEqual(['a']);
  });

  test('after three reviews an item retires', () => {
    const log: ReviewEntry[] = [90, 80, 60].map((n) => ({ itemId: 'a', at: daysAgo(n), kind: 'done' as const }));
    expect(pick([cand('a')], [att('a', 3, 100)], log)).toEqual([]);
  });

  test('a skip counts as a touch but not as a review: it comes back at the same step later', () => {
    const skipped: ReviewEntry[] = [{ itemId: 'a', at: daysAgo(0, 8), kind: 'skipped' }];
    expect(pick([cand('a')], [att('a', 3, 5)], skipped)).toEqual([]); // skipped today
    const old: ReviewEntry[] = [{ itemId: 'a', at: daysAgo(1), kind: 'skipped' }];
    expect(pick([cand('a')], [att('a', 3, 5)], old)).toEqual(['a']); // still the 1-day step
  });

  test('items never attempted are never offered', () => {
    expect(pick([cand('a'), cand('b')], [att('a', 3, 5)])).toEqual(['a']);
  });

  test('items passed with only 2 criteria come first, then the most overdue', () => {
    const attempts = [att('three-old', 3, 30), att('two-new', 2, 2), att('three-new', 3, 6), att('two-old', 2, 20)];
    const candidates = ['three-old', 'two-new', 'three-new', 'two-old'].map((id, i) => cand(id, `m${i}`));
    expect(pick(candidates, attempts, [], 4)).toEqual(['two-old', 'two-new', 'three-old', 'three-new']);
  });

  test('at most 3, spread over different modules where possible', () => {
    const attempts = ['a1', 'a2', 'a3', 'b1', 'c1'].map((id) => att(id, 2, 5));
    const candidates = [cand('a1', 'A'), cand('a2', 'A'), cand('a3', 'A'), cand('b1', 'B'), cand('c1', 'C')];
    const got = pick(candidates, attempts);
    expect(got).toHaveLength(3);
    expect(new Set(got.map((id) => candidates.find((c) => c.itemId === id)!.moduleKey)).size).toBe(3);
  });

  test('when there are not enough modules, the same module fills the rest', () => {
    const attempts = ['a1', 'a2', 'a3', 'a4'].map((id) => att(id, 3, 5));
    expect(pick(['a1', 'a2', 'a3', 'a4'].map((id) => cand(id, 'A')), attempts)).toHaveLength(3);
  });
});

describe('the review log', () => {
  let storage: Mem;
  beforeEach(() => { storage = new Mem(); });
  test('is empty at first and keeps what is appended', () => {
    expect(loadReviewLog(storage)).toEqual([]);
    appendReview({ itemId: 'a', at: daysAgo(0), kind: 'done', response: 'my answer' }, storage);
    appendReview({ itemId: 'b', at: daysAgo(0), kind: 'skipped' }, storage);
    expect(loadReviewLog(storage).map((e) => e.itemId)).toEqual(['a', 'b']);
  });
  test('corrupt or foreign data reads as empty and bad rows are dropped', () => {
    storage.setItem(REVIEW_KEY, '{not json');
    expect(loadReviewLog(storage)).toEqual([]);
    storage.setItem(REVIEW_KEY, JSON.stringify([{ itemId: 'a', at: 'x', kind: 'done' }, { nope: 1 }, 7]));
    expect(loadReviewLog(storage)).toHaveLength(1);
  });
  test('a storage that throws does not break a review', () => {
    const bad = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } } as unknown as Storage;
    expect(loadReviewLog(bad)).toEqual([]);
    expect(() => appendReview({ itemId: 'a', at: daysAgo(0), kind: 'done' }, bad)).not.toThrow();
  });
});
