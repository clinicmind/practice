import { z } from 'zod';
import type {
  Attempt, Decision, NewAttempt, NewDecision, NewReflection, ProgressStore, Reflection,
} from './types';

export const STORAGE_KEY = 'cm.practice.v1';
const BACKUP_KEY = `${STORAGE_KEY}.corrupt`;

const iso = z.string().min(1);
const AttemptSchema = z.object({
  id: z.string().min(1), itemId: z.string().min(1), response: z.string(),
  criteriaMet: z.array(z.boolean()).length(3), createdAt: iso,
});
const DecisionSchema = z.object({
  id: z.string().min(1), sessionId: z.string().min(1), decisionId: z.string().min(1),
  optionId: z.string().optional(), response: z.string().optional(), createdAt: iso,
});
const ReflectionSchema = z.object({
  id: z.string().min(1), moduleSlug: z.string().min(1), promptId: z.string().min(1),
  text: z.string(), createdAt: iso,
});
const StateSchema = z.object({
  version: z.literal(1),
  attempts: z.array(AttemptSchema),
  decisions: z.array(DecisionSchema),
  reflections: z.array(ReflectionSchema),
});
type State = z.infer<typeof StateSchema>;

const emptyState = (): State => ({ version: 1, attempts: [], decisions: [], reflections: [] });
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

function newId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** now, but strictly later than every timestamp in `existing` so ordering is stable. */
function nextTimestamp(existing: { createdAt: string }[]): string {
  let t = Date.now();
  for (const e of existing) {
    const m = Date.parse(e.createdAt);
    if (!Number.isNaN(m) && m >= t) t = m + 1;
  }
  return new Date(t).toISOString();
}

export type LocalStore = ProgressStore & { readonly wasReset: boolean };

export function createLocalStore(storage: Storage = globalThis.localStorage): LocalStore {
  let reset = false;

  function backupAndClear(raw: string) {
    reset = true;
    try {
      const prev = storage.getItem(BACKUP_KEY);
      if (prev !== null && prev !== raw) storage.setItem(`${BACKUP_KEY}.${Date.now()}`, prev);
      storage.setItem(BACKUP_KEY, raw);
      storage.removeItem(STORAGE_KEY);
    } catch {
      /* best effort: the app must still start */
    }
  }

  /** Reads fresh from storage every time so other tabs' writes are never lost. */
  function read(): State {
    let raw: string | null;
    try {
      raw = storage.getItem(STORAGE_KEY);
    } catch {
      return emptyState();
    }
    if (raw === null) return emptyState();
    try {
      const parsed = StateSchema.safeParse(JSON.parse(raw));
      if (parsed.success) return parsed.data;
    } catch {
      /* fall through to corrupt handling */
    }
    backupAndClear(raw);
    return emptyState();
  }

  function write(state: State) {
    storage.setItem(STORAGE_KEY, JSON.stringify(state)); // throws on quota → caller rejects
  }

  // Detect a bad stored value at startup so the UI can notify once.
  read();

  function append<K extends 'attempts' | 'decisions' | 'reflections'>(
    kind: K,
    input: Omit<State[K][number], 'id' | 'createdAt'>,
  ): State[K][number] {
    const state = read(); // re-read immediately before writing
    const list = state[kind] as { createdAt: string }[];
    const rec = { ...clone(input), id: newId(), createdAt: nextTimestamp(list) } as State[K][number];
    list.push(rec);
    write(state);
    return clone(rec);
  }

  return {
    get wasReset() { return reset; },
    async saveAttempt(a: NewAttempt): Promise<Attempt> {
      if (!Array.isArray(a.criteriaMet) || a.criteriaMet.length !== 3) {
        throw new Error('criteriaMet must have exactly 3 entries');
      }
      if (!a.itemId) throw new Error('itemId required');
      return append('attempts', { itemId: a.itemId, response: a.response, criteriaMet: [...a.criteriaMet] });
    },
    async listAttempts(itemId?: string) {
      return clone(read().attempts.filter((x) => itemId === undefined || x.itemId === itemId));
    },
    async saveDecision(d: NewDecision): Promise<Decision> {
      if (!d.sessionId || !d.decisionId) throw new Error('sessionId and decisionId required');
      return append('decisions', { ...d });
    },
    async listDecisions(sessionId?: string) {
      return clone(read().decisions.filter((x) => sessionId === undefined || x.sessionId === sessionId));
    },
    async saveReflection(r: NewReflection): Promise<Reflection> {
      if (!r.moduleSlug || !r.promptId) throw new Error('moduleSlug and promptId required');
      return append('reflections', { ...r });
    },
    async listReflections(moduleSlug?: string) {
      return clone(read().reflections.filter((x) => moduleSlug === undefined || x.moduleSlug === moduleSlug));
    },
  };
}
