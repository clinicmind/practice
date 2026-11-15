import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/** The slice of the Supabase client the app uses. Tests inject a fake of this. */
export type Backend = Pick<SupabaseClient, 'auth' | 'from' | 'rpc'>;

let cached: SupabaseClient | null | undefined;

/**
 * The real client, or null when VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are
 * not set. Null means local mode: the app runs as in phase 1, with no login.
 * Only the public anon key is ever read here.
 */
export function getSupabase(): SupabaseClient | null {
  if (cached !== undefined) return cached;
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  cached = url && key ? createClient(url, key) : null;
  return cached;
}
