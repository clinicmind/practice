import { loadModule, loadStage, loadStages } from '../content/client';
import { LEVELS, type Level, type ModuleBundle, type StageIndex } from '../content/schema';
import type { Backend } from '../auth/supabase';
import { StoreError } from '../progress/storeError';
import { fetchAll, run, type Result, type Row } from '../progress/cloud';
import { levelPassed, walkthroughDone } from '../progress/rules';
import { toAttempt, toDecision, toReflection } from '../progress/supabaseStore';
import type { AiDisagreement, AiEvaluation } from './aiSummary';
import type { AiBudget, UsageRow } from './aiUsage';
import type { Attempt, Decision, Reflection } from '../progress/types';
import type { CohortAttempt } from './triage';

export type ModuleProgress = { walkthroughDone: boolean; passed: Level[] };
export type StudentSummary = {
  id: string;
  displayName: string;
  cohortId: string | null;
  lastActiveAt: string | null;
  /** When the student's profile was made (joined the cohort). */
  joinedAt: string | null;
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
export type CohortInfo = {
  id: string; name: string; inviteCode: string; termEnd: string;
  /** The owner's switch for AI feedback in this cohort. Off unless the owner turned it on. */
  aiEnabled: boolean;
};
export type CourseStage = { stage: string; title: string; index: StageIndex };
export type Course = {
  /** Every stage this build ships, foundations first. */
  stages: CourseStage[];
  /** Keyed by module slug; slugs are unique across stages. */
  bundles: Record<string, ModuleBundle>;
  /** Which stage each module slug belongs to. */
  stageOf: Record<string, string>;
};

/** Every module of every stage whose content this build ships. A missing unreviewed module is expected; a missing reviewed one is an error. */
export async function loadCourse(): Promise<Course> {
  const list = await loadStages();
  const stages: CourseStage[] = await Promise.all(
    list.map(async (s) => ({ stage: s.stage, title: s.title, index: await loadStage('en', s.stage) })),
  );
  const modules = stages.flatMap((s) => s.index.modules.map((m) => ({ stage: s.stage, m })));
  const loaded = await Promise.all(
    modules.map(async ({ stage, m }) => {
      try {
        return await loadModule(m.slug, 'en', stage);
      } catch (e) {
        if (m.reviewed) throw e;
        return null;
      }
    }),
  );
  const bundles: Record<string, ModuleBundle> = {};
  const stageOf: Record<string, string> = {};
  modules.forEach(({ stage, m }, i) => {
    const b = loaded[i];
    if (b) { bundles[m.slug] = b; stageOf[m.slug] = stage; }
  });
  return { stages, bundles, stageOf };
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
      return rows.map((r) => ({ id: r.id, name: r.name, inviteCode: r.invite_code, termEnd: r.term_end, aiEnabled: r.ai_enabled === true }));
    },

    async listStudents(): Promise<StudentSummary[]> {
      const [{ bundles }, profiles, attemptRows, decisionRows, activity] = await Promise.all([
        loadCourse(),
        all('profiles', 'id, display_name, cohort_id, created_at', (q) => ordered(q.eq('role', 'student'), 'id')),
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
          joinedAt: p.created_at ? new Date(p.created_at).toISOString() : null,
          modules: progressOf(
            (attempts.get(p.id) ?? []).map((x) => x.v),
            (decisions.get(p.id) ?? []).map((x) => x.v),
            bundles,
          ),
        }))
        .sort((a, b) => a.displayName.localeCompare(b.displayName) || a.id.localeCompare(b.id));
    },

    /** Every attempt of every student this supervisor can see, for the "what to look at first" blocks. Row level security limits it to their cohorts. */
    async listCohortAttempts(): Promise<CohortAttempt[]> {
      const rows = await all('attempts', '*', (q) => ordered(q, 'created_at', 'id'));
      return rows.map((r: Row): CohortAttempt => ({ ...toAttempt(r), userId: String(r.user_id) }));
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

    /** Stages (other than foundations) open to this cohort. Throws; a missing table is recognised by isMissingTable. */
    async listOpenStages(cohortId: string): Promise<string[]> {
      const rows = await all('cohort_stages', 'stage', (q) => ordered(q.eq('cohort_id', cohortId), 'created_at', 'id'));
      return rows.map((r: Row) => String(r.stage));
    },

    /** Opening a stage that is already open (another tab, another supervisor) is not a failure. */
    async openStage(cohortId: string, stage: string): Promise<void> {
      try {
        await run(() =>
          client.from('cohort_stages').insert({ cohort_id: cohortId, stage, opened_by: supervisorId }) as unknown as PromiseLike<Result>,
        );
      } catch (e) {
        if (!(e instanceof StoreError && e.code === '23505')) throw e;
      }
    },

    async closeStage(cohortId: string, stage: string): Promise<void> {
      await run(() =>
        client.from('cohort_stages').delete().eq('cohort_id', cohortId).eq('stage', stage) as unknown as PromiseLike<Result>,
      );
    },

    /**
     * Every finished AI check visible to this supervisor, as ids and a flag only: the response text and the
     * quoted words are not read. Only called for cohorts with the AI switch on.
     * The row shape is PostgREST's: `concern` is `output->>concern`, `attempt` is the embedded attempt.
     */
    async listAiEvaluations(): Promise<AiEvaluation[]> {
      const rows = await all('ai_feedback', 'attempt_id, concern:output->>concern, attempt:attempts(user_id, item_id)', (q) => ordered(q.eq('status', 'done'), 'created_at', 'id'));
      return rows.flatMap((r: Row): AiEvaluation[] => {
        const a = Array.isArray(r.attempt) ? r.attempt[0] : r.attempt;
        if (!a) return [];
        const concern = r.concern === 'risk-content' || r.concern === 'off-task' ? r.concern : 'none';
        return [{ attemptId: String(r.attempt_id), userId: String(a.user_id), itemId: String(a.item_id), concern }];
      });
    },

    /** One row per criterion where the student's self-check and the AI differ (the `ai_disagreements` view). */
    async listAiDisagreements(): Promise<AiDisagreement[]> {
      const rows = await all('ai_disagreements', 'attempt_id, user_id, item_id, criterion_index, self_met, ai_met', (q) => ordered(q, 'attempt_id', 'criterion_index'));
      return rows
        .filter((r: Row) => [1, 2, 3].includes(Number(r.criterion_index)) && typeof r.self_met === 'boolean' && typeof r.ai_met === 'boolean')
        .map((r: Row): AiDisagreement => ({
          attemptId: String(r.attempt_id), userId: String(r.user_id), itemId: String(r.item_id),
          criterion: Number(r.criterion_index) as 1 | 2 | 3, selfMet: r.self_met, aiMet: r.ai_met,
        }));
    },

    /** Token counts, money and labels since `sinceIso`. There is no text in this table. */
    async listAiUsage(sinceIso: string): Promise<UsageRow[]> {
      const rows = await all('ai_usage', 'kind, input_tokens, output_tokens, cache_write_tokens, cache_read_tokens, cost_usd, outcome, created_at', (q) => ordered(q.gte('created_at', sinceIso), 'created_at', 'id'));
      return rows.map((r: Row): UsageRow => ({
        kind: r.kind, inputTokens: Number(r.input_tokens), outputTokens: Number(r.output_tokens),
        cacheWriteTokens: Number(r.cache_write_tokens), cacheReadTokens: Number(r.cache_read_tokens),
        costUsd: Number(r.cost_usd), outcome: r.outcome, createdAt: String(r.created_at),
      }));
    },

    /** The monthly budget row, or null when there is none. */
    async getAiBudget(): Promise<AiBudget | null> {
      const row = (await run(() => client.from('ai_budget').select('monthly_limit_usd, warn_at').maybeSingle() as unknown as PromiseLike<Result>)) as Row | null;
      return row ? { monthlyLimitUsd: Number(row.monthly_limit_usd), warnAt: Number(row.warn_at) } : null;
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
