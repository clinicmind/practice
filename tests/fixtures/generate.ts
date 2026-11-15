// Regenerates the committed fixtures: `npx tsx tests/fixtures/generate.ts`
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { writeFixture } from './makeContent';

const root = join(dirname(fileURLToPath(import.meta.url)), 'content');
rmSync(root, { recursive: true, force: true });
writeFixture(join(root, 'ok'), ['intake']); // alliance deliberately unreviewed
// Used by e2e and the app tests. zh-Hant: intake is reviewed; alliance is written but not yet reviewed.
writeFixture(join(root, 'ok-reviewed'), ['intake', 'alliance'], { present: ['intake', 'alliance'], reviewed: ['intake'] });
// Two stages (foundations + demo), everything reviewed in both languages. For multi-stage tests; never used by e2e.
writeFixture(join(root, 'multi'), ['intake', 'alliance'], { present: ['intake', 'alliance'], reviewed: ['intake', 'alliance'] }, { demoStage: true });
