import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { BrowserContext } from '@playwright/test';

/**
 * Helpers for the specs that need a real Supabase project (local `supabase start` or a test project).
 * They need: E2E_SUPABASE_URL, E2E_SUPABASE_ANON_KEY, E2E_SUPABASE_SERVICE_KEY (test project only;
 * the service key is used here, in Node, and never reaches the browser or the build).
 * The app under test must be built with VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY pointing at the same project.
 */
export const BACKEND = {
  url: process.env.E2E_SUPABASE_URL ?? '',
  anon: process.env.E2E_SUPABASE_ANON_KEY ?? '',
  service: process.env.E2E_SUPABASE_SERVICE_KEY ?? '',
};
export const hasBackend = !!(BACKEND.url && BACKEND.anon && BACKEND.service);

export const admin = (): SupabaseClient => createClient(BACKEND.url, BACKEND.service, { auth: { persistSession: false } });

const run = Date.now().toString(36);
export type TestUser = { id: string; email: string; password: string };

export async function createUser(label: string): Promise<TestUser> {
  const email = `e2e-${label}-${run}@example.test`;
  const password = `pw-${run}-${label}-Aa1!`;
  const { data, error } = await admin().auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw error ?? new Error('createUser failed');
  return { id: data.user.id, email, password };
}

export async function makeSupervisor(u: TestUser, name: string) {
  const { error } = await admin().from('profiles').insert({ id: u.id, role: 'supervisor', display_name: name });
  if (error) throw error;
}

/** Creates a cohort as this supervisor (through the real RPC) and returns its invite code. */
export async function createCohortAs(u: TestUser, name: string): Promise<{ id: string; code: string }> {
  const c = await signedInClient(u);
  const end = new Date(Date.now() + 90 * 864e5).toISOString().slice(0, 10);
  const { data, error } = await c.rpc('create_cohort', { name, term_end: end });
  if (error) throw error;
  return { id: data[0].id, code: data[0].invite_code };
}

export async function signedInClient(u: TestUser): Promise<SupabaseClient> {
  const c = createClient(BACKEND.url, BACKEND.anon, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email: u.email, password: u.password });
  if (error) throw error;
  return c;
}

export async function joinAs(u: TestUser, code: string, name: string) {
  const c = await signedInClient(u);
  const { data, error } = await c.rpc('join_cohort', { code, display_name: name });
  if (error || data[0].error_code) throw error ?? new Error(data[0].error_code);
}

/** Starts the browser context already signed in as `u` (the app reads the session from localStorage). */
export async function signInBrowser(context: BrowserContext, u: TestUser) {
  const c = await signedInClient(u);
  const { data } = await c.auth.getSession();
  const ref = new URL(BACKEND.url).hostname.split('.')[0];
  await context.addInitScript(
    ([key, value]) => localStorage.setItem(key, value),
    [`sb-${ref}-auth-token`, JSON.stringify(data.session)] as const,
  );
}
