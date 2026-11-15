import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useT } from '../i18n';

export function Layout({ children, wasReset }: { children: ReactNode; wasReset?: boolean }) {
  const s = useT();
  const [showReset, setShowReset] = useState(!!wasReset);
  const { status, profile, signOut } = useAuth();
  return (
    <div className="shell">
      <a className="skip" href="#main">{s.common.skipToContent}</a>
      <header className="site-header">
        <Link to="/" className="brand">{s.appName}</Link>
        {profile && (status === 'student' || status === 'supervisor') && (
          <nav className="account" aria-label={s.common.account}>
            {status === 'supervisor' && <Link to="/supervisor">{s.auth.supervisorLink}</Link>}
            <span className="muted">{s.auth.signedInAs(profile.displayName)}</span>
            <button type="button" className="btn" onClick={() => void signOut()}>{s.auth.signOut}</button>
          </nav>
        )}
      </header>
      {showReset && (
        <div role="status" className="notice">
          <span>{s.notice.storeReset}</span>{' '}
          <button type="button" className="btn" onClick={() => setShowReset(false)}>{s.notice.dismiss}</button>
        </div>
      )}
      <main id="main" tabIndex={-1}>{children}</main>
      <footer className="site-footer">
        <p>{s.footer}</p>
      </footer>
    </div>
  );
}
