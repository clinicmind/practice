import type { SupabaseClient } from '@supabase/supabase-js';
import { createContext, useContext } from 'react';
import { LEVELS, type Level } from '../content/schema';
import { fetchAll, type Result } from './cloud';

/** Levels a supervisor opened by hand, per module slug. */
export type Grants = Record<string, Level[]>;
export type GrantReader = () => Promise<Grants>;

export function createGrantReader(client: Pick<SupabaseClient, 'from'>, userId: string): GrantReader {
  return async () => {
    const rows = await fetchAll((from, to) =>
      client.from('unlocks').select('*').eq('user_id', userId)
        .order('created_at', { ascending: true }).order('id', { ascending: true })
        .range(from, to) as unknown as PromiseLike<Result>,
    );
    const out: Grants = {};
    for (const r of rows) {
      if (!(LEVELS as readonly string[]).includes(r.level)) continue;
      (out[r.module_slug] ??= []).push(r.level as Level);
    }
    return out;
  };
}

/** Local mode has no supervisor, so nothing is ever granted. */
export const GrantsContext = createContext<GrantReader>(async () => ({}));
export const useGrantReader = () => useContext(GrantsContext);
