import type { Backend } from '../auth/supabase';
import { createFakeDb, type FakeDb } from './fakeDb';

export type ProfileRow = { id: string; role: 'student' | 'supervisor'; display_name: string; cohort_id: string | null };
type Session = { user: { id: string } } | null;
type Listener = (event: string, session: Session) => void;

export interface FakeBackend {
  backend: Backend;
  db: FakeDb;
  /** Simulate Supabase emitting an auth event (sign-in via magic link, expiry, …). */
  emit(event: 'SIGNED_IN' | 'SIGNED_OUT' | 'TOKEN_REFRESHED', userId: string | null): void;
  profiles: { set(id: string, row: ProfileRow): void; get(id: string): ProfileRow | undefined };
  calls: { signInWithOtp: { email: string; redirectTo?: string }[]; rpc: { name: string; args: Record<string, unknown> }[]; signOut: number };
  /** Next result of join_cohort. On success the profile is created. */
  joinResult: { cohort_id: string | null; error_code: string | null };
  /** Make signInWithOtp reject. */
  failOtp?: Error;
  /** Make create_cohort fail with this message. */
  createCohortError?: string;
}

/** A fake of the Supabase client: auth, plus tables and RPCs over an in-memory FakeDb. */
export function createFakeBackend(opts: { userId?: string | null; profile?: ProfileRow; db?: FakeDb } = {}): FakeBackend {
  const db = opts.db ?? createFakeDb();
  let session: Session = opts.userId ? { user: { id: opts.userId } } : null;
  const listeners = new Set<Listener>();

  const profiles: FakeBackend['profiles'] = {
    set(id, row) {
      const i = db.tables.profiles.findIndex((r) => r.id === id);
      if (i >= 0) db.tables.profiles[i] = { ...row, created_at: '2026-01-01T00:00:00.000Z' };
      else db.tables.profiles.push({ ...row, created_at: '2026-01-01T00:00:00.000Z' });
    },
    get: (id) => db.tables.profiles.find((r) => r.id === id) as ProfileRow | undefined,
  };
  if (opts.profile) profiles.set(opts.profile.id, opts.profile);

  const fake: FakeBackend = {
    db,
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
      from: (table: string) => db.client.from(table),
      rpc: async (name: string, args: Record<string, unknown>) => {
        fake.calls.rpc.push({ name, args });
        if (name === 'join_cohort') {
          const r = fake.joinResult;
          if (!r.error_code && session) {
            profiles.set(session.user.id, {
              id: session.user.id, role: 'student', display_name: String(args.display_name).trim(), cohort_id: r.cohort_id,
            });
          }
          return { data: [r], error: null };
        }
        if (name === 'create_cohort') {
          const me = session && profiles.get(session.user.id);
          if (fake.createCohortError || !me || me.role !== 'supervisor') {
            return { data: null, status: 403, error: { message: fake.createCohortError ?? 'only supervisors can create cohorts', code: '42501' } };
          }
          const row = {
            id: `cohort-${db.tables.cohorts.length + 1}`, name: String(args.name).trim(), supervisor_id: me.id,
            invite_code: 'KMNPQRSTUV'.slice(0, 10), term_end: args.term_end, created_at: new Date().toISOString(),
          };
          db.tables.cohorts.push(row);
          return { data: [{ id: row.id, invite_code: row.invite_code }], error: null };
        }
        throw new Error(`fake: unexpected rpc ${name}`);
      },
    } as unknown as Backend,
  };
  return fake;
}
