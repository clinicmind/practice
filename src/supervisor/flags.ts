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
 * `models` maps item id → its example response (only `model_response` is read). Pass one map per
 * language: a response that copies the example in any language is flagged.
 */
type Models = Record<string, { model_response: string }>;
export function flagAttempts(
  attempts: Attempt[],
  models: Models | readonly Models[] = {},
): Flag[] {
  const modelSets: readonly Models[] = Array.isArray(models) ? (models as readonly Models[]) : [models as Models];
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
    const response = normalize(a.response);
    const copied = modelSets.some((set) => {
      const model = set[a.itemId]?.model_response;
      return model !== undefined && normalize(model) !== '' && normalize(model) === response;
    });
    if (copied) flags.push({ attemptId: a.id, reason: 'copied-model' });
  }
  return flags;
}
