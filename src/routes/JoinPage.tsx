import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { JoinError, useAuth } from '../auth/AuthContext';
import { useT } from '../i18n';
import { NotFound } from './NotFound';

export function JoinPage() {
  const s = useT();
  const t = s.auth;
  const { status, join } = useAuth();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (status === 'local') return <NotFound />;
  if (status === 'loading') return <p>{s.common.loading}</p>;
  if (status === 'signedOut') return <Navigate to="/login" replace />;
  if (status === 'student') return <Navigate to="/" replace />;
  if (status === 'supervisor') return <Navigate to="/supervisor" replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    const cleanName = name.trim();
    if (!code.trim()) { setError(t.codeRequired); return; }
    if (cleanName.length < 1 || cleanName.length > 40) { setError(t.displayNameInvalid); return; }
    setError(null);
    setBusy(true);
    try {
      await join(code.trim(), cleanName);
      // status flips to 'student' and the redirect above takes over.
    } catch (err) {
      setError(t.joinErrors[err instanceof JoinError ? err.code : 'other'] ?? t.joinErrors.other);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate>
      <h1>{t.joinHeading}</h1>
      <p>{t.joinIntro}</p>
      <label htmlFor="code">{t.codeLabel}</label>
      <input id="code" autoComplete="off" autoCapitalize="characters" spellCheck={false} value={code}
        onChange={(e) => setCode(e.target.value)} />
      <label htmlFor="display-name">{t.displayNameLabel}</label>
      <input id="display-name" autoComplete="nickname" maxLength={80} value={name}
        onChange={(e) => setName(e.target.value)} aria-describedby="display-name-help" />
      <p id="display-name-help" className="muted">{t.displayNameHelp}</p>
      {error && <p role="alert" className="error">{error}</p>}
      <p>
        <button type="submit" className="btn" disabled={busy}>{busy ? t.joining : t.joinSubmit}</button>
      </p>
    </form>
  );
}
