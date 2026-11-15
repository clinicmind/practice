import { useEffect, useId, useRef, useState } from 'react';
import type { Drill, Model } from '../content/schema';
import { en } from '../i18n/en';
import { clearDraft, loadDraft, saveDraft } from '../progress/drafts';
import { MIN_CRITERIA, MIN_RESPONSE } from '../progress/rules';
import type { Attempt, NewAttempt } from '../progress/types';

type Phase = 'writing' | 'rating' | 'review';
const t = en.drill;

interface Props {
  drill: Drill;
  attempts: Attempt[];
  onSubmit: (a: NewAttempt) => Promise<void>;
  /** Called only after an attempt has been saved (spec §3.1). */
  getModel: () => Promise<Model>;
  onNext?: () => void;
  /** Called by "Sign in again" when the cloud session has expired. */
  onReauth?: () => void;
}

export function DrillCard({ drill, attempts, onSubmit, getModel, onNext, onReauth }: Props) {
  const uid = useId();
  const [phase, setPhase] = useState<Phase>('writing');
  const [draft] = useState(() => loadDraft(drill.id));
  const [text, setText] = useState(draft?.response ?? '');
  const [ticks, setTicks] = useState<boolean[]>(draft?.ticks ?? [false, false, false]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<null | 'auth' | 'other'>(null);
  const [model, setModel] = useState<Model | null>(null);
  const [modelError, setModelError] = useState(false);
  const [saved, setSaved] = useState<{ response: string; met: boolean } | null>(null);

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
    try {
      await onSubmit({ itemId: drill.id, response: text, criteriaMet: [...ticks] });
    } catch (err) {
      const auth = (err as { kind?: string } | null)?.kind === 'auth';
      if (auth) saveDraft(drill.id, { response: text, ticks });
      setSaveError(auth ? 'auth' : 'other');
      setSaving(false);
      return;
    }
    clearDraft(drill.id);
    setSaving(false);
    setSaved({ response: text, met: wouldMeet });
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

  return (
    <article className="card" aria-labelledby={`${uid}-client`}>
      <p className="muted">
        <strong>{t.context}:</strong> {drill.context}
      </p>
      <p id={`${uid}-client`} className="client-line">
        <span className="visually-hidden">{t.client}: </span>“{drill.client}”
      </p>

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
          <h3 ref={reviewRef} tabIndex={-1}>{t.yourResponse}</h3>
          <blockquote>{saved.response}</blockquote>
          <p>{saved.met ? t.met : t.notMet}</p>
          {modelError && (
            <div>
              <p role="alert" className="error">{t.modelError}</p>
              <button type="button" className="btn" onClick={() => void fetchModel()}>
                {t.modelRetry}
              </button>
            </div>
          )}
          {model && (
            <section>
              <h3>{t.modelHeading}</h3>
              <p>{model.model_response}</p>
              <h4>{t.whyHeading}</h4>
              <p>{model.why}</p>
              <h4>{t.avoidHeading}</h4>
              <p>{model.avoid}</p>
            </section>
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
