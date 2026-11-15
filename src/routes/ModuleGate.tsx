import { createContext, useContext, type ReactNode } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { en } from '../i18n/en';
import { LEVELS, type Level, type ModuleBundle } from '../content/schema';
import { unlockedLevels } from '../progress/rules';
import type { Attempt, Decision } from '../progress/types';
import { useStageData, type StageEntry } from '../useStageData';
import { NotFound } from './NotFound';

export function lockedModuleNotice(entry: StageEntry): string {
  return entry.lockedReason?.kind === 'walkthrough'
    ? en.stage.lockedNeedsWalkthrough(entry.lockedReason.prevTitle)
    : en.stage.lockedUnavailable;
}

interface GateValue {
  slug: string;
  bundle: ModuleBundle;
  attempts: Attempt[];
  decisions: Decision[];
  levels: Level[];
}
const GateContext = createContext<GateValue | null>(null);
export function useGate(): GateValue {
  const v = useContext(GateContext);
  if (!v) throw new Error('useGate outside ModuleGate');
  return v;
}

export function ErrorBlock({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div>
      <p role="alert" className="error">{message}</p>
      <button type="button" className="btn" onClick={onRetry}>{en.common.retry}</button>
    </div>
  );
}

/** Unknown/unreviewed module → not found; locked module → back to / with the reason. */
export function ModuleGate({ children }: { children: ReactNode }) {
  const { slug = '' } = useParams();
  const state = useStageData();
  if (state.status === 'loading') return <p>{en.common.loading}</p>;
  if (state.status === 'error') return <ErrorBlock message={en.stage.loadError} onRetry={state.reload} />;
  const { data } = state;
  const entry = data.visible.find((v) => v.slug === slug);
  if (!entry) return <NotFound />;
  if (!data.unlocked.includes(slug)) {
    return <Navigate to="/" replace state={{ notice: lockedModuleNotice(entry) }} />;
  }
  const bundle = data.bundles[slug];
  const levels = unlockedLevels(data.attempts, bundle.drills);
  return (
    <GateContext.Provider value={{ slug, bundle, attempts: data.attempts, decisions: data.decisions, levels }}>
      {children}
    </GateContext.Provider>
  );
}

/** Unknown level → not found; locked level → module page with the reason. */
export function LevelGate({ children }: { children: ReactNode }) {
  const { level = '' } = useParams();
  const { slug, levels } = useGate();
  if (!(LEVELS as readonly string[]).includes(level)) return <NotFound />;
  if (!levels.includes(level as Level)) {
    const prev = en.levels[LEVELS[LEVELS.indexOf(level as Level) - 1]];
    return <Navigate to={`/m/${slug}`} replace state={{ notice: en.module.levelLockedReason(prev) }} />;
  }
  return <>{children}</>;
}
