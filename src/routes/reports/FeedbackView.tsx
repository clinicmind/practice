import { useEffect, useId, useState } from 'react';
import { useT } from '../../i18n';
import { DIMENSIONS, useReportsApi, type FeedbackRecord } from '../../reports/ReportsContext';

/** The released feedback on one report. Shows nothing when there is none, and never a draft. */
export function FeedbackView({ reportId }: { reportId: string }) {
  const t = useT().reportsReview;
  const api = useReportsApi();
  const heading = useId();
  const [r, setR] = useState<FeedbackRecord | null | 'error'>(null);

  useEffect(() => {
    let live = true;
    setR(null);
    api.releasedFeedback(reportId).then((x) => live && setR(x), () => live && setR('error'));
    return () => { live = false; };
  }, [api, reportId]);

  if (r === null) return null;
  if (r === 'error') return <p role="alert" className="error">{t.student.loadError}</p>;
  return (
    <section aria-labelledby={heading}>
      <h2 id={heading}>{t.student.heading}</h2>
      {r.releasedAt && <p className="muted">{t.student.releasedOn(r.releasedAt.slice(0, 10))}</p>}
      <ul className="feedback-scores">
        {DIMENSIONS.map((d) => {
          const n = r.scores[d];
          const rub = t.rubric[d]!;
          if (n === undefined) return null;
          return (
            <li key={d} aria-label={rub.title}>
              <strong>{rub.title}</strong>: {t.levelNames[n - 1]} ({n} / 4)
              <div className="muted">{rub.levels[n - 1]}</div>
            </li>
          );
        })}
      </ul>
      <h3>{t.student.commentsHeading}</h3>
      <div className="report-text">{r.comments}</div>
    </section>
  );
}
