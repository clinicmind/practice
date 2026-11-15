import { Link, useLocation } from 'react-router-dom';
import { LEVELS, isDecision } from '../content/schema';
import { useT } from '../i18n';
import { itemMet, levelPassed } from '../progress/rules';
import { useGate } from './ModuleGate';

export function ModulePage() {
  const s = useT();
  const t = s.module;
  const { slug, bundle, attempts, decisions, levels, unreviewed } = useGate();
  const notice = (useLocation().state as { notice?: string } | null)?.notice;
  return (
    <div>
      <h1>{bundle.meta.title}</h1>
      {unreviewed && <p><span className="badge">{s.stage.unreviewed}</span></p>}
      {notice && <p role="status" className="notice">{notice}</p>}
      <p>{bundle.meta.intro}</p>

      <section aria-labelledby="wt-h">
        <h2 id="wt-h">{t.walkthrough}</h2>
        <ul>
          {bundle.sessions.map((s) => {
            const ds = s.turns.filter(isDecision);
            const done = ds.every((d) => decisions.some((x) => x.sessionId === s.id && x.decisionId === d.id));
            return (
              <li key={s.id}>
                <Link to={`/m/${slug}/walkthrough/${s.id}`}>{t.sessionLabel(s.title, done)}</Link>
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="pr-h">
        <h2 id="pr-h">{t.practice}</h2>
        <p className="muted">{t.passRule}</p>
        <ul>
          {LEVELS.map((lv, i) => {
            const inLevel = bundle.drills.filter((d) => d.level === lv);
            const met = inLevel.filter((d) => itemMet(attempts, d.id)).length;
            const open = levels.includes(lv);
            return (
              <li key={lv}>
                {open ? (
                  <Link to={`/m/${slug}/drills/${lv}`}>{t.levelLine(s.levels[lv])}</Link>
                ) : (
                  <span>{t.levelLine(s.levels[lv])}</span>
                )}{' '}
                <span>{t.met(met, inLevel.length)}</span>{' '}
                {open ? (
                  levelPassed(attempts, bundle.drills, lv) && <span className="badge">{t.passed}</span>
                ) : (
                  <>
                    <span className="badge">{t.levelLocked}</span>
                    <span className="muted"> {t.levelLockedReason(s.levels[LEVELS[i - 1]])}</span>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <p>
        <Link to={`/m/${slug}/reflect`}>{t.reflectLink}</Link>
      </p>
    </div>
  );
}
