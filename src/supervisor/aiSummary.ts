/** Pure helpers for the supervisor's AI views. No text of any response is handled here, only ids and flags. */
export type AiEvaluation = { attemptId: string; userId: string; itemId: string; concern: 'none' | 'risk-content' | 'off-task' };
export type AiDisagreement = { attemptId: string; userId: string; itemId: string; criterion: 1 | 2 | 3; selfMet: boolean; aiMet: boolean };
export type Direction = 'self-only' | 'ai-only';
export type StudentAiRow = { userId: string; checked: number; selfOnly: number; aiOnly: number };

/** 'self-only': the student ticked it and the AI did not find it. 'ai-only': the AI found it and the student did not tick. */
export const directionOf = (d: AiDisagreement): Direction => (d.selfMet && !d.aiMet ? 'self-only' : 'ai-only');

/** One row per student of the cohort who has at least one checked response, most differences first. */
export function summarizeByStudent(evals: AiEvaluation[], diffs: AiDisagreement[], studentIds: string[]): StudentAiRow[] {
  const mine = new Set(studentIds);
  const rows = new Map<string, StudentAiRow>();
  const row = (userId: string) => {
    let r = rows.get(userId);
    if (!r) rows.set(userId, (r = { userId, checked: 0, selfOnly: 0, aiOnly: 0 }));
    return r;
  };
  for (const e of evals) if (mine.has(e.userId) && e.concern === 'none') row(e.userId).checked++;
  for (const d of diffs) if (mine.has(d.userId)) row(d.userId)[directionOf(d) === 'self-only' ? 'selfOnly' : 'aiOnly']++;
  return [...rows.values()]
    .filter((r) => r.checked > 0 || r.selfOnly + r.aiOnly > 0)
    .sort((a, b) => b.selfOnly + b.aiOnly - (a.selfOnly + a.aiOnly) || a.userId.localeCompare(b.userId));
}

export const riskOf = (evals: AiEvaluation[], studentIds: string[]): AiEvaluation[] =>
  evals.filter((e) => e.concern === 'risk-content' && studentIds.includes(e.userId));
