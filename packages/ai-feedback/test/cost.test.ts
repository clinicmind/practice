import { test, expect } from 'vitest';
import {
  costUsd, PRICES, PRICES_CHECKED_ON, checkPromptSize, estimatePromptTokens, buildPracticeRequest, roundUsd,
} from '../src/index';
// 交叉驗證：不複製公式，直接用離線估算腳本的函式算同一組輸入。
import {
  practiceRequestCost, reportRequestCost, SCENARIOS, PRICES as SCRIPT_PRICES, loadDrillStats, estimateTokens,
} from '../../../scripts/estimate-ai-cost';

const HAIKU = 'claude-haiku-5-5';
const SONNET = 'claude-sonnet-5-5';

test('prices match the cost script and carry their source date', () => {
  expect(PRICES_CHECKED_ON).toBe('2026-11-23');
  expect(PRICES[HAIKU]).toEqual({ input: SCRIPT_PRICES.haiku.input, cacheWrite: SCRIPT_PRICES.haiku.cacheWrite5m, cacheRead: SCRIPT_PRICES.haiku.cacheRead, output: SCRIPT_PRICES.haiku.output });
  expect(PRICES[SONNET]).toEqual({ input: SCRIPT_PRICES.sonnet.input, cacheWrite: SCRIPT_PRICES.sonnet.cacheWrite5m, cacheRead: SCRIPT_PRICES.sonnet.cacheRead, output: SCRIPT_PRICES.sonnet.output });
});

test('costUsd counts cache writes at 1.25x and reads at 0.1x of the input price (Haiku)', () => {
  const p = PRICES[HAIKU];
  expect(p.cacheWrite / p.input).toBeCloseTo(1.25, 10);
  expect(p.cacheRead / p.input).toBeCloseTo(0.1, 10);
  const n = 100_000; // 單價是每百萬 token，所以 10 萬 token 是單價的 1/10
  expect(costUsd(HAIKU, { input: n, output: 0, cacheWrite: 0, cacheRead: 0 })).toBeCloseTo(0.01, 10);
  expect(costUsd(HAIKU, { input: 0, output: 0, cacheWrite: n, cacheRead: 0 })).toBeCloseTo(0.0125, 10);
  expect(costUsd(HAIKU, { input: 0, output: 0, cacheWrite: 0, cacheRead: n })).toBeCloseTo(0.001, 10);
  expect(costUsd(HAIKU, { input: 0, output: 1_000_000, cacheWrite: 0, cacheRead: 0 })).toBeCloseTo(0.5, 10);
  expect(costUsd(SONNET, { input: n, output: 1_000_000, cacheWrite: 0, cacheRead: 0 })).toBeCloseTo(10.2, 10);
});

test('an unknown model is an error, not a free request', () => {
  expect(() => costUsd('claude-unknown' as never, { input: 1, output: 1, cacheWrite: 0, cacheRead: 0 })).toThrow();
});

test('costUsd matches the cost script within 5% for the mid scenario (practice, Haiku)', () => {
  const stats = loadDrillStats('content', 'zh-Hant');
  expect(stats.drills).toBeGreaterThan(0);
  const sc = SCENARIOS.mid;
  // 把腳本的假設拆成用量：一次命中快取、一次沒命中，按 hit rate 加權（和腳本的期望值同一個算法）。
  const cached = 1200 + stats.avgCriteriaTokens;
  const fresh = stats.avgPromptTokens - stats.avgCriteriaTokens + 40 + sc.studentTokens;
  const output = 140 + 0.6 * sc.studentTokens + sc.thinkingTokens;
  const hit = costUsd(HAIKU, { input: fresh, output, cacheWrite: 0, cacheRead: cached });
  const miss = costUsd(HAIKU, { input: fresh, output, cacheWrite: cached, cacheRead: 0 });
  const blended = sc.cacheHitRate * hit + (1 - sc.cacheHitRate) * miss;
  const script = practiceRequestCost(stats, sc, true);
  expect(Math.abs(blended - script) / script).toBeLessThan(0.05);
  expect(Math.abs(script - 0.00032) / 0.00032).toBeLessThan(0.1); // 成本文件第 3 節的數字（約）
});

test('costUsd matches the cost script within 5% for the report draft (Sonnet)', () => {
  const sc = SCENARIOS.mid;
  const hit = costUsd(SONNET, { input: sc.reportTokens, output: sc.reportOutputTokens, cacheWrite: 0, cacheRead: 2500 });
  const miss = costUsd(SONNET, { input: sc.reportTokens, output: sc.reportOutputTokens, cacheWrite: 2500, cacheRead: 0 });
  const blended = sc.cacheHitRate * hit + (1 - sc.cacheHitRate) * miss;
  const script = reportRequestCost(sc, true);
  expect(Math.abs(blended - script) / script).toBeLessThan(0.05);
});

test('roundUsd rounds to the 6 decimals of ai_usage.cost_usd', () => {
  expect(roundUsd(0.00032049)).toBe(0.00032);
  expect(roundUsd(0.0000004)).toBe(0);
});

test('a usage over 100,000 prompt tokens is refused rather than priced at the high rate', () => {
  const big = { input: 60_000, output: 100, cacheWrite: 30_000, cacheRead: 20_000 };
  expect(() => costUsd(HAIKU, big)).toThrow(/100/);
  expect(() => costUsd(HAIKU, { ...big, input: 50_000 })).not.toThrow(); // 剛好 100,000
});

test('checkPromptSize refuses a request that could pass 100,000 tokens before it is sent', () => {
  const mk = (n: number) => buildPracticeRequest({
    locale: 'zh-Hant', context: '字'.repeat(n), client: 'c', criteria: ['a', 'b', 'c'],
    modelResponse: 'm', studentResponse: '這是學生寫的一段回應，用來測試長度。', nonce: 'a1b2c3d4e5f60718293a4b5c',
  });
  expect(checkPromptSize(mk(500))).toEqual({ ok: true });
  expect(checkPromptSize(mk(80_000))).toEqual({ ok: false, reason: 'prompt_too_large' });
  expect(estimatePromptTokens(mk(500))).toBeGreaterThan(estimateTokens(mk(500).system) * 0.9); // 保守：不低估
});
