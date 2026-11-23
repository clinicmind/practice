/** 呼叫模型前的輸入守衛。不通過就不呼叫（也不花錢）。純函式。 */
export const INPUT_MIN = 20;
export const INPUT_MAX = 1500;
/** 分隔標記的固定字樣，nonce 附在後面。 */
export const DELIMITER_WORD = 'STUDENT_RESPONSE';

export type GuardResult = { ok: true } | { ok: false; reason: 'too_short' | 'too_long' | 'contains_delimiter' };

/**
 * 長度用 Unicode 碼位。下限看去掉頭尾空白後的長度（灌空白湊不到 20）；
 * 上限看原文長度（幾 MB 的空白也不送）。
 */
export function guardInput(studentResponse: string, nonce: string): GuardResult {
  if ([...studentResponse].length > INPUT_MAX) return { ok: false, reason: 'too_long' };
  if ([...studentResponse.trim()].length < INPUT_MIN) return { ok: false, reason: 'too_short' };
  if (studentResponse.includes(nonce) || studentResponse.includes(DELIMITER_WORD)) {
    return { ok: false, reason: 'contains_delimiter' };
  }
  return { ok: true };
}
