import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { loadModels } from '../content/client';
import type { Model } from '../content/schema';
import { useT } from '../i18n';
import type { Attempt } from '../progress/types';
import { ErrorBlock } from '../routes/ModuleGate';
import { appendReview, loadReviewLog, pickReviewItems } from './review';
import { useCourse, type OpenItem } from './useCourse';

function latest(attempts: Attempt[], id: string): Attempt | undefined {
  let best: Attempt | undefined;
  for (const a of attempts) if (a.itemId === id && (!best || a.createdAt >= best.createdAt)) best = a;
  return best;
}

function ReviewStep({ item, earlier, index, total, last, onDone }: {
  item: OpenItem; earlier: Attempt | undefined; index: number; total: number; last: boolean;
  onDone: (kind: 'done' | 'skipped', response?: string) => void;
}) {
  const s = useT();
  const x = s.practiceExtras.review;
  const [text, setText] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [model, setModel] = useState<Model | null>(null);
  const [modelError, setModelError] = useState(false);
  const headRef = useRef<HTMLHeadingElement>(null);
  const t = item.drill;

  async function fetchModel() {
    setModelError(false);
    try {
      const all = await loadModels(item.slug, item.contentLocale, item.stage);
      if (!all[t.id]) throw new Error('missing');
      setModel(all[t.id]);
    } catch { setModelError(true); }
  }
  function reveal() {
    // Recorded as soon as the student has answered, so closing the page afterwards still counts as a review.
    appendReview({ itemId: t.id, at: new Date().toISOString(), kind: 'done', response: text });
    setRevealed(true);
    void fetchModel();
  }
  useEffect(() => { if (revealed) headRef.current?.focus(); }, [revealed]);

  return (
    <article className="card drill" aria-label={x.itemOf(index + 1, total)}>
      <p className="muted">{x.itemOf(index + 1, total)}</p>
      <p className="muted"><strong>{x.situation}:</strong> {t.context}</p>
      <p className="client-line"><span className="visually-hidden">{x.clientSays}: </span>“{t.client}”</p>
      {!revealed ? (
        <>
          <div className="field">
            <label htmlFor="review-answer">{x.yourAnswerNow}</label>
            <textarea id="review-answer" rows={4} value={text} onChange={(e) => setText(e.target.value)} />
          </div>
          <div className="row">
            <button type="button" className="btn primary" disabled={text.trim().length === 0} onClick={reveal}>{x.reveal}</button>
            <button type="button" className="btn" onClick={() => onDone('skipped')}>{x.skip}</button>
          </div>
        </>
      ) : (
        <>
          <div className="compare">
            <div className="mine">
              <h3 ref={headRef} tabIndex={-1}>{x.earlier}</h3>
              <blockquote>{earlier?.response}</blockquote>
              <h3>{x.now}</h3>
              <blockquote>{text}</blockquote>
            </div>
            {modelError && (
              <div>
                <p role="alert" className="error">{x.modelError}</p>
                <button type="button" className="btn" onClick={() => void fetchModel()}>{s.common.retry}</button>
              </div>
            )}
            {model && (
              <section className="model" role="region" aria-labelledby="review-model" tabIndex={0}>
                <h3 id="review-model">{x.exampleHeading}</h3>
                <blockquote>{model.model_response}</blockquote>
                <h4>{x.whyHeading}</h4>
                <p>{model.why}</p>
                <h4>{x.avoidHeading}</h4>
                <p>{model.avoid}</p>
              </section>
            )}
          </div>
          <div className="row">
            <button type="button" className="btn primary" onClick={() => onDone('done')}>{last ? x.finish : x.next}</button>
          </div>
        </>
      )}
    </article>
  );
}

/**
 * Up to 3 earlier questions, module names hidden. The student answers from memory first, then sees the earlier
 * answer and the example. Notes go to a local review log. No attempt is saved, so nothing here can change a pass.
 */
export function ReviewPage() {
  const s = useT();
  const x = s.practiceExtras.review;
  const course = useCourse();
  const [step, setStep] = useState(0);
  const [tally, setTally] = useState({ done: 0, skipped: 0 });
  // The pick is made once when the data arrives: logging an item mid-session must not reshuffle the rest.
  const picked = useMemo(() => {
    if (course.status !== 'ready') return null;
    const { items, attempts } = course.data;
    const ids = pickReviewItems({
      candidates: items.map((i) => ({ itemId: i.drill.id, moduleKey: `${i.stage}/${i.slug}` })),
      attempts, log: loadReviewLog(), now: new Date(),
    });
    return ids.flatMap((id) => { const it = items.find((i) => i.drill.id === id); return it ? [it] : []; });
  }, [course]);

  if (course.status === 'loading') return <p>{s.common.loading}</p>;
  if (course.status === 'error') return <ErrorBlock message={x.loadError} onRetry={course.reload} />;
  const items = picked ?? [];
  if (items.length === 0) {
    return (
      <div>
        <h1>{x.heading}</h1>
        <p>{x.nothingDue}</p>
        <p><Link to="/">{x.backHome}</Link></p>
      </div>
    );
  }
  if (step >= items.length) {
    return (
      <div>
        <h1>{x.doneHeading}</h1>
        <p role="status">{x.doneText(tally.done, tally.skipped)}</p>
        <p className="muted">{x.localNote}</p>
        <p><Link to="/">{x.backHome}</Link></p>
      </div>
    );
  }
  const item = items[step];
  return (
    <div>
      <h1>{x.heading}</h1>
      <p className="lede">{x.intro}</p>
      <ReviewStep
        key={item.drill.id} item={item} earlier={latest(course.status === 'ready' ? course.data.attempts : [], item.drill.id)}
        index={step} total={items.length} last={step === items.length - 1}
        onDone={(kind, response) => {
          // "done" was logged when the answer was revealed; only a skip is logged here.
          if (kind === 'skipped') appendReview({ itemId: item.drill.id, at: new Date().toISOString(), kind, ...(response ? { response } : {}) });
          setTally((t) => ({ done: t.done + (kind === 'done' ? 1 : 0), skipped: t.skipped + (kind === 'skipped' ? 1 : 0) }));
          setStep((n) => n + 1);
        }}
      />
    </div>
  );
}
