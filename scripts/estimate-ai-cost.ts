/**
 * Offline cost estimate for stage 4 (AI feedback). Makes NO network request and needs NO API key.
 *
 *   npx tsx scripts/estimate-ai-cost.ts          # markdown tables
 *   npx tsx scripts/estimate-ai-cost.ts --json   # same numbers as JSON
 *
 * Token counts are heuristics (see estimateTokens), not the API's own count. Before the owner
 * approves a budget, calibrate once with the free `count_tokens` endpoint (needs an API key).
 * The plan is docs/plans/2026-11-23-ai-feedback-cost.md.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse } from 'yaml';

export type Locale = 'en' | 'zh-Hant';

/** US$ per million tokens. Source: the Claude pricing page, read 2026-11-23. Haiku rates are for prompts <= 100K tokens. */
export const PRICES = {
  checkedOn: '2026-11-23',
  source: 'https://platform.claude.com/docs/en/about-claude/pricing',
  haiku: { model: 'claude-haiku-5-5', input: 0.1, cacheWrite5m: 0.125, cacheRead: 0.01, output: 0.5 },
  sonnet: { model: 'claude-sonnet-5-5', input: 2, cacheWrite5m: 2.5, cacheRead: 0.1, output: 10 },
  /** Batch API: 50% off input and output. Not used here (feedback must be interactive); noted in the plan. */
  batchDiscount: 0.5,
} as const;

/** Assumptions that are not measured from content. Each one is listed in the plan. */
export const ASSUMPTIONS = {
  /** The practice-feedback system prompt does not exist yet. Instructions + JSON schema + delimiter rules. */
  practiceSystemTokens: 1200,
  /** Delimiters and labels wrapped around the per-drill fields. */
  perRequestFramingTokens: 40,
  /** JSON skeleton + suggestion (<= 60 zh chars / 40 en words) + 3 booleans. */
  practiceOutputBaseTokens: 140,
  /** evidence quotes copy part of the student's response. */
  evidenceShareOfResponse: 0.6,
  /** Report-draft system prompt + rubric. */
  reportSystemTokens: 2500,
  students: 30,
  foundationsDrillsPerStudent: 240, // 8 modules x 30
  eftDrillsPerStudent: 180, // 6 modules x 30
  dbtDrillsPerStudent: 180, // 6 modules x 30
} as const;

const CJK = /[⺀-鿿豈-﫿＀-￯　-〿]/;
/** Latin text: ~4 chars per token on older tokenizers; Haiku 5.5 / Sonnet 5.5 use a newer tokenizer that makes ~30% more. */
const LATIN_TOKENS_PER_CHAR = 1.3 / 4;
/** CJK: ~1 token per character on older tokenizers, +30%. */
const CJK_TOKENS_PER_CHAR = 1.3;

export function estimateTokens(text: string): number {
  let cjk = 0;
  let other = 0;
  for (const ch of text) {
    if (CJK.test(ch)) cjk++;
    else other++;
  }
  return Math.ceil(cjk * CJK_TOKENS_PER_CHAR + other * LATIN_TOKENS_PER_CHAR);
}

export interface DrillStats {
  drills: number;
  /** Mean tokens of one drill's own content: context + client + 3 criteria + model response. */
  avgPromptTokens: number;
  /** Mean tokens of the 3 criteria alone (shared by the drills of one skill and level, so cacheable). */
  avgCriteriaTokens: number;
}

interface RawDrill {
  id: string;
  context: string;
  client: string;
  criteria: string[];
}

/** Reads every `drills.yaml` (+ `models.yaml`) under content/<locale>/stages/<stage>/<module>/. */
export function loadDrillStats(contentDir: string, locale: Locale): DrillStats {
  const root = join(contentDir, locale, 'stages');
  let total = 0;
  let criteriaTotal = 0;
  let n = 0;
  if (!existsSync(root)) return { drills: 0, avgPromptTokens: 0, avgCriteriaTokens: 0 };
  for (const stage of readdirSync(root, { withFileTypes: true })) {
    if (!stage.isDirectory()) continue;
    for (const mod of readdirSync(join(root, stage.name), { withFileTypes: true })) {
      if (!mod.isDirectory()) continue;
      const dir = join(root, stage.name, mod.name);
      const drillsFile = join(dir, 'drills.yaml');
      if (!existsSync(drillsFile)) continue;
      const drills = (parse(readFileSync(drillsFile, 'utf8')) ?? []) as RawDrill[];
      const modelsFile = join(dir, 'models.yaml');
      const models = existsSync(modelsFile)
        ? ((parse(readFileSync(modelsFile, 'utf8')) ?? {}) as Record<string, { model_response?: string }>)
        : {};
      for (const d of drills) {
        const criteria = estimateTokens(d.criteria.join('\n'));
        const rest =
          estimateTokens(d.context) + estimateTokens(d.client) + estimateTokens(models[d.id]?.model_response ?? '');
        total += criteria + rest;
        criteriaTotal += criteria;
        n++;
      }
    }
  }
  if (n === 0) return { drills: 0, avgPromptTokens: 0, avgCriteriaTokens: 0 };
  return { drills: n, avgPromptTokens: total / n, avgCriteriaTokens: criteriaTotal / n };
}

