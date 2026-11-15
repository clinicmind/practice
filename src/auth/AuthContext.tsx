import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Backend } from './supabase';

export type Profile = {
  id: string;
  role: 'student' | 'supervisor';
  displayName: string;
  cohortId: string | null;
};

export type AuthStatus = 'loading' | 'local' | 'signedOut' | 'needsCohort' | 'student' | 'supervisor';

export interface AuthValue {
  status: AuthStatus;
  profile?: Profile;
  /** True when the account could not be read (network); status stays 'loading'. */
  profileError: boolean;
  reloadProfile(): void;
  signIn(email: string): Promise<void>;
  signOut(): Promise<void>;
  join(code: string, displayName: string): Promise<void>;
}

/** join_cohort reports these as a returned error_code; anything else is 'other'. */
export class JoinError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = 'JoinError';
  }
}

const AuthContext = createContext<AuthValue | null>(null);

export function useAuth(): AuthValue {
  const v = useContext(AuthContext);
  if (!v) throw new Error('useAuth must be used inside <AuthProvider>');
  return v;
}

type Row = { id: string; role: string; display_name: string; cohort_id: string | null };
const toProfile = (r: Row): Profile => ({
  id: r.id,
  role: r.role === 'supervisor' ? 'supervisor' : 'student',
  displayName: r.display_name,
  cohortId: r.cohort_id,
});

/**
 * `backend = null` is local mode (no Supabase configured): status is 'local'
 * from the first render and nothing here touches the network.
 */
export function AuthProvider({ backend, children }: { backend: Backend | null; children: ReactNode }) {
  // undefined = not known yet; null = signed out.
  const [userId, setUserId] = useState<string | null | undefined>(backend ? undefined : null);
  const [loaded, setLoaded] = useState<{ userId: string; profile: Profile | null } | undefined>();
  const [profileError, setProfileError] = useState(false);
  const [tick, setTick] = useState(0);
  const reloadProfile = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    if (!backend) return;
    let live = true;
    backend.auth.getSession().then(({ data }) => {
      if (live) setUserId((cur) => (cur === undefined ? data.session?.user.id ?? null : cur));
    }).catch(() => live && setUserId((cur) => (cur === undefined ? null : cur)));
    // Do not call back into Supabase from this callback: just record the session.
    const { data } = backend.auth.onAuthStateChange((_event, session) => {
      if (live) setUserId(session?.user.id ?? null);
    });
    return () => { live = false; data.subscription.unsubscribe(); };
  }, [backend]);

  useEffect(() => {
    if (!backend || !userId) return;
    let live = true;
    setProfileError(false);
    Promise.resolve(backend.from('profiles').select('id, role, display_name, cohort_id').eq('id', userId).maybeSingle())
      .then(({ data, error }) => {
        if (!live) return;
        if (error) { setProfileError(true); return; }
        setLoaded({ userId, profile: data ? toProfile(data as Row) : null });
      })
      .catch(() => live && setProfileError(true));
    return () => { live = false; };
  }, [backend, userId, tick]);

  const status: AuthStatus = !backend
    ? 'local'
    : userId === undefined ? 'loading'
    : userId === null ? 'signedOut'
    : loaded?.userId !== userId ? 'loading'
    : loaded.profile === null ? 'needsCohort'
    : loaded.profile.role;
  const profile = loaded && loaded.userId === userId ? loaded.profile ?? undefined : undefined;

  const value = useMemo<AuthValue>(() => ({
    status,
    profile,
    profileError,
    reloadProfile,
    async signIn(email) {
      if (!backend) throw new Error('no backend');
      const { error } = await backend.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
      });
      if (error) throw error;
    },
    async signOut() {
      if (!backend) return;
      await backend.auth.signOut();
      setLoaded(undefined);
    },
    async join(code, displayName) {
      if (!backend) throw new Error('no backend');
      const { data, error } = await backend.rpc('join_cohort', { code, display_name: displayName });
      if (error) throw new JoinError('other');
      const row = (Array.isArray(data) ? data[0] : data) as { error_code: string | null } | undefined;
      if (!row) throw new JoinError('other');
      if (row.error_code) throw new JoinError(row.error_code);
      reloadProfile();
    },
  }), [backend, status, profile, profileError, reloadProfile]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
