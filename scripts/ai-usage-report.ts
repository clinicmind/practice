/**
 * Offline: compares real AI use with the cost document's low / mid / high scenarios.
 *
 *   npx tsx scripts/ai-usage-report.ts ai_usage.csv
 *
 * The CSV is an export of the `ai_usage` table from the Supabase SQL Editor (the owner downloads it; see docs/SETUP-ai.md).
 * Needed columns: kind, input_tokens, output_tokens, cache_write_tokens, cache_read_tokens, cost_usd, outcome, created_at.
 * The table has no text column, so there is no student content here. Makes no network request.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { summarizeUsage, type UsageRow } from '../src/supervisor/aiUsage';
import { loadDrillStats, practiceRequestCost, SCENARIOS } from './estimate-ai-cost';

/** Minimal CSV reader: commas, double-quoted fields with "" for a quote. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length > 0) { row.push(field); if (row.some((f) => f !== '')) rows.push(row); }
  const [head, ...body] = rows;
  if (!head) return [];
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), r[i] ?? ''])));
}

const KINDS = ['practice', 'report_draft', 'eval'] as const;
const OUTCOMES = ['ok', 'invalid', 'refusal', 'error', 'blocked'] as const;

export function toUsageRows(csv: Record<string, string>[]): UsageRow[] {
  return csv.map((r, i) => {
    const kind = r.kind as UsageRow['kind'], outcome = r.outcome as UsageRow['outcome'];
    if (!KINDS.includes(kind) || !OUTCOMES.includes(outcome)) throw new Error(`row ${i + 2}: unknown kind or outcome`);
    return {
      kind, outcome, createdAt: r.created_at ?? '',
      inputTokens: Number(r.input_tokens), outputTokens: Number(r.output_tokens),
      cacheWriteTokens: Number(r.cache_write_tokens), cacheReadTokens: Number(r.cache_read_tokens), costUsd: Number(r.cost_usd),
    };
  });
}

export type Comparison = { name: 'low' | 'mid' | 'high'; perRequestUsd: number };
export type UsageReport = { markdown: string; aboveHigh: boolean };

/** `perRequest` is the cost document's practice cost per request for each scenario (with caching). */
export function buildReport(rows: UsageRow[], perRequest: Comparison[]): UsageReport {
  const s = summarizeUsage(rows);
  const high = perRequest.find((p) => p.name === 'high')!;
  const aboveHigh = s.avgPracticeCostUsd !== null && s.avgPracticeCostUsd > high.perRequestUsd;
  const f = (n: number | null, d = 5) => (n === null ? '–' : n.toFixed(d));
  const pct = (n: number | null) => (n === null ? '–' : `${(n * 100).toFixed(0)}%`);
  const lines = [
    '| Measure | Value |', '|---|---|',
    `| Calls | ${s.calls} (practice ${s.byKind.practice}, report draft ${s.byKind.report_draft}, eval ${s.byKind.eval}) |`,
    `| Total cost | US$${s.spent.toFixed(4)} |`,
    `| Average cost of a kept practice call | US$${f(s.avgPracticeCostUsd)} |`,
    `| Cache hit rate | ${pct(s.cacheHitRate)} |`,
    `| Discarded (invalid, refusal, error) | ${pct(s.discardedRate)} |`,
    '', '| Scenario | Cost document, per practice call (cached) | Actual average vs this |', '|---|---|---|',
    ...perRequest.map((p) => `| ${p.name} | US$${p.perRequestUsd.toFixed(5)} | ${s.avgPracticeCostUsd === null ? '–' : `${(s.avgPracticeCostUsd / p.perRequestUsd).toFixed(2)}x`} |`),
  ];
  if (aboveHigh) lines.push('', `**Above the high scenario** (US$${high.perRequestUsd.toFixed(5)}): stop and ask the owner before opening more (plan T16 step 4).`);
  return { markdown: lines.join('\n'), aboveHigh };
}

function main(): void {
  const file = process.argv[2];
  if (!file) { console.error('usage: npx tsx scripts/ai-usage-report.ts ai_usage.csv'); process.exit(1); }
  const rows = toUsageRows(parseCsv(readFileSync(file, 'utf8')));
  const contentDir = resolve(process.cwd(), 'content');
  const perRequest = Object.values(SCENARIOS).map((sc) => ({ name: sc.name, perRequestUsd: practiceRequestCost(loadDrillStats(contentDir, sc.locale), sc, true) }));
  console.log(buildReport(rows, perRequest).markdown);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
