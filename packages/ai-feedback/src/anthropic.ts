/**
 * 真實的 Anthropic 客戶端。整個專案只有這個檔案知道 api.anthropic.com。
 * 純函式庫，沒有 DOM／Node 依賴；`fetchFn` 由呼叫端注入（測試用假的，Edge Function 用全域 fetch）。
 *
 * ── C1：SDK 還是 fetch？結論：fetch（2026-11-23，只做打包實驗，沒有呼叫 API）──
 * 實驗：`@anthropic-ai/sdk@1.12.0`，esbuild 單一檔案打包，建構時注入 `fetch`，對假 fetch 發一個請求。
 *   - `platform: 'neutral'` 打包失敗（SDK 內有 `node:child_process`）；`browser` 和 `node` 可以。
 *   - `browser` 版：未壓縮 1,082,888 位元組、壓縮後 386,982 位元組。現有 `reports/index.ts` 是 27,205 位元組
 *     （約 40 倍／14 倍）。內含 `node:buffer`、`process.env` 等 7 處環境讀取、憑證檔／OAuth 換 token 的程式。
 *   - 它「能」打包、也能對假 fetch 運作。我們沒有證明「不可行」；但擁有人要把這個檔案貼進 Supabase 網頁編輯器，
 *     貼上上限我們讀不到（未證實），1 MB 的單檔風險高；而且 T7 要核對「檔案裡沒有金鑰以外的真實網址」，
 *     SDK 內有大量文件網址；SDK 的自動重試（預設 2 次）要關掉，才符合「最多重試一次」。
 *   - 我們只用一個端點，輸出由 zod 自己驗證，SDK 的便利幾乎用不到。所以退到 `fetch`。
 *   若顧問要改用 SDK：只要重寫本檔（`new Anthropic({ apiKey, fetch: fetchFn, maxRetries: 0 })`
 *   加同樣的對應），其他程式只認 LlmClient，不受影響。
 *
 * ── 對照 claude-api skill（快取日期 2026-11-03）──
 *   - 標頭：`x-api-key`、`anthropic-version`、`content-type`。skill 的 curl 範例用 `anthropic-version: 2026-10-21`；
 *     舊值 `2023-06-01` 仍可用但 2026-10-21 起 `temperature`／`top_p`／`top_k` 任何值都 400（我們不送）。
 *     兩個版本對本請求的形狀沒有差別。T16（真實冒煙測試）是第一次對真實 API 驗證，API_VERSION 在這裡改。
 *   - 結構化輸出：`output_config: { effort, format: { type: 'json_schema', schema } }`（舊的 `output_format` 已棄用）。
 *   - 快取：兩個 `cache_control: { type: 'ephemeral' }` 斷點（system、criteria 區塊）。Haiku 5.5 最小可快取
 *     長度 skill 寫 512 token，「要看 usage.cache_read_input_tokens 驗證」（T16）。
 *   - 拒答：HTTP 200、`stop_reason: "refusal"`；先看 stop_reason 才讀 content；Haiku 5.5 沒有伺服器端備援，不要送 `fallbacks`。
 *   - 回應 content 可能以 `thinking` 區塊開頭：只取 `text` 區塊。thinking 也算進 max_tokens
 *     （計畫的 600 加上 adaptive 思考，可能不夠；`max_tokens` 停止會被當作 unavailable，T16 用 usage 校準）。
 */
import { LlmError, type LlmClient, type LlmRequest, type LlmResult, type StopReason } from './llm';

export const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
export const API_VERSION = '2026-10-21';

export type AnthropicClientOptions = {
  apiKey: string;
  fetchFn: typeof fetch;
  /** 重試前等待。預設 400 ms；測試傳空函式。 */
  sleep?: (ms: number) => Promise<void>;
  /** 單次請求逾時，預設 30 秒。逾時不重試（第一次請求可能已經計費）。 */
  timeoutMs?: number;
};

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function bodyFor(req: LlmRequest): string {
  const cc = { type: 'ephemeral' } as const;
  return JSON.stringify({
    model: req.model,
    max_tokens: req.maxTokens,
    system: [{ type: 'text', text: req.system, cache_control: cc }],
    messages: [
      {
        role: 'user',
        content: req.blocks.map((b) => (b.cache ? { type: 'text', text: b.text, cache_control: cc } : { type: 'text', text: b.text })),
      },
    ],
    thinking: { type: req.thinking },
    output_config: { effort: req.effort, format: { type: 'json_schema', schema: req.schema } },
  });
}

function kindForStatus(status: number): LlmError['kind'] {
  if (status === 429) return 'rate_limited';
  if (status === 401 || status === 403) return 'auth';
  if (status >= 500) return 'unavailable';
  return 'bad_request';
}

const isAbort = (e: unknown) => typeof e === 'object' && e !== null && (e as { name?: string }).name === 'AbortError';
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

function parse(json: unknown): LlmResult {
  const j = json as { stop_reason?: unknown; content?: unknown; usage?: Record<string, unknown> } | null;
  if (!j || typeof j !== 'object' || typeof j.stop_reason !== 'string' || !Array.isArray(j.content) || !j.usage) {
    throw new LlmError('unavailable');
  }
  const usage = {
    input: num(j.usage.input_tokens),
    output: num(j.usage.output_tokens),
    cacheWrite: num(j.usage.cache_creation_input_tokens),
    cacheRead: num(j.usage.cache_read_input_tokens),
  };
  const stopReason: StopReason =
    j.stop_reason === 'end_turn' || j.stop_reason === 'max_tokens' || j.stop_reason === 'refusal' ? j.stop_reason : 'other';
  if (stopReason !== 'end_turn') return { stopReason, text: null, usage };
  const texts = (j.content as { type?: unknown; text?: unknown }[])
    .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string);
  return { stopReason, text: texts.length ? texts.join('') : null, usage };
}

export function createAnthropicClient(opts: AnthropicClientOptions): LlmClient {
  if (!opts.apiKey) throw new Error('apiKey is required');
  const sleep = opts.sleep ?? defaultSleep;
  const timeoutMs = opts.timeoutMs ?? 30_000;

  async function once(req: LlmRequest): Promise<Response> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      return await opts.fetchFn(ANTHROPIC_MESSAGES_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': opts.apiKey, 'anthropic-version': API_VERSION },
        body: bodyFor(req),
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async complete(req: LlmRequest): Promise<LlmResult> {
      let res: Response | null = null;
      let failure: LlmError | null = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          res = await once(req);
        } catch (e) {
          // 一律丟新的 LlmError：原錯誤的訊息可能含金鑰或網址。
          if (isAbort(e)) throw new LlmError('unavailable'); // 逾時不重試
          res = null;
          failure = new LlmError('unavailable');
        }
        if (res) {
          if (res.ok) return parse(await res.json().catch(() => null));
          const kind = kindForStatus(res.status);
          failure = new LlmError(kind);
          if (kind !== 'rate_limited' && kind !== 'unavailable') throw failure; // 4xx：重試只會多花錢
        }
        if (attempt === 0) await sleep(400);
      }
      throw failure ?? new LlmError('unavailable');
    },
  };
}
