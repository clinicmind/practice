import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { en } from '../i18n/en';

export function Layout({ children, wasReset }: { children: ReactNode; wasReset?: boolean }) {
  const [showReset, setShowReset] = useState(!!wasReset);
  const { status, profile, signOut } = useAuth();
  return (
    <div className="shell">
      <a className="skip" href="#main">{en.common.skipToContent}</a>
      <header className="site-header">
        <Link to="/" className="brand">{en.appName}</Link>
        {profile && (status === 'student' || status === 'supervisor') && (
          <nav className="account" aria-label="Account">
            {status === 'supervisor' && <Link to="/supervisor">{en.auth.supervisorLink}</Link>}
            <span className="muted">{en.auth.signedInAs(profile.displayName)}</span>
            <button type="button" className="btn" onClick={() => void signOut()}>{en.auth.signOut}</button>
          </nav>
        )}
      </header>
      {showReset && (
        <div role="status" className="notice">
          <span>{en.notice.storeReset}</span>{' '}
          <button type="button" className="btn" onClick={() => setShowReset(false)}>{en.notice.dismiss}</button>
        </div>
      )}
      <main id="main" tabIndex={-1}>{children}</main>
      <footer className="site-footer">
        <p>{en.footer}</p>
      </footer>
    </div>
  );
}
