// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, test } from 'vitest';

// Stage 4. Tasks 1 and 6 added a database part and a server part. Tasks 8-10 (the student panel, the supervisor
// views, the usage panel) added site code, and only that code may name the function or the new tables: the list
// below. Everything else must not reach them. With the build switch off (the default) none of that code runs and
// the client for the function is not in the bundle (e2e/ai-feedback.spec.ts checks the built files).
// The function's own "switch is off" tests are in supabase/functions/ai-feedback/test/handler.test.ts.
const root = join(__dirname, '..');
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p]; });

/** The only site files that may name the function or the new tables. Adding one here is a decision, not a habit. */
const ALLOWED = new Set([
  'src/ai/cloudApi.ts', 'src/ai/cloudApi.test.ts', // the student's client for the function (a separate chunk)
  'src/ai/fakeApi.ts',                                // the stand-in used by the end-to-end build only
  'src/ai/fakeBackend.ts',                            // seeded stand-in database, end-to-end build only
  'src/main.tsx',                                     // loads the two above behind build-time switches
  'src/supervisor/api.ts', 'src/supervisor/aiUsage.ts', 'src/supervisor/AiUsagePanel.tsx', // the supervisor's reads
  'src/routes/supervisor/AiSupervisor.test.tsx', 'src/test/fakeDb.ts',
]);

describe('the site does not reach the AI feedback code', () => {
  const siteFiles = [...walk(join(root, 'src')), join(root, 'index.html'), join(root, 'vite.config.ts'), join(root, 'wrangler.jsonc')].filter((f) => /\.(tsx?|html|css|json|jsonc)$/.test(f));
  test('only the listed files mention the function or the new tables', () => {
    const hits = siteFiles.filter((f) => /ai-feedback|ai_feedback|ai_usage|ai_budget|ai_disagreements|ai_enabled|functions\/v1\/ai/.test(readFileSync(f, 'utf8')));
    expect(hits.map((f) => relative(root, f)).filter((f) => !ALLOWED.has(f))).toEqual([]);
  });
  test('the pages and components the production site renders never name them (they go through the context)', () => {
    const rendered = siteFiles.filter((f) => /src\/(routes|components)\//.test(f) && /\.tsx$/.test(f) && !/\.test\./.test(f));
    const hits = rendered.filter((f) => /ai-feedback|ai_feedback|ai_usage|ai_budget|ai_disagreements|ai_enabled|functions\/v1\/ai/.test(readFileSync(f, 'utf8')));
    expect(hits.map((f) => relative(root, f))).toEqual([]);
  });
  test('the site does not import from packages/ai-feedback or supabase/functions', () => {
    const hits = siteFiles.filter((f) => /from ['"][^'"]*(packages\/ai-feedback|supabase\/functions)/.test(readFileSync(f, 'utf8')));
    expect(hits.map((f) => relative(root, f))).toEqual([]);
  });
  test('the page security headers still allow only what they did (no new host)', () => {
    const headers = readFileSync(join(root, 'public', '_headers'), 'utf8');
    expect(headers).not.toMatch(/anthropic/i);
  });
});
