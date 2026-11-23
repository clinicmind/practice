import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { DriveStatusPanel } from '../../components/DriveStatusPanel';
import { useT } from '../../i18n';
import { useReportsApi, type PurgeResult, type ReviewRow } from '../../reports/ReportsContext';

/** From this many leftover flags a report is marked, so the supervisor reads it with care. */
const HEAVY = 3;
const total = (r: ReviewRow) => Object.values(r.summary).reduce((n, v) => n + v.found, 0);

type Purge = { phase: 'idle' | 'asking' | 'working' } | { phase: 'done'; result: PurgeResult };

function PurgePanel({ onDone }: { onDone: () => void }) {
  const t = useT().reportsReview.purge;
  const api = useReportsApi();
  const [state, setState] = useState<Purge>({ phase: 'idle' });

  async function run() {
    setState({ phase: 'working' });
    let result: PurgeResult;
    try { result = await api.purgeExpired(); } catch { result = { ok: false, status: 0 }; }
    setState({ phase: 'done', result });
    if (result.ok && result.purged > 0) onDone();
  }

  const busy = state.phase === 'working';
  return (
    <section aria-labelledby="purge-h" className="card">
      <h2 id="purge-h">{t.heading}</h2>
      <p className="muted">{t.intro}</p>
      {state.phase === 'asking' ? (
        <div role="group" aria-label={t.confirm}>
          <p>{t.confirm}</p>
          <button type="button" className="btn primary" onClick={() => void run()}>{t.confirmYes}</button>{' '}
          <button type="button" className="btn" onClick={() => setState({ phase: 'idle' })}>{t.cancel}</button>
        </div>
      ) : (
        <p><button type="button" className="btn" disabled={busy} onClick={() => setState({ phase: 'asking' })}>{busy ? t.working : t.button}</button></p>
      )}
      {state.phase === 'done' && !state.result.ok && <p role="alert" className="error">{t.error}</p>}
      {state.phase === 'done' && state.result.ok && (
        <div role="status">
          <p>{state.result.purged === 0 && state.result.failed === 0 && !state.result.driveError ? t.none : state.result.purged > 0 ? t.done(state.result.purged) : null}</p>
          {state.result.more && <p>{t.more}</p>}
          {state.result.failed > 0 && <p>{t.failed(state.result.failed)}</p>}
          {state.result.driveError && <p>{t.driveError}</p>}
        </div>
      )}
    </section>
  );
}

type State = { status: 'loading' } | { status: 'error' } | { status: 'ready'; rows: ReviewRow[] };

export function ReportsListPage() {
  const s = useT();
  const t = s.reportsReview;
  const api = useReportsApi();
  const [state, setState] = useState<State>({ status: 'loading' });
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    let live = true;
    setState({ status: 'loading' });
    api.listForReview().then((rows) => live && setState({ status: 'ready', rows }), () => live && setState({ status: 'error' }));
    return () => { live = false; };
  }, [api, tick]);

  return (
    <div>
      <p><Link to="/supervisor">{s.auth.supervisorLink}</Link></p>
      <h1>{t.heading}</h1>
      <p className="muted">{t.intro}</p>
      <DriveStatusPanel />
      <PurgePanel onDone={reload} />
      {state.status === 'loading' && <p>{s.common.loading}</p>}
      {state.status === 'error' && (
        <div>
          <p role="alert" className="error">{t.loadError}</p>
          <button type="button" className="btn" onClick={reload}>{s.common.retry}</button>
        </div>
      )}
      {state.status === 'ready' && (state.rows.length === 0 ? <p>{t.empty}</p> : (
        <div className="table-scroll">
          <table>
            <caption className="visually-hidden">{t.heading}</caption>
            <thead>
              <tr>
                <th scope="col">{t.colTitle}</th>
                <th scope="col">{t.colStudent}</th>
                <th scope="col">{t.colDate}</th>
                <th scope="col">{t.colStatus}</th>
                <th scope="col">{t.colFlags}</th>
              </tr>
            </thead>
            <tbody>
              {state.rows.map((r) => {
                const n = total(r);
                const rules = Object.entries(r.summary).filter(([, v]) => v.found > 0);
                return (
                  <tr key={r.id}>
                    <th scope="row"><Link to={`/supervisor/reports/${r.id}`}>{r.title}</Link></th>
                    <td>{r.studentName}</td>
                    <td>{r.createdAt.slice(0, 10)}<div className="muted">{t.deleteAfter(r.deleteAfter)}</div></td>
                    <td>{r.status === 'reviewed' ? t.statusReviewed : t.statusSubmitted}</td>
                    <td>
                      {n === 0 ? t.flagsNone : (
                        <>
                          <div>{t.flagsTotal(n)}</div>
                          <div className="muted">{rules.map(([rule, v]) => `${s.reports.rules[rule] ?? rule} ×${v.found}`).join('、')}</div>
                          {n >= HEAVY && <span className="badge">{t.flagsHeavy}</span>}
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
