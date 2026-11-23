import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { DriveStatusPanel } from '../../components/DriveStatusPanel';
import { useT } from '../../i18n';
import { useReportsEnabled } from '../../reports/ReportsContext';
import { isMissingTable } from '../../progress/storeError';
import { DEFAULT_STAGE } from '../../stages';
import { loadCourse, type CohortInfo, type Course, type CourseStage, type StudentSummary } from '../../supervisor/api';
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

type StagesState =
  | { status: 'loading' }
  | { status: 'ready'; open: string[] }
  | { status: 'error'; kind: 'migration' | 'load' };

/**
 * Which stages this cohort can open. Foundations is always open and has no
 * control. This panel fails on its own: a missing cohort_stages table (0004 not
 * applied yet) or a failed read leaves the rest of the cohort page working.
 */
function StagesPanel({ cohort, stages }: { cohort: CohortInfo; stages: CourseStage[] }) {
  const s = useT();
  const t = s.stageAdmin;
  const api = useSupervisorApi();
  const others = stages.filter((x) => x.stage !== DEFAULT_STAGE);
  const [state, setState] = useState<StagesState>({ status: 'loading' });
  const [busy, setBusy] = useState<string | null>(null);
  const [saveError, setSaveError] = useState(false);
  const [tick, setTick] = useState(0);
  const hasOthers = others.length > 0;

  useEffect(() => {
    // With only foundations there is nothing to open, so do not depend on the cohort_stages table.
    if (!hasOthers) return;
    let live = true;
    setState({ status: 'loading' });
    api.listOpenStages(cohort.id)
      .then((open) => live && setState({ status: 'ready', open }))
      .catch((e) => live && setState({ status: 'error', kind: isMissingTable(e) ? 'migration' : 'load' }));
    return () => { live = false; };
  }, [api, cohort.id, hasOthers, tick]);

  async function toggle(stage: string, open: string[], wantOpen: boolean) {
    setBusy(stage);
    setSaveError(false);
    try {
      if (wantOpen) await api.openStage(cohort.id, stage);
      else await api.closeStage(cohort.id, stage);
      setState({ status: 'ready', open: wantOpen ? [...open, stage] : open.filter((x) => x !== stage) });
    } catch (e) {
      if (isMissingTable(e)) setState({ status: 'error', kind: 'migration' });
      else setSaveError(true);
    } finally {
      setBusy(null);
    }
  }

  const headingId = `stages-${cohort.id}`;
  return (
    <section aria-labelledby={headingId} className="stage-admin">
      <h3 id={headingId}>{t.heading}</h3>
      {!hasOthers ? (
        <p>{t.onlyFoundations}</p>
      ) : state.status === 'loading' ? (
        <p role="status">{t.loading}</p>
      ) : state.status === 'error' ? (
        state.kind === 'migration' ? (
          <p role="status" className="notice">{t.needsMigration}</p>
        ) : (
          <div>
            <p role="alert" className="error">{t.loadError}</p>
            <button type="button" className="btn" onClick={() => setTick((n) => n + 1)}>{s.common.retry}</button>
          </div>
        )
      ) : (
        <>
          <p className="muted">{t.intro}</p>
          {saveError && <p role="alert" className="error">{t.saveError}</p>}
          <ul className="stage-admin-list">
            {others.map((x) => {
              const open = state.open.includes(x.stage);
              const reviewed = x.index.modules.some((m) => m.reviewed);
              return (
                <li key={x.stage}>
                  <label>
                    <input
                      type="checkbox"
                      checked={open}
                      disabled={busy !== null}
                      aria-label={t.toggleLabel(x.title)}
                      onChange={() => void toggle(x.stage, state.open, !open)}
                    />{' '}
                    <span>{x.title}</span>
                  </label>
                  {!reviewed && <>{' '}<span className="badge">{t.unreviewed}</span></>}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}

function CohortSection({ cohort, students, course }: { cohort: CohortInfo; students: StudentSummary[]; course: Course }) {
  const s = useT();
  const t = s.supervisor;
  const modules = course.stages.flatMap((st) => st.index.modules).filter((m) => m.reviewed);
  const closed = cohort.termEnd < todayLocal();
  return (
    <section aria-labelledby={`cohort-${cohort.id}`} className="card">
      <h2 id={`cohort-${cohort.id}`}>{cohort.name}</h2>
      <InviteCode code={cohort.inviteCode} />
      <p>
        <span>{t.termEnds(cohort.termEnd)}</span>
        {closed && <>{' '}<span className="badge">{t.termClosed}</span></>}
      </p>
      <StagesPanel cohort={cohort} stages={course.stages} />
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
  | { status: 'ready'; cohorts: CohortInfo[]; students: StudentSummary[]; course: Course };

export function CohortPage() {
  const s = useT();
  const t = s.supervisor;
  const api = useSupervisorApi();
  const reportsOn = useReportsEnabled();
  const [state, setState] = useState<State>({ status: 'loading' });
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    let live = true;
    setState({ status: 'loading' });
    Promise.all([api.listCohorts(), api.listStudents(), loadCourse()])
      .then(([cohorts, students, course]) => live && setState({ status: 'ready', cohorts, students, course }))
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
  const { cohorts, students, course } = state;
  return (
    <div>
      <h1>{t.heading}</h1>
      {reportsOn && (
        <>
          <p><Link to="/supervisor/reports">{s.reportsReview.link}</Link></p>
          <DriveStatusPanel />
        </>
      )}
      {cohorts.length === 0 ? (
        <section aria-labelledby="create-h">
          <h2 id="create-h">{t.createHeading}</h2>
          <CreateCohortForm onCreated={reload} />
        </section>
      ) : (
        <>
          {cohorts.map((c) => (
            <CohortSection key={c.id} cohort={c} course={course} students={students.filter((s) => s.cohortId === c.id)} />
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
