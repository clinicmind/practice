/**
 * 呼叫模型的介面。Edge Function、測試、離線腳本只認這個介面；真實實作只在 anthropic.ts。
 * 純型別，沒有 DOM／Node 依賴。
 */
export type Effort = 'low' | 'medium' | 'high';
export type ThinkingMode = 'adaptive' | 'disabled';

/** user 訊息的一個內容塊。`cache: true` 表示這一塊結尾放一個快取斷點。 */
export type LlmBlock = { text: string; cache: boolean };

export type LlmRequest = {
  model: string;
  maxTokens: number;
  effort: Effort;
  thinking: ThinkingMode;
  /** 靜態系統提示。整段結尾是第一個快取斷點。 */
  system: string;
  blocks: LlmBlock[];
  /** `output_config.format.schema`。 */
  schema: object;
};

export type StopReason = 'end_turn' | 'max_tokens' | 'refusal' | 'other';
export type LlmUsage = { input: number; output: number; cacheWrite: number; cacheRead: number };

/** `text` 只在 `end_turn` 時有值。拒答、截斷、其他一律 null：呼叫端不可能誤用不完整的文字。 */
export type LlmResult = { stopReason: StopReason; text: string | null; usage: LlmUsage };

export type LlmErrorKind = 'rate_limited' | 'unavailable' | 'bad_request' | 'auth';

/** 訊息只由 kind 決定：不含回應內容、不含金鑰。 */
export class LlmError extends Error {
  readonly kind: LlmErrorKind;
  constructor(kind: LlmErrorKind) {
    super(`llm_${kind}`);
    this.name = 'LlmError';
    this.kind = kind;
  }
}

export interface LlmClient {
  complete(req: LlmRequest): Promise<LlmResult>;
}
