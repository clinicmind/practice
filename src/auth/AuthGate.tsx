import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useT } from '../i18n';
import { importLocal } from '../progress/importLocal';
import { STORAGE_KEY } from '../progress/localStore';
import { createSupabaseStore } from '../progress/supabaseStore';
import { createOpenStageReader, OpenStagesContext } from '../progress/stageAccess';
import { createGrantReader, GrantsContext } from '../progress/unlocks';
import { createSupervisorApi } from '../supervisor/api';
import { SupervisorApiContext } from '../supervisor/SupervisorContext';
import type { ProgressStore } from '../progress/types';
import { NotFound } from '../routes/NotFound';
import { StoreProvider } from '../StoreContext';
import { useAuth, type Profile } from './AuthContext';
import { rememberReturnTo } from './returnTo';
import type { Backend } from './supabase';

function Loading() {
  const s = useT();
  const { profileError, reloadProfile } = useAuth();
  if (profileError) {
    return (
      <div>
        <p role="alert" className="error">{s.auth.profileLoadError}</p>
        <button type="button" className="btn" onClick={reloadProfile}>{s.common.retry}</button>
      </div>
    );
  }
  return <p>{s.common.loading}</p>;
}

/**
 * Signed in: progress lives in the cloud store. Anything saved in this browser
 * before sign-in is moved over first (once; safe to repeat), then cleared.
 */
function CloudShell({ backend, profile, local, storage }: {
  backend: Backend; profile: Profile; local: ProgressStore; storage: Storage;
}) {
  const s = useT();
  const remote = useMemo(() => createSupabaseStore(backend, profile.id), [backend, profile.id]);
  const readGrants = useMemo(() => createGrantReader(backend, profile.id), [backend, profile.id]);
  const readOpenStages = useMemo(
    () => createOpenStageReader(backend, { role: profile.role, cohortId: profile.cohortId }),
    [backend, profile.role, profile.cohortId],
  );
  const supervisorApi = useMemo(
    () => (profile.role === 'supervisor' ? createSupervisorApi(backend, profile.id) : null),
    [backend, profile.id, profile.role],
  );
  const hasLocal = useMemo(() => {
    try { return storage.getItem(STORAGE_KEY) !== null; } catch { return false; }
  }, [storage]);
  const [phase, setPhase] = useState<'running' | 'done' | 'error'>(hasLocal ? 'running' : 'done');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!hasLocal) return;
    let live = true;
    setPhase('running');
    importLocal(local, remote, storage)
      .then(() => live && setPhase('done'))
      .catch(() => live && setPhase('error'));
    return () => { live = false; };
  }, [hasLocal, local, remote, storage, attempt]);

  if (phase === 'running') return <p role="status">{s.auth.importing}</p>;
  if (phase === 'error') {
    return (
      <div>
        <p role="alert" className="error">{s.auth.importError}</p>
        <button type="button" className="btn" onClick={() => setAttempt((n) => n + 1)}>{s.common.retry}</button>
      </div>
    );
  }
  return (
    <StoreProvider store={remote}>
      <GrantsContext.Provider value={readGrants}>
        <OpenStagesContext.Provider value={readOpenStages}>
          <SupervisorApiContext.Provider value={supervisorApi}>
            <Outlet />
          </SupervisorApiContext.Provider>
        </OpenStagesContext.Provider>
      </GrantsContext.Provider>
    </StoreProvider>
  );
}

/**
 * Wraps every route that needs a signed-in user, or local mode (no Supabase),
 * where `store` is the browser store exactly as in phase 1.
 */
export function RequireAuth({ store, backend, storage }: { store: ProgressStore; backend: Backend | null; storage: Storage }) {
  const { status, profile } = useAuth();
  const loc = useLocation();
  const here = loc.pathname + loc.search;
  useEffect(() => { if (status === 'signedOut') rememberReturnTo(here); }, [status, here]);

  switch (status) {
    case 'loading': return <Loading />;
    case 'signedOut': return <Navigate to="/login" replace state={{ from: here }} />;
    case 'needsCohort': return <Navigate to="/join" replace />;
    case 'local': return <StoreProvider store={store}><Outlet /></StoreProvider>;
    default:
      if (!backend || !profile) return <Loading />;
      return <CloudShell key={profile.id} backend={backend} profile={profile} local={store} storage={storage} />;
  }
}

/** Supervisor-only pages. Anyone else gets the ordinary not-found page. */
export function RequireSupervisor({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  return status === 'supervisor' ? <>{children}</> : <NotFound />;
}
