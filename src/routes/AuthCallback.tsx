import { Link } from 'react-router-dom';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { usePostLoginTarget } from '../auth/usePostLogin';
import { useT } from '../i18n';
import { NotFound } from './NotFound';

/** Landing page of the magic link. Supabase's client reads the session from the URL. */
export function AuthCallback() {
  const s = useT();
  const { status } = useAuth();
  const target = usePostLoginTarget();
  if (status === 'local') return <NotFound />;
  if (target) return <Navigate to={target} replace />;
  if (status === 'signedOut') {
    return (
      <div>
        <p role="alert" className="error">{s.auth.callbackFailed}</p>
        <p><Link to="/login">{s.auth.backToLogin}</Link></p>
      </div>
    );
  }
  return <p role="status">{s.auth.callbackHeading}</p>;
}
