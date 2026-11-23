import { useEffect, useId, useRef, useState } from 'react';
import { AiError, useAi, useAiAvailable, type AiResult } from '../ai/AiContext';
import { highlight } from '../ai/highlight';
import { useLocale, useT } from '../i18n';

type Props = {
  attemptId: string;
  /** What the student wrote, as saved. */
  response: string;
  /** The three criteria, in order. */
  criteria: string[];
  /** The student's own self-check for this attempt. */
  selfMet: boolean[];
  /**
   * 'ask': show the button when there is no stored result (right after saving a self-check).
   * 'stored': show a stored result only, never a button (looking back at an earlier attempt).
   */
  mode: 'ask' | 'stored';
  /** Replaces the default heading, e.g. when this is about an earlier attempt. */
  heading?: string;
};

type State =
  | { phase: 'checking' } // asking whether a result is already stored
  | { phase: 'idle' }
  | { phase: 'asking' }
  | { phase: 'error'; code: string }
  | { phase: 'result'; result: AiResult };

/**
 * The AI's check of one saved attempt, beside the student's own self-check. It never writes anything:
 * passing is decided by the self-check alone. It renders nothing unless the feature is switched on, and
 * it asks the server only when the student presses the button (reading a stored result is free).
 */
export function AiFeedbackPanel({ attemptId, response, criteria, selfMet, mode, heading: headingText }: Props) {
  const available = useAiAvailable();
  const { client, markClassOff } = useAi();
  const { locale } = useLocale();
  const t = useT().aiFeedback;
  const uid = useId();
  const [state, setState] = useState<State>({ phase: 'checking' });
  const sending = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (!available) return;
    let live = true;
    setState({ phase: 'checking' });
    client.get(attemptId, locale).then(
      (r) => live && setState(r ? { phase: 'result', result: r } : { phase: 'idle' }),
      (e) => {
        if (!live) return;
        if (e instanceof AiError && e.code === 'ai_disabled') markClassOff();
        else setState({ phase: 'idle' });
      },
    );
    return () => { live = false; };
    // The language is not a dependency: a stored result does not change with it, and a second look is not needed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [available, client, attemptId]);

  async function ask() {
    if (sending.current) return; // a double click sends one request
    sending.current = true;
    setState({ phase: 'asking' });
    try {
      const result = await client.request(attemptId, locale);
      setState({ phase: 'result', result });
      setTimeout(() => heading.current?.focus(), 0);
    } catch (e) {
      const code = e instanceof AiError ? e.code : 'unavailable';
      if (code === 'ai_disabled') markClassOff();
      else setState({ phase: 'error', code });
    } finally {
      sending.current = false;
    }
  }

  if (!available || state.phase === 'checking') return null;
  if (mode === 'stored' && state.phase !== 'result') return null;

  const headingId = `${uid}-h`;
  return (
    <section className="ai-panel" aria-labelledby={headingId}>
      <h3 id={headingId} ref={heading} tabIndex={-1}>{headingText ?? t.panelHeading}</h3>

      {(state.phase === 'idle' || state.phase === 'asking' || state.phase === 'error') && (
        <>
          <p className="muted">{t.askHelp}</p>
          {state.phase === 'error' && <p role="alert" className="error">{t.errors[state.code] ?? t.errors.unavailable}</p>}
          <button type="button" className="btn" disabled={state.phase === 'asking'} onClick={() => void ask()}>
            {state.phase === 'asking' ? t.asking : t.askButton}
          </button>
        </>
      )}

      {state.phase === 'result' && state.result.status === 'concern' && (
        <p>{state.result.concern === 'risk-content' ? t.riskNote : t.offTask}</p>
      )}

      {state.phase === 'result' && state.result.status === 'ok' && (
        <Result result={state.result} response={response} criteria={criteria} selfMet={selfMet} />
      )}
    </section>
  );
}

function Result({ result, response, criteria, selfMet }: { result: Extract<AiResult, { status: 'ok' }>; response: string; criteria: string[]; selfMet: boolean[] }) {
  const t = useT().aiFeedback;
  const { output, unsupported } = result;
  const quotes = output.criteria.map((c) => c.evidence).filter((q) => q.trim() !== '');
  const segments = highlight(response, quotes);
  return (
    <>
      <p className="muted ai-caveat">{t.caveat}</p>
      <ol className="ai-criteria" aria-label={t.tableCaption}>
        {criteria.map((text, i) => {
          const mine = selfMet[i] === true;
          const ai = output.criteria[i]!;
          const differs = mine !== ai.met;
          return (
            <li key={i} className={differs ? 'differs' : undefined}>
              <p className="ai-criterion">{text}</p>
              <p className="ai-verdicts">
                <span>{t.colYou}: <strong>{mine ? t.met : t.notMet}</strong></span>
                <span>{t.colAi}: <strong>{ai.met ? t.met : t.notMet}</strong></span>
                <span className={differs ? 'badge flag-diff' : 'badge'}>{differs ? t.differs : t.agrees}</span>
              </p>
              {ai.evidence.trim() !== '' ? (
                <p className="ai-evidence"><span className="muted">{t.evidenceLabel}:</span> <q>{ai.evidence}</q></p>
              ) : (
                <p className="ai-evidence muted">{t.noEvidence}</p>
              )}
              {unsupported.includes(i) && <p className="muted">{t.unsupported}</p>}
            </li>
          );
        })}
      </ol>
      {quotes.length > 0 && (
        <>
          <h4>{t.yourWords}</h4>
          <p className="ai-response">
            {segments.map((s, i) => (s.marked ? <mark key={i}>{s.text}</mark> : <span key={i}>{s.text}</span>))}
          </p>
        </>
      )}
      <h4>{t.suggestionHeading}</h4>
      <p className="ai-suggestion">{output.suggestion}</p>
    </>
  );
}
