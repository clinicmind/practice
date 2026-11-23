import { useEffect, useId, useState } from 'react';
import { useT } from '../i18n';
import { useReportsApi, type DriveStatus } from '../reports/ReportsContext';

type State = { status: 'checking' } | { status: DriveStatus | 'error' };

/**
 * Whether the saved Google Drive authorisation still works. A broken link stops every submit and every
 * read, so it is shown plainly, with the file that holds the steps to fix it. Asks the function each
 * time it is shown; nothing is cached.
 */
export function DriveStatusPanel() {
  const t = useT().reportsReview.drive;
  const api = useReportsApi();
  const id = useId();
  const [state, setState] = useState<State>({ status: 'checking' });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let live = true;
    setState({ status: 'checking' });
    api.driveStatus().then((s) => live && setState({ status: s }), () => live && setState({ status: 'error' }));
    return () => { live = false; };
  }, [api, tick]);

  const text: Record<DriveStatus | 'error', string> = {
    ok: t.ok, auth: t.auth, quota: t.quota, unavailable: t.unavailable, not_configured: t.notConfigured, error: t.checkError,
  };
  const s = state.status;
  const bad = s === 'auth' || s === 'quota' || s === 'not_configured' || s === 'error';
  return (
    <section aria-labelledby={id} className="card">
      <h2 id={id}>{t.heading}</h2>
      {s === 'checking' ? (
        <p role="status" className="muted">{t.checking}</p>
      ) : bad ? (
        <p role="alert" className="error">{text[s]}</p>
      ) : (
        <p role="status" className={s === 'ok' ? '' : 'notice'}>{text[s]}</p>
      )}
      {s !== 'checking' && <p><button type="button" className="btn" onClick={() => setTick((n) => n + 1)}>{t.recheck}</button></p>}
    </section>
  );
}
