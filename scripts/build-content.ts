import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse } from 'yaml';
import type { ZodType } from 'zod';
import {
  DrillsFileSchema,
  LEVELS,
  ModelsFileSchema,
  ModuleMetaSchema,
  StageFileSchema,
  WalkthroughFileSchema,
  isDecision,
  type Drill,
  type ModuleBundle,
  type StageIndex,
} from '../src/content/schema';

export interface BuildOptions {
  contentDir: string;
  outDir: string;
  locale: 'en';
  /** Also emit module.json / models.json for modules not registered in REVIEW.md (authoring preview only). */
  includeUnreviewed?: boolean;
}

const STAGE = 'foundations';
const DRILLS_PER_LEVEL = 10;
const DRILLS_PER_SKILL_PER_LEVEL = 5;
const LEVEL_CODE: Record<string, string> = { easy: 'e', medium: 'm', hard: 'h' };

/** Reads and validates one YAML file; returns parsed data or records errors and returns undefined. */
function load<T>(file: string, label: string, schema: ZodType<T, any, any>, errors: string[]): T | undefined {
  if (!existsSync(file)) {
    errors.push(`${label}: file not found`);
    return undefined;
  }
  let raw: unknown;
  try {
    raw = parse(readFileSync(file, 'utf8'));
  } catch (e) {
    errors.push(`${label}: invalid YAML (${(e as Error).message.split('\n')[0]})`);
    return undefined;
  }
  const r = schema.safeParse(raw);
  if (!r.success) {
    for (const i of r.error.issues) {
      errors.push(`${label}: ${i.path.length ? i.path.join('.') + ': ' : ''}${i.message}`);
    }
    return undefined;
  }
  return r.data;
}

/** REVIEW.md rows: | slug | locale | version | reviewed_on | → set of "slug|locale|version". */
function readReviewed(contentDir: string): Set<string> {
  const file = join(contentDir, 'REVIEW.md');
  const set = new Set<string>();
  if (!existsSync(file)) return set;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim().startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length < 3) continue;
    const [slug, locale, version] = cells;
    if (slug === 'slug' || /^-+$/.test(slug)) continue;
    set.add(`${slug}|${locale}|${version}`);
  }
  return set;
}

function checkDrills(slug: string, skills: string[], drills: Drill[], errors: string[]) {
  const seen = new Set<string>();
  for (const d of drills) {
    if (seen.has(d.id)) errors.push(`${slug}: duplicate id "${d.id}"`);
    seen.add(d.id);
    if (!d.id.startsWith(`${slug}-`)) {
      errors.push(`${slug}: id "${d.id}" does not belong to module "${slug}"`);
    } else if (!new RegExp(`^${slug}-${LEVEL_CODE[d.level]}\\d{2}$`).test(d.id)) {
      errors.push(`${slug}: id "${d.id}" does not match level ${d.level} (expected ${slug}-${LEVEL_CODE[d.level]}NN)`);
    }
    if (!skills.includes(d.skill)) {
      errors.push(`${slug}: ${d.id}: skill "${d.skill}" is not one of the module skills (${skills.join(', ')})`);
    }
  }
  for (const level of LEVELS) {
    const atLevel = drills.filter((d) => d.level === level);
    if (atLevel.length !== DRILLS_PER_LEVEL) {
      errors.push(`${slug}: ${level}: expected ${DRILLS_PER_LEVEL} drills, got ${atLevel.length}`);
    }
    for (const skill of skills) {
      const n = atLevel.filter((d) => d.skill === skill).length;
      if (n !== DRILLS_PER_SKILL_PER_LEVEL) {
        errors.push(`${slug}: skill "${skill}" at level ${level}: expected ${DRILLS_PER_SKILL_PER_LEVEL}, got ${n}`);
      }
    }
  }
}

