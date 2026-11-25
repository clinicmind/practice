import { Suspense, useEffect, useId, useRef, useState } from 'react';
import { LazyAiFeedbackPanel } from '../ai/lazy';
import { useExtrasEnabled } from '../extras/ExtrasContext';
import { LazyReviseOnce } from '../extras/lazy';
import type { Drill, Model } from '../content/schema';
import { useT } from '../i18n';
import { clearDraft, loadDraft, saveDraft } from '../progress/drafts';
import { MIN_CRITERIA, MIN_RESPONSE } from '../progress/rules';
import type { Attempt, NewAttempt } from '../progress/types';

type Phase = 'writing' | 'rating' | 'review';
interface Props {
  drill: Drill;
  /** Changes when the example responses would be in another language, so a shown one is fetched again. */
  contentKey?: string;
  attempts: Attempt[];
  /** Resolves with the saved attempt when the store returns it (the AI check needs its id). */
  onSubmit: (a: NewAttempt) => Promise<Attempt | void>;
  /** Called only after an attempt has been saved (spec §3.1). */
  getModel: () => Promise<Model>;
  onNext?: () => void;
  /** Called by "Sign in again" when the cloud session has expired. */
  onReauth?: () => void;
}

export function DrillCard({ drill, contentKey, attempts, onSubmit, getModel, onNext, onReauth }: Props) {
  const s = useT();
  const t = s.drill;
  const x = s.practiceExtras;
  const extras = useExtrasEnabled();
  const uid = useId();
  const [folded, setFolded] = useState(false);
  const [phase, setPhase] = useState<Phase>('writing');
  const [draft] = useState(() => loadDraft(drill.id));
  const [text, setText] = useState(draft?.response ?? '');
  const [ticks, setTicks] = useState<boolean[]>(draft?.ticks ?? [false, false, false]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<null | 'auth' | 'other'>(null);
  const [model, setModel] = useState<Model | null>(null);
  const [modelError, setModelError] = useState(false);
  const [saved, setSaved] = useState<{ response: string; met: boolean; attemptId: string | null; ticks: boolean[] } | null>(null);

  // Keyboard users lose focus when a button unmounts; move it to the new step.
  const textRef = useRef<HTMLTextAreaElement>(null);
  const ratingRef = useRef<HTMLFieldSetElement>(null);
  const reviewRef = useRef<HTMLHeadingElement>(null);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (phase === 'writing') textRef.current?.focus();
    else if (phase === 'rating') ratingRef.current?.focus();
    else reviewRef.current?.focus();
  }, [phase]);

  // Keep an unsaved answer so a sign-in round trip (or an accidental navigation) cannot lose it.
  useEffect(() => {
    if (phase === 'review') return;
    if (text.length === 0) clearDraft(drill.id);
    else saveDraft(drill.id, { response: text, ticks });
  }, [phase, text, ticks, drill.id]);

  // The example response follows the language of the module; refetch it if the language changes after it was shown.
  const shownKey = useRef(contentKey);
  useEffect(() => {
    if (shownKey.current === contentKey) return;
    shownKey.current = contentKey;
    if (phase === 'review') void fetchModel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentKey]);

  const blank = text.trim().length === 0;
  const ticked = ticks.filter(Boolean).length;
  const wouldMeet = ticked >= MIN_CRITERIA && text.trim().length >= MIN_RESPONSE;

  async function fetchModel() {
    setModelError(false);
    try {
      setModel(await getModel());
    } catch {
      setModelError(true);
    }
  }

  async function save() {
    if (saving) return;
    setSaving(true);
    setSaveError(null);
    let savedAttempt: Attempt | void;
    try {
      savedAttempt = await onSubmit({ itemId: drill.id, response: text, criteriaMet: [...ticks] });
    } catch (err) {
      const auth = (err as { kind?: string } | null)?.kind === 'auth';
      if (auth) saveDraft(drill.id, { response: text, ticks });
      setSaveError(auth ? 'auth' : 'other');
      setSaving(false);
      return;
    }
    clearDraft(drill.id);
    setSaving(false);
    setSaved({ response: text, met: wouldMeet, attemptId: savedAttempt ? savedAttempt.id : null, ticks: [...ticks] });
    setPhase('review');
    void fetchModel();
  }

  function retry() {
    setText('');
    setTicks([false, false, false]);
    setSaved(null);
    setModel(null);
    setModelError(false);
    setSaveError(null);
    setPhase('writing');
  }

  const earlier = attempts.filter((a) => a.itemId === drill.id);
  const lastEarlier = earlier.reduce<Attempt | null>((m, a) => (m === null || a.createdAt >= m.createdAt ? a : m), null);

  return (
    <article className="card drill" aria-labelledby={`${uid}-client`}>
      <p className="muted context">
        <strong>{t.context}:</strong> {drill.context}
      </p>
      {/* On a phone this bar stays at the top while the student types, so the client's words are never hidden by the keyboard. */}
      <div className={['client-bar', folded && 'folded', phase === 'review' && 'done'].filter(Boolean).join(' ')}>
        <p id={`${uid}-client`} className="client-line">
          <span className="visually-hidden">{t.client}: </span>“{drill.client}”
        </p>
        <button
          type="button" className="client-bar-toggle" aria-expanded={!folded} aria-controls={`${uid}-client`}
          onClick={() => setFolded((v) => !v)}
        >
          {folded ? x.clientBar.unfold : x.clientBar.fold}
        </button>
      </div>

      {phase !== 'review' && (
        <div className="field">
          <label htmlFor={`${uid}-resp`}>{t.responseLabel}</label>
          <p id={`${uid}-help`} className="muted">{t.responseHelp}</p>
          <textarea
            id={`${uid}-resp`}
            ref={textRef}
            aria-describedby={`${uid}-help`}
            rows={4}
            value={text}
            readOnly={phase === 'rating'}
            onChange={(e) => setText(e.target.value)}
          />
        </div>
      )}

      {phase === 'writing' && (
        <>
          <button type="button" className="btn primary" disabled={blank} onClick={() => setPhase('rating')}>
            {t.submit}
          </button>
          {earlier.length > 0 && (
            <section>
              <h3>{t.earlierAttempts}</h3>
              <ul aria-label={t.earlierAttempts} className="attempt-list">
                {earlier.map((a) => (
                  <li key={a.id}>
                    <span>{a.response}</span>{' '}
                    <span className="muted">({t.attemptSummary(a.criteriaMet.filter(Boolean).length)})</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {lastEarlier && LazyAiFeedbackPanel && (
            <Suspense fallback={null}>
              <LazyAiFeedbackPanel
                mode="stored" heading={s.aiFeedback.previousSummary}
                attemptId={lastEarlier.id} response={lastEarlier.response} criteria={drill.criteria} selfMet={lastEarlier.criteriaMet}
              />
            </Suspense>
          )}
        </>
      )}

      {phase === 'rating' && (
        <>
          <fieldset ref={ratingRef} tabIndex={-1}>
            <legend>{t.selfCheckLegend}</legend>
            {drill.criteria.map((c, i) => (
              <label key={i} className="check">
                <input
                  type="checkbox"
                  checked={ticks[i]}
                  onChange={(e) => setTicks(ticks.map((v, j) => (j === i ? e.target.checked : v)))}
                />{' '}
                {c}
              </label>
            ))}
          </fieldset>
          {!wouldMeet && <p className="muted">{t.needHint}</p>}
          {saveError === 'other' && <p role="alert" className="error">{t.saveError}</p>}
          {saveError === 'auth' && (
            <div>
              <p role="alert" className="error">{t.sessionExpired}</p>
              {onReauth && <button type="button" className="btn primary" onClick={onReauth}>{t.signInAgain}</button>}
            </div>
          )}
          <div className="row">
            <button type="button" className="btn primary" disabled={saving} onClick={save}>
              {saving ? t.saving : t.saveSelfCheck}
            </button>
            <button type="button" className="btn" disabled={saving} onClick={() => setPhase('writing')}>
              {t.editResponse}
            </button>
          </div>
        </>
      )}

      {phase === 'review' && saved && (
        <>
          <div className="compare">
          <div className="mine">
          <h3 ref={reviewRef} tabIndex={-1}>{t.yourResponse}</h3>
          <blockquote>{saved.response}</blockquote>
          <p className={saved.met ? 'verdict met' : 'verdict'}>{saved.met ? t.met : t.notMet}</p>
          <ul aria-label={x.selfCheck.heading} className="self-check">
            {drill.criteria.map((c, i) => (
              <li key={i} className={saved.ticks[i] ? 'on' : undefined}>
                <span aria-hidden="true">{saved.ticks[i] ? '✓ ' : '○ '}</span>
                <strong>{saved.ticks[i] ? x.selfCheck.ticked : x.selfCheck.notTicked}:</strong> {c}
              </li>
            ))}
          </ul>
          </div>
          {modelError && (
            <div>
              <p role="alert" className="error">{t.modelError}</p>
              <button type="button" className="btn" onClick={() => void fetchModel()}>
                {t.modelRetry}
              </button>
            </div>
          )}
          {model && (
            <section className="model" role="region" aria-labelledby={`${uid}-model`} tabIndex={0}>
              <h3 id={`${uid}-model`}>{t.modelHeading}</h3>
              <blockquote>{model.model_response}</blockquote>
              <h4>{t.whyHeading}</h4>
              <p>{model.why}</p>
              <h4>{t.avoidHeading}</h4>
              <p>{model.avoid}</p>
            </section>
          )}
          </div>
          {extras && LazyReviseOnce && model && (
            <Suspense fallback={null}>
              <LazyReviseOnce criteria={drill.criteria} firstVersion={saved.response} />
            </Suspense>
          )}
          {saved.attemptId && LazyAiFeedbackPanel && (
            <Suspense fallback={null}>
              <LazyAiFeedbackPanel mode="ask" attemptId={saved.attemptId} response={saved.response} criteria={drill.criteria} selfMet={saved.ticks} />
            </Suspense>
          )}
          <div className="row">
            <button type="button" className="btn" onClick={retry}>{t.tryAgain}</button>
            {onNext && <button type="button" className="btn primary" onClick={onNext}>{t.next}</button>}
          </div>
        </>
      )}
    </article>
  );
}
