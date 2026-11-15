import { useEffect, type ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { en } from '../i18n/en';
import type { ProgressStore } from '../progress/types';
import { NotFound } from '../routes/NotFound';
import { StoreProvider } from '../StoreContext';
import { useAuth } from './AuthContext';
import { rememberReturnTo } from './returnTo';

function Loading() {
  const { profileError, reloadProfile } = useAuth();
  if (profileError) {
    return (
      <div>
        <p role="alert" className="error">{en.auth.profileLoadError}</p>
        <button type="button" className="btn" onClick={reloadProfile}>{en.common.retry}</button>
      </div>
    );
  }
  return <p>{en.common.loading}</p>;
}

/** Wraps every route that needs a signed-in user (or local mode). */
export function RequireAuth({ store }: { store: ProgressStore }) {
  const { status } = useAuth();
  const loc = useLocation();
  const here = loc.pathname + loc.search;
  useEffect(() => { if (status === 'signedOut') rememberReturnTo(here); }, [status, here]);

  switch (status) {
    case 'loading': return <Loading />;
    case 'signedOut': return <Navigate to="/login" replace state={{ from: here }} />;
    case 'needsCohort': return <Navigate to="/join" replace />;
    default: return <StoreProvider store={store}><Outlet /></StoreProvider>;
  }
}

/** Supervisor-only pages. Anyone else gets the ordinary not-found page. */
export function RequireSupervisor({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  return status === 'supervisor' ? <>{children}</> : <NotFound />;
}
