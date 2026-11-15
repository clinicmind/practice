import { LEVELS, isDecision, type Drill, type Level, type Session } from '../content/schema';
import type { Attempt, Decision } from './types';

export const MIN_RESPONSE = 20;
export const MIN_CRITERIA = 2;
export const PASS_THRESHOLD = 8;

/** Latest attempt wins (by createdAt; ties resolved by list order). */
function latest(attempts: Attempt[], itemId: string): Attempt | undefined {
  let best: Attempt | undefined;
  for (const a of attempts) {
    if (a.itemId !== itemId) continue;
    if (!best || a.createdAt >= best.createdAt) best = a;
  }
  return best;
}

export function itemMet(attempts: Attempt[], itemId: string): boolean {
  const a = latest(attempts, itemId);
  if (!a) return false;
  return (
    a.criteriaMet.filter(Boolean).length >= MIN_CRITERIA && a.response.trim().length >= MIN_RESPONSE
  );
}

export function levelPassed(attempts: Attempt[], drills: Drill[], level: Level): boolean {
  const met = drills.filter((d) => d.level === level && itemMet(attempts, d.id)).length;
  return met >= PASS_THRESHOLD;
}

export function unlockedLevels(attempts: Attempt[], drills: Drill[]): Level[] {
  const out: Level[] = [LEVELS[0]];
  for (let i = 1; i < LEVELS.length; i++) {
    if (!levelPassed(attempts, drills, LEVELS[i - 1])) break;
    out.push(LEVELS[i]);
  }
  return out;
}

export function walkthroughDone(decisions: Decision[], sessions: Session[]): boolean {
  return sessions.every((s) =>
    s.turns
      .filter(isDecision)
      .every((d) => decisions.some((x) => x.sessionId === s.id && x.decisionId === d.id)),
  );
}

export function unlockedModules(
  decisions: Decision[],
  modules: { slug: string; sessions: Session[] }[],
): string[] {
  const out: string[] = [];
  for (let i = 0; i < modules.length; i++) {
    if (i > 0 && !walkthroughDone(decisions, modules[i - 1].sessions)) break;
    out.push(modules[i].slug);
  }
  return out;
}
