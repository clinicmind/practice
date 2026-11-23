import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAiAvailable } from '../../ai/AiContext';
import { loadModels } from '../../content/client';
import { LEVELS, type Drill, type Level, type Model, type StageIndex } from '../../content/schema';
import { useT } from '../../i18n';
import { itemMet, levelPassed, unlockedLevels, walkthroughDone } from '../../progress/rules';
import { loadCourse, type Course, type StudentDetail } from '../../supervisor/api';
import { directionOf, type AiDisagreement, type AiEvaluation } from '../../supervisor/aiSummary';
import { flagAttempts, type Flag } from '../../supervisor/flags';
import { useSupervisorApi } from '../../supervisor/SupervisorContext';

const Heading = ({ level, children }: { level: 3 | 4; children: ReactNode }) => (level === 3 ? <h3>{children}</h3> : <h4>{children}</h4>);
const day = (iso: string) => iso.slice(0, 10);

/** What the AI said about this student's responses. 'error': the read failed, which must not break the page. */
type StudentAi = { evals: AiEvaluation[]; diffs: AiDisagreement[] } | 'error' | null;
type Loaded = { detail: StudentDetail; course: Course; models: Record<string, Model>[]; modelsMissing: boolean; ai: StudentAi };
type State = { status: 'loading' } | { status: 'error' } | { status: 'missing' } | ({ status: 'ready' } & Loaded);

