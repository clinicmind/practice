import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent } from 'react';
import { Link } from 'react-router-dom';
import { scan, type Finding } from '../../../packages/deid/src';
import { FindingsPanel } from '../../components/FindingsPanel';
import { useT } from '../../i18n';
import { NOT_OPEN, useReportsApi, type ReportFinding } from '../../reports/ReportsContext';
import { MAX_LENGTH, MIN_LENGTH, useDeid } from '../../reports/useDeid';

type Step = 1 | 2 | 3 | 4;
const STEP_KEYS = ['guidance', 'write', 'confirm', 'done'] as const;

/** Select a span in a textarea and bring it into view. */
function selectSpan(ta: HTMLTextAreaElement | null, start: number, end: number) {
  if (!ta) return;
  ta.focus();
  ta.setSelectionRange(start, end);
  const len = Math.max(ta.value.length, 1);
  if (ta.scrollHeight > ta.clientHeight) ta.scrollTop = Math.max(0, (start / len) * ta.scrollHeight - ta.clientHeight / 2);
}

export function NewReportPage() {
  const t = useT();
  const s = t.reports;
  const api = useReportsApi();
  const [step, setStep] = useState<Step>(1);
  const [ack, setAck] = useState(false);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [declared, setDeclared] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverFindings, setServerFindings] = useState<ReportFinding[]>([]);
  const [failure, setFailure] = useState<string | null>(null);
  const [pasteNote, setPasteNote] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const deid = useDeid(text);

  // Server positions only describe the text that was sent. Editing makes them stale, so drop them.
  useEffect(() => { setServerFindings([]); }, [text]);

  const titleFindings = useMemo(() => scan(title), [title]);
  const highCount = deid.findings.filter((f) => f.level === 'high').length;
  const blockers: string[] = [];
  if (title.trim() === '') blockers.push(s.blockers.titleEmpty);
  else if (titleFindings.length > 0) blockers.push(s.blockers.titleIdentifying);
  if (deid.lengthStatus === 'short') blockers.push(s.blockers.short(MIN_LENGTH));
  if (deid.lengthStatus === 'long') blockers.push(s.blockers.long(MAX_LENGTH));
  if (deid.pending) blockers.push(s.blockers.pending);
  if (highCount > 0) blockers.push(s.blockers.high(highCount));
  if (deid.unresolved - highCount > 0) blockers.push(s.blockers.unresolved(deid.unresolved - highCount));
  const ready = deid.canSubmit && title.trim() !== '' && titleFindings.length === 0;

  const guardFiles = (files: FileList | File[] | undefined, e: { preventDefault(): void }, hasText: boolean) => {
    if (files && files.length > 0 && !hasText) { e.preventDefault(); setPasteNote(true); return true; }
    return false;
  };
  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const d = e.clipboardData;
    const hasText = !!d?.getData?.('text/plain');
    if (guardFiles(d?.files as FileList, e, hasText)) return;
    setPasteNote(false);
  };
  const onDrop = (e: DragEvent<HTMLTextAreaElement>) => {
    // Dropping a file never inserts anything useful. Dropped text is left to the browser.
    guardFiles(e.dataTransfer?.files as FileList, e, !!e.dataTransfer?.getData?.('text/plain'));
  };

  const submit = async () => {
    setBusy(true);
    setFailure(null);
    try {
      const r = await api.submit({ title: title.trim(), body: text });
      if (r.ok) { setStep(4); return; }
      if ('findings' in r) { setServerFindings(r.findings); setDeclared(false); setStep(2); return; }
      setFailure(r.status === NOT_OPEN ? s.notOpen : (r.code && t.reportsBackend.errors[r.code]) || s.failed.error(r.status));
    } catch {
      setFailure(s.failed.error(0));
    } finally {
      setBusy(false);
    }
  };

  const stepper = (
    <p className="muted" aria-live="polite">{s.stepLabel(step, 4, s.steps[STEP_KEYS[step - 1]])}</p>
  );
  const warning = <p className="notice" role="note">{s.warning}</p>;

  if (step === 1) {
    return (
      <div>
        <h1>{s.newReport}</h1>
        {stepper}
        <h2>{s.guidance.heading}</h2>
        <ul>{s.guidance.points.map((p) => <li key={p}>{p}</li>)}</ul>
        {warning}
        <label className="check"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /><span>{s.guidance.tick}</span></label>
        <div className="row">
          <button type="button" className="btn primary" disabled={!ack} onClick={() => setStep(2)}>{s.guidance.next}</button>
        </div>
      </div>
    );
  }

  if (step === 2) {
    const locate = (f: Finding | ReportFinding) => selectSpan(taRef.current, f.start, f.end);
    return (
      <div>
        <h1>{s.write.heading}</h1>
        {stepper}
        {warning}
        {serverFindings.length > 0 && (
          <div role="alert" className="notice">
            <strong>{s.rejected.heading}</strong>
            <p>{s.rejected.body}</p>
            <ul className="finding-list">
              {serverFindings.map((f) => (
                <li key={`${f.rule}:${f.start}:${f.end}`}>
                  {s.rejected.item(s.rules[f.rule] ?? f.rule, f.start + 1, f.end)}{' '}
                  <button type="button" className="btn" onClick={() => locate(f)}>{s.findings.locate}</button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="field">
          <label htmlFor="report-title">{s.write.titleLabel}</label>
          <p className="muted" id="report-title-help">{s.write.titleHelp}</p>
          <input id="report-title" type="text" value={title} maxLength={120} aria-describedby="report-title-help" onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="report-body">{s.write.bodyLabel}</label>
          <p className="muted" id="report-body-help">{s.write.bodyHelp}</p>
          <textarea
            id="report-body" ref={taRef} rows={14} value={text} aria-describedby="report-body-help report-count"
            onChange={(e) => setText(e.target.value)} onPaste={onPaste} onDrop={onDrop}
          />
          <p className="muted" id="report-count">{s.write.counter(text.length, MIN_LENGTH, MAX_LENGTH)}</p>
          {pasteNote && <p role="status" className="notice">{s.paste.fileIgnored}</p>}
        </div>
        <FindingsPanel
          findings={deid.findings} resolutions={deid.resolutions} pending={deid.pending}
          onLocate={locate} onResolve={(k) => deid.resolve(k, 'not-identifying')} onUndo={deid.unresolve}
        />
        {!ready && blockers.length > 0 && (
          <div id="blockers" className="muted">
            <p>{s.write.cannotContinue}</p>
            <ul>{blockers.map((b) => <li key={b}>{b}</li>)}</ul>
          </div>
        )}
        <div className="row">
          <button type="button" className="btn" onClick={() => setStep(1)}>{s.write.back}</button>
          <button type="button" className="btn primary" disabled={!ready} aria-describedby={ready ? undefined : 'blockers'} onClick={() => setStep(3)}>{s.write.next}</button>
        </div>
      </div>
    );
  }

  if (step === 3) {
    return (
      <div>
        <h1>{s.confirm.heading}</h1>
        {stepper}
        {warning}
        <p>{s.confirm.intro}</p>
        <h2>{s.confirm.titleHeading}</h2>
        <p className="report-title">{title.trim()}</p>
        <h2>{s.confirm.bodyHeading}</h2>
        <div className="report-text" tabIndex={0}>{text}</div>
        <label className="check"><input type="checkbox" checked={declared} onChange={(e) => setDeclared(e.target.checked)} /><span>{s.confirm.declaration}</span></label>
        {failure && <p role="alert" className="error">{failure}</p>}
        <div className="row">
          <button type="button" className="btn" disabled={busy} onClick={() => setStep(2)}>{s.write.back}</button>
          <button type="button" className="btn primary" disabled={!declared || !ready || busy} onClick={() => void submit()}>
            {busy ? s.confirm.submitting : s.confirm.submit}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1>{s.done.heading}</h1>
      {stepper}
      <p>{s.done.body}</p>
      <p><Link to="/reports">{s.done.list}</Link></p>
    </div>
  );
}
