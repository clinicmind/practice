import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useReportsEnabled } from '../reports/ReportsContext';
import { LOCALE_NAME, useLocale, useT, type Locale } from '../i18n';

export function Layout({ children, wasReset }: { children: ReactNode; wasReset?: boolean }) {
  const s = useT();
  const { locale, setLocale } = useLocale();
  const other: Locale = locale === 'en' ? 'zh-Hant' : 'en';
  const [showReset, setShowReset] = useState(!!wasReset);
  const { status, profile, signOut } = useAuth();
  const reportsOn = useReportsEnabled();
  return (
    <div className="shell">
      <a className="skip" href="#main">{s.common.skipToContent}</a>
      <header className="site-header">
        <Link to="/" className="brand">{s.appName}</Link>
        <button type="button" className="btn lang-switch" lang={other} onClick={() => setLocale(other)}>
          {LOCALE_NAME[other]}
        </button>
        {reportsOn && <Link to="/reports" className="reports-link">{s.reports.nav}</Link>}
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
