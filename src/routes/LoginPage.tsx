import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { rememberReturnTo, safePath } from '../auth/returnTo';
import { usePostLoginTarget } from '../auth/usePostLogin';
import { en } from '../i18n/en';
import { NotFound } from './NotFound';

const t = en.auth;

export function LoginPage() {
  const { status, signIn } = useAuth();
  const from = safePath((useLocation().state as { from?: string } | null)?.from);
  const target = usePostLoginTarget();
  const [email, setEmail] = useState('');
  const [phase, setPhase] = useState<'form' | 'sending' | 'sent'>('form');
  const [error, setError] = useState<string | null>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => { if (from) rememberReturnTo(from); }, [from]);
  useEffect(() => { if (phase === 'sent') statusRef.current?.focus(); }, [phase]);

  if (status === 'local') return <NotFound />;
  if (status === 'loading') return <p>{en.common.loading}</p>;
  if (target) return <Navigate to={target} replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    const clean = email.trim();
    if (!clean) { setError(t.emailRequired); return; }
    setError(null);
    setPhase('sending');
    try {
      await signIn(clean);
      setPhase('sent');
    } catch {
      setPhase('form');
      setError(t.sendError);
    }
  }

  if (phase === 'sent') {
    // The same message whether or not the address is known.
    return (
      <div>
        <h1>{t.loginHeading}</h1>
        <p role="status" tabIndex={-1} ref={statusRef}>{t.checkEmail}</p>
        <button type="button" className="btn" onClick={() => { setEmail(''); setPhase('form'); }}>{t.useAnotherEmail}</button>
      </div>
    );
  }
  return (
    <form onSubmit={submit} noValidate>
      <h1>{t.loginHeading}</h1>
      <p>{t.loginIntro}</p>
      <label htmlFor="email">{t.emailLabel}</label>
      <input id="email" type="email" autoComplete="email" value={email}
        onChange={(e) => setEmail(e.target.value)} aria-describedby={error ? 'login-error' : undefined} />
      {error && <p id="login-error" role="alert" className="error">{error}</p>}
      <p>
        <button type="submit" className="btn" disabled={phase === 'sending'}>
          {phase === 'sending' ? t.sending : t.sendLink}
        </button>
      </p>
    </form>
  );
}
