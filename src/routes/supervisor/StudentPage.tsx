import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { loadModels } from '../../content/client';
import { LEVELS, type Drill, type Level, type Model } from '../../content/schema';
import { useT } from '../../i18n';
import { itemMet, levelPassed, unlockedLevels, walkthroughDone } from '../../progress/rules';
import { loadCourse, type Course, type StudentDetail } from '../../supervisor/api';
import { flagAttempts, type Flag } from '../../supervisor/flags';
import { useSupervisorApi } from '../../supervisor/SupervisorContext';

const day = (iso: string) => iso.slice(0, 10);

type Loaded = { detail: StudentDetail; course: Course; models: Record<string, Model>; modelsMissing: boolean };
type State = { status: 'loading' } | { status: 'error' } | { status: 'missing' } | ({ status: 'ready' } & Loaded);

export function StudentPage() {
  const s = useT();
  const t = s.supervisor;
  const { id = '' } = useParams();
  const api = useSupervisorApi();
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
      const models: Record<string, Model> = {};
      await Promise.all([...used].filter((slug) => course.bundles[slug]).map(async (slug) => {
        try { Object.assign(models, await loadModels(slug)); } catch { modelsMissing = true; }
      }));
      if (live) setState({ status: 'ready', detail, course, models, modelsMissing });
    })().catch(() => live && setState({ status: 'error' }));
    return () => { live = false; };
  }, [api, id, tick]);

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

  const { detail, course, modelsMissing } = state;
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

  const newest = [...detail.attempts].reverse(); // stored oldest → newest
  return (
    <div>
      <h1>{detail.displayName}</h1>
      <p className="muted">{detail.lastActiveAt ? t.lastActive(day(detail.lastActiveAt)) : t.neverActive}</p>
      {back}

      <section aria-labelledby="progress-h">
        <h2 id="progress-h">{t.progressHeading}</h2>
        {grantError && <p role="alert" className="error">{t.grantError}</p>}
        {course.stage.modules.map((m) => {
          const b = course.bundles[m.slug];
          if (!b) return null;
          const handLevels = detail.grants.filter((g) => g.moduleSlug === m.slug).map((g) => g.level);
          const earned = unlockedLevels(detail.attempts, b.drills);
          const open = unlockedLevels(detail.attempts, b.drills, handLevels);
          return (
            <div key={m.slug} className="card">
              <h3>{m.title}{!m.reviewed && <>{' '}<span className="badge">{s.stage.unreviewed}</span></>}</h3>
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
        })}
      </section>

      <section aria-labelledby="attempts-h">
        <h2 id="attempts-h">{t.attemptsHeading}</h2>
        <p className="muted">{t.flagsNote}</p>
        {modelsMissing && <p role="status" className="notice">{t.modelsMissing}</p>}
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
