/**
 * 模型輸出的形狀（規格：docs/specs/2026-11-15-stage4-6-design.md「輸出格式」）。
 * 純函式，沒有 DOM／Node 依賴。
 *
 * 核對紀錄（2026-11-23，claude-api skill，快取日期 2026-11-03）：結構化輸出
 * （`output_config.format = { type: 'json_schema', schema }`）支援 object／array／string／boolean／enum、
 * `additionalProperties: false`（每個 object 都必須有）；**不支援** minLength／maxLength、minimum／maximum
 * 和「複雜的陣列限制」（minItems／maxItems 視為不可用）。所以送出的 JSON_SCHEMA 只放結構；
 * 恰好 3 條、長度、子字串都由本套件在伺服器端核對（evidence.ts）。
 */
import { z } from 'zod';

export const CONCERNS = ['none', 'risk-content', 'off-task'] as const;
export type Concern = (typeof CONCERNS)[number];
export type Locale = 'en' | 'zh-Hant';

const CriterionSchema = z.object({ met: z.boolean(), evidence: z.string() }).strict();

/** 結構驗證。「恰好 3 條」不在這裡，因為要回報不同的原因（criteria_count）。 */
export const FeedbackOutputSchema = z
  .object({
    criteria: z.array(CriterionSchema),
    suggestion: z.string(),
    concern: z.enum(CONCERNS),
  })
  .strict();

export type FeedbackOutput = z.infer<typeof FeedbackOutputSchema>;

/** 送給 API 的 `output_config.format.schema`。手寫，和上面的 zod 一一對應（測試鎖定）。 */
export const JSON_SCHEMA = {
  type: 'object',
  properties: {
    criteria: {
      type: 'array',
      items: {
        type: 'object',
        properties: { met: { type: 'boolean' }, evidence: { type: 'string' } },
        required: ['met', 'evidence'],
        additionalProperties: false,
      },
    },
    suggestion: { type: 'string' },
    concern: { type: 'string', enum: [...CONCERNS] },
  },
  required: ['criteria', 'suggestion', 'concern'],
  additionalProperties: false,
} as const;
