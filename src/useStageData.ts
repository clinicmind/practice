import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import { loadModule, loadStage, loadStages, type ContentLocale } from './content/client';
import { useLocale } from './i18n';
import type { ModuleBundle, StageIndex } from './content/schema';
import { unlockedModules } from './progress/rules';
import { stageIsOpen, useOpenStageReader } from './progress/stageAccess';
import { useGrantReader, type Grants } from './progress/unlocks';
import type { Attempt, Decision } from './progress/types';
import { useStageParam } from './stages';
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
  /** Which language each module's content is in. Chinese modules that are not ready fall back to English. */
  contentLocale: Record<string, ContentLocale>;
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
  /** The stage in the URL does not exist in this build. */
  | { status: 'notfound' }
  /** The stage exists, but the student's cohort has not been given it. */
  | { status: 'locked' }
  | { status: 'error'; reload: () => void }
  | { status: 'ready'; data: StageData };

/**
 * Loads the stage index plus every module that can matter for unlocking.
 * An unreviewed module can never be completed, so it blocks every module after it.
 */
export function useStageData(): StageState {
  const stageName = useStageParam();
  const store = useStore();
  const readGrants = useGrantReader();
  const readOpenStages = useOpenStageReader();
  const isSupervisor = useAuth().status === 'supervisor';
  const { locale } = useLocale();
  const [state, setState] = useState<StageState>({ status: 'loading' });
  const [tick, setTick] = useState(0);
  // Gate components are reused across routes, so re-read progress on every navigation.
  const locationKey = useLocation().key;
  const lastKey = useRef(locationKey);
  const reload = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    let live = true;
    // A language switch keeps what is on screen (and any text being typed) until the new content arrives.
    const sameNavigation = lastKey.current === locationKey;
    lastKey.current = locationKey;
    setState((prev) => (sameNavigation && prev.status === 'ready' ? prev : { status: 'loading' }));
    (async () => {
      // English is the reference: it decides which modules exist and in what order.
      // An unknown stage name is a missing page, not a load error.
      const stages = await loadStages('en');
      if (!stages.some((s) => s.stage === stageName)) {
        if (live) setState({ status: 'notfound' });
        return;
      }
      if (!stageIsOpen(await readOpenStages(), stageName)) {
        if (live) setState({ status: 'locked' });
        return;
      }
      const stage = await loadStage('en', stageName);
      // Chinese is optional per module; a missing or unreadable Chinese index just means English everywhere.
      let zh: StageIndex | undefined;
      if (locale === 'zh-Hant') {
        try { zh = await loadStage('zh-Hant', stageName); } catch { zh = undefined; }
      }
      const zhEntry = (slug: string) => zh?.modules.find((m) => m.slug === slug);
      // Students only get a Chinese module that has been reviewed; supervisors may preview one that has not.
      const zhUsable = (slug: string) => {
        const e = zhEntry(slug);
        return !!e && (e.reviewed || isSupervisor);
      };
      const contentLocale: Record<string, ContentLocale> = {};
      for (const m of stage.modules) contentLocale[m.slug] = locale === 'zh-Hant' && zhUsable(m.slug) ? 'zh-Hant' : 'en';
      const titleOf = (slug: string, enTitle: string) => (contentLocale[slug] === 'zh-Hant' ? zhEntry(slug)?.title ?? enTitle : enTitle);
      const fetchModule = async (slug: string, soft: boolean) => {
        if (contentLocale[slug] === 'zh-Hant') {
          try { return await loadModule(slug, 'zh-Hant', stageName); } catch (e) {
            if (!soft) throw e;
            // A supervisor's preview of a Chinese module that is not shipped falls back to English.
            contentLocale[slug] = 'en';
          }
        }
        return loadModule(slug, 'en', stageName);
      };
      const stageTitle = zh && zh.modules.length > 0 ? zh.title : stage.title;
      const [attempts, decisions, grants] = await Promise.all([
        store.listAttempts(), store.listDecisions(), readGrants(),
      ]);
      if (isSupervisor) {
        // Supervisors preview the whole course: nothing is locked, unreviewed modules are marked.
        const loaded = await Promise.all(stage.modules.map(async (m) => {
          try { return await fetchModule(m.slug, true); } catch (e) { if (m.reviewed) throw e; return undefined; }
        }));
        const bundles: Record<string, ModuleBundle | undefined> = {};
        stage.modules.forEach((m, i) => { bundles[m.slug] = loaded[i]; });
        const visible: StageEntry[] = stage.modules.map((m) => ({ slug: m.slug, title: titleOf(m.slug, m.title), ...(m.reviewed ? {} : { unreviewed: true }) }));
        if (live) setState({ status: 'ready', data: { stage: { ...stage, title: stageTitle }, visible, contentLocale, bundles, grants, unlocked: stage.modules.map((m) => m.slug), attempts, decisions } });
        return;
      }
      const prefix: string[] = [];
      for (const m of stage.modules) {
        if (!m.reviewed) break;
        prefix.push(m.slug);
      }
      const loaded = await Promise.all(prefix.map((slug) => fetchModule(slug, false)));
      const bundles: Record<string, ModuleBundle | undefined> = {};
      prefix.forEach((slug, i) => { bundles[slug] = loaded[i]; });
      // Walkthrough completion is keyed by session and decision ids, which are the same in both languages.
      const unlocked = unlockedModules(
        decisions,
        prefix.map((slug, i) => ({ slug, sessions: loaded[i].sessions })),
      );
      const visible: StageEntry[] = [];
      stage.modules.forEach((m, i) => {
        if (!m.reviewed) return;
        const entry: StageEntry = { slug: m.slug, title: titleOf(m.slug, m.title) };
        if (!unlocked.includes(m.slug)) {
          const prev = stage.modules[i - 1];
          entry.lockedReason = prev && prev.reviewed ? { kind: 'walkthrough', prevTitle: titleOf(prev.slug, prev.title) } : { kind: 'unavailable' };
        }
        visible.push(entry);
      });
      if (live) setState({ status: 'ready', data: { stage: { ...stage, title: stageTitle }, visible, contentLocale, bundles, grants, unlocked, attempts, decisions } });
    })().catch(() => live && setState({ status: 'error', reload }));
    return () => { live = false; };
  }, [stageName, store, readGrants, readOpenStages, isSupervisor, tick, reload, locationKey, locale]);

  return state;
}
