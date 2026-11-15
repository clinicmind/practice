import type { SupabaseClient } from '@supabase/supabase-js';
import { createContext, useContext } from 'react';
import { DEFAULT_STAGE } from '../stages';
import { fetchAll, type Result } from './cloud';

/** Stages the signed-in user may open. `'all'` = no restriction (local mode, supervisors). */
export type OpenStages = 'all' | string[];
export type OpenStageReader = () => Promise<OpenStages>;

/**
 * A student's stages are the rows of cohort_stages for their cohort (row level
 * security allows no others). A failed read throws: the caller shows an error
 * and never treats "could not read" as "open".
 */
export function createOpenStageReader(
  client: Pick<SupabaseClient, 'from'>,
  profile: { role: 'student' | 'supervisor'; cohortId: string | null },
): OpenStageReader {
  return async () => {
    if (profile.role === 'supervisor') return 'all';
    if (!profile.cohortId) return [];
    const cohortId = profile.cohortId;
    const rows = await fetchAll((from, to) =>
      client.from('cohort_stages').select('stage').eq('cohort_id', cohortId)
        .order('created_at', { ascending: true }).order('id', { ascending: true })
        .range(from, to) as unknown as PromiseLike<Result>,
    );
    return rows.map((r) => String(r.stage));
  };
}

/** Local mode has no cohorts: every stage is open. */
export const OpenStagesContext = createContext<OpenStageReader>(async () => 'all');
export const useOpenStageReader = () => useContext(OpenStagesContext);

/** foundations is open for everyone; any other stage needs to be on the list. */
export const stageIsOpen = (open: OpenStages, stage: string): boolean =>
  stage === DEFAULT_STAGE || open === 'all' || open.includes(stage);
