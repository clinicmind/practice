import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { loadModels, loadModule } from '../../content/client';
import type { Model, ModuleBundle } from '../../content/schema';
import { useLocale, useT } from '../../i18n';
import { type CohortInfo, type Course, type StudentSummary, type SupervisorApi } from '../../supervisor/api';
import {
  discussionPicks, hardestCriteria, MIN_ANSWERS, studentsToCheckIn, WINDOW_DAYS,
  type CheckInReason, type CohortAttempt,
} from '../../supervisor/triage';

type Models = Record<string, Model>;
export type TriageData = { attempts: CohortAttempt[]; models: Models[]; modelsMissing: boolean; now: Date };
export type TriageState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; data: TriageData };

const DAY = 86_400_000;
/** The module a question belongs to, found from the course (item ids are shared by both languages). */
const slugOf = (course: Course) => {
  const m = new Map<string, string>();
  for (const [slug, b] of Object.entries(course.bundles)) for (const d of b.drills) m.set(d.id, slug);
  return m;
};

/**
 * Reads what the summary blocks need. It runs after the page's own data has loaded and fails on its own:
 * the progress table never waits for it, and a failure here only shows a note in these blocks.
 */
export function useTriageData(api: SupervisorApi, course: Course | null): TriageState {
  const [state, setState] = useState<TriageState>({ status: 'loading' });
  useEffect(() => {
    if (!course) return;
    let live = true;
    setState({ status: 'loading' });
    (async () => {
      const attempts = await api.listCohortAttempts();
      const now = new Date();
      const since = new Date(now.getTime() - WINDOW_DAYS * DAY).toISOString();
      // Example responses are only needed to spot copies among this week's replies.
      const slugs = slugOf(course);
      const used = new Set(attempts.filter((a) => a.createdAt >= since).map((a) => slugs.get(a.itemId)).filter((x): x is string => !!x));
      let modelsMissing = false;
      const en: Models = {}, zh: Models = {};
      await Promise.all([...used].flatMap((slug) => [
        // English is the reference: failing to load it means copies could go unnoticed.
        loadModels(slug, 'en', course.stageOf[slug]).then((m) => { Object.assign(en, m); }, () => { modelsMissing = true; }),
        // A Chinese module may not exist (or be reviewed) yet; that is not an error.
        loadModels(slug, 'zh-Hant', course.stageOf[slug]).then((m) => { Object.assign(zh, m); }, () => {}),
      ]));
      if (live) setState({ status: 'ready', data: { attempts, models: [en, zh], modelsMissing, now } });
    })().catch(() => live && setState({ status: 'error' }));
    return () => { live = false; };
  }, [api, course]);
  return state;
}

