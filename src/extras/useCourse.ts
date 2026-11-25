import { useCallback, useEffect, useState } from 'react';
import { loadModule, loadStage, loadStages, type ContentLocale } from '../content/client';
import type { Drill, ModuleBundle } from '../content/schema';
import { useLocale } from '../i18n';
import { unlockedLevels, unlockedModules } from '../progress/rules';
import { stageIsOpen, useOpenStageReader } from '../progress/stageAccess';
import type { Attempt, Reflection } from '../progress/types';
import { useGrantReader } from '../progress/unlocks';
import { useStore } from '../StoreContext';

/** One practice question the student can already open, with the module it belongs to. */
export interface OpenItem {
  stage: string;
  slug: string;
  moduleTitle: string;
  contentLocale: ContentLocale;
  drill: Drill;
  bundle: ModuleBundle;
}
export interface CourseData {
  items: OpenItem[];
  attempts: Attempt[];
  reflections: Reflection[];
}
export type CourseState =
  | { status: 'loading' }
  | { status: 'error'; reload: () => void }
  | { status: 'ready'; data: CourseData };

/**
 * Everything the student can open right now: stages their class has opened, reviewed modules only,
 * modules whose earlier walkthrough is done, levels that are unlocked. Mirrors useStageData, over every stage.
 */
export function useCourse(): CourseState {
  const store = useStore();
  const readGrants = useGrantReader();
  const readOpenStages = useOpenStageReader();
  const { locale } = useLocale();
  const [state, setState] = useState<CourseState>({ status: 'loading' });
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    let live = true;
    (async () => {
      const stages = await loadStages('en');
      const open = stages.length > 1 ? await readOpenStages() : 'all';
      const [attempts, decisions, reflections, grants] = await Promise.all([
        store.listAttempts(), store.listDecisions(), store.listReflections(), readGrants(),
      ]);
      const items: OpenItem[] = [];
      for (const st of stages) {
        if (!stageIsOpen(open, st.stage)) continue;
        const index = await loadStage('en', st.stage);
        const prefix: typeof index.modules = [];
        for (const m of index.modules) {
          if (!m.reviewed) break;
          prefix.push(m);
        }
        let zh: Awaited<ReturnType<typeof loadStage>> | undefined;
        if (locale === 'zh-Hant') {
          try { zh = await loadStage('zh-Hant', st.stage); } catch { zh = undefined; }
        }
        const loaded = await Promise.all(prefix.map(async (m) => {
          const zhEntry = zh?.modules.find((z) => z.slug === m.slug);
          if (zhEntry?.reviewed) {
            try { return { bundle: await loadModule(m.slug, 'zh-Hant', st.stage), contentLocale: 'zh-Hant' as ContentLocale, title: zhEntry.title }; } catch { /* English */ }
          }
          return { bundle: await loadModule(m.slug, 'en', st.stage), contentLocale: 'en' as ContentLocale, title: m.title };
        }));
        const unlocked = unlockedModules(decisions, prefix.map((m, i) => ({ slug: m.slug, sessions: loaded[i].bundle.sessions })));
        prefix.forEach((m, i) => {
          if (!unlocked.includes(m.slug)) return;
          const { bundle, contentLocale, title } = loaded[i];
          const levels = unlockedLevels(attempts, bundle.drills, grants[m.slug] ?? []);
          for (const drill of bundle.drills) {
            if (levels.includes(drill.level)) items.push({ stage: st.stage, slug: m.slug, moduleTitle: title, contentLocale, drill, bundle });
          }
        });
      }
      if (live) setState({ status: 'ready', data: { items, attempts, reflections } });
    })().catch(() => live && setState({ status: 'error', reload }));
    return () => { live = false; };
  }, [store, readGrants, readOpenStages, locale, tick, reload]);

  return state;
}