export interface Scenario {
  name: 'low' | 'mid' | 'high';
  /** Which locale's content stats to use. */
  locale: Locale;
  /** Share of the 600 drills a student actually submits. The pass rule needs 8 of 10 per level (80%). */
  coverage: number;
  /** Feedback requests per submitted drill (re-tries after the first feedback). */
  attemptsPerDrill: number;
  /** Student response length in tokens. 30-300 zh characters ~ 40-400 tokens. */
  studentTokens: number;
  /** Thinking tokens per practice request. Billed as output. */
  thinkingTokens: number;
  /** Share of requests that read the cached prefix (the rest pay the 5-minute cache write). */
  cacheHitRate: number;
  /** Report draft requests per student over the whole program. */
  reportsPerStudent: number;
  /** Report text sent to the model, in tokens. */
  reportTokens: number;
  /** Draft feedback output including thinking, in tokens. */
  reportOutputTokens: number;
}

export const SCENARIOS: Record<'low' | 'mid' | 'high', Scenario> = {
  low: {
    name: 'low',
    locale: 'en',
    coverage: 0.8,
    attemptsPerDrill: 1,
    studentTokens: 40,
    thinkingTokens: 0,
    cacheHitRate: 0.9,
    reportsPerStudent: 2,
    reportTokens: 4000,
    reportOutputTokens: 1200,
  },
  mid: {
    name: 'mid',
    locale: 'zh-Hant',
    coverage: 1,
    attemptsPerDrill: 1.3,
    studentTokens: 160,
    thinkingTokens: 200,
    cacheHitRate: 0.6,
    reportsPerStudent: 4,
    reportTokens: 8000,
    reportOutputTokens: 2000,
  },
  high: {
    name: 'high',
    locale: 'zh-Hant',
    coverage: 1,
    attemptsPerDrill: 2,
    studentTokens: 400,
    thinkingTokens: 800,
    cacheHitRate: 0.2,
    reportsPerStudent: 8,
    reportTokens: 16000,
    reportOutputTokens: 3500,
  },
};

const M = 1e6;

interface Rates {
  input: number;
  cacheWrite5m: number;
  cacheRead: number;
  output: number;
}

/** Cost of one request. `cachedTokens` is the stable prefix; `hitRate` is the chance it is read from cache. */
function requestCost(
  rates: Rates,
  cachedTokens: number,
  freshTokens: number,
  outputTokens: number,
  hitRate: number,
  useCache: boolean,
): number {
  const prefix = useCache
    ? cachedTokens * (hitRate * rates.cacheRead + (1 - hitRate) * rates.cacheWrite5m)
    : cachedTokens * rates.input;
  return (prefix + freshTokens * rates.input + outputTokens * rates.output) / M;
}

/** US$ for one practice-feedback request on Haiku 5.5. */
export function practiceRequestCost(stats: DrillStats, sc: Scenario, useCache: boolean): number {
  const cached = ASSUMPTIONS.practiceSystemTokens + stats.avgCriteriaTokens;
  const fresh =
    stats.avgPromptTokens - stats.avgCriteriaTokens + ASSUMPTIONS.perRequestFramingTokens + sc.studentTokens;
  const output =
    ASSUMPTIONS.practiceOutputBaseTokens + ASSUMPTIONS.evidenceShareOfResponse * sc.studentTokens + sc.thinkingTokens;
  return requestCost(PRICES.haiku, cached, fresh, output, sc.cacheHitRate, useCache);
}

/** US$ for one report-draft request on Sonnet 5.5. */
export function reportRequestCost(sc: Scenario, useCache: boolean): number {
  return requestCost(
    PRICES.sonnet,
    ASSUMPTIONS.reportSystemTokens,
    sc.reportTokens,
    sc.reportOutputTokens,
    sc.cacheHitRate,
    useCache,
  );
}

