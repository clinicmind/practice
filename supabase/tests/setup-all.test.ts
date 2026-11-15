// @vitest-environment node
import { expect, test } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

test('setup-all.sql contains every migration, in order, unchanged', () => {
  const dir = join(__dirname, '..', 'migrations');
  const all = readFileSync(join(__dirname, '..', 'setup-all.sql'), 'utf8');
  let at = 0;
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()) {
    const i = all.indexOf(readFileSync(join(dir, f), 'utf8'), at);
    expect(i, `${f} missing or out of date in setup-all.sql`).toBeGreaterThanOrEqual(at);
    at = i + 1;
  }
});
