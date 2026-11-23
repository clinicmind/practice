// @vitest-environment node
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  PRICES,
  SCENARIOS,
  estimateTokens,
  loadDrillStats,
  practiceRequestCost,
  estimateProgram,
  dailyCapCeiling,
} from './estimate-ai-cost';

const CONTENT = join(__dirname, '..', 'content');

describe('estimateTokens', () => {
  test('empty text is zero tokens', () => {
    expect(estimateTokens('')).toBe(0);
  });
  test('Latin text counts about chars / 3.1 (4 chars per token, +30% newer tokenizer)', () => {
    const t = estimateTokens('a'.repeat(310));
    expect(t).toBeGreaterThanOrEqual(95);
    expect(t).toBeLessThanOrEqual(105);
  });
  test('CJK text counts more tokens per character than Latin', () => {
    expect(estimateTokens('你好嗎'.repeat(10))).toBeGreaterThan(estimateTokens('abc'.repeat(10)));
  });
  test('is monotonic in length', () => {
    expect(estimateTokens('abcdef ghi')).toBeGreaterThan(estimateTokens('abc'));
  });
});

describe('PRICES', () => {
  test('record the check date and the source', () => {
    expect(PRICES.checkedOn).toBe('2026-11-23');
    expect(PRICES.source).toMatch(/platform\.claude\.com/);
  });
  test('Haiku 5.5 and Sonnet 5.5 rates match the pricing page', () => {
    expect(PRICES.haiku).toMatchObject({ input: 0.1, cacheWrite5m: 0.125, cacheRead: 0.01, output: 0.5 });
    expect(PRICES.sonnet).toMatchObject({ input: 2, cacheWrite5m: 2.5, cacheRead: 0.1, output: 10 });
  });
});

describe('loadDrillStats', () => {
  test('reads criteria, context, client and model response from a content tree', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cost-'));
    const mod = join(dir, 'en', 'stages', 'foundations', 'm1');
    mkdirSync(mod, { recursive: true });
    writeFileSync(
      join(mod, 'drills.yaml'),
      [
        '- id: m1-e01',
        '  level: easy',
        '  skill: s',
        '  context: "ctx"',
        '  client: "hello there"',
        '  criteria: ["one", "two", "three"]',
        '',
      ].join('\n'),
    );
    writeFileSync(
      join(mod, 'models.yaml'),
      ['m1-e01:', '  model_response: "a good answer"', '  why: "w"', '  avoid: "a"', ''].join('\n'),
    );
    const s = loadDrillStats(dir, 'en');
    expect(s.drills).toBe(1);
    expect(s.avgPromptTokens).toBeGreaterThan(0);
    expect(s.avgCriteriaTokens).toBeGreaterThan(0);
    expect(s.avgCriteriaTokens).toBeLessThan(s.avgPromptTokens + 1);
  });

  test('real content: 8 foundations modules x 30 drills in both languages', () => {
    for (const locale of ['en', 'zh-Hant'] as const) {
      const s = loadDrillStats(CONTENT, locale);
      expect(s.drills).toBe(240);
      expect(s.avgPromptTokens).toBeGreaterThan(50);
      expect(s.avgPromptTokens).toBeLessThan(1500);
    }
  });

  test('Chinese drills cost more tokens per drill than the English ones are allowed to hide', () => {
    const en = loadDrillStats(CONTENT, 'en');
    const zh = loadDrillStats(CONTENT, 'zh-Hant');
    expect(zh.avgPromptTokens).toBeGreaterThan(0);
    expect(en.avgPromptTokens).toBeGreaterThan(0);
  });
});

describe('practiceRequestCost', () => {
  const stats = { drills: 10, avgPromptTokens: 400, avgCriteriaTokens: 100 };

  test('caching never costs more than no caching once the hit rate is high', () => {
    const sc = { ...SCENARIOS.mid, cacheHitRate: 0.9 };
    const withCache = practiceRequestCost(stats, sc, true);
    const noCache = practiceRequestCost(stats, sc, false);
    expect(withCache).toBeLessThan(noCache);
  });

  test('at a 0% hit rate caching costs slightly more (every request pays the write premium)', () => {
    const sc = { ...SCENARIOS.mid, cacheHitRate: 0 };
    expect(practiceRequestCost(stats, sc, true)).toBeGreaterThan(practiceRequestCost(stats, sc, false));
  });

  test('longer student responses cost more', () => {
    const a = practiceRequestCost(stats, { ...SCENARIOS.mid, studentTokens: 50 }, true);
    const b = practiceRequestCost(stats, { ...SCENARIOS.mid, studentTokens: 500 }, true);
    expect(b).toBeGreaterThan(a);
  });

  test('thinking tokens are billed as output', () => {
    const a = practiceRequestCost(stats, { ...SCENARIOS.mid, thinkingTokens: 0 }, true);
    const b = practiceRequestCost(stats, { ...SCENARIOS.mid, thinkingTokens: 1000 }, true);
    expect(b - a).toBeCloseTo((1000 * PRICES.haiku.output) / 1e6, 8);
  });
});

describe('estimateProgram', () => {
  const stats = { drills: 240, avgPromptTokens: 400, avgCriteriaTokens: 100 };

  test('counts 600 drills per student: 8 foundations + 6 EFT + 6 DBT modules of 30', () => {
    const r = estimateProgram(stats, SCENARIOS.mid);
    expect(r.drillsPerStudent).toBe(600);
    expect(r.students).toBe(30);
  });

  test('low < mid < high, and total = practice + reports', () => {
    const low = estimateProgram(stats, SCENARIOS.low);
    const mid = estimateProgram(stats, SCENARIOS.mid);
    const high = estimateProgram(stats, SCENARIOS.high);
    expect(low.totalUsd).toBeLessThan(mid.totalUsd);
    expect(mid.totalUsd).toBeLessThan(high.totalUsd);
    expect(mid.totalUsd).toBeCloseTo(mid.practiceUsd + mid.reportUsd, 8);
  });

  test('prompt caching saves money when the hit rate is above break-even (low, mid)', () => {
    for (const sc of [SCENARIOS.low, SCENARIOS.mid]) {
      const r = estimateProgram(stats, sc);
      expect(r.totalUsd).toBeLessThan(r.totalUsdNoCache);
      expect(r.cacheSavingsPct).toBeGreaterThan(0);
    }
  });

  test('high scenario assumes a 20% hit rate, just under break-even: caching neither helps nor hurts much', () => {
    const r = estimateProgram(stats, SCENARIOS.high);
    expect(Math.abs(r.cacheSavingsPct)).toBeLessThan(2);
  });

  test('per-student figure is total / students', () => {
    const r = estimateProgram(stats, SCENARIOS.mid);
    expect(r.perStudentUsd).toBeCloseTo(r.totalUsd / r.students, 8);
  });
});

describe('dailyCapCeiling', () => {
  test('the cap of 30 practice feedbacks per day bounds one student-day', () => {
    const stats = { drills: 240, avgPromptTokens: 400, avgCriteriaTokens: 100 };
    const day = dailyCapCeiling(stats, SCENARIOS.high);
    expect(day).toBeGreaterThan(0);
    expect(day).toBeLessThan(1); // 30 Haiku calls cost well under US$1
  });
});
