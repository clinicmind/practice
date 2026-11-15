// Regenerates the committed fixtures: `npx tsx tests/fixtures/generate.ts`
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { writeFixture } from './makeContent';

const root = join(dirname(fileURLToPath(import.meta.url)), 'content');
rmSync(root, { recursive: true, force: true });
writeFixture(join(root, 'ok'), ['intake']); // alliance deliberately unreviewed
writeFixture(join(root, 'ok-reviewed'), ['intake', 'alliance']); // used by e2e
