import { useCallback, useEffect, useState } from 'react';
import { useAuth } from './auth/AuthContext';
import { loadStage, loadStages } from './content/client';
import { useLocale } from './i18n';
import { stageIsOpen, useOpenStageReader } from './progress/stageAccess';

export interface StageListEntry {
  stage: string;
  title: string;
  /** False when the student's cohort has not been given this stage. */
  open: boolean;
  /** Only ever set for supervisors, who also see stages with nothing reviewed yet. */
  unreviewed?: boolean;
}

export type StageListState =
  | { status: 'loading' }
  | { status: 'error'; reload: () => void }
  | { status: 'ready'; entries: StageListEntry[] };

/**
 * The stages this user can see. Students see a stage once it has at least one
 * reviewed module (a stage that is not ready yet does not exist for them, which
 * is also why a one-stage course shows no stage list). Supervisors see all.
 */
export function useStageList(): StageListState {
  const { locale } = useLocale();
  const isSupervisor = useAuth().status === 'supervisor';
  const readOpenStages = useOpenStageReader();
  const [state, setState] = useState<StageListState>({ status: 'loading' });
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    let live = true;
    (async () => {
      const [stages, open] = await Promise.all([loadStages('en'), readOpenStages()]);
      const zhTitles = new Map<string, string>();
      if (locale === 'zh-Hant') {
        try { for (const s of await loadStages('zh-Hant')) zhTitles.set(s.stage, s.title); } catch { /* English titles */ }
      }
      const entries = (await Promise.all(stages.map(async (s) => {
        const index = await loadStage('en', s.stage);
        const ready = index.modules.some((m) => m.reviewed);
        if (!ready && !isSupervisor) return null;
        // A Chinese stage title is used only once the stage has a reviewed Chinese module.
        let title = s.title;
        if (locale === 'zh-Hant' && zhTitles.has(s.stage)) {
          try {
            const zh = await loadStage('zh-Hant', s.stage);
            if (zh.modules.some((m) => m.reviewed) || isSupervisor) title = zhTitles.get(s.stage)!;
          } catch { /* English title */ }
        }
        const entry: StageListEntry = { stage: s.stage, title, open: stageIsOpen(open, s.stage) };
        if (!ready) entry.unreviewed = true;
        return entry;
      }))).filter((e): e is StageListEntry => e !== null);
      if (live) setState({ status: 'ready', entries });
    })().catch(() => live && setState({ status: 'error', reload }));
    return () => { live = false; };
  }, [locale, isSupervisor, readOpenStages, tick, reload]);

  return state;
}
