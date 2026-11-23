/**
 * 模型 id 的唯一來源。核對：2026-11-23，claude-api skill（快取日期 2026-11-03）。
 * id 不加日期尾碼。定價見 cost.ts。
 *
 * Haiku 5.5 的行為（本套件的請求都照這個寫，T16 的冒煙測試才第一次對真實 API 驗證）：
 * - `temperature`／`top_p`／`top_k` 不送（非預設值會 400；API 版本 2026-10-21 起任何值都 400）。
 * - 沒有 assistant prefill；`thinking` 預設是 adaptive，`budget_tokens` 會 400；
 *   `{type:'disabled'}` 只在 effort ≤ high 時可用。`effort` 放在 `output_config.effort`，預設 medium。
 * - 沒有伺服器端拒答備援；拒答是 HTTP 200、`stop_reason: "refusal"`，要先看 stop_reason 再讀 content。
 * - `thinking` 區塊也算進 `max_tokens`。回應的 content 可能以 thinking 區塊開頭：依 type 取 text，不看位置。
 */
export const MODELS = {
  practice: 'claude-haiku-5-5',
  report: 'claude-sonnet-5-5',
} as const;

export type ModelId = (typeof MODELS)[keyof typeof MODELS];
