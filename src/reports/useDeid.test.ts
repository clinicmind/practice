import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { findingKey, scan } from '../../packages/deid/src';
import { MAX_LENGTH, MIN_LENGTH, useDeid } from './useDeid';

// Fictional filler so the text is long enough to submit.
const FILL = 'The trainee noted that the client spoke slowly and paused often before answering. '.repeat(4);
const CLEAN = FILL + 'We agreed to look at one small step this week.';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const settle = () => act(() => { vi.advanceTimersByTime(300); });

function setup(initial: string) {
  const h = renderHook(({ t }) => useDeid(t), { initialProps: { t: initial } });
  const change = (t: string) => { h.rerender({ t }); settle(); };
  return { ...h, change };
}

describe('useDeid', () => {
  test('a clean report of valid length can be submitted', () => {
    const { result } = setup(CLEAN);
    expect(CLEAN.length).toBeGreaterThanOrEqual(MIN_LENGTH);
    expect(result.current.findings).toEqual([]);
    expect(result.current.canSubmit).toBe(true);
  });

  test('scanning waits 300 ms after the last keystroke, and an unscanned edit cannot be submitted', () => {
    const { result, rerender } = setup(CLEAN);
    rerender({ t: CLEAN + ' Call 91234567.' });
    expect(result.current.findings).toEqual([]);
    expect(result.current.pending).toBe(true);
    expect(result.current.canSubmit).toBe(false);
    act(() => { vi.advanceTimersByTime(299); });
    expect(result.current.findings).toEqual([]);
    act(() => { vi.advanceTimersByTime(1); });
    expect(result.current.pending).toBe(false);
    expect(result.current.findings.map((f) => f.rule)).toContain('phone');
  });

  test('length outside 200 to 30,000 blocks submit and reports which side', () => {
    const short = setup('too short');
    expect(short.result.current.lengthStatus).toBe('short');
    expect(short.result.current.canSubmit).toBe(false);
    const long = setup('a '.repeat(MAX_LENGTH / 2 + 1));
    expect(long.result.current.lengthStatus).toBe('long');
    expect(long.result.current.canSubmit).toBe(false);
    expect(setup(CLEAN).result.current.lengthStatus).toBe('ok');
  });

  test('a high finding cannot be resolved; only rewriting removes it', () => {
    const { result, change } = setup(CLEAN + ' Call 91234567.');
    const high = result.current.findings.find((f) => f.level === 'high')!;
    act(() => result.current.resolve(findingKey(high), 'not-identifying'));
    expect(result.current.resolutions).toEqual({});
    expect(result.current.canSubmit).toBe(false);
    change(CLEAN + ' Call the clinic.');
    expect(result.current.findings.filter((f) => f.level === 'high')).toEqual([]);
    expect(result.current.canSubmit).toBe(true);
  });

  test('resolving a medium finding lowers unresolved; submit opens when it reaches 0', () => {
    const { result } = setup(CLEAN + ' Mr Chan came late.');
    expect(result.current.unresolved).toBe(1);
    expect(result.current.canSubmit).toBe(false);
    const f = result.current.findings.find((x) => x.rule === 'title-name')!;
    act(() => result.current.resolve(findingKey(f), 'not-identifying'));
    expect(result.current.unresolved).toBe(0);
    expect(result.current.canSubmit).toBe(true);
  });

  test('a resolution is discarded when the finding changes', () => {
    const { result, change } = setup(CLEAN + ' Mr Chan came late.');
    const f = result.current.findings.find((x) => x.rule === 'title-name')!;
    act(() => result.current.resolve(findingKey(f), 'not-identifying'));
    expect(result.current.unresolved).toBe(0);
    change(CLEAN + ' Mr Wong came late.');
    expect(result.current.unresolved).toBe(1);
    expect(result.current.resolutions).toEqual({});
  });

  test('a finding that disappears after an edit counts as rewritten; the summary holds no matched text', () => {
    const { result, change } = setup(CLEAN + ' Mr Chan came late. Call 91234567.');
    expect(result.current.summary.phone).toEqual({ found: 1, rewritten: 0, notIdentifying: 0 });
    change(CLEAN + ' Her teacher came late. Call the school.');
    expect(result.current.summary.phone).toEqual({ found: 1, rewritten: 1, notIdentifying: 0 });
    expect(result.current.summary['title-name']).toEqual({ found: 1, rewritten: 1, notIdentifying: 0 });
    expect(JSON.stringify(result.current.summary)).not.toMatch(/Chan|91234567/);
  });

  test('a marked finding keeps counting as notIdentifying, not rewritten', () => {
    const { result } = setup(CLEAN + ' Mr Chan came late.');
    const f = result.current.findings.find((x) => x.rule === 'title-name')!;
    act(() => result.current.resolve(findingKey(f), 'not-identifying'));
    expect(result.current.summary['title-name']).toEqual({ found: 1, rewritten: 0, notIdentifying: 1 });
  });

  test('moving a finding by editing earlier text does not count it as rewritten', () => {
    const { result, change } = setup(CLEAN + ' Call 91234567.');
    change('Intro. ' + CLEAN + ' Call 91234567.');
    expect(result.current.summary.phone).toEqual({ found: 1, rewritten: 0, notIdentifying: 0 });
  });

  test('over-long text is not scanned, so the page never stalls', () => {
    const huge = 'x'.repeat(MAX_LENGTH + 1);
    const { result } = setup(huge);
    expect(result.current.findings).toEqual([]);
    expect(result.current.lengthStatus).toBe('long');
    expect(result.current.canSubmit).toBe(false);
  });

  test('uses the shared scanner', () => {
    const t = CLEAN + ' Mr Chan.';
    expect(setup(t).result.current.findings).toEqual(scan(t));
  });
});