export interface ProgramEstimate {
  scenario: Scenario['name'];
  students: number;
  drillsPerStudent: number;
  practiceRequests: number;
  reportRequests: number;
  practiceUsd: number;
  reportUsd: number;
  totalUsd: number;
  totalUsdNoCache: number;
  cacheSavingsPct: number;
  perStudentUsd: number;
}

/**
 * Whole program for one class: 8 foundations modules + EFT + DBT, all submitted.
 * EFT and DBT have no content yet, so they borrow the measured per-drill averages of foundations.
 */
export function estimateProgram(stats: DrillStats, sc: Scenario): ProgramEstimate {
  const a = ASSUMPTIONS;
  const drillsPerStudent = a.foundationsDrillsPerStudent + a.eftDrillsPerStudent + a.dbtDrillsPerStudent;
  const practiceRequests = a.students * drillsPerStudent * sc.coverage * sc.attemptsPerDrill;
  const reportRequests = a.students * sc.reportsPerStudent;
  const practiceUsd = practiceRequests * practiceRequestCost(stats, sc, true);
  const reportUsd = reportRequests * reportRequestCost(sc, true);
  const totalUsd = practiceUsd + reportUsd;
  const totalUsdNoCache =
    practiceRequests * practiceRequestCost(stats, sc, false) + reportRequests * reportRequestCost(sc, false);
  return {
    scenario: sc.name,
    students: a.students,
    drillsPerStudent,
    practiceRequests,
    reportRequests,
    practiceUsd,
    reportUsd,
    totalUsd,
    totalUsdNoCache,
    cacheSavingsPct: ((totalUsdNoCache - totalUsd) / totalUsdNoCache) * 100,
    perStudentUsd: totalUsd / a.students,
  };
}

/** Most one student can cost in one day under the cap of 30 practice feedbacks per day. */
export function dailyCapCeiling(stats: DrillStats, sc: Scenario, dailyCap = 30): number {
  return dailyCap * practiceRequestCost(stats, sc, true);
}

function usd(n: number): string {
  if (n < 1) return `US$${n.toFixed(3)}`;
  return n < 10 ? `US$${n.toFixed(2)}` : `US$${Math.round(n)}`;
}

export function report(contentDir: string): { stats: Record<Locale, DrillStats>; estimates: ProgramEstimate[]; ceilings: Record<string, number> } {
  const stats: Record<Locale, DrillStats> = {
    en: loadDrillStats(contentDir, 'en'),
    'zh-Hant': loadDrillStats(contentDir, 'zh-Hant'),
  };
  const estimates = Object.values(SCENARIOS).map((sc) => estimateProgram(stats[sc.locale], sc));
  const ceilings = Object.fromEntries(
    Object.values(SCENARIOS).map((sc) => [sc.name, dailyCapCeiling(stats[sc.locale], sc)]),
  );
  return { stats, estimates, ceilings };
}

function main(): void {
  const contentDir = resolve(process.cwd(), 'content');
  const { stats, estimates, ceilings } = report(contentDir);
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ prices: PRICES, assumptions: ASSUMPTIONS, scenarios: SCENARIOS, stats, estimates, ceilings }, null, 2));
    return;
  }
  console.log(`Prices checked ${PRICES.checkedOn} (${PRICES.source})\n`);
  console.log('| Locale | Drills | Avg drill content (tokens) | Avg criteria (tokens) |');
  console.log('|---|---|---|---|');
  for (const [loc, s] of Object.entries(stats)) {
    console.log(`| ${loc} | ${s.drills} | ${s.avgPromptTokens.toFixed(0)} | ${s.avgCriteriaTokens.toFixed(0)} |`);
  }
  console.log('\n| Scenario | Practice requests | Report requests | Practice (Haiku 5.5) | Reports (Sonnet 5.5) | Total | Without caching | Caching saves | Per student | Student-day ceiling |');
  console.log('|---|---|---|---|---|---|---|---|---|---|');
  for (const e of estimates) {
    console.log(
      `| ${e.scenario} | ${Math.round(e.practiceRequests)} | ${e.reportRequests} | ${usd(e.practiceUsd)} | ${usd(e.reportUsd)} | ${usd(e.totalUsd)} | ${usd(e.totalUsdNoCache)} | ${e.cacheSavingsPct.toFixed(0)}% | ${usd(e.perStudentUsd)} | ${usd(ceilings[e.scenario])} |`,
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
