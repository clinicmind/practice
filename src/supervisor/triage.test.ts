import { describe, expect, test } from 'vitest';
import type { Drill } from '../content/schema';
import type { Attempt } from '../progress/types';
import {
  discussionPicks, hardestCriteria, studentsToCheckIn, weekIndex,
  MIN_ANSWERS, type CohortAttempt, type TriageStudent,
} from './triage';

// All names and text here are made up.
const NOW = new Date('2026-11-25T12:00:00.000Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

let seq = 0;
function att(userId: string, itemId: string, over: Partial<Attempt> = {}): CohortAttempt {
  seq += 1;
  return {
    id: `a${seq}`, userId, itemId, response: `A considered reply number ${seq} to the client.`,
    criteriaMet: [true, true, true], createdAt: daysAgo(1), ...over,
  };
}
const student = (id: string, over: Partial<TriageStudent> = {}): TriageStudent => ({
  id, displayName: id.toUpperCase(), lastActiveAt: daysAgo(1), joinedAt: daysAgo(60), ...over,
});
const drill = (id: string, level: Drill['level']): Drill => ({
  id, level, skill: 's', context: 'c', client: 'x', criteria: ['one', 'two', 'three'],
});
/** Module `m` with 2 easy items, so a "round" is two answers. */
const bundles = { m: { drills: [drill('m-e01', 'easy'), drill('m-e02', 'easy'), drill('m-m01', 'medium')] } };

describe('hardestCriteria', () => {
  test('no attempts: nothing to show, nothing pending', () => {
    expect(hardestCriteria([], NOW)).toEqual({ rows: [], pending: 0 });
  });

  test('ranks item+criterion pairs by pass rate, lowest first, and returns at most 3', () => {
    const students = ['s1', 's2', 's3', 's4', 's5'];
    const attempts = [
      // item e01: criterion 2 met by 1 of 5, criterion 3 by 2 of 5, criterion 1 by all
      ...students.map((u, i) => att(u, 'm-e01', { criteriaMet: [true, i < 1, i < 2] })),
      // item e02: criterion 1 met by 4 of 5, others all
      ...students.map((u, i) => att(u, 'm-e02', { criteriaMet: [i < 4, true, true] })),
    ];
    const { rows } = hardestCriteria(attempts, NOW);
    expect(rows.map((r) => [r.itemId, r.criterion, r.met, r.answers])).toEqual([
      ['m-e01', 2, 1, 5],
      ['m-e01', 3, 2, 5],
      ['m-e02', 1, 4, 5],
    ]);
    expect(rows[0]!.passRate).toBeCloseTo(0.2);
  });

  test('pairs with fewer than MIN_ANSWERS answers are not ranked, and are counted as pending', () => {
    const few = Array.from({ length: MIN_ANSWERS - 1 }, (_, i) => att(`s${i}`, 'm-e01', { criteriaMet: [false, false, false] }));
    const res = hardestCriteria(few, NOW);
    expect(res.rows).toEqual([]);
    expect(res.pending).toBe(3); // three criteria of one item
  });

  test('only the last 7 days count', () => {
    const old = Array.from({ length: 6 }, (_, i) => att(`s${i}`, 'm-e01', { criteriaMet: [false, false, false], createdAt: daysAgo(8) }));
    expect(hardestCriteria(old, NOW)).toEqual({ rows: [], pending: 0 });
    const edge = Array.from({ length: 5 }, (_, i) => att(`s${i}`, 'm-e01', { criteriaMet: [false, true, true], createdAt: daysAgo(6.9) }));
    expect(hardestCriteria(edge, NOW).rows).toHaveLength(3);
  });

  test('one student answering the same item twice counts once, by the latest attempt', () => {
    const attempts = [
      att('s1', 'm-e01', { criteriaMet: [false, false, false], createdAt: daysAgo(3) }),
      att('s1', 'm-e01', { criteriaMet: [true, true, true], createdAt: daysAgo(1) }),
      ...['s2', 's3', 's4', 's5'].map((u) => att(u, 'm-e01', { criteriaMet: [true, true, true] })),
    ];
    const { rows } = hardestCriteria(attempts, NOW);
    expect(rows.every((r) => r.answers === 5 && r.met === 5)).toBe(true);
  });

  test('a single student never reaches the minimum', () => {
    const res = hardestCriteria([att('s1', 'm-e01'), att('s1', 'm-e02')], NOW);
    expect(res.rows).toEqual([]);
    expect(res.pending).toBe(6);
  });

  test('answers in either language are the same item: the item id decides', () => {
    // The item id is shared by both languages, so the app has nothing language-specific to add up.
    const mixed = [
      att('s1', 'm-e01', { response: 'Tell me more about that.', criteriaMet: [false, true, true] }),
      att('s2', 'm-e01', { response: '請多說一些。', criteriaMet: [false, true, true] }),
      att('s3', 'm-e01', { response: '多談談這件事好嗎', criteriaMet: [false, true, true] }),
      att('s4', 'm-e01', { response: 'What was that like?', criteriaMet: [true, true, true] }),
      att('s5', 'm-e01', { response: '那是什麼感覺？', criteriaMet: [false, true, true] }),
    ];
    const { rows } = hardestCriteria(mixed, NOW);
    expect(rows[0]).toMatchObject({ itemId: 'm-e01', criterion: 1, met: 1, answers: 5 });
  });

  test('ties go to the larger number of answers, then to item id', () => {
    const six = ['s1', 's2', 's3', 's4', 's5', 's6'];
    const five = six.slice(0, 5);
    const attempts = [
      ...five.map((u) => att(u, 'm-e01', { criteriaMet: [false, true, true] })),
      ...six.map((u) => att(u, 'm-e02', { criteriaMet: [false, true, true] })),
    ];
    expect(hardestCriteria(attempts, NOW).rows.slice(0, 2).map((r) => r.itemId)).toEqual(['m-e02', 'm-e01']);
  });

  test('ignores an attempt whose criteria are not three entries', () => {
    const bad = att('s1', 'm-e01', { criteriaMet: [true] });
    expect(hardestCriteria([bad], NOW)).toEqual({ rows: [], pending: 0 });
  });
});

describe('studentsToCheckIn', () => {
  test('no students and no attempts: empty', () => {
    expect(studentsToCheckIn([], [], bundles, NOW)).toEqual([]);
  });

  test('a student with nothing in 7 days is listed as not practising lately', () => {
    const s = student('s1', { lastActiveAt: daysAgo(8) });
    expect(studentsToCheckIn([s], [], bundles, NOW)).toEqual([
      { userId: 's1', displayName: 'S1', reasons: [{ kind: 'inactive', never: false }] },
    ]);
  });

  test('active 6 days ago is fine', () => {
    expect(studentsToCheckIn([student('s1', { lastActiveAt: daysAgo(6) })], [], bundles, NOW)).toEqual([]);
  });

  test('a recent attempt counts even when the activity time is stale', () => {
    const s = student('s1', { lastActiveAt: daysAgo(20) });
    expect(studentsToCheckIn([s], [att('s1', 'm-e01', { createdAt: daysAgo(2) })], bundles, NOW)).toEqual([]);
  });

  test('never active: listed once they have been in the cohort for 7 days, not before', () => {
    const old = student('s1', { lastActiveAt: null, joinedAt: daysAgo(10) });
    const fresh = student('s2', { lastActiveAt: null, joinedAt: daysAgo(2) });
    const res = studentsToCheckIn([old, fresh], [], bundles, NOW);
    expect(res.map((r) => r.userId)).toEqual(['s1']);
    expect(res[0]!.reasons).toEqual([{ kind: 'inactive', never: true }]);
  });

  test('two full rounds of a level without passing is listed with the module and level', () => {
    const s = student('s1');
    const attempts = ['m-e01', 'm-e02'].flatMap((id) => [0, 1].map((k) =>
      att('s1', id, { criteriaMet: [true, false, false], createdAt: daysAgo(5 - k) })));
    const res = studentsToCheckIn([s], attempts, bundles, NOW);
    expect(res).toEqual([{ userId: 's1', displayName: 'S1', reasons: [{ kind: 'stuck', slug: 'm', level: 'easy', rounds: 2 }] }]);
  });

  test('one round, or a second round on only some items, is not enough', () => {
    const s = student('s1');
    const oneRound = ['m-e01', 'm-e02'].map((id) => att('s1', id, { criteriaMet: [false, false, false] }));
    expect(studentsToCheckIn([s], oneRound, bundles, NOW)).toEqual([]);
    const partial = [...oneRound, att('s1', 'm-e01', { criteriaMet: [false, false, false] })];
    expect(studentsToCheckIn([s], partial, bundles, NOW)).toEqual([]);
  });

  test('a level that was passed is not listed even after many rounds', () => {
    // Pass needs 8 met items; build a module with 8 easy items all met on the 2nd round.
    const eight = Array.from({ length: 8 }, (_, i) => drill(`p-e0${i + 1}`, 'easy'));
    const b = { p: { drills: eight } };
    const attempts = eight.flatMap((d) => [
      att('s1', d.id, { criteriaMet: [false, false, false], createdAt: daysAgo(4) }),
      att('s1', d.id, { criteriaMet: [true, true, true], createdAt: daysAgo(2) }),
    ]);
    expect(studentsToCheckIn([student('s1')], attempts, b, NOW)).toEqual([]);
  });

  test('both reasons can apply to one student; results are sorted by name', () => {
    const z = student('z', { displayName: 'Zed', lastActiveAt: daysAgo(30) });
    const a = student('a', { displayName: 'Ada', lastActiveAt: daysAgo(30) });
    const stuck = ['m-e01', 'm-e02'].flatMap((id) => [0, 1].map((k) => att('z', id, { criteriaMet: [false, false, false], createdAt: daysAgo(40 - k) })));
    const res = studentsToCheckIn([z, a], stuck, bundles, NOW);
    expect(res.map((r) => r.displayName)).toEqual(['Ada', 'Zed']);
    expect(res[1]!.reasons.map((r) => r.kind)).toEqual(['inactive', 'stuck']);
  });

  test('attempts on questions this build does not have are ignored', () => {
    const s = student('s1');
    const attempts = [0, 1].map((k) => att('s1', 'gone-e01', { criteriaMet: [false, false, false], createdAt: daysAgo(5 - k) }));
    expect(studentsToCheckIn([s], attempts, bundles, NOW)).toEqual([]);
  });
});

describe('weekIndex', () => {
  test('is the same for every moment of a UTC week and moves on at the next one', () => {
    const start = new Date('2026-11-19T00:00:00.000Z'); // a Thursday: weeks count from the epoch
    const w = weekIndex(start);
    expect(weekIndex(new Date(start.getTime() + 6.99 * 86_400_000))).toBe(w);
    expect(weekIndex(new Date(start.getTime() + 7 * 86_400_000))).toBe(w + 1);
  });
});

describe('discussionPicks', () => {
  const models = [{ 'm-e01': { model_response: 'Tell me what has brought you here today.' } }];
  const ids = ['s1', 's2', 's3', 's4', 's5', 's6', 's7'];

  test('nobody and nothing: empty', () => {
    expect(discussionPicks([], [], models, NOW)).toEqual({ flagged: [], rotation: [] });
  });

  test('a single student: flagged marks are listed, and the rotation can pick another reply of theirs', () => {
    const short = att('s1', 'm-e01', { response: 'ok', criteriaMet: [true, true, true], createdAt: daysAgo(1) });
    const fine = att('s1', 'm-e02', { createdAt: daysAgo(2) });
    const res = discussionPicks([student('s1')], [short, fine], models, NOW);
    expect(res.flagged).toEqual([{ attemptId: short.id, userId: 's1', itemId: 'm-e01', response: 'ok', reasons: ['all-met-but-short'] }]);
    expect(res.rotation.map((p) => p.attemptId)).toEqual([fine.id]);
  });

  test('a flagged attempt is not offered a second time as an ordinary pick', () => {
    const short = att('s1', 'm-e01', { response: 'ok', criteriaMet: [true, true, true] });
    const res = discussionPicks([student('s1')], [short], models, NOW);
    expect(res.flagged).toHaveLength(1);
    expect(res.rotation).toEqual([]);
  });

  test('flags older than 7 days are not listed, but the earlier attempt is still used to spot a repeat', () => {
    const first = att('s1', 'm-e02', { response: 'Same words again for this one.', createdAt: daysAgo(10), criteriaMet: [true, true, false] });
    const again = att('s1', 'm-e02', { response: 'Same words again for this one.', createdAt: daysAgo(2), criteriaMet: [true, true, false] });
    const res = discussionPicks([student('s1')], [first, again], models, NOW);
    expect(res.flagged.map((f) => [f.attemptId, f.reasons])).toEqual([[again.id, ['identical-to-previous']]]);
  });

  test('copying the example in either language is flagged', () => {
    const both = [
      { 'm-e01': { model_response: 'Tell me what has brought you here today.' } },
      { 'm-e01': { model_response: '請告訴我今天是什麼讓你來到這裡。' } },
    ];
    const en = att('s1', 'm-e01', { response: 'tell me what has brought you here today', criteriaMet: [true, true, false] });
    const zh = att('s2', 'm-e01', { response: '請告訴我，今天是什麼讓你來到這裡！', criteriaMet: [true, true, false] });
    const res = discussionPicks([student('s1'), student('s2')], [en, zh], both, NOW);
    expect(res.flagged.map((f) => f.reasons)).toEqual([['copied-model'], ['copied-model']]);
  });

  test('flags of different students never mix: "identical to previous" is per student', () => {
    const a = att('s1', 'm-e02', { response: 'Exactly the same sentence here.', criteriaMet: [true, true, false] });
    const b = att('s2', 'm-e02', { response: 'Exactly the same sentence here.', criteriaMet: [true, true, false] });
    expect(discussionPicks([student('s1'), student('s2')], [a, b], models, NOW).flagged).toEqual([]);
  });

  test('the rotation picks 3 students a week and moves on the next week, so everyone gets a turn', () => {
    const students = ids.map((id) => student(id));
    const attempts = ids.map((id) => att(id, 'm-e02', { criteriaMet: [true, true, false] }));
    const seen = new Set<string>();
    for (let w = 0; w < 3; w++) {
      const now = new Date(NOW.getTime() + w * 7 * 86_400_000);
      // keep the attempts inside each week's window
      const moved = attempts.map((a) => ({ ...a, createdAt: new Date(now.getTime() - 86_400_000).toISOString() }));
      const { rotation } = discussionPicks(students, moved, models, now);
      expect(rotation).toHaveLength(3);
      for (const p of rotation) seen.add(p.userId);
    }
    expect(seen.size).toBe(7); // 3 weeks x 3 picks cover all 7 students
  });

  test('students with nothing this week are passed over without breaking the turn order', () => {
    const students = ids.map((id) => student(id));
    const attempts = ['s3', 's6'].map((id) => att(id, 'm-e02', { criteriaMet: [true, true, false] }));
    const { rotation } = discussionPicks(students, attempts, models, NOW);
    expect(rotation.map((p) => p.userId).sort()).toEqual(['s3', 's6']);
  });

  test('the same inputs always give the same picks', () => {
    const students = ids.map((id) => student(id));
    const attempts = ids.map((id) => att(id, 'm-e02', { criteriaMet: [true, true, false] }));
    expect(discussionPicks(students, attempts, models, NOW)).toEqual(discussionPicks(students, attempts, models, NOW));
  });

  test('replies shorter than the minimum are not offered as ordinary picks', () => {
    const tiny = att('s1', 'm-e02', { response: 'fine thanks', criteriaMet: [true, true, false] });
    expect(discussionPicks([student('s1')], [tiny], models, NOW).rotation).toEqual([]);
  });
});
