import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, test } from 'vitest';
import { en } from './en';
import { zhHant } from './zh-Hant';
import { LOCALE_KEY, LocaleProvider, detectLocale, useLocale, useT } from './index';

function keyPaths(o: unknown, prefix = ''): string[] {
  if (o === null || typeof o !== 'object') return [prefix];
  return Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => keyPaths(v, prefix ? `${prefix}.${k}` : k));
}
function shape(o: unknown, prefix = ''): string[] {
  if (typeof o === 'function') return [`${prefix}:fn:${(o as Function).length}`];
  if (o !== null && typeof o === 'object') {
    return Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => shape(v, prefix ? `${prefix}.${k}` : k));
  }
  return [`${prefix}:str`];
}

describe('zh-Hant strings', () => {
  test('keys match en.ts exactly, including record keys', () => {
    expect(keyPaths(zhHant).sort()).toEqual(keyPaths(en).sort());
  });
  test('same shape: strings stay strings, functions keep their arity', () => {
    expect(shape(zhHant).sort()).toEqual(shape(en).sort());
  });
  test('no string is left empty and function results are text', () => {
    for (const p of shape(zhHant)) expect(p.endsWith(':str') || p.includes(':fn:')).toBe(true);
    expect(zhHant.footer).toBe('訓練工具。不適用於處於危機中的個案。如有人有風險，請依實習機構的守則處理，並聯絡督導。');
    expect(zhHant.contentFallback).toBe('此模組的中文版尚未提供，現在顯示英文版。');
  });
});

describe('detectLocale', () => {
  const store = (v?: string) => ({ getItem: () => v ?? null }) as unknown as Storage;
  test('a saved choice wins over the browser language', () => {
    expect(detectLocale(store('en'), ['zh-TW'])).toBe('en');
    expect(detectLocale(store('zh-Hant'), ['en-US'])).toBe('zh-Hant');
  });
  test('without a record, a browser language starting with zh gives zh-Hant', () => {
    expect(detectLocale(store(), ['zh-TW', 'en'])).toBe('zh-Hant');
    expect(detectLocale(store(), ['zh'])).toBe('zh-Hant');
    expect(detectLocale(store(), ['ZH-hk'])).toBe('zh-Hant');
    expect(detectLocale(store(), ['en-US'])).toBe('en');
    expect(detectLocale(store(), [])).toBe('en');
  });
  test('an unknown saved value is ignored', () => {
    expect(detectLocale(store('fr'), ['zh-TW'])).toBe('zh-Hant');
  });
  test('a storage that throws still gives a locale', () => {
    const bad = { getItem: () => { throw new Error('denied'); } } as unknown as Storage;
    expect(detectLocale(bad, ['en'])).toBe('en');
  });
});

function Probe() {
  const t = useT();
  const { locale, setLocale } = useLocale();
  return <div><span data-testid="t">{t.common.back}</span><button onClick={() => setLocale(locale === 'en' ? 'zh-Hant' : 'en')}>flip</button></div>;
}

describe('LocaleProvider', () => {
  beforeEach(() => { localStorage.clear(); document.documentElement.lang = ''; });
  test('provides strings, persists the choice and sets <html lang>', () => {
    render(<LocaleProvider><Probe /></LocaleProvider>);
    expect(screen.getByTestId('t').textContent).toBe(en.common.back);
    expect(document.documentElement.lang).toBe('en');
    act(() => screen.getByText('flip').click());
    expect(screen.getByTestId('t').textContent).toBe(zhHant.common.back);
    expect(document.documentElement.lang).toBe('zh-Hant');
    expect(localStorage.getItem(LOCALE_KEY)).toBe('zh-Hant');
  });
  test('LOCALE_KEY is the documented one', () => {
    expect(LOCALE_KEY).toBe('cm.practice.locale');
  });
});
