/**
 * 費用計算。純函式，沒有 DOM／Node 依賴。
 *
 * 單價（美元／百萬 token）。來源：https://platform.claude.com/docs/en/about-claude/pricing，
 * 核對日期 2026-11-23（成本文件第 2 節；和 scripts/estimate-ai-cost.ts 的 PRICES 同一組，測試交叉驗證）。
 * Haiku 5.5 的價格是「提示 ≤ 100,000 token」的那一檔；超過是另一檔較高的價格（輸入 $0.50／輸出 $2.50），
 * 本系統用不到，所以不處理：超過就拒絕呼叫（checkPromptSize），也不替它算錢（costUsd 丟錯）。
 * 快取寫入用 5 分鐘 TTL 的價格（輸入 ×1.25）；快取讀取 Haiku 輸入 ×0.1。
 */
import { MODELS, type ModelId } from './models';
import type { LlmRequest, LlmUsage } from './llm';

export const PRICES_CHECKED_ON = '2026-11-23';
export const PRICES_SOURCE = 'https://platform.claude.com/docs/en/about-claude/pricing';

export type Rates = { input: number; cacheWrite: number; cacheRead: number; output: number };

export const PRICES: Record<ModelId, Rates> = {
  [MODELS.practice]: { input: 0.1, cacheWrite: 0.125, cacheRead: 0.01, output: 0.5 },
  [MODELS.report]: { input: 2, cacheWrite: 2.5, cacheRead: 0.1, output: 10 },
};

export const HIGH_PRICE_THRESHOLD_TOKENS = 100_000;

/** 回傳美元（未四捨五入）。一般提示總長（輸入＋快取寫＋快取讀）超過 100,000 token 時丟錯，不用高價檔計算。 */
export function costUsd(model: ModelId, usage: LlmUsage): number {
  const rates = PRICES[model];
  if (!rates) throw new Error(`no price for model ${String(model)}`);
  const promptTokens = usage.input + usage.cacheWrite + usage.cacheRead;
  if (promptTokens > HIGH_PRICE_THRESHOLD_TOKENS) {
    throw new RangeError(`prompt over ${HIGH_PRICE_THRESHOLD_TOKENS} tokens is not priced`);
  }
  return (
    (usage.input * rates.input + usage.cacheWrite * rates.cacheWrite + usage.cacheRead * rates.cacheRead + usage.output * rates.output) /
    1e6
  );
}

/** `ai_usage.cost_usd` 是 numeric(10,6)。 */
export const roundUsd = (usd: number): number => Math.round(usd * 1e6) / 1e6;

/**
 * 送出前的粗估（偏高，不低估）：每個碼位按 1.5 token 算。
 * 目的只是擋掉離譜的長度；真正的用量以回應的 usage 為準。
 */
export function estimatePromptTokens(req: LlmRequest): number {
  const chars = [req.system, ...req.blocks.map((b) => b.text)].reduce((n, t) => n + [...t].length, 0);
  return Math.ceil(chars * 1.5);
}

export function checkPromptSize(req: LlmRequest): { ok: true } | { ok: false; reason: 'prompt_too_large' } {
  return estimatePromptTokens(req) > HIGH_PRICE_THRESHOLD_TOKENS ? { ok: false, reason: 'prompt_too_large' } : { ok: true };
}
