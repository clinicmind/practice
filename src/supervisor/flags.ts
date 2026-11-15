import type { Attempt } from '../progress/types';

export type FlagReason = 'all-met-but-short' | 'identical-to-previous' | 'copied-model';
export type Flag = { attemptId: string; reason: FlagReason };

export const SHORT_RESPONSE = 40;

const CJK = String.raw`\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}`;
const CJK_GAP = new RegExp(`(?<=[${CJK}])\\s+|\\s+(?=[${CJK}])`, 'gu');

/** Lower-case, drop punctuation, collapse whitespace (and drop it next to CJK, where it carries no meaning). */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(CJK_GAP, '');
}

/**
 * Attempts a supervisor may want to read by hand. These are prompts for a
 * human to look, not judgements. `attempts` must all belong to ONE student.
 * `models` maps item id → its example response (only `model_response` is read).
 */
export function flagAttempts(
  attempts: Attempt[],
  models: Record<string, { model_response: string }> = {},
): Flag[] {
  // Attempts per item in time order, to find the previous one.
  const prev = new Map<string, Attempt>();
  const byTime = [...attempts].sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
  const last = new Map<string, Attempt>();
  for (const a of byTime) {
    const p = last.get(a.itemId);
    if (p) prev.set(a.id, p);
    last.set(a.itemId, a);
  }

  const flags: Flag[] = [];
  for (const a of attempts) {
    if (a.criteriaMet.length === 3 && a.criteriaMet.every(Boolean) && a.response.trim().length < SHORT_RESPONSE) {
      flags.push({ attemptId: a.id, reason: 'all-met-but-short' });
    }
    const p = prev.get(a.id);
    if (p && p.response === a.response) {
      flags.push({ attemptId: a.id, reason: 'identical-to-previous' });
    }
    const model = models[a.itemId]?.model_response;
    if (model !== undefined) {
      const m = normalize(model);
      if (m !== '' && m === normalize(a.response)) flags.push({ attemptId: a.id, reason: 'copied-model' });
    }
  }
  return flags;
}
