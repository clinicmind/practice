import { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { loadModule, loadStage } from './content/client';
import type { ModuleBundle, StageIndex } from './content/schema';
import { unlockedModules } from './progress/rules';
import type { Attempt, Decision } from './progress/types';
import { useStore } from './StoreContext';

export interface StageEntry {
  slug: string;
  title: string;
  /** Why this module is locked; undefined when it is open. */
  lockedReason?: { kind: 'walkthrough'; prevTitle: string } | { kind: 'unavailable' };
}

export interface StageData {
  stage: StageIndex;
  /** Reviewed modules only, in course order. Unreviewed modules never appear. */
  visible: StageEntry[];
  bundles: Record<string, ModuleBundle>;
  unlocked: string[];
  attempts: Attempt[];
  decisions: Decision[];
}

export type StageState =
  | { status: 'loading' }
  | { status: 'error'; reload: () => void }
  | { status: 'ready'; data: StageData };

/**
 * Loads the stage index plus every module that can matter for unlocking.
 * An unreviewed module can never be completed, so it blocks every module after it.
 */
export function useStageData(): StageState {
  const store = useStore();
  const [state, setState] = useState<StageState>({ status: 'loading' });
  const [tick, setTick] = useState(0);
  // Gate components are reused across routes, so re-read progress on every navigation.
  const locationKey = useLocation().key;
  const reload = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    let live = true;
    setState({ status: 'loading' });
    (async () => {
      const stage = await loadStage();
      const [attempts, decisions] = await Promise.all([store.listAttempts(), store.listDecisions()]);
      const prefix: string[] = [];
      for (const m of stage.modules) {
        if (!m.reviewed) break;
        prefix.push(m.slug);
      }
      const loaded = await Promise.all(prefix.map((slug) => loadModule(slug)));
      const bundles: Record<string, ModuleBundle> = {};
      prefix.forEach((slug, i) => { bundles[slug] = loaded[i]; });
      const unlocked = unlockedModules(
        decisions,
        prefix.map((slug) => ({ slug, sessions: bundles[slug].sessions })),
      );
      const visible: StageEntry[] = [];
      stage.modules.forEach((m, i) => {
        if (!m.reviewed) return;
        const entry: StageEntry = { slug: m.slug, title: m.title };
        if (!unlocked.includes(m.slug)) {
          const prev = stage.modules[i - 1];
          entry.lockedReason = prev && prev.reviewed ? { kind: 'walkthrough', prevTitle: prev.title } : { kind: 'unavailable' };
        }
        visible.push(entry);
      });
      if (live) setState({ status: 'ready', data: { stage, visible, bundles, unlocked, attempts, decisions } });
    })().catch(() => live && setState({ status: 'error', reload }));
    return () => { live = false; };
  }, [store, tick, reload, locationKey]);

  return state;
}
