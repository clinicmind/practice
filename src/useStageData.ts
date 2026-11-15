import { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import { loadModule, loadStage } from './content/client';
import type { ModuleBundle, StageIndex } from './content/schema';
import { unlockedModules } from './progress/rules';
import { useGrantReader, type Grants } from './progress/unlocks';
import type { Attempt, Decision } from './progress/types';
import { useStore } from './StoreContext';

export interface StageEntry {
  slug: string;
  title: string;
  /** Why this module is locked; undefined when it is open. */
  lockedReason?: { kind: 'walkthrough'; prevTitle: string } | { kind: 'unavailable' };
  /** Only ever set for supervisors, who can see modules that have not been reviewed. */
  unreviewed?: boolean;
}

export interface StageData {
  stage: StageIndex;
  /** In course order. Students get reviewed modules only; supervisors get all of them. */
  visible: StageEntry[];
  /** Missing for an unreviewed module whose content is not shipped in this build. */
  bundles: Record<string, ModuleBundle | undefined>;
  /** Levels a supervisor opened by hand, per module. */
  grants: Grants;
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
  const readGrants = useGrantReader();
  const isSupervisor = useAuth().status === 'supervisor';
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
      const [attempts, decisions, grants] = await Promise.all([
        store.listAttempts(), store.listDecisions(), readGrants(),
      ]);
      if (isSupervisor) {
        // Supervisors preview the whole course: nothing is locked, unreviewed modules are marked.
        const loaded = await Promise.all(stage.modules.map(async (m) => {
          try { return await loadModule(m.slug); } catch (e) { if (m.reviewed) throw e; return undefined; }
        }));
        const bundles: Record<string, ModuleBundle | undefined> = {};
        stage.modules.forEach((m, i) => { bundles[m.slug] = loaded[i]; });
        const visible: StageEntry[] = stage.modules.map((m) => ({ slug: m.slug, title: m.title, ...(m.reviewed ? {} : { unreviewed: true }) }));
        if (live) setState({ status: 'ready', data: { stage, visible, bundles, grants, unlocked: stage.modules.map((m) => m.slug), attempts, decisions } });
        return;
      }
      const prefix: string[] = [];
      for (const m of stage.modules) {
        if (!m.reviewed) break;
        prefix.push(m.slug);
      }
      const loaded = await Promise.all(prefix.map((slug) => loadModule(slug)));
      const bundles: Record<string, ModuleBundle | undefined> = {};
      prefix.forEach((slug, i) => { bundles[slug] = loaded[i]; });
      const unlocked = unlockedModules(
        decisions,
        prefix.map((slug, i) => ({ slug, sessions: loaded[i].sessions })),
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
      if (live) setState({ status: 'ready', data: { stage, visible, bundles, grants, unlocked, attempts, decisions } });
    })().catch(() => live && setState({ status: 'error', reload }));
    return () => { live = false; };
  }, [store, readGrants, isSupervisor, tick, reload, locationKey]);

  return state;
}
