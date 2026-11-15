import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchAll, run, type Result, type Row } from './cloud';
import type {
  Attempt, Decision, NewAttempt, NewDecision, NewReflection, ProgressStore, Reflection,
} from './types';

type Client = Pick<SupabaseClient, 'from'>;

function uuid(): string {
  return globalThis.crypto.randomUUID();
}
/** Always the same shape and order as the local store, whatever precision the server used. */
const iso = (v: unknown) => new Date(String(v)).toISOString();

export const toAttempt = (r: Row): Attempt => ({
  id: r.id, itemId: r.item_id, response: r.response, criteriaMet: r.criteria_met, createdAt: iso(r.created_at),
});
export const toDecision = (r: Row): Decision => ({
  id: r.id, sessionId: r.session_id, decisionId: r.decision_id,
  ...(r.option_id != null && { optionId: r.option_id }),
  ...(r.response != null && { response: r.response }),
  createdAt: iso(r.created_at),
});
export const toReflection = (r: Row): Reflection => ({
  id: r.id, moduleSlug: r.module_slug, promptId: r.prompt_id, text: r.text, createdAt: iso(r.created_at),
});

/**
 * ProgressStore over Supabase. Row level security decides what the server
 * returns; every read here also filters to `userId` so a supervisor's own
 * progress is never mixed with their students'.
 */
export function createSupabaseStore(client: Client, userId: string): ProgressStore {
  const sortKeys = ['created_at', 'id'];

  async function list(table: string, extra: [string, string] | null): Promise<Row[]> {
    return fetchAll((from, to) => {
      let q = client.from(table).select('*').eq('user_id', userId);
      if (extra) q = q.eq(extra[0], extra[1]);
      for (const k of sortKeys) q = q.order(k, { ascending: true });
      return q.range(from, to) as unknown as PromiseLike<Result>;
    });
  }

  /** Insert once per (user_id, client_id); a repeat returns the row already stored. */
  async function insertOnce(table: string, row: Row): Promise<Row> {
    const inserted = (await run(() =>
      client.from(table)
        .upsert(row, { onConflict: 'user_id,client_id', ignoreDuplicates: true })
        .select() as unknown as PromiseLike<Result>,
    )) as Row[] | null;
    if (inserted && inserted.length > 0) return inserted[0];
    return (await run(() =>
      client.from(table).select('*').eq('user_id', userId).eq('client_id', row.client_id).single() as unknown as PromiseLike<Result>,
    )) as Row;
  }

  const base = (o: { clientId?: string; createdAt?: string }): Row => ({
    user_id: userId,
    client_id: o.clientId ?? uuid(),
    ...(o.createdAt && { created_at: o.createdAt }),
  });

  return {
    async saveAttempt(a: NewAttempt) {
      if (!Array.isArray(a.criteriaMet) || a.criteriaMet.length !== 3) {
        throw new Error('criteriaMet must have exactly 3 entries');
      }
      if (!a.itemId) throw new Error('itemId required');
      return toAttempt(await insertOnce('attempts', {
        ...base(a), item_id: a.itemId, response: a.response, criteria_met: [...a.criteriaMet],
      }));
    },
    async listAttempts(itemId) {
      return (await list('attempts', itemId === undefined ? null : ['item_id', itemId])).map(toAttempt);
    },
    async saveDecision(d: NewDecision) {
      if (!d.sessionId || !d.decisionId) throw new Error('sessionId and decisionId required');
      return toDecision(await insertOnce('decisions', {
        ...base(d), session_id: d.sessionId, decision_id: d.decisionId,
        option_id: d.optionId ?? null, response: d.response ?? null,
      }));
    },
    async listDecisions(sessionId) {
      return (await list('decisions', sessionId === undefined ? null : ['session_id', sessionId])).map(toDecision);
    },
    async saveReflection(r: NewReflection) {
      if (!r.moduleSlug || !r.promptId) throw new Error('moduleSlug and promptId required');
      return toReflection(await insertOnce('reflections', {
        ...base(r), module_slug: r.moduleSlug, prompt_id: r.promptId, text: r.text,
      }));
    },
    async listReflections(moduleSlug) {
      return (await list('reflections', moduleSlug === undefined ? null : ['module_slug', moduleSlug])).map(toReflection);
    },
  };
}
