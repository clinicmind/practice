import { describe, expect, test } from 'vitest';
import { RULES, SUGGESTIONS } from '../../packages/deid/src';
import { en } from './en';
import { zhHant } from './zh-Hant';

describe('report strings', () => {
  test.each([['en', en], ['zh-Hant', zhHant]] as const)('%s has a rule name and a suggestion for every scanner rule', (_n, s) => {
    for (const { id } of RULES) {
      expect(s.reports.rules[id], id).toBeTruthy();
      expect(s.reports.suggestions[id], id).toBeTruthy();
    }
    expect(Object.keys(s.reports.rules).sort()).toEqual(RULES.map((r) => r.id).sort());
    expect(Object.keys(s.reports.suggestions).sort()).toEqual(RULES.map((r) => r.id).sort());
  });
  test('English suggestions match the scanner, so they cannot drift', () => {
    expect(en.reports.suggestions).toEqual(SUGGESTIONS);
  });
  test('the warning is exact in English and says the same in Chinese', () => {
    expect(en.reports.warning).toBe('This check can miss things. You are responsible for removing every detail that could identify a client.');
    expect(zhHant.reports.warning).toContain('可能會漏');
  });
  test('Chinese uses the agreed terms and avoids mainland wording', () => {
    const all = JSON.stringify(zhHant.reports);
    expect(all).toContain('個案');
    expect(all).toContain('督導');
    for (const bad of ['信息', '視頻', '質量', '網絡', '唔', '嘅']) expect(all).not.toContain(bad);
  });
});
