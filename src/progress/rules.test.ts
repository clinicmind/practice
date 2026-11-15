import { describe, expect, test } from 'vitest';
import type { Drill, Level, Session } from '../content/schema';
import type { Attempt, Decision } from './types';
import { MIN_RESPONSE, itemMet, levelPassed, unlockedLevels, unlockedModules, walkthroughDone } from './rules';

const LONG = 'x'.repeat(30);
let n = 0;
const att = (itemId: string, criteriaMet: boolean[], createdAt = `2026-01-01T00:00:${String(n++ % 60).padStart(2, '0')}.000Z`, response = LONG): Attempt =>
  ({ id: `a${n}`, itemId, response, criteriaMet, createdAt });
const T1 = '2026-01-01T00:00:01.000Z';
const T2 = '2026-01-01T00:00:02.000Z';

const mkDrills = (): Drill[] =>
  (['easy', 'medium', 'hard'] as Level[]).flatMap((level) =>
    Array.from({ length: 10 }, (_, i) => ({
      id: `m-${level[0]}${String(i + 1).padStart(2, '0')}`, level, skill: 's', context: 'c', client: 'c',
      criteria: ['a', 'b', 'c'] as [string, string, string],
    })),
  );
const drills = mkDrills();
const passCount = (level: Level, count: number): Attempt[] =>
  drills.filter((d) => d.level === level).slice(0, count).map((d) => att(d.id, [true, true, false]));
const pass = (level: Level) => passCount(level, 8);

const session = (id: string, decisionIds: string[]): Session => ({
  id,
  title: 't',
  turns: [
    { id: 't1', speaker: 'client', text: 'hi' },
    ...decisionIds.map((d) => ({ id: d, type: 'free' as const, prompt: 'p', actual: 'a', rationale: 'r' })),
  ],
  notes: { goals: 'g', alliance: 'a', formulation_update: 'f' },
});
const dec = (sessionId: string, decisionId: string): Decision =>
  ({ id: `${sessionId}${decisionId}`, sessionId, decisionId, response: 'r', createdAt: T1 });

describe('itemMet', () => {
  test('needs 2 of 3 criteria on the latest attempt', () => {
    expect(itemMet([att('a', [true, true, false])], 'a')).toBe(true);
    expect(itemMet([att('a', [true, false, false])], 'a')).toBe(false);
    expect(itemMet([att('a', [true, true, true], T1), att('a', [true, false, false], T2)], 'a')).toBe(false);
    expect(itemMet([att('a', [true, false, false], T1), att('a', [true, true, false], T2)], 'a')).toBe(true);
  });
  test('latest is by createdAt even if listed out of order', () => {
    expect(itemMet([att('a', [true, false, false], T2), att('a', [true, true, true], T1)], 'a')).toBe(false);
  });
  test('short or blank response is never met', () => {
    expect(itemMet([att('a', [true, true, true], T1, '   ')], 'a')).toBe(false);
    expect(itemMet([att('a', [true, true, true], T1, 'x'.repeat(19))], 'a')).toBe(false);
    expect(itemMet([att('a', [true, true, true], T1, '  ' + 'x'.repeat(20) + '  ')], 'a')).toBe(true);
    expect(MIN_RESPONSE).toBe(20);
  });
  test('only counts whitespace-trimmed length (inner spaces count)', () => {
    expect(itemMet([att('a', [true, true, false], T1, ' ' + 'ab '.repeat(7) + ' ')], 'a')).toBe(true); // 20 chars after trim
  });
  test('unknown item or other items do not count', () => {
    expect(itemMet([], 'a')).toBe(false);
    expect(itemMet([att('b', [true, true, true])], 'a')).toBe(false);
  });
});

describe('levelPassed', () => {
  test('passes at 8 of 10', () => {
    expect(levelPassed(passCount('easy', 7), drills, 'easy')).toBe(false);
    expect(levelPassed(passCount('easy', 8), drills, 'easy')).toBe(true);
    expect(levelPassed(passCount('easy', 10), drills, 'easy')).toBe(true);
  });
  test('other levels do not count', () => {
    expect(levelPassed(pass('medium'), drills, 'easy')).toBe(false);
  });
  test('a later weak retry can un-meet an item', () => {
    const a = pass('easy');
    const first = drills[0].id;
    expect(levelPassed([...a, att(first, [false, false, false], '2099-01-01T00:00:00.000Z')], drills, 'easy')).toBe(false); // 7 of 10 now
  });
});

describe('unlockedLevels', () => {
  test('levels unlock in order', () => {
    expect(unlockedLevels([], drills)).toEqual(['easy']);
    expect(unlockedLevels(pass('easy'), drills)).toEqual(['easy', 'medium']);
    expect(unlockedLevels([...pass('easy'), ...pass('medium')], drills)).toEqual(['easy', 'medium', 'hard']);
  });
  test('skipping a level does not unlock', () => {
    expect(unlockedLevels(pass('medium'), drills)).toEqual(['easy']);
    expect(unlockedLevels([...pass('easy'), ...pass('hard')], drills)).toEqual(['easy', 'medium']);
  });
});

describe('walkthrough and modules', () => {
  const s1 = session('intake-s1', ['d1', 'd2']);
  test('walkthrough done needs every decision point answered', () => {
    expect(walkthroughDone([], [s1])).toBe(false);
    expect(walkthroughDone([dec('intake-s1', 'd1')], [s1])).toBe(false);
    expect(walkthroughDone([dec('intake-s1', 'd1'), dec('intake-s1', 'd2')], [s1])).toBe(true);
  });
  test('same decision id in another session does not count', () => {
    expect(walkthroughDone([dec('other', 'd1'), dec('other', 'd2')], [s1])).toBe(false);
  });
  const mods = [
    { slug: 'intake', sessions: [s1] },
    { slug: 'alliance', sessions: [session('alliance-s1', ['d1'])] },
    { slug: 'assessment', sessions: [session('assessment-s1', ['d1'])] },
  ];
  test('modules unlock one at a time', () => {
    expect(unlockedModules([], mods)).toEqual(['intake']);
    const d1 = [dec('intake-s1', 'd1'), dec('intake-s1', 'd2')];
    expect(unlockedModules(d1, mods)).toEqual(['intake', 'alliance']);
    expect(unlockedModules([...d1, dec('alliance-s1', 'd1')], mods)).toEqual(['intake', 'alliance', 'assessment']);
  });
  test('finishing module 2 does not unlock module 3 while module 1 is open', () => {
    expect(unlockedModules([dec('alliance-s1', 'd1')], mods)).toEqual(['intake']);
  });
  test('empty module list', () => expect(unlockedModules([], [])).toEqual([]));
});
