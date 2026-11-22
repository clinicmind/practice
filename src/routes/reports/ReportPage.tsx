import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useT } from '../../i18n';
import { useReportsApi, type ReportContent } from '../../reports/ReportsContext';

export function ReportPage() {
  const t = useT();
  const s = t.reports;
  const { id = '' } = useParams();
  const api = useReportsApi();
  const [r, setR] = useState<ReportContent | 'error' | null>(null);

  useEffect(() => {
    let live = true;
    setR(null);
    api.get(id).then((x) => { if (live) setR(x); }, () => { if (live) setR('error'); });
    return () => { live = false; };
  }, [api, id]);

  const back = <p><Link to="/reports">{s.report.back}</Link></p>;
  if (r === null) return <p className="muted">{t.common.loading}</p>;
  if (r === 'error') return <div><p role="alert" className="error">{s.report.loadError}</p>{back}</div>;
  if (!r.ok) {
    return <div><p role="alert">{r.status === 410 ? s.report.gone : r.status === 404 ? s.report.notFound : s.report.loadError}</p>{back}</div>;
  }
  return (
    <div>
      <h1>{r.title}</h1>
      <div className="report-text">{r.body}</div>
      {back}
    </div>
  );
}
