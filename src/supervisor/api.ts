import { loadModule, loadStage } from '../content/client';
import { LEVELS, type Level, type ModuleBundle, type StageIndex } from '../content/schema';
import type { Backend } from '../auth/supabase';
import { fetchAll, run, type Result, type Row } from '../progress/cloud';
import { levelPassed, walkthroughDone } from '../progress/rules';
import { toAttempt, toDecision, toReflection } from '../progress/supabaseStore';
import type { Attempt, Decision, Reflection } from '../progress/types';

export type ModuleProgress = { walkthroughDone: boolean; passed: Level[] };
export type StudentSummary = {
  id: string;
  displayName: string;
  cohortId: string | null;
  lastActiveAt: string | null;
  /** Only modules whose content is available in this build. */
  modules: Record<string, ModuleProgress>;
};
export type StudentDetail = {
  id: string;
  displayName: string;
  cohortId: string | null;
  lastActiveAt: string | null;
  attempts: Attempt[];
  decisions: Decision[];
  reflections: Reflection[];
  grants: { moduleSlug: string; level: Level }[];
};
export type CohortInfo = { id: string; name: string; inviteCode: string; termEnd: string };
export type Course = { stage: StageIndex; bundles: Record<string, ModuleBundle> };

/** Every module whose content this build ships. A missing unreviewed module is expected; a missing reviewed one is an error. */
export async function loadCourse(): Promise<Course> {
  const stage = await loadStage();
  const loaded = await Promise.all(
    stage.modules.map(async (m) => {
      try {
        return await loadModule(m.slug);
      } catch (e) {
        if (m.reviewed) throw e;
        return null;
      }
    }),
  );
  const bundles: Record<string, ModuleBundle> = {};
  stage.modules.forEach((m, i) => { const b = loaded[i]; if (b) bundles[m.slug] = b; });
  return { stage, bundles };
}

export function progressOf(attempts: Attempt[], decisions: Decision[], bundles: Record<string, ModuleBundle>): Record<string, ModuleProgress> {
  const out: Record<string, ModuleProgress> = {};
  for (const [slug, b] of Object.entries(bundles)) {
    out[slug] = {
      walkthroughDone: walkthroughDone(decisions, b.sessions),
      passed: LEVELS.filter((lv) => levelPassed(attempts, b.drills, lv)),
    };
  }
  return out;
}

const latest = (...times: (string | undefined)[]): string | null =>
  times.reduce<string | null>((m, t) => (t && (m === null || t > m) ? t : m), null);
const group = <T extends { userId: string }>(xs: T[]) => {
  const m = new Map<string, T[]>();
  for (const x of xs) m.set(x.userId, [...(m.get(x.userId) ?? []), x]);
  return m;
};

const ordered = (q: { order(c: string, o: { ascending: boolean }): any }, ...cols: string[]) => // eslint-disable-line @typescript-eslint/no-explicit-any
  cols.reduce((acc, c) => acc.order(c, { ascending: true }), q);

/**
 * What the supervisor dashboard reads and writes. Row level security decides
 * which students come back; nothing here checks authorisation.
 * Differs from the plan's flat functions only in taking the client (and the
 * supervisor's id, for `granted_by`) so tests can inject a fake.
 */
export function createSupervisorApi(client: Backend, supervisorId: string) {
  const all = (table: string, cols: string, build: (q: any) => any = (q) => q) => // eslint-disable-line @typescript-eslint/no-explicit-any
    fetchAll((from, to) => build(client.from(table).select(cols)).range(from, to) as PromiseLike<Result>);

  return {
    async listCohorts(): Promise<CohortInfo[]> {
      const rows = await all('cohorts', '*', (q) => ordered(q, 'created_at', 'id'));
      return rows.map((r) => ({ id: r.id, name: r.name, inviteCode: r.invite_code, termEnd: r.term_end }));
    },

    async listStudents(): Promise<StudentSummary[]> {
      const [{ bundles }, profiles, attemptRows, decisionRows, activity] = await Promise.all([
        loadCourse(),
        all('profiles', 'id, display_name, cohort_id', (q) => ordered(q.eq('role', 'student'), 'id')),
        all('attempts', '*', (q) => ordered(q, 'created_at', 'id')),
        all('decisions', '*', (q) => ordered(q, 'created_at', 'id')),
        all('student_activity', 'user_id, last_active_at', (q) => ordered(q, 'user_id')),
      ]);
      const attempts = group(attemptRows.map((r: Row) => ({ userId: r.user_id as string, v: toAttempt(r) })));
      const decisions = group(decisionRows.map((r: Row) => ({ userId: r.user_id as string, v: toDecision(r) })));
      const seen = new Map<string, string>(activity.map((r: Row) => [r.user_id as string, new Date(r.last_active_at).toISOString()]));
      return profiles
        .map((p: Row): StudentSummary => ({
          id: p.id,
          displayName: p.display_name,
          cohortId: p.cohort_id,
          lastActiveAt: seen.get(p.id) ?? null,
          modules: progressOf(
            (attempts.get(p.id) ?? []).map((x) => x.v),
            (decisions.get(p.id) ?? []).map((x) => x.v),
            bundles,
          ),
        }))
        .sort((a, b) => a.displayName.localeCompare(b.displayName) || a.id.localeCompare(b.id));
    },

    /** null when the student does not exist or is not in a cohort this supervisor runs. */
    async getStudent(id: string): Promise<StudentDetail | null> {
      const profile = (await run(() =>
        client.from('profiles').select('id, display_name, cohort_id').eq('id', id).eq('role', 'student').maybeSingle() as unknown as PromiseLike<Result>,
      )) as Row | null;
      if (!profile) return null;
      const mine = (q: any) => ordered(q.eq('user_id', id), 'created_at', 'id'); // eslint-disable-line @typescript-eslint/no-explicit-any
      const [a, d, r, g] = await Promise.all([
        all('attempts', '*', mine), all('decisions', '*', mine), all('reflections', '*', mine), all('unlocks', '*', mine),
      ]);
      const attempts = a.map(toAttempt), decisions = d.map(toDecision), reflections = r.map(toReflection);
      return {
        id: profile.id,
        displayName: profile.display_name,
        cohortId: profile.cohort_id,
        lastActiveAt: latest(...attempts.map((x) => x.createdAt), ...decisions.map((x) => x.createdAt), ...reflections.map((x) => x.createdAt)),
        attempts, decisions, reflections,
        grants: g
          .filter((x) => (LEVELS as readonly string[]).includes(x.level))
          .map((x) => ({ moduleSlug: x.module_slug as string, level: x.level as Level })),
      };
    },

    async grantUnlock(studentId: string, moduleSlug: string, level: Level): Promise<void> {
      await run(() =>
        client.from('unlocks').upsert(
          { user_id: studentId, module_slug: moduleSlug, level, granted_by: supervisorId },
          { onConflict: 'user_id,module_slug,level', ignoreDuplicates: true },
        ) as unknown as PromiseLike<Result>,
      );
    },

    async createCohort(name: string, termEnd: string): Promise<{ id: string; inviteCode: string }> {
      const data = (await run(() =>
        client.rpc('create_cohort', { name, term_end: termEnd }) as unknown as PromiseLike<Result>,
      )) as Row[] | Row | null;
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) throw new Error('create_cohort returned nothing');
      return { id: row.id, inviteCode: row.invite_code };
    },
  };
}

export type SupervisorApi = ReturnType<typeof createSupervisorApi>;
