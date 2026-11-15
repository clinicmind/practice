import type { Backend } from '../auth/supabase';
import type { FakeDb } from './fakeDb';

export type ProfileRow = { id: string; role: 'student' | 'supervisor'; display_name: string; cohort_id: string | null };
type Session = { user: { id: string } } | null;
type Listener = (event: string, session: Session) => void;

export interface FakeBackend {
  backend: Backend;
  /** Simulate Supabase emitting an auth event (sign-in via magic link, expiry, …). */
  emit(event: 'SIGNED_IN' | 'SIGNED_OUT' | 'TOKEN_REFRESHED', userId: string | null): void;
  profiles: Map<string, ProfileRow>;
  calls: { signInWithOtp: { email: string; redirectTo?: string }[]; rpc: { name: string; args: unknown }[]; signOut: number };
  /** Next result of join_cohort. On success the profile is created. */
  joinResult: { cohort_id: string | null; error_code: string | null };
  /** Make signInWithOtp reject. */
  failOtp?: Error;
}

/** A fake of the parts of the Supabase client that auth and join use. */
export function createFakeBackend(opts: { userId?: string | null; profile?: ProfileRow; db?: FakeDb } = {}): FakeBackend {
  let session: Session = opts.userId ? { user: { id: opts.userId } } : null;
  const listeners = new Set<Listener>();
  const profiles = new Map<string, ProfileRow>();
  if (opts.profile) profiles.set(opts.profile.id, opts.profile);

  const fake: FakeBackend = {
    profiles,
    calls: { signInWithOtp: [], rpc: [], signOut: 0 },
    joinResult: { cohort_id: 'c1', error_code: null },
    emit(event, userId) {
      session = userId ? { user: { id: userId } } : null;
      for (const l of [...listeners]) l(event, session);
    },
    backend: {
      auth: {
        getSession: async () => ({ data: { session }, error: null }),
        onAuthStateChange: (cb: Listener) => {
          listeners.add(cb);
          return { data: { subscription: { unsubscribe: () => listeners.delete(cb) } } };
        },
        signInWithOtp: async (a: { email: string; options?: { emailRedirectTo?: string } }) => {
          fake.calls.signInWithOtp.push({ email: a.email, redirectTo: a.options?.emailRedirectTo });
          if (fake.failOtp) return { data: {}, error: fake.failOtp };
          return { data: {}, error: null };
        },
        signOut: async () => {
          fake.calls.signOut++;
          fake.emit('SIGNED_OUT', null);
          return { error: null };
        },
      },
      from: (table: string) => {
        if (table !== 'profiles') {
          if (!opts.db) throw new Error(`fake: unexpected table ${table}`);
          return opts.db.client.from(table);
        }
        return {
          select: () => ({
            eq: (_col: string, val: string) => ({
              maybeSingle: async () => ({ data: profiles.get(val) ?? null, error: null }),
            }),
          }),
        };
      },
      rpc: async (name: string, args: Record<string, unknown>) => {
        fake.calls.rpc.push({ name, args });
        if (name !== 'join_cohort') throw new Error(`fake: unexpected rpc ${name}`);
        const r = fake.joinResult;
        if (!r.error_code && session) {
          profiles.set(session.user.id, {
            id: session.user.id, role: 'student', display_name: String(args.display_name).trim(), cohort_id: r.cohort_id,
          });
        }
        return { data: [r], error: null };
      },
    } as unknown as Backend,
  };
  return fake;
}