/** Module bundles in the language on screen, for the few modules the blocks mention; English where that module has no Chinese yet. */
function useBundles(course: Course, slugs: string[]): Record<string, ModuleBundle> {
  const { locale } = useLocale();
  const key = slugs.join('|');
  const [loaded, setLoaded] = useState<Record<string, ModuleBundle>>({});
  useEffect(() => {
    let live = true;
    if (locale === 'en') { setLoaded({}); return; }
    Promise.all(slugs.map((slug) => loadModule(slug, locale, course.stageOf[slug]).then((b) => [slug, b] as const, () => null)))
      .then((rows) => live && setLoaded(Object.fromEntries(rows.filter((r): r is readonly [string, ModuleBundle] => r !== null))));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [course, locale, key]);
  return useMemo(() => ({ ...course.bundles, ...loaded }), [course, loaded]);
}

function CheckInReasonText({ reason, titles }: { reason: CheckInReason; titles: Record<string, string> }) {
  const s = useT();
  const t = s.supervisorTriage.checkIn;
  if (reason.kind === 'inactive') return <>{reason.never ? t.neverStarted : t.inactive}</>;
  return <>{t.stuck(titles[reason.slug] ?? reason.slug, s.levels[reason.level] ?? reason.level, reason.rounds)}</>;
}

export function TriagePanel({ cohort, students, course, state, closed }: {
  cohort: CohortInfo; students: StudentSummary[]; course: Course; state: TriageState; closed: boolean;
}) {
  const s = useT();
  const t = s.supervisorTriage;
  const people = useMemo(() => new Map(students.map((x) => [x.id, x.displayName])), [students]);
  const ids = useMemo(() => new Set(students.map((x) => x.id)), [students]);

  const computed = useMemo(() => {
    if (state.status !== 'ready') return null;
    const { attempts, models, now } = state.data;
    const mine = attempts.filter((a) => ids.has(a.userId));
    const triageStudents = students.map((x) => ({ id: x.id, displayName: x.displayName, lastActiveAt: x.lastActiveAt, joinedAt: x.joinedAt }));
    return {
      hardest: hardestCriteria(mine, now),
      checkIn: closed ? [] : studentsToCheckIn(triageStudents, mine, course.bundles, now),
      picks: discussionPicks(triageStudents, mine, models, now),
    };
  }, [state, ids, students, course, closed]);

  const itemSlug = useMemo(() => slugOf(course), [course]);
  const slugs = useMemo(() => {
    const out = new Set<string>();
    for (const r of computed?.hardest.rows ?? []) { const x = itemSlug.get(r.itemId); if (x) out.add(x); }
    for (const c of computed?.checkIn ?? []) for (const r of c.reasons) if (r.kind === 'stuck') out.add(r.slug);
    return [...out].sort();
  }, [computed, itemSlug]);
  const bundles = useBundles(course, slugs);
  const titles = useMemo(() => Object.fromEntries(Object.entries(bundles).map(([k, b]) => [k, b.meta.title])), [bundles]);

  const hid = `triage-${cohort.id}`;
  if (state.status !== 'ready' || !computed) {
    return (
      <section aria-labelledby={hid} className="triage">
        <h3 id={hid}>{t.heading}</h3>
        {state.status === 'error' ? <p role="alert" className="error">{t.loadError}</p> : <p role="status">{t.loading}</p>}
      </section>
    );
  }

  const { hardest, checkIn, picks } = computed;
  const where = (itemId: string) => {
    const slug = itemSlug.get(itemId);
    const b = slug ? bundles[slug] : undefined;
    const d = b?.drills.find((x) => x.id === itemId);
    if (!slug || !b || !d) return null;
    const number = b.drills.filter((x) => x.level === d.level).findIndex((x) => x.id === itemId) + 1;
    return { drill: d, label: t.hardest.where(b.meta.title, s.levels[d.level] ?? d.level, number) };
  };
  const row = (userId: string) => ({ name: people.get(userId) ?? '' });

  return (
    <section aria-labelledby={hid} className="triage">
      <h3 id={hid}>{t.heading}</h3>
      <p className="muted">{t.intro}</p>

      <section aria-labelledby={`${hid}-hard`}>
        <h4 id={`${hid}-hard`}>{t.hardest.heading}</h4>
        <p className="muted">{t.hardest.intro}</p>
        {hardest.rows.length === 0 ? (
          <p>{t.hardest.none}</p>
        ) : (
          <ol className="triage-list">
            {hardest.rows.map((r) => {
              const w = where(r.itemId);
              return (
                <li key={`${r.itemId}-${r.criterion}`}>
                  <p className="triage-criterion">
                    <span className="muted">{t.hardest.criterionLabel(r.criterion)}: </span>
                    {w ? w.drill.criteria[r.criterion - 1] : t.hardest.unknownItem}
                  </p>
                  <p className="muted triage-meta">
                    {w ? w.label : r.itemId}{' '}
                    <span className="badge">{t.hardest.rate(r.met, r.answers, Math.round(r.passRate * 100))}</span>
                  </p>
                  {w && <blockquote className="triage-quote">{w.drill.client}</blockquote>}
                </li>
              );
            })}
          </ol>
        )}
        {hardest.pending > 0 && <p className="muted">{t.hardest.tooFew(hardest.pending, MIN_ANSWERS)}</p>}
        <p className="muted">{t.hardest.note}</p>
      </section>

      <section aria-labelledby={`${hid}-check`}>
        <h4 id={`${hid}-check`}>{t.checkIn.heading}</h4>
        <p className="muted">{t.checkIn.intro}</p>
        {closed ? (
          <p>{t.checkIn.termOver}</p>
        ) : checkIn.length === 0 ? (
          <p>{t.checkIn.none}</p>
        ) : (
          <ul className="triage-list">
            {checkIn.map((c) => (
              <li key={c.userId}>
                <Link to={`/supervisor/students/${c.userId}`}>{c.displayName}</Link>
                {c.reasons.map((r, i) => (
                  <span key={i} className="muted triage-reason"> · <CheckInReasonText reason={r} titles={titles} /></span>
                ))}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby={`${hid}-discuss`}>
        <h4 id={`${hid}-discuss`}>{t.discuss.heading}</h4>
        <p className="muted">{t.discuss.intro}</p>
        {state.data.modelsMissing && <p role="status" className="notice">{t.discuss.modelsMissing}</p>}

        <h5>{t.discuss.flaggedHeading}</h5>
        {picks.flagged.length === 0 ? (
          <p>{t.discuss.noneFlagged}</p>
        ) : (
          <>
            <p className="muted">{t.discuss.flaggedNote}</p>
            <ul className="triage-list">
              {picks.flagged.map((p) => (
                <li key={p.attemptId}>
                  <blockquote className="triage-quote">{p.response}</blockquote>
                  <p className="muted triage-meta">
                    {p.reasons.map((r) => <span key={r} className="badge flag">{s.supervisor.flags[r] ?? r}</span>)}{' '}
                    <Link to={`/supervisor/students/${p.userId}`}>{t.discuss.student(row(p.userId).name)}</Link>
                  </p>
                </li>
              ))}
            </ul>
          </>
        )}

        <h5>{t.discuss.rotationHeading}</h5>
        {picks.rotation.length === 0 ? (
          <p>{t.discuss.noneRotation}</p>
        ) : (
          <>
            <p className="muted">{t.discuss.rotationNote}</p>
            <ul className="triage-list">
              {picks.rotation.map((p) => (
                <li key={p.attemptId}>
                  <blockquote className="triage-quote">{p.response}</blockquote>
                  <p className="muted triage-meta">
                    <Link to={`/supervisor/students/${p.userId}`}>{t.discuss.student(row(p.userId).name)}</Link>
                  </p>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </section>
  );
}

/** Step-by-step help for the things a supervisor does a few times a term. */
export function GuideDrawer() {
  const s = useT();
  const g = s.supervisorGuide;
  return (
    <details className="guide-drawer">
      <summary>{g.summary}</summary>
      <div className="guide-body">
        <p className="muted">{g.intro}</p>
        {g.sections.map((sec) => (
          <section key={sec.title}>
            <h2>{sec.title}</h2>
            <ol>{sec.steps.map((step) => <li key={step}>{step}</li>)}</ol>
          </section>
        ))}
      </div>
    </details>
  );
}
