import { describe, expect, test } from 'vitest';
import type { Attempt } from '../progress/types';
import { flagAttempts } from './flags';

let n = 0;
function att(o: Partial<Attempt> = {}): Attempt {
  n++;
  return {
    id: `a${n}`, itemId: 'intake-e01', criteriaMet: [true, true, false],
    response: 'A perfectly ordinary and reasonably detailed reply.',
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, n)).toISOString(), ...o,
  };
}
const MODEL = "It sounds like starting feels overwhelming; where would you like to begin?";
const models = { 'intake-e01': { model_response: MODEL } };
const R = 'Same words both times, long enough to count as a real answer.';

describe('flagAttempts', () => {
  test.each([
    [[att({ criteriaMet: [true, true, true], response: 'ok fine' })], 'all-met-but-short'],
    [[att({ response: R }), att({ response: R })], 'identical-to-previous'],
    [[att({ response: '  ' + MODEL.toUpperCase() + '!! ' })], 'copied-model'],
  ] as const)('flags %#', (attempts, reason) => {
    const flags = flagAttempts([...attempts], models);
    expect(flags.map((f) => f.reason)).toContain(reason);
    const flagged = reason === 'identical-to-previous' ? attempts[1] : attempts[0];
    expect(flags).toContainEqual({ attemptId: flagged.id, reason });
  });

  test('an honest 60-character attempt with 2 criteria is not flagged', () => {
    const response = 'I hear that it is hard to know where to begin with all this.';
    expect(response.length).toBeGreaterThanOrEqual(60);
    expect(flagAttempts([att({ response, criteriaMet: [true, true, false] })], models)).toEqual([]);
  });

  test('all three criteria with a long response is not flagged', () => {
    expect(flagAttempts([att({ criteriaMet: [true, true, true], response: 'x'.repeat(40) })], models)).toEqual([]);
  });

  test('short is judged on the trimmed response; 39 characters is short, 40 is not', () => {
    const ok = att({ criteriaMet: [true, true, true], response: '  ' + 'x'.repeat(40) + '  ' });
    const short = att({ criteriaMet: [true, true, true], response: 'y'.repeat(39) });
    expect(flagAttempts([ok, short], models)).toEqual([{ attemptId: short.id, reason: 'all-met-but-short' }]);
  });

  test('a short response without all criteria ticked is not "all met"', () => {
    expect(flagAttempts([att({ criteriaMet: [true, true, false], response: 'ok fine' })], models)).toEqual([]);
  });

  test('identical-to-previous only compares consecutive attempts at the same item', () => {
    const a1 = att({ itemId: 'i1', response: R });
    const other = att({ itemId: 'i2', response: R });
    const a2 = att({ itemId: 'i1', response: R });
    expect(flagAttempts([a1, other, a2], {})).toEqual([{ attemptId: a2.id, reason: 'identical-to-previous' }]);
    const a3 = att({ itemId: 'i1', response: 'Something different, and also long enough to be real.' });
    const a4 = att({ itemId: 'i1', response: R });
    expect(flagAttempts([a1, a3, a4], {})).toEqual([]); // not consecutive
  });

  test('"previous" follows time, not the order of the input', () => {
    const first = att({ response: R });
    const second = att({ response: R });
    expect(flagAttempts([second, first], {})).toEqual([{ attemptId: second.id, reason: 'identical-to-previous' }]);
  });

  test('copied-model ignores case, punctuation and extra spaces, but not different words', () => {
    const same = att({ response: 'it SOUNDS like   starting feels overwhelming -- where would you like to begin' });
    const near = att({ response: 'It sounds like starting feels overwhelming; where would you like to start?' });
    expect(flagAttempts([same, near], models)).toEqual([{ attemptId: same.id, reason: 'copied-model' }]);
  });

  test('copied-model works with non-Latin text', () => {
    const m = { 'x-1': { model_response: '聽起來，要開始真的很不容易。' } };
    const a = att({ itemId: 'x-1', response: ' 聽起來 要開始真的很不容易 ' });
    expect(flagAttempts([a], m)).toEqual([{ attemptId: a.id, reason: 'copied-model' }]);
  });

  test('an item with no known model is never flagged as copied; empty text never matches', () => {
    expect(flagAttempts([att({ itemId: 'unknown', response: MODEL })], models)).toEqual([]);
    expect(flagAttempts([att({ response: '!!!' })], { 'intake-e01': { model_response: '...' } })).toEqual([]);
  });

  test('one attempt can carry several flags', () => {
    const a = att({ criteriaMet: [true, true, true], response: MODEL.slice(0, 30) });
    const flags = flagAttempts([a], { 'intake-e01': { model_response: MODEL.slice(0, 30) } });
    expect(flags.map((f) => f.reason).sort()).toEqual(['all-met-but-short', 'copied-model']);
  });

  test('no attempts, no flags', () => {
    expect(flagAttempts([], models)).toEqual([]);
  });
});