export function StudentPage() {
  const s = useT();
  const t = s.supervisor;
  const { id = '' } = useParams();
  const api = useSupervisorApi();
  const aiAvailable = useAiAvailable();
  const [state, setState] = useState<State>({ status: 'loading' });
  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState(false);
  const [grantError, setGrantError] = useState(false);
  const reload = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    let live = true;
    (async () => {
      const [detail, course] = await Promise.all([api.getStudent(id), loadCourse()]);
      if (!detail) { if (live) setState({ status: 'missing' }); return; }
      // Example responses are needed only to spot copied answers, and only for modules this student has used.
      const used = new Set(detail.attempts.map((a) => a.itemId.replace(/-[emh]\d+$/, '')));
      let modelsMissing = false;
      const modelsEn: Record<string, Model> = {};
      const modelsZh: Record<string, Model> = {};
      await Promise.all([...used].filter((slug) => course.bundles[slug]).flatMap((slug) => [
        // English is the reference: failing to load it means copies could go unnoticed.
        loadModels(slug, 'en', course.stageOf[slug]).then((m) => { Object.assign(modelsEn, m); }, () => { modelsMissing = true; }),
        // A Chinese module may simply not exist (or not be reviewed) yet; that is not an error.
        loadModels(slug, 'zh-Hant', course.stageOf[slug]).then((m) => { Object.assign(modelsZh, m); }, () => {}),
      ]));
      const models = [modelsEn, modelsZh];
      // AI marks: only when the build has the feature and this student's cohort has its switch on.
      // A failure here is shown as a note; it does not stop the rest of the page.
      let ai: StudentAi = null;
      if (aiAvailable) {
        try {
          const cohort = (await api.listCohorts()).find((c) => c.id === detail.cohortId);
          if (cohort?.aiEnabled) {
            const [evals, diffs] = await Promise.all([api.listAiEvaluations(), api.listAiDisagreements()]);
            ai = { evals: evals.filter((e) => e.userId === id), diffs: diffs.filter((d) => d.userId === id) };
          }
        } catch {
          ai = 'error';
        }
      }
      if (live) setState({ status: 'ready', detail, course, models, modelsMissing, ai });
    })().catch(() => live && setState({ status: 'error' }));
    return () => { live = false; };
  }, [api, id, tick, aiAvailable]);

  const loaded = state.status === 'ready' ? state : null;
  const flagsByAttempt = useMemo(() => {
    const m = new Map<string, Flag[]>();
    if (!loaded) return m;
    for (const f of flagAttempts(loaded.detail.attempts, loaded.models)) m.set(f.attemptId, [...(m.get(f.attemptId) ?? []), f]);
    return m;
  }, [loaded]);

  if (state.status === 'loading') return <p>{s.common.loading}</p>;
  const back = <p><Link to="/supervisor">{t.backToCohort}</Link></p>;
  if (state.status === 'missing') return <div><p>{t.studentNotFound}</p>{back}</div>;
  if (state.status === 'error') {
    return (
      <div>
        <p role="alert" className="error">{t.studentLoadError}</p>
        <button type="button" className="btn" onClick={() => { setState({ status: 'loading' }); reload(); }}>{s.common.retry}</button>
        {back}
      </div>
    );
  }

  const { detail, course, modelsMissing, ai } = state;
  const ta = s.aiFeedback.supervisor;
  const drillOf = new Map<string, Drill>();
  for (const b of Object.values(course.bundles)) for (const d of b.drills) drillOf.set(d.id, d);

  async function grant(moduleSlug: string, level: Level) {
    setBusy(true);
    setGrantError(false);
    try {
      await api.grantUnlock(detail.id, moduleSlug, level);
      reload();
    } catch {
      setGrantError(true);
    } finally {
      setBusy(false);
    }
  }

  const grouped = course.stages.length > 1;
  const moduleCard = (m: StageIndex['modules'][number], level: 3 | 4) => {
    const b = course.bundles[m.slug];
    if (!b) return null;
    const handLevels = detail.grants.filter((g) => g.moduleSlug === m.slug).map((g) => g.level);
    const earned = unlockedLevels(detail.attempts, b.drills);
    const open = unlockedLevels(detail.attempts, b.drills, handLevels);
    return (
      <div key={m.slug} className="card">
        <Heading level={level}>{m.title}{!m.reviewed && <>{' '}<span className="badge">{s.stage.unreviewed}</span></>}</Heading>
        <p>{walkthroughDone(detail.decisions, b.sessions) ? t.walkthroughDone : t.walkthroughNotDone}</p>
        <ul>
          {LEVELS.map((lv) => {
            const inLevel = b.drills.filter((d) => d.level === lv);
            const met = inLevel.filter((d) => itemMet(detail.attempts, d.id)).length;
            return (
              <li key={lv}>
                {s.levels[lv]}: {s.module.met(met, inLevel.length)}
                {levelPassed(detail.attempts, b.drills, lv) && <>{' '}<span className="badge">{s.module.passed}</span></>}
                {open.includes(lv) && !earned.includes(lv) && <> <span className="muted">{t.grantedByHand(s.levels[lv], m.title)}</span></>}
                {!open.includes(lv) && m.reviewed && (
                  <>{' '}
                    <button type="button" className="btn" disabled={busy} onClick={() => void grant(m.slug, lv)}>
                      {t.unlockButton(s.levels[lv], m.title)}
                    </button>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    );
  };

  const newest = [...detail.attempts].reverse(); // stored oldest → newest
  return (
    <div>
      <h1>{detail.displayName}</h1>
      <p className="muted">{detail.lastActiveAt ? t.lastActive(day(detail.lastActiveAt)) : t.neverActive}</p>
      {back}

      <section aria-labelledby="progress-h">
        <h2 id="progress-h">{t.progressHeading}</h2>
        {grantError && <p role="alert" className="error">{t.grantError}</p>}
        {course.stages.map((st) => {
          const cards = st.index.modules.map((m) => moduleCard(m, grouped ? 4 : 3));
          if (!grouped) return <Fragment key={st.stage}>{cards}</Fragment>;
          return (
            <div key={st.stage} role="group" aria-labelledby={`stage-h-${st.stage}`} className="stage-group">
              <h3 id={`stage-h-${st.stage}`}>{st.title}</h3>
              {cards}
            </div>
          );
        })}
      </section>

      <section aria-labelledby="attempts-h">
        <h2 id="attempts-h">{t.attemptsHeading}</h2>
        <p className="muted">{t.flagsNote}</p>
        {modelsMissing && <p role="status" className="notice">{t.modelsMissing}</p>}
        {ai === 'error' && <p role="alert" className="error">{ta.loadError}</p>}
        {newest.length === 0 ? (
          <p>{t.noAttempts}</p>
        ) : (
          <ul aria-labelledby="attempts-h" className="attempt-list">
            {newest.map((a) => {
              const drill = drillOf.get(a.itemId);
              const flags = flagsByAttempt.get(a.id) ?? [];
              return (
                <li key={a.id}>
                  <p className="muted">
                    <strong>{a.itemId}</strong> · <time dateTime={a.createdAt}>{day(a.createdAt)}</time>
                    {!drill && <> · {t.unknownItem}</>}
                  </p>
                  <blockquote>{a.response}</blockquote>
                  <ul>
                    {a.criteriaMet.map((met, i) => (
                      <li key={i}>
                        <span>{drill ? drill.criteria[i] : t.criterionN(i + 1)}</span>{' '}
                        <span className="badge">{met ? t.criterionMet : t.criterionNotMet}</span>
                      </li>
                    ))}
                  </ul>
                  {flags.map((f) => (
                    <p key={f.reason}><span className="badge flag">{t.flagPrefix} {t.flags[f.reason]}</span></p>
                  ))}
                  {ai && ai !== 'error' && <AiMarks attemptId={a.id} ai={ai} criteria={drill?.criteria} />}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="decisions-h">
        <h2 id="decisions-h">{t.decisionsHeading}</h2>
        <ul>
          {detail.decisions.map((d) => (
            <li key={d.id}>
              <span className="muted">{d.sessionId} · {d.decisionId}{d.optionId ? ` · ${t.optionLabel(d.optionId)}` : ''}</span>
              {d.response && <blockquote>{d.response}</blockquote>}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="reflections-h">
        <h2 id="reflections-h">{t.reflectionsHeading}</h2>
        <ul>
          {detail.reflections.map((r) => (
            <li key={r.id}>
              <span className="muted">{r.moduleSlug} · {r.promptId} · {day(r.createdAt)}</span>
              <blockquote>{r.text}</blockquote>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

/** The AI's check of one response, in the supervisor's words. Differences are split by direction. Nothing if it was not checked. */
function AiMarks({ attemptId, ai, criteria }: { attemptId: string; ai: { evals: AiEvaluation[]; diffs: AiDisagreement[] }; criteria?: string[] }) {
  const s = useT();
  const t = s.aiFeedback.supervisor;
  const evaluation = ai.evals.find((e) => e.attemptId === attemptId);
  if (!evaluation) return null;
  if (evaluation.concern === 'risk-content') return <p><span className="badge risk">{t.riskFlag}</span></p>;
  if (evaluation.concern === 'off-task') return <p><span className="badge">{t.offTaskFlag}</span></p>;
  const diffs = ai.diffs.filter((d) => d.attemptId === attemptId);
  if (diffs.length === 0) return <p className="muted">{t.agreeFlag}</p>;
  return (
    <ul className="plain ai-supervisor" aria-label={t.attemptHeading}>
      {diffs.map((d) => {
        const label = criteria?.[d.criterion - 1] ?? s.supervisor.criterionN(d.criterion);
        return <li key={d.criterion}><span className="badge">{directionOf(d) === 'self-only' ? t.selfOnly(label) : t.aiOnly(label)}</span></li>;
      })}
    </ul>
  );
}
