/**
 * 模型輸出的伺服器端核對。不通過的輸出不儲存、不顯示、不計入學生每日上限。
 * 純函式，沒有 DOM／Node 依賴。
 */
import { FeedbackOutputSchema, type FeedbackOutput, type Locale } from './schema';

export const CRITERIA_COUNT = 3;
export const SUGGESTION_MAX_ZH_CHARS = 60;
export const SUGGESTION_MAX_EN_WORDS = 40;

export type CheckFailure = 'schema' | 'evidence' | 'suggestion_length' | 'criteria_count';
export type CheckWarning = { criterion: number; kind: 'unsupported' };
export type CheckResult =
  | { ok: true; value: FeedbackOutput; warnings: CheckWarning[] }
  | { ok: false; reason: CheckFailure };

/**
 * 只把連續空白折成一個空格。不做 NFKC、不分大小寫：寧可多丟，也不放行捏造的引文。
 * 不 trim：模型引用的片段前後有空白，學生的回應裡也有，折完仍然是子字串。
 */
export function foldWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ');
}

function suggestionTooLong(s: string, locale: Locale): boolean {
  if (locale === 'zh-Hant') return [...s].length > SUGGESTION_MAX_ZH_CHARS;
  const words = s.trim().split(/\s+/).filter(Boolean);
  return words.length > SUGGESTION_MAX_EN_WORDS;
}

export function checkOutput(raw: unknown, studentResponse: string, locale: Locale): CheckResult {
  // 先分辨「條數不對」，因為它是獨立的失敗原因。
  const rawCriteria = (raw as { criteria?: unknown } | null)?.criteria;
  if (Array.isArray(rawCriteria) && rawCriteria.length !== CRITERIA_COUNT) {
    return { ok: false, reason: 'criteria_count' };
  }
  const parsed = FeedbackOutputSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: 'schema' };
  const value = parsed.data;

  // concern = none 時一定要有建議；其他情況不顯示建議，所以允許空字串。
  if (value.concern === 'none' && value.suggestion.trim() === '') return { ok: false, reason: 'schema' };

  const hay = foldWhitespace(studentResponse);
  const warnings: CheckWarning[] = [];
  for (let i = 0; i < value.criteria.length; i++) {
    const c = value.criteria[i]!;
    if (c.evidence === '') {
      if (c.met) warnings.push({ criterion: i, kind: 'unsupported' });
      continue;
    }
    if (!hay.includes(foldWhitespace(c.evidence))) return { ok: false, reason: 'evidence' };
  }
  if (suggestionTooLong(value.suggestion, locale)) return { ok: false, reason: 'suggestion_length' };
  return { ok: true, value, warnings };
}
