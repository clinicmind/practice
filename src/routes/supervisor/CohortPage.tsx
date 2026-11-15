import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { loadStage } from '../../content/client';
import type { StageIndex } from '../../content/schema';
import { useT } from '../../i18n';
import type { CohortInfo, StudentSummary } from '../../supervisor/api';
import { useSupervisorApi } from '../../supervisor/SupervisorContext';

/** Local calendar date as YYYY-MM-DD, comparable as a string with a date input's value. */
function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function CreateCohortForm({ onCreated }: { onCreated: () => void }) {
  const s = useT();
  const t = s.supervisor;
  const api = useSupervisorApi();
  const [name, setName] = useState('');
  const [termEnd, setTermEnd] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const clean = name.trim();
    if (clean.length < 1 || clean.length > 80) { setError(t.nameRequired); return; }
    if (!termEnd) { setError(t.dateRequired); return; }
    if (termEnd <= todayLocal()) { setError(t.termEndFuture); return; }
    setError(null);
    setBusy(true);
    try {
      await api.createCohort(clean, termEnd);
      setName('');
      setTermEnd('');
      onCreated();
    } catch {
      setError(t.createError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate>
      <p>{t.createIntro}</p>
      <label htmlFor="cohort-name">{t.cohortName}</label>
      <input id="cohort-name" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
      <label htmlFor="term-end">{t.termEnd}</label>
      <input id="term-end" type="date" value={termEnd} onChange={(e) => setTermEnd(e.target.value)} aria-describedby="term-end-help" />
      <p id="term-end-help" className="muted">{t.termEndHelp}</p>
      {error && <p role="alert" className="error">{error}</p>}
      <p><button type="submit" className="btn primary" disabled={busy}>{busy ? t.creating : t.createSubmit}</button></p>
    </form>
  );
}

function InviteCode({ code }: { code: string }) {
  const s = useT();
  const t = s.supervisor;
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      setCopied(false); // the code is on screen; the supervisor can select it by hand
    }
  }
  return (
    <p>
      {t.inviteCode}: <code>{code}</code>{' '}
      <button type="button" className="btn" onClick={() => void copy()}>{t.copyCode}</button>{' '}
      {copied && <span role="status">{t.copied}</span>}
    </p>
  );
}

function ProgressCell({ student, slug }: { student: StudentSummary; slug: string }) {
  const s = useT();
  const t = s.supervisor;
  const m = student.modules[slug];
  if (!m) return <>–</>;
  return (
    <>
      <div>{m.walkthroughDone ? t.walkthroughDone : t.walkthroughNotDone}</div>
      <div>{t.passed(m.passed.map((l) => s.levels[l]))}</div>
    </>
  );
}

function CohortSection({ cohort, students, stage }: { cohort: CohortInfo; students: StudentSummary[]; stage: StageIndex }) {
  const s = useT();
  const t = s.supervisor;
  const modules = stage.modules.filter((m) => m.reviewed);
  const closed = cohort.termEnd < todayLocal();
  return (
    <section aria-labelledby={`cohort-${cohort.id}`} className="card">
      <h2 id={`cohort-${cohort.id}`}>{cohort.name}</h2>
      <InviteCode code={cohort.inviteCode} />
      <p>
        <span>{t.termEnds(cohort.termEnd)}</span>
        {closed && <>{' '}<span className="badge">{t.termClosed}</span></>}
      </p>
      {students.length === 0 ? (
        <p>{t.noStudents}</p>
      ) : (
        <div className="table-scroll">
          <table>
            <caption className="visually-hidden">{t.progressCaption(cohort.name)}</caption>
            <thead>
              <tr>
                <th scope="col">{t.colStudent}</th>
                <th scope="col">{t.colLastActive}</th>
                {modules.map((m) => <th scope="col" key={m.slug}>{m.title}</th>)}
              </tr>
            </thead>
            <tbody>
              {students.map((s) => (
                <tr key={s.id}>
                  <th scope="row"><Link to={`/supervisor/students/${s.id}`}>{s.displayName}</Link></th>
                  <td>{s.lastActiveAt ? s.lastActiveAt.slice(0, 10) : t.neverActive}</td>
                  {modules.map((m) => <td key={m.slug}><ProgressCell student={s} slug={m.slug} /></td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

type State =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; cohorts: CohortInfo[]; students: StudentSummary[]; stage: StageIndex };

export function CohortPage() {
  const s = useT();
  const t = s.supervisor;
  const api = useSupervisorApi();
  const [state, setState] = useState<State>({ status: 'loading' });
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    let live = true;
    setState({ status: 'loading' });
    Promise.all([api.listCohorts(), api.listStudents(), loadStage()])
      .then(([cohorts, students, stage]) => live && setState({ status: 'ready', cohorts, students, stage }))
      .catch(() => live && setState({ status: 'error' }));
    return () => { live = false; };
  }, [api, tick]);

  if (state.status === 'loading') return <p>{s.common.loading}</p>;
  if (state.status === 'error') {
    return (
      <div>
        <p role="alert" className="error">{t.loadError}</p>
        <button type="button" className="btn" onClick={reload}>{s.common.retry}</button>
      </div>
    );
  }
  const { cohorts, students, stage } = state;
  return (
    <div>
      <h1>{t.heading}</h1>
      {cohorts.length === 0 ? (
        <section aria-labelledby="create-h">
          <h2 id="create-h">{t.createHeading}</h2>
          <CreateCohortForm onCreated={reload} />
        </section>
      ) : (
        <>
          {cohorts.map((c) => (
            <CohortSection key={c.id} cohort={c} stage={stage} students={students.filter((s) => s.cohortId === c.id)} />
          ))}
          <details>
            <summary>{t.createAnother}</summary>
            <CreateCohortForm onCreated={reload} />
          </details>
        </>
      )}
    </div>
  );
}
