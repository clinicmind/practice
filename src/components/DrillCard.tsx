import { useId, useState } from 'react';
import type { Drill, Model } from '../content/schema';
import { en } from '../i18n/en';
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
}

export function DrillCard({ drill, attempts, onSubmit, getModel, onNext }: Props) {
  const uid = useId();
  const [phase, setPhase] = useState<Phase>('writing');
  const [text, setText] = useState('');
  const [ticks, setTicks] = useState<boolean[]>([false, false, false]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [model, setModel] = useState<Model | null>(null);
  const [modelError, setModelError] = useState(false);
  const [saved, setSaved] = useState<{ response: string; met: boolean } | null>(null);

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
    setSaveError(false);
    try {
      await onSubmit({ itemId: drill.id, response: text, criteriaMet: [...ticks] });
    } catch {
      setSaveError(true);
      setSaving(false);
      return;
    }
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
    setSaveError(false);
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
          <fieldset>
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
          {saveError && <p role="alert" className="error">{t.saveError}</p>}
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
          <h3>{t.yourResponse}</h3>
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
