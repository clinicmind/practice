import { describe, expect, test } from 'vitest';
import { DecisionPointSchema, DrillSchema, SessionSchema, isDecision, LEVELS } from './schema';

const drill = {
  id: 'intake-e01', level: 'easy', skill: 'open-question', context: 'c', client: 'x',
  criteria: ['a', 'b', 'c'],
};

describe('schema', () => {
  test('LEVELS order', () => expect(LEVELS).toEqual(['easy', 'medium', 'hard']));
  test('drill needs exactly 3 criteria', () => {
    expect(DrillSchema.safeParse(drill).success).toBe(true);
    expect(DrillSchema.safeParse({ ...drill, criteria: ['a', 'b'] }).success).toBe(false);
    expect(DrillSchema.safeParse({ ...drill, criteria: ['a', 'b', 'c', 'd'] }).success).toBe(false);
    expect(DrillSchema.safeParse({ ...drill, criteria: ['a', 'b', ' '] }).success).toBe(false);
  });
  test('decision: choice needs 3 options with a strong one', () => {
    const opt = (id: string, fit: string) => ({ id, text: 't', fit, note: 'n' });
    const base = { id: 'd1', type: 'choice', prompt: 'p', actual: 'a', rationale: 'r' };
    expect(DecisionPointSchema.safeParse({ ...base, options: [opt('a', 'strong'), opt('b', 'weak'), opt('c', 'weak')] }).success).toBe(true);
    expect(DecisionPointSchema.safeParse({ ...base, options: [opt('a', 'strong'), opt('b', 'weak')] }).success).toBe(false);
    expect(DecisionPointSchema.safeParse({ ...base, options: [opt('a', 'weak'), opt('b', 'weak'), opt('c', 'workable')] }).success).toBe(false);
  });
  test('free decision has no options', () => {
    const free = { id: 'd2', type: 'free', prompt: 'p', actual: 'a', rationale: 'r' };
    expect(DecisionPointSchema.safeParse(free).success).toBe(true);
    expect(DecisionPointSchema.safeParse({ ...free, options: [] }).success).toBe(false);
  });
  test('session distinguishes turns from decisions and needs a decision', () => {
    const notes = { goals: 'g', alliance: 'a', formulation_update: 'f' };
    const turn = { id: 't1', speaker: 'client', text: 'hi' };
    const free = { id: 'd1', type: 'free', prompt: 'p', actual: 'a', rationale: 'r' };
    const ok = SessionSchema.parse({ id: 'x-s1', title: 'T', turns: [turn, free], notes });
    expect(ok.turns.map(isDecision)).toEqual([false, true]);
    expect(SessionSchema.safeParse({ id: 'x-s1', title: 'T', turns: [turn], notes }).success).toBe(false);
  });
});
