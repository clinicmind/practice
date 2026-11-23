import { useEffect, useId, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useT } from '../../i18n';
import { DIMENSIONS, useReportsApi, type FeedbackRecord, type Scores, type Score, type ReviewRow } from '../../reports/ReportsContext';
import { canRelease, RUBRIC_REVIEWED, SCORES } from '../../reports/rubric';

type Loaded =
  | { kind: 'text'; row: ReviewRow; title: string; body: string; feedback: FeedbackRecord | null }
  | { kind: 'message'; text: 'notFound' | 'gone' | 'driveDown' | 'loadError' };
type State = { status: 'loading' } | ({ status: 'ready' } & { loaded: Loaded });

export function ReportReviewPage() {
  const s = useT();
  const t = s.reportsReview;
  const { id = '' } = useParams();
  const api = useReportsApi();
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    let live = true;
    const done = (loaded: Loaded) => live && setState({ status: 'ready', loaded });
    setState({ status: 'loading' });
    Promise.all([api.listForReview(), api.get(id), api.myFeedback(id)]).then(
      ([rows, content, feedback]) => {
        const row = rows.find((r) => r.id === id);
        if (!row || (!content.ok && content.status === 404)) return done({ kind: 'message', text: 'notFound' });
        if (!content.ok) return done({ kind: 'message', text: content.status === 410 ? 'gone' : content.status === 502 ? 'driveDown' : 'loadError' });
        done({ kind: 'text', row, title: content.title, body: content.body, feedback });
      },
      () => done({ kind: 'message', text: 'loadError' }),
    );
    return () => { live = false; };
  }, [api, id]);

  const back = <p><Link to="/supervisor/reports">{t.review.back}</Link></p>;
  if (state.status === 'loading') return <p>{s.common.loading}</p>;
  const { loaded } = state;
  if (loaded.kind === 'message') return <div><p role="alert">{t.review[loaded.text]}</p>{back}</div>;
  return (
    <div>
      {back}
      <h1>{loaded.title}</h1>
      <p className="muted">{t.review.by(loaded.row.studentName, loaded.row.createdAt.slice(0, 10))}</p>
      <h2>{t.review.textHeading}</h2>
      <div className="report-text">{loaded.body}</div>
      <ReviewForm reportId={id} initial={loaded.feedback} />
      <DeleteReport reportId={id} />
    </div>
  );
}

function ReviewForm({ reportId, initial }: { reportId: string; initial: FeedbackRecord | null }) {
  const s = useT();
  const t = s.reportsReview;
  const api = useReportsApi();
  const [record, setRecord] = useState(initial);
  const [scores, setScores] = useState<Scores>(initial?.scores ?? {});
  const [comments, setComments] = useState(initial?.comments ?? '');
  const [phase, setPhase] = useState<'idle' | 'asking' | 'saving'>('idle');
  const [message, setMessage] = useState<'savedDraft' | 'savedReleased' | 'error' | null>(null);
  const released = record?.status === 'released';
  const ready = canRelease(scores, comments);

  async function save(release: boolean) {
    setPhase('saving');
    setMessage(null);
    let r: Awaited<ReturnType<typeof api.saveFeedback>> = { ok: false };
    try { r = await api.saveFeedback(reportId, { scores, comments }, release); } catch { /* shown below */ }
    setPhase('idle');
    if (!r.ok) { setMessage('error'); return; }
    setRecord(r.record);
    setMessage(r.record.status === 'released' ? 'savedReleased' : 'savedDraft');
  }

  return (
    <section aria-labelledby="review-h">
      <h2 id="review-h">{t.review.feedbackHeading}</h2>
      {!RUBRIC_REVIEWED && <p role="note" className="notice">{t.review.rubricUnreviewed}</p>}
      <p className="muted">{released ? t.review.releasedNote(record!.releasedAt?.slice(0, 10) ?? '') : t.review.draftNote}</p>
      {DIMENSIONS.map((d) => {
        const rub = t.rubric[d]!;
        return (
          <fieldset key={d}>
            <legend>{rub.title}</legend>
            {SCORES.map((n: Score) => (
              <div key={n}>
                <label>
                  <input type="radio" name={`score-${d}`} checked={scores[d] === n} onChange={() => setScores((x) => ({ ...x, [d]: n }))} />{' '}
                  <strong>{t.levelNames[n - 1]}</strong> ({n}): {rub.levels[n - 1]}
                </label>
              </div>
            ))}
          </fieldset>
        );
      })}
      <label htmlFor="review-comments">{t.review.comments}</label>
      <textarea id="review-comments" rows={6} maxLength={10000} value={comments} onChange={(e) => setComments(e.target.value)} />
      {message === 'error' && <p role="alert" className="error">{t.review.saveError}</p>}
      {message === 'savedDraft' && <p role="status">{t.review.savedDraft}</p>}
      {message === 'savedReleased' && <p role="status">{t.review.savedReleased}</p>}
      {phase === 'asking' ? (
        <div role="group" aria-label={t.review.releaseConfirm}>
          <p>{t.review.releaseConfirm}</p>
          <button type="button" className="btn primary" onClick={() => void save(true)}>{t.review.releaseYes}</button>{' '}
          <button type="button" className="btn" onClick={() => setPhase('idle')}>{t.review.cancel}</button>
        </div>
      ) : released ? (
        <p>
          <button type="button" className="btn" disabled={phase === 'saving' || !ready} onClick={() => void save(true)}>
            {phase === 'saving' ? t.review.saving : t.review.saveChanges}
          </button>
          {!ready && <>{' '}<span className="muted">{t.review.releaseHint}</span></>}
        </p>
      ) : (
        <p>
          <button type="button" className="btn" disabled={phase === 'saving'} onClick={() => void save(false)}>
            {phase === 'saving' ? t.review.saving : t.review.saveDraft}
          </button>{' '}
          <button type="button" className="btn primary" disabled={phase === 'saving' || !ready} onClick={() => setPhase('asking')}>{t.review.release}</button>
          {!ready && <>{' '}<span className="muted">{t.review.releaseHint}</span></>}
        </p>
      )}
    </section>
  );
}

function DeleteReport({ reportId }: { reportId: string }) {
  const t = useT().reportsReview.review;
  const api = useReportsApi();
  const navigate = useNavigate();
  const warn = useId();
  const [asking, setAsking] = useState(false);
  const [failed, setFailed] = useState(false);

  async function remove() {
    setFailed(false);
    let ok = false;
    try { ok = await api.remove(reportId); } catch { ok = false; }
    if (ok) navigate('/supervisor/reports'); else setFailed(true);
  }

  return (
    <section>
      {failed && <p role="alert" className="error">{t.deleteError}</p>}
      {asking ? (
        <div role="group" aria-labelledby={warn}>
          <p id={warn}>{t.deleteConfirm}</p>
          <button type="button" className="btn primary" onClick={() => void remove()}>{t.deleteYes}</button>{' '}
          <button type="button" className="btn" onClick={() => setAsking(false)}>{t.cancel}</button>
        </div>
      ) : (
        <p><button type="button" className="btn" onClick={() => setAsking(true)}>{t.deleteButton}</button></p>
      )}
    </section>
  );
}
