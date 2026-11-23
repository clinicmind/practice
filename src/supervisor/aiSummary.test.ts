import { describe, expect, test } from 'vitest';
import { directionOf, riskOf, summarizeByStudent, type AiDisagreement, type AiEvaluation } from './aiSummary';

const ev = (attemptId: string, userId: string, concern: AiEvaluation['concern'] = 'none'): AiEvaluation => ({ attemptId, userId, itemId: 'intake-e01', concern });
const dis = (attemptId: string, userId: string, criterion: 1 | 2 | 3, selfMet: boolean): AiDisagreement => ({ attemptId, userId, itemId: 'intake-e01', criterion, selfMet, aiMet: !selfMet });

describe('direction', () => {
  test('student ticked and the AI did not is one direction; the reverse is the other', () => {
    expect(directionOf(dis('a', 'u', 1, true))).toBe('self-only');
    expect(directionOf(dis('a', 'u', 1, false))).toBe('ai-only');
  });
});

describe('summarizeByStudent', () => {
  test('counts checked responses and the two directions separately, per student', () => {
    const rows = summarizeByStudent(
      [ev('a1', 'u1'), ev('a2', 'u1'), ev('a3', 'u2')],
      [dis('a1', 'u1', 1, true), dis('a1', 'u1', 2, true), dis('a2', 'u1', 3, false)],
      ['u1', 'u2'],
    );
    expect(rows).toEqual([
      { userId: 'u1', checked: 2, selfOnly: 2, aiOnly: 1 },
      { userId: 'u2', checked: 3 - 2, selfOnly: 0, aiOnly: 0 },
    ]);
  });
  test('only students of the given cohort are listed; students with nothing checked are left out', () => {
    const rows = summarizeByStudent([ev('a1', 'u1'), ev('a9', 'other')], [dis('a9', 'other', 1, true)], ['u1', 'u3']);
    expect(rows.map((r) => r.userId)).toEqual(['u1']);
  });
  test('students with more differences come first', () => {
    const rows = summarizeByStudent([ev('a1', 'u1'), ev('a2', 'u2')], [dis('a2', 'u2', 1, true)], ['u1', 'u2']);
    expect(rows.map((r) => r.userId)).toEqual(['u2', 'u1']);
  });
  test('a response the AI called risk content or off task is not counted as checked', () => {
    const rows = summarizeByStudent([ev('a1', 'u1', 'risk-content'), ev('a2', 'u1', 'off-task'), ev('a3', 'u1')], [], ['u1']);
    expect(rows).toEqual([{ userId: 'u1', checked: 1, selfOnly: 0, aiOnly: 0 }]);
  });
});

describe('riskOf', () => {
  test('lists risk-content responses of the given students only', () => {
    expect(riskOf([ev('a1', 'u1', 'risk-content'), ev('a2', 'u1', 'off-task'), ev('a3', 'other', 'risk-content')], ['u1']).map((e) => e.attemptId)).toEqual(['a1']);
  });
});
