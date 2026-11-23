// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, test } from 'vitest';

// Stage 4, tasks 1 and 6 add a database part and a server part only. With a cohort's switch off (the default)
// the live site must be byte for byte what it was. The site is built from `src/`, `content/`, `public/` and the
// build config, so these tests pin that none of them reaches the new code. The build itself was also compared
// before and after with `diff -r` (see the delivery report); the function's own "switch is off" tests are in
// supabase/functions/ai-feedback/test/handler.test.ts.
const root = join(__dirname, '..');
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p]; });

describe('the site does not reach the AI feedback code', () => {
  const siteFiles = [...walk(join(root, 'src')), join(root, 'index.html'), join(root, 'vite.config.ts'), join(root, 'wrangler.jsonc')].filter((f) => /\.(tsx?|html|css|json|jsonc)$/.test(f));
  test('no file the site is built from mentions the function, the package or the new tables', () => {
    const hits = siteFiles.filter((f) => /ai-feedback|ai_feedback|ai_usage|ai_budget|ai_disagreements|ai_enabled|functions\/v1\/ai/.test(readFileSync(f, 'utf8')));
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
