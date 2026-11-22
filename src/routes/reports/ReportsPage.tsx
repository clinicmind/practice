import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useT } from '../../i18n';
import { useReportsApi, type ReportRow } from '../../reports/ReportsContext';

export function ReportsPage() {
  const t = useT();
  const s = t.reports;
  const api = useReportsApi();
  const [rows, setRows] = useState<ReportRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [asking, setAsking] = useState<string | null>(null);
  const [deleteFailed, setDeleteFailed] = useState(false);

  useEffect(() => {
    let live = true;
    api.list().then((r) => { if (live) setRows(r); }, () => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [api]);

  const remove = async (id: string) => {
    setDeleteFailed(false);
    let ok = false;
    try { ok = await api.remove(id); } catch { ok = false; }
    if (ok) { setRows((r) => r?.filter((x) => x.id !== id) ?? r); setAsking(null); }
    else setDeleteFailed(true);
  };

  return (
    <div>
      <h1>{s.heading}</h1>
      <p><Link to="/reports/new">{s.newReport}</Link></p>
      {failed && <p role="alert" className="error">{s.loadError}</p>}
      {!failed && rows === null && <p className="muted">{t.common.loading}</p>}
      {rows && rows.length === 0 && <p>{s.empty}</p>}
      {rows && rows.length > 0 && (
        <ul className="sessions">
          {rows.map((r) => (
            <li key={r.id}>
              <Link to={`/reports/${r.id}`}>{r.title}</Link>
              <span className="muted">{r.createdAt.slice(0, 10)}</span>
              {asking === r.id ? (
                <div className="row">
                  <p role="alert">{s.list.deletePrompt}</p>
                  <button type="button" className="btn" onClick={() => void remove(r.id)}>{s.list.confirmDelete}</button>
                  <button type="button" className="btn" onClick={() => { setAsking(null); setDeleteFailed(false); }}>{s.list.cancel}</button>
                </div>
              ) : (
                <button type="button" className="btn" onClick={() => { setAsking(r.id); setDeleteFailed(false); }}>{s.list.delete}</button>
              )}
            </li>
          ))}
        </ul>
      )}
      {deleteFailed && <p role="alert" className="error">{s.list.deleteError}</p>}
    </div>
  );
}
