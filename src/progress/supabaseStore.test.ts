import { beforeEach, describe, expect, test } from 'vitest';
import { createFakeDb, type FakeDb } from '../test/fakeDb';
import { StoreError } from './storeError';
import { createSupabaseStore } from './supabaseStore';
import type { ProgressStore } from './types';

const ME = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
let db: FakeDb;
let store: ProgressStore;
beforeEach(() => {
  db = createFakeDb();
  store = createSupabaseStore(db.client as never, ME);
});

const A = { itemId: 'intake-e01', response: 'I hear that it is hard to start.', criteriaMet: [true, true, false] };

describe('SupabaseStore', () => {
  test('store methods map rows to the ProgressStore types (snake_case → camelCase)', async () => {
    const att = await store.saveAttempt(A);
    expect(att).toMatchObject(A);
    expect(att.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(Number.isNaN(Date.parse(att.createdAt))).toBe(false);
    expect(db.tables.attempts[0]).toMatchObject({ user_id: ME, item_id: 'intake-e01', criteria_met: [true, true, false], response: A.response });
    expect(db.tables.attempts[0].client_id).toMatch(/^[0-9a-f-]{36}$/);

    const dec = await store.saveDecision({ sessionId: 's1', decisionId: 'd1', optionId: 'a' });
    expect(dec).toMatchObject({ sessionId: 's1', decisionId: 'd1', optionId: 'a' });
    expect(dec.response).toBeUndefined();
    const free = await store.saveDecision({ sessionId: 's1', decisionId: 'd2', response: 'my words' });
    expect(free.optionId).toBeUndefined();
    expect(free.response).toBe('my words');

    const ref = await store.saveReflection({ moduleSlug: 'intake', promptId: 'p1', text: 'learned a lot' });
    expect(ref).toMatchObject({ moduleSlug: 'intake', promptId: 'p1', text: 'learned a lot' });

    expect(await store.listAttempts()).toEqual([att]);
    expect(await store.listDecisions()).toEqual([dec, free]);
    expect(await store.listReflections()).toEqual([ref]);
  });

  test('list filters by item, session and module', async () => {
    await store.saveAttempt(A);
    await store.saveAttempt({ ...A, itemId: 'intake-e02' });
    expect(await store.listAttempts('intake-e02')).toHaveLength(1);
    await store.saveDecision({ sessionId: 's1', decisionId: 'd1', optionId: 'a' });
    await store.saveDecision({ sessionId: 's2', decisionId: 'd1', optionId: 'a' });
    expect(await store.listDecisions('s2')).toHaveLength(1);
    await store.saveReflection({ moduleSlug: 'intake', promptId: 'p', text: 'x' });
    await store.saveReflection({ moduleSlug: 'alliance', promptId: 'p', text: 'y' });
    expect(await store.listReflections('alliance')).toHaveLength(1);
  });

  test("lists only the signed-in user's own rows, even if RLS would let more through (supervisors)", async () => {
    db.tables.attempts.push({ id: 'x', user_id: OTHER, client_id: 'c', item_id: 'intake-e01', response: 'theirs', criteria_met: [true, true, true], created_at: '2026-01-01T00:00:00.000Z' });
    await store.saveAttempt(A);
    const got = await store.listAttempts();
    expect(got).toHaveLength(1);
    expect(got[0].response).toBe(A.response);
  });

  test('lists in the order they were made', async () => {
    const one = await store.saveAttempt({ ...A, response: 'first response here' });
    const two = await store.saveAttempt({ ...A, response: 'second response here' });
    expect((await store.listAttempts()).map((a) => a.id)).toEqual([one.id, two.id]);
  });

  test('the same clientId saved twice yields one row, and returns the stored record', async () => {
    const clientId = '33333333-3333-4333-8333-333333333333';
    const first = await store.saveAttempt({ ...A, clientId });
    const second = await store.saveAttempt({ ...A, clientId });
    expect(db.tables.attempts).toHaveLength(1);
    expect(second).toEqual(first);
  });

  test('a supplied createdAt is kept (used by import)', async () => {
    const att = await store.saveAttempt({ ...A, createdAt: '2026-03-01T10:00:00.000Z' });
    expect(att.createdAt).toBe('2026-03-01T10:00:00.000Z');
  });

  test('network failure rejects with StoreError kind "network"', async () => {
    db.networkDown = true;
    for (const call of [
      () => store.saveAttempt(A),
      () => store.listAttempts(),
      () => store.saveDecision({ sessionId: 's', decisionId: 'd', optionId: 'a' }),
      () => store.saveReflection({ moduleSlug: 'm', promptId: 'p', text: 't' }),
    ]) {
      const err = await call().then(() => null, (e: unknown) => e);
      expect(err).toBeInstanceOf(StoreError);
      expect((err as StoreError).kind).toBe('network');
    }
  });

  test('a thrown fetch error is also kind "network"', async () => {
    const throwing = { from: () => { throw new TypeError('Failed to fetch'); } };
    const s = createSupabaseStore(throwing as never, ME);
    await expect(s.listAttempts()).rejects.toMatchObject({ kind: 'network' });
  });

  test('401 rejects with StoreError kind "auth"', async () => {
    db.authExpired = true;
    await expect(store.saveAttempt(A)).rejects.toMatchObject({ name: 'StoreError', kind: 'auth' });
    await expect(store.listAttempts()).rejects.toMatchObject({ kind: 'auth' });
  });

  test('other server errors are kind "other"', async () => {
    const bad = { from: () => ({ select: () => ({ eq: () => ({ order: () => ({ order: () => Promise.resolve({ data: null, status: 500, error: { message: 'boom', code: 'XX000' } }) }) }) }) }) };
    const s = createSupabaseStore(bad as never, ME);
    await expect(s.listAttempts()).rejects.toMatchObject({ kind: 'other' });
  });

  test('validates input like the local store', async () => {
    await expect(store.saveAttempt({ ...A, criteriaMet: [true] })).rejects.toThrow();
    await expect(store.saveAttempt({ ...A, itemId: '' })).rejects.toThrow();
    expect(db.writes).toBe(0);
  });
});
