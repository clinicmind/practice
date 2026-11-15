import { useEffect, useId, useRef, useState } from 'react';
import type { DecisionPoint } from '../content/schema';
import { useT } from '../i18n';
import type { Decision, NewDecision } from '../progress/types';

interface Props {
  sessionId: string;
  decision: DecisionPoint;
  /** Present once the learner has answered; answers cannot be changed. */
  answer?: Decision;
  onAnswer: (d: NewDecision) => Promise<void>;
}

export function DecisionPointView({ sessionId, decision, answer, onAnswer }: Props) {
  const s = useT();
  const t = s.walkthrough;
  const uid = useId();
  const [optionId, setOptionId] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  const answeredRef = useRef<HTMLElement>(null);
  const wasAnswered = useRef(!!answer);
  useEffect(() => {
    if (answer && !wasAnswered.current) answeredRef.current?.focus();
    wasAnswered.current = !!answer;
  }, [answer]);

  async function submit(d: NewDecision) {
    if (saving) return;
    setSaving(true);
    setError(false);
    try {
      await onAnswer(d);
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  }

  if (answer) {
    const chosen = decision.options?.find((o) => o.id === answer.optionId);
    return (
      <section ref={answeredRef} tabIndex={-1} className="decision answered" aria-label={t.answered}>
        <p className="prompt">{decision.prompt}</p>
        {decision.type === 'choice' && chosen && (
          <div>
            <p><strong>{t.yourChoice}:</strong> {chosen.text}</p>
            <p><span className={`fit fit-${chosen.fit}`}>{t.fit[chosen.fit]}</span></p>
            <p>{chosen.note}</p>
          </div>
        )}
        {decision.type === 'free' && (
          <div>
            <p><strong>{t.yourAnswer}:</strong></p>
            <blockquote>{answer.response}</blockquote>
          </div>
        )}
        <p><strong>{t.therapistActual}:</strong></p>
        <blockquote>{decision.actual}</blockquote>
        <p><strong>{t.rationale}:</strong></p>
        <p>{decision.rationale}</p>
      </section>
    );
  }

  return (
    <section className="decision" aria-labelledby={`${uid}-p`}>
      {decision.type === 'choice' ? (
        <fieldset>
          <legend id={`${uid}-p`} className="prompt">{decision.prompt}</legend>
          {(decision.options ?? []).map((o) => (
            <label key={o.id} className="check">
              <input
                type="radio"
                name={`${uid}-opt`}
                checked={optionId === o.id}
                onChange={() => setOptionId(o.id)}
              />{' '}
              {o.text}
            </label>
          ))}
          {error && <p role="alert" className="error">{t.saveError}</p>}
          <button
            type="button"
            className="btn primary"
            disabled={optionId === null || saving}
            onClick={() => optionId && void submit({ sessionId, decisionId: decision.id, optionId })}
          >
            {t.confirmChoice}
          </button>
        </fieldset>
      ) : (
        <div className="field">
          <p id={`${uid}-p`} className="prompt">{decision.prompt}</p>
          <label htmlFor={`${uid}-r`}>{t.responseLabel}</label>
          <textarea id={`${uid}-r`} rows={4} value={text} onChange={(e) => setText(e.target.value)} />
          {error && <p role="alert" className="error">{t.saveError}</p>}
          <button
            type="button"
            className="btn primary"
            disabled={text.trim().length === 0 || saving}
            onClick={() => void submit({ sessionId, decisionId: decision.id, response: text })}
          >
            {t.submitResponse}
          </button>
        </div>
      )}
    </section>
  );
}
