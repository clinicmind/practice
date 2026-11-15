import { Link } from 'react-router-dom';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { usePostLoginTarget } from '../auth/usePostLogin';
import { en } from '../i18n/en';
import { NotFound } from './NotFound';

/** Landing page of the magic link. Supabase's client reads the session from the URL. */
export function AuthCallback() {
  const { status } = useAuth();
  const target = usePostLoginTarget();
  if (status === 'local') return <NotFound />;
  if (target) return <Navigate to={target} replace />;
  if (status === 'signedOut') {
    return (
      <div>
        <p role="alert" className="error">{en.auth.callbackFailed}</p>
        <p><Link to="/login">{en.auth.backToLogin}</Link></p>
      </div>
    );
  }
  return <p role="status">{en.auth.callbackHeading}</p>;
}
