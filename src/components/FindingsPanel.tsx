import { findingKey, type Finding, type Resolution } from '../../packages/deid/src';
import { useT } from '../i18n';

/** Lists what the scanner found. Each finding quotes the matched text so the student can see it without counting characters.
 *  The scan runs only in the student's browser; the quote is never sent or stored (the summary holds counts only). */
export function FindingsPanel({ findings, resolutions, pending, onLocate, onResolve, onUndo }: {
  findings: Finding[];
  resolutions: Record<string, Resolution>;
  pending: boolean;
  onLocate: (f: Finding) => void;
  onResolve: (key: string) => void;
  onUndo: (key: string) => void;
}) {
  const s = useT().reports;
  return (
    <section aria-labelledby="findings-h" className="findings">
      <h2 id="findings-h">{s.findings.heading}</h2>
      {pending ? (
        <p className="muted" role="status">{s.write.checking}</p>
      ) : findings.length === 0 ? (
        <p role="status">{s.write.clean}</p>
      ) : (
        <ul className="finding-list">
          {findings.map((f) => {
            const key = findingKey(f);
            const done = resolutions[key] === 'not-identifying';
            return (
              <li key={key} className={`finding ${f.level}${done ? ' done' : ''}`}>
                <div className="finding-head">
                  <strong>{s.rules[f.rule] ?? f.rule}</strong>{' '}
                  <span className={`badge level-${f.level}`}>{s.level[f.level]}</span>{' '}
                  <q className="finding-match">{f.match}</q>{' '}
                  <span className="muted">{s.findings.position(f.start + 1, f.end)}</span>
                </div>
                <p className="finding-tip">{s.suggestions[f.rule]}</p>
                {f.level === 'high' && <p className="error">{s.findings.mustRewrite}</p>}
                {done && <p className="muted">{s.findings.marked}</p>}
                <div className="finding-actions">
                  <button type="button" className="btn" onClick={() => onLocate(f)}>{s.findings.locate}</button>
                  {f.level !== 'high' && !done && (
                    <button type="button" className="btn" onClick={() => onResolve(key)}>{s.findings.notIdentifying}</button>
                  )}
                  {done && <button type="button" className="btn" onClick={() => onUndo(key)}>{s.findings.undo}</button>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