export async function buildContent(opts: BuildOptions): Promise<void> {
  const { contentDir, outDir, locale } = opts;
  const stageDir = join(contentDir, locale, 'stages', STAGE);
  const outStage = join(outDir, locale, STAGE);
  const errors: string[] = [];

  // Always start from a clean output so stale modules never linger.
  rmSync(outStage, { recursive: true, force: true });
  mkdirSync(outStage, { recursive: true });

  // No stage authored yet: valid, produces an empty module list.
  if (!existsSync(join(stageDir, 'stage.yaml'))) {
    const empty: StageIndex = { stage: STAGE, title: 'Foundations', modules: [] };
    writeFileSync(join(outStage, 'index.json'), JSON.stringify(empty, null, 2));
    return;
  }

  const stage = load(join(stageDir, 'stage.yaml'), 'stage.yaml', StageFileSchema, errors);
  const reviewed = readReviewed(contentDir);
  const index: StageIndex = { stage: STAGE, title: stage?.title ?? 'Foundations', modules: [] };
  const emit: { slug: string; bundle: ModuleBundle; models: unknown; reviewed: boolean }[] = [];

  const slugs = stage?.modules ?? [];
  if (new Set(slugs).size !== slugs.length) errors.push('stage.yaml: duplicate module slug');
  const sessionIds = new Set<string>();
  const drillIds = new Set<string>();

  for (const slug of slugs) {
    const dir = join(stageDir, slug);
    if (!existsSync(dir) || !readdirSync(dir).length) {
      errors.push(`stage.yaml: module "${slug}" listed but directory not found`);
      continue;
    }
    const before = errors.length;
    const meta = load(join(dir, 'module.yaml'), `${slug}/module.yaml`, ModuleMetaSchema, errors);
    const wt = load(join(dir, 'walkthrough.yaml'), `${slug}/walkthrough.yaml`, WalkthroughFileSchema, errors);
    const drills = load(join(dir, 'drills.yaml'), `${slug}/drills.yaml`, DrillsFileSchema, errors);
    const models = load(join(dir, 'models.yaml'), `${slug}/models.yaml`, ModelsFileSchema, errors);
    if (errors.length > before || !meta || !wt || !drills || !models) continue;

    if (meta.slug !== slug) {
      errors.push(`${slug}/module.yaml: slug "${meta.slug}" does not match directory "${slug}"`);
      continue;
    }
    const promptIds = meta.reflection_prompts.map((p) => p.id);
    if (new Set(promptIds).size !== promptIds.length) errors.push(`${slug}: duplicate reflection prompt id`);

    checkDrills(slug, meta.skills, drills, errors);
    for (const d of drills) {
      if (drillIds.has(d.id)) errors.push(`duplicate id "${d.id}" (also used in another module)`);
      drillIds.add(d.id);
    }
    // models.yaml must correspond 1:1 with drills.
    const ids = new Set(drills.map((d) => d.id));
    for (const id of ids) {
      if (!(id in models)) errors.push(`${slug}/models.yaml: no entry for "${id}"`);
    }
    for (const id of Object.keys(models)) {
      if (!ids.has(id)) errors.push(`${slug}/models.yaml: "${id}" has no drill`);
    }
    for (const s of wt.sessions) {
      if (!s.id.startsWith(`${slug}-`)) {
        errors.push(`${slug}: session id "${s.id}" does not belong to module "${slug}"`);
      }
      if (sessionIds.has(s.id)) errors.push(`duplicate id "${s.id}" (session)`);
      sessionIds.add(s.id);
      // schema already enforces decision shape; touch isDecision to keep the contract explicit
      void s.turns.filter(isDecision);
    }

    const isReviewed = reviewed.has(`${slug}|${locale}|${meta.version}`);
    index.modules.push({ slug, title: meta.title, reviewed: isReviewed });
    emit.push({
      slug,
      bundle: { meta, sessions: wt.sessions, drills },
      models,
      reviewed: isReviewed,
    });
  }

  if (errors.length) {
    throw new Error(`Content validation failed:\n${errors.map((e) => `  - ${e}`).join('\n')}`);
  }

  writeFileSync(join(outStage, 'index.json'), JSON.stringify(index, null, 2));
  for (const m of emit) {
    if (!m.reviewed && !opts.includeUnreviewed) continue;
    const out = join(outStage, m.slug);
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, 'module.json'), JSON.stringify(m.bundle));
    writeFileSync(join(out, 'models.json'), JSON.stringify(m.models));
  }
}

// CLI: `npm run content`. CONTENT_DIR / OUT_DIR / INCLUDE_UNREVIEWED=1 override defaults.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  buildContent({
    contentDir: resolve(process.env.CONTENT_DIR ?? 'content'),
    outDir: resolve(process.env.OUT_DIR ?? 'public/content'),
    locale: 'en',
    includeUnreviewed: process.env.INCLUDE_UNREVIEWED === '1',
  }).catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
