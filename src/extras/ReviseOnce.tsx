import { useId, useState } from 'react';
import { useT } from '../i18n';

/**
 * "Revise once more": after the example is shown, an optional second try at the same moment.
 * It lives in this component's memory only. It never reaches the progress store, so the saved attempt
 * (and with it the pass count) is exactly what it was before.
 */
export function ReviseOnce({ criteria, firstVersion }: { criteria: readonly string[]; firstVersion: string }) {
  const x = useT().practiceExtras.revise;
  const uid = useId();
  const [text, setText] = useState('');
  const [focus, setFocus] = useState<number | null>(null);
  const [shown, setShown] = useState(false);
  const ready = text.trim().length > 0 && focus !== null;

  if (shown && focus !== null) {
    return (
      <section className="revise" aria-labelledby={`${uid}-h`}>
        <h3 id={`${uid}-h`}>{x.heading}</h3>
        <p className="muted">{x.focusLabel(criteria[focus])}</p>
        <div className="revise-pair" role="group" aria-label={x.compareLabel}>
          <div>
            <h4>{x.first}</h4>
            <blockquote>{firstVersion}</blockquote>
          </div>
          <div>
            <h4>{x.second}</h4>
            <blockquote>{text}</blockquote>
          </div>
        </div>
        <p className="muted">{x.leaveNote}</p>
        <button type="button" className="btn" onClick={() => setShown(false)}>{x.edit}</button>
      </section>
    );
  }
  return (
    <section className="revise" aria-labelledby={`${uid}-h`}>
      <h3 id={`${uid}-h`}>{x.heading}</h3>
      <p className="muted">{x.intro}</p>
      <fieldset>
        <legend>{x.focusLegend}</legend>
        {criteria.map((c, i) => (
          <label key={i} className="check">
            <input type="radio" name={`${uid}-focus`} checked={focus === i} onChange={() => setFocus(i)} /> {c}
          </label>
        ))}
      </fieldset>
      <div className="field">
        <label htmlFor={`${uid}-text`}>{x.textLabel}</label>
        <textarea id={`${uid}-text`} rows={4} value={text} onChange={(e) => setText(e.target.value)} />
      </div>
      <button type="button" className="btn primary" disabled={!ready} onClick={() => setShown(true)}>{x.show}</button>
    </section>
  );
}
