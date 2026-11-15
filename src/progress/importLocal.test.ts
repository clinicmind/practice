import { beforeEach, describe, expect, test } from 'vitest';
import { createFakeDb, type FakeDb } from '../test/fakeDb';
import { importLocal } from './importLocal';
import { createLocalStore, STORAGE_KEY } from './localStore';
import { createSupabaseStore } from './supabaseStore';
import type { ProgressStore } from './types';

class Mem implements Storage {
  m = new Map<string, string>();
  get length() { return this.m.size; }
  clear() { this.m.clear(); }
  getItem(k: string) { return this.m.get(k) ?? null; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  removeItem(k: string) { this.m.delete(k); }
  setItem(k: string, v: string) { this.m.set(k, v); }
}

const ME = '11111111-1111-4111-8111-111111111111';
let db: FakeDb;
let storage: Mem;
let local: ProgressStore;
let remote: ProgressStore;

/** 3 attempts + 1 decision + 1 reflection = 5 records. */
async function seedLocal() {
  await local.saveAttempt({ itemId: 'intake-e01', response: 'first try at this one', criteriaMet: [true, false, false] });
  await local.saveAttempt({ itemId: 'intake-e01', response: 'second try at this one', criteriaMet: [true, true, false] });
  await local.saveAttempt({ itemId: 'intake-e02', response: 'another item entirely', criteriaMet: [true, true, true] });
  await local.saveDecision({ sessionId: 's1', decisionId: 'd1', optionId: 'a' });
  await local.saveReflection({ moduleSlug: 'intake', promptId: 'p1', text: 'a reflection' });
}
const remoteCount = () => db.tables.attempts.length + db.tables.decisions.length + db.tables.reflections.length;

beforeEach(async () => {
  db = createFakeDb();
  storage = new Mem();
  local = createLocalStore(storage);
  remote = createSupabaseStore(db.client as never, ME);
  await seedLocal();
});

describe('importLocal', () => {
  test('import copies everything, then clears local', async () => {
    const before = await local.listAttempts();
    const result = await importLocal(local, remote, storage);
    expect(result).toEqual({ attempts: 3, decisions: 1, reflections: 1 });
    expect(remoteCount()).toBe(5);
    expect(storage.getItem(STORAGE_KEY)).toBeNull();
    // Content and original timestamps are preserved, in order.
    const got = await remote.listAttempts();
    expect(got.map((a) => [a.itemId, a.response, a.criteriaMet, a.createdAt])).toEqual(
      before.map((a) => [a.itemId, a.response, a.criteriaMet, a.createdAt]),
    );
  });

  test('import with nothing local is a no-op', async () => {
    storage.clear();
    expect(await importLocal(createLocalStore(storage), remote, storage)).toEqual({ attempts: 0, decisions: 0, reflections: 0 });
    expect(remoteCount()).toBe(0);
  });

  test('import run twice creates no duplicates', async () => {
    db.failWritesAfter(2); // the 3rd write fails
    await expect(importLocal(local, remote, storage)).rejects.toThrow();
    expect(remoteCount()).toBe(2);
    db.restore();
    await importLocal(local, remote, storage);
    expect(await remote.listAttempts()).toHaveLength(3);
    expect(await remote.listDecisions()).toHaveLength(1);
    expect(await remote.listReflections()).toHaveLength(1);
    expect(remoteCount()).toBe(5);
  });

  test('re-running after a full import (e.g. refresh before clearing) adds nothing', async () => {
    const snapshot = storage.getItem(STORAGE_KEY)!;
    await importLocal(local, remote, storage);
    storage.setItem(STORAGE_KEY, snapshot); // as if the tab died before the clear
    await importLocal(createLocalStore(storage), remote, storage);
    expect(remoteCount()).toBe(5);
  });

  test('two imports running at the same time create no duplicates', async () => {
    await Promise.all([importLocal(local, remote, storage), importLocal(local, remote, storage)]);
    expect(remoteCount()).toBe(5);
  });

  test('failed import keeps local data intact', async () => {
    const snapshot = storage.getItem(STORAGE_KEY);
    db.failWritesAfter(3);
    await expect(importLocal(local, remote, storage)).rejects.toThrow();
    expect(storage.getItem(STORAGE_KEY)).toBe(snapshot);
    expect(await local.listAttempts()).toHaveLength(3);
  });

  test('an unreadable remote (network down) keeps local data and rejects', async () => {
    db.networkDown = true;
    await expect(importLocal(local, remote, storage)).rejects.toMatchObject({ kind: 'network' });
    expect(await local.listAttempts()).toHaveLength(3);
  });

  test('records whose local id is not a uuid still import once', async () => {
    const legacy = {
      version: 1,
      attempts: [{ id: 'k1abc-xyz', itemId: 'intake-e01', response: 'legacy record text here', criteriaMet: [true, true, true], createdAt: '2026-02-01T00:00:00.000Z' }],
      decisions: [], reflections: [],
    };
    storage.setItem(STORAGE_KEY, JSON.stringify(legacy));
    await importLocal(createLocalStore(storage), remote, storage);
    storage.setItem(STORAGE_KEY, JSON.stringify(legacy));
    await importLocal(createLocalStore(storage), remote, storage);
    expect(db.tables.attempts).toHaveLength(1);
    expect(db.tables.attempts[0].client_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  test('a record added locally during the import is not lost', async () => {
    const racing: ProgressStore = {
      ...remote,
      async saveReflection(r) {
        await local.saveAttempt({ itemId: 'intake-e09', response: 'written in another tab', criteriaMet: [true, true, true] });
        return remote.saveReflection(r);
      },
    };
    await importLocal(local, racing, storage);
    expect(storage.getItem(STORAGE_KEY)).not.toBeNull();
    expect((await local.listAttempts()).some((a) => a.itemId === 'intake-e09')).toBe(true);
    await importLocal(local, remote, storage);
    expect(storage.getItem(STORAGE_KEY)).toBeNull();
    expect(remoteCount()).toBe(6);
  });
});
