import { createContext, useContext, type ReactNode } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { useT } from '../i18n';
import type { Strings } from '../i18n/en';
import { LEVELS, type Level, type ModuleBundle } from '../content/schema';
import { unlockedLevels } from '../progress/rules';
import type { Attempt, Decision } from '../progress/types';
import { useStageData, type StageEntry } from '../useStageData';
import { NotFound } from './NotFound';

export function lockedModuleNotice(entry: StageEntry, s: Strings): string {
  return entry.lockedReason?.kind === 'walkthrough'
    ? s.stage.lockedNeedsWalkthrough(entry.lockedReason.prevTitle)
    : s.stage.lockedUnavailable;
}

interface GateValue {
  slug: string;
  bundle: ModuleBundle;
  attempts: Attempt[];
  decisions: Decision[];
  levels: Level[];
  /** True only for a supervisor looking at a module that has not been reviewed. */
  unreviewed: boolean;
}
const GateContext = createContext<GateValue | null>(null);
export function useGate(): GateValue {
  const v = useContext(GateContext);
  if (!v) throw new Error('useGate outside ModuleGate');
  return v;
}

export function ErrorBlock({ message, onRetry }: { message: string; onRetry: () => void }) {
  const s = useT();
  return (
    <div>
      <p role="alert" className="error">{message}</p>
      <button type="button" className="btn" onClick={onRetry}>{s.common.retry}</button>
    </div>
  );
}

/** Unknown/unreviewed module → not found; locked module → back to / with the reason. */
export function ModuleGate({ children }: { children: ReactNode }) {
  const s = useT();
  const { slug = '' } = useParams();
  const state = useStageData();
  if (state.status === 'loading') return <p>{s.common.loading}</p>;
  if (state.status === 'error') return <ErrorBlock message={s.stage.loadError} onRetry={state.reload} />;
  const { data } = state;
  const entry = data.visible.find((v) => v.slug === slug);
  if (!entry) return <NotFound />;
  if (!data.unlocked.includes(slug)) {
    return <Navigate to="/" replace state={{ notice: lockedModuleNotice(entry, s) }} />;
  }
  const bundle = data.bundles[slug];
  if (!bundle) {
    // A supervisor opened an unreviewed module whose content this build does not ship.
    return (
      <div>
        <h1>{entry.title}</h1>
        <p><span className="badge">{s.stage.unreviewed}</span></p>
        <p>{s.stage.unreviewedNotShipped}</p>
        <p><Link to="/">{s.notFound.home}</Link></p>
      </div>
    );
  }
  const levels = unlockedLevels(data.attempts, bundle.drills, data.grants[slug] ?? []);
  return (
    <GateContext.Provider value={{ slug, bundle, attempts: data.attempts, decisions: data.decisions, levels, unreviewed: !!entry.unreviewed }}>
      {children}
    </GateContext.Provider>
  );
}

/** Unknown level → not found; locked level → module page with the reason. */
export function LevelGate({ children }: { children: ReactNode }) {
  const s = useT();
  const { level = '' } = useParams();
  const { slug, levels } = useGate();
  if (!(LEVELS as readonly string[]).includes(level)) return <NotFound />;
  if (!levels.includes(level as Level)) {
    const prev = s.levels[LEVELS[LEVELS.indexOf(level as Level) - 1]];
    return <Navigate to={`/m/${slug}`} replace state={{ notice: s.module.levelLockedReason(prev) }} />;
  }
  return <>{children}</>;
}
