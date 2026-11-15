import { beforeEach, describe, expect, test } from 'vitest';
import { createLocalStore } from './localStore';

class MemStorage implements Storage {
  data = new Map<string, string>();
  failSet = false;
  get length() { return this.data.size; }
  clear() { this.data.clear(); }
  getItem(k: string) { return this.data.has(k) ? this.data.get(k)! : null; }
  key(i: number) { return [...this.data.keys()][i] ?? null; }
  removeItem(k: string) { this.data.delete(k); }
  setItem(k: string, v: string) {
    if (this.failSet) throw new DOMException('full', 'QuotaExceededError');
    this.data.set(k, v);
  }
}

const KEY = 'cm.practice.v1';
const n = (itemId: string) => ({ itemId, response: 'r', criteriaMet: [true, false, false] });
let storage: MemStorage;
beforeEach(() => { storage = new MemStorage(); });

describe('LocalStore', () => {
  test('attempts are appended, never replaced', async () => {
    const s = createLocalStore(storage);
    const a = await s.saveAttempt(n('x'));
    const b = await s.saveAttempt(n('x'));
    const all = await s.listAttempts('x');
    expect(all).toHaveLength(2);
    expect(a.id).not.toBe(b.id);
    expect(b.createdAt > a.createdAt).toBe(true);
  });
  test('listAttempts filters by itemId', async () => {
    const s = createLocalStore(storage);
    await s.saveAttempt(n('x')); await s.saveAttempt(n('y'));
    expect(await s.listAttempts('y')).toHaveLength(1);
    expect(await s.listAttempts()).toHaveLength(2);
  });
  test('survives reload', async () => {
    await createLocalStore(storage).saveAttempt(n('x'));
    expect(await createLocalStore(storage).listAttempts()).toHaveLength(1);
  });
  test('decisions and reflections persist and filter', async () => {
    const s = createLocalStore(storage);
    await s.saveDecision({ sessionId: 's1', decisionId: 'd1', optionId: 'a' });
    await s.saveDecision({ sessionId: 's2', decisionId: 'd1', response: 'free text' });
    await s.saveReflection({ moduleSlug: 'intake', promptId: 'r1', text: 'one' });
    await s.saveReflection({ moduleSlug: 'alliance', promptId: 'r1', text: 'two' });
    expect(await s.listDecisions('s1')).toHaveLength(1);
    expect(await s.listDecisions()).toHaveLength(2);
    expect((await s.listReflections('intake'))[0].text).toBe('one');
    expect(await s.listReflections()).toHaveLength(2);
  });
  test('fresh storage: wasReset false', () => {
    expect(createLocalStore(storage).wasReset).toBe(false);
  });
  test('corrupt JSON is backed up and store starts empty', async () => {
    storage.setItem(KEY, '{not json');
    const s = createLocalStore(storage);
    expect(s.wasReset).toBe(true);
    expect(storage.getItem(KEY + '.corrupt')).toBe('{not json');
    expect(await s.listAttempts()).toEqual([]);
    await s.saveAttempt(n('x')); // usable afterwards
    expect(await s.listAttempts()).toHaveLength(1);
  });
  test('wrong shape is treated as corrupt', async () => {
    storage.setItem(KEY, '{"attempts":"nope"}');
    const s = createLocalStore(storage);
    expect(s.wasReset).toBe(true);
    expect(storage.getItem(KEY + '.corrupt')).toBe('{"attempts":"nope"}');
    expect(await s.listAttempts()).toEqual([]);
  });
  test('old format (no version / other version) is treated as corrupt, not crashed on', async () => {
    storage.setItem(KEY, JSON.stringify({ attempts: [], decisions: [], reflections: [] }));
    expect(createLocalStore(storage).wasReset).toBe(true);
    storage.setItem(KEY, JSON.stringify({ version: 0, attempts: [], decisions: [], reflections: [] }));
    expect(createLocalStore(storage).wasReset).toBe(true);
  });
  test('an entry with a bad criteriaMet length makes the whole store corrupt', async () => {
    storage.setItem(KEY, JSON.stringify({ version: 1, attempts: [{ id: 'a', itemId: 'x', response: 'r', criteriaMet: [true], createdAt: '2026-01-01T00:00:00.000Z' }], decisions: [], reflections: [] }));
    expect(createLocalStore(storage).wasReset).toBe(true);
  });
  test('a previous backup is not overwritten silently', async () => {
    storage.setItem(KEY + '.corrupt', 'older');
    storage.setItem(KEY, 'newer-bad');
    createLocalStore(storage);
    expect(storage.getItem(KEY + '.corrupt')).toBe('newer-bad');
    const kept = [...storage.data.entries()].filter(([k]) => k.startsWith(KEY + '.corrupt.'));
    expect(kept.map(([, v]) => v)).toEqual(['older']);
  });
  test('storage that throws on read does not crash construction', async () => {
    const bad = new MemStorage();
    bad.getItem = () => { throw new Error('denied'); };
    const s = createLocalStore(bad);
    expect(await s.listAttempts()).toEqual([]);
  });
  test('writes from two store instances do not clobber each other', async () => {
    const a = createLocalStore(storage), b = createLocalStore(storage);
    await a.saveAttempt(n('x'));
    await b.saveAttempt(n('y'));
    expect((await a.listAttempts()).map((t) => t.itemId).sort()).toEqual(['x', 'y']);
    expect((await b.listAttempts()).map((t) => t.itemId).sort()).toEqual(['x', 'y']);
  });
  test('interleaved saves across instances across all kinds keep everything', async () => {
    const a = createLocalStore(storage), b = createLocalStore(storage);
    await Promise.all([
      a.saveAttempt(n('x')), b.saveDecision({ sessionId: 's', decisionId: 'd', optionId: 'a' }),
      a.saveReflection({ moduleSlug: 'm', promptId: 'p', text: 't' }), b.saveAttempt(n('y')),
    ]);
    expect(await a.listAttempts()).toHaveLength(2);
    expect(await a.listDecisions()).toHaveLength(1);
    expect(await a.listReflections()).toHaveLength(1);
  });
  test('criteriaMet must have length 3', async () => {
    const s = createLocalStore(storage);
    await expect(s.saveAttempt({ itemId: 'a', response: 'r', criteriaMet: [true] })).rejects.toThrow();
    await expect(s.saveAttempt({ itemId: 'a', response: 'r', criteriaMet: [true, true, true, true] })).rejects.toThrow();
    expect(await s.listAttempts()).toEqual([]);
  });
  test('storage quota error surfaces as a rejected promise, not a silent loss', async () => {
    const s = createLocalStore(storage);
    await s.saveAttempt(n('x'));
    storage.failSet = true;
    await expect(s.saveAttempt(n('y'))).rejects.toThrow();
    storage.failSet = false;
    expect(await s.listAttempts()).toHaveLength(1);
  });
  test('saved records are not aliased to internal state', async () => {
    const s = createLocalStore(storage);
    const a = await s.saveAttempt(n('x'));
    a.criteriaMet[0] = false;
    expect((await s.listAttempts())[0].criteriaMet[0]).toBe(true);
  });
});
