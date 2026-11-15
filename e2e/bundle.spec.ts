import { expect, test } from '@playwright/test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Runs against the bundle the webServer just built. Needs no backend.
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}

test('built bundle contains no service role key', () => {
  const all = files('dist');
  expect(all.length).toBeGreaterThan(0);
  for (const f of all.filter((p) => /\.(js|html|css|json|map)$/.test(p))) {
    const text = readFileSync(f, 'utf8');
    expect(text, f).not.toMatch(/service_role/i);
    expect(text, f).not.toMatch(/E2E_SUPABASE_SERVICE_KEY/);
  }
  // An actual service-role JWT would carry this claim, base64-encoded: {"role":"service_role"
  const b64 = Buffer.from('"role":"service_role"').toString('base64').slice(0, 20);
  for (const f of all.filter((p) => p.endsWith('.js'))) expect(readFileSync(f, 'utf8'), f).not.toContain(b64);
});
