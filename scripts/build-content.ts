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
  type ModuleMeta,
  type Session,
  type ModuleBundle,
  type StageIndex,
} from '../src/content/schema';

export type Locale = 'en' | 'zh-Hant';
export const LOCALES: readonly Locale[] = ['en', 'zh-Hant'];

export interface BuildOptions {
  contentDir: string;
  outDir: string;
  locale: Locale;
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

type ModuleFiles = {
  meta: ModuleMeta;
  wt: { sessions: Session[] };
  drills: Drill[];
  models: Record<string, unknown>;
};

/** Parts of a zh-Hant module that must be identical to the English module (spec: translate text only). */
function compareToEnglish(slug: string, en: ModuleFiles, zh: ModuleFiles, errors: string[]) {
  const at = (file: string, msg: string) => errors.push(`zh-Hant ${slug}/${file}: ${msg}`);
  const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

  if (!same(zh.meta.skills, en.meta.skills)) {
    at('module.yaml', `skills [${zh.meta.skills.join(', ')}] differ from English [${en.meta.skills.join(', ')}]`);
  }
  const zp = zh.meta.reflection_prompts.map((p) => p.id);
  const ep = en.meta.reflection_prompts.map((p) => p.id);
  if (!same(zp, ep)) at('module.yaml', `reflection prompt ids [${zp.join(', ')}] differ from English [${ep.join(', ')}]`);

  const enDrill = new Map(en.drills.map((d) => [d.id, d]));
  const zhDrill = new Map(zh.drills.map((d) => [d.id, d]));
  for (const id of enDrill.keys()) if (!zhDrill.has(id)) at('drills.yaml', `drill "${id}" exists in English but not in zh-Hant`);
  for (const [id, d] of zhDrill) {
    const e = enDrill.get(id);
    if (!e) { at('drills.yaml', `drill "${id}" does not exist in English`); continue; }
    if (d.level !== e.level) at('drills.yaml', `drill "${id}": level "${d.level}" differs from English "${e.level}"`);
    if (d.skill !== e.skill) at('drills.yaml', `drill "${id}": skill "${d.skill}" differs from English "${e.skill}"`);
  }

  const enSession = new Map(en.wt.sessions.map((x) => [x.id, x]));
  const zhSession = new Map(zh.wt.sessions.map((x) => [x.id, x]));
  for (const id of enSession.keys()) if (!zhSession.has(id)) at('walkthrough.yaml', `session "${id}" exists in English but not in zh-Hant`);
  for (const [sid, zs] of zhSession) {
    const es = enSession.get(sid);
    if (!es) { at('walkthrough.yaml', `session "${sid}" does not exist in English`); continue; }
    const zTurns = zs.turns.map((t) => t.id);
    const eTurns = es.turns.map((t) => t.id);
    if (!same(zTurns, eTurns)) {
      for (const id of eTurns) if (!zTurns.includes(id)) at('walkthrough.yaml', `session "${sid}": "${id}" exists in English but not in zh-Hant (or is out of order)`);
      for (const id of zTurns) if (!eTurns.includes(id)) at('walkthrough.yaml', `session "${sid}": "${id}" does not exist in English`);
      if (zTurns.length === eTurns.length && zTurns.every((id) => eTurns.includes(id))) {
        at('walkthrough.yaml', `session "${sid}": turn order [${zTurns.join(', ')}] differs from English [${eTurns.join(', ')}]`);
      }
      continue;
    }
    es.turns.forEach((et, i) => {
      const zt = zs.turns[i];
      if (isDecision(et) !== isDecision(zt)) {
        at('walkthrough.yaml', `session "${sid}": "${et.id}" is ${isDecision(zt) ? 'a decision point' : 'not a decision point'} but English is ${isDecision(et) ? 'a decision point' : 'not'}`);
        return;
      }
      if (!isDecision(et) || !isDecision(zt)) {
        if (!isDecision(et) && !isDecision(zt) && et.speaker !== zt.speaker) {
          at('walkthrough.yaml', `session "${sid}": turn "${et.id}" speaker "${zt.speaker}" differs from English "${et.speaker}"`);
        }
        return;
      }
      if (zt.type !== et.type) {
        at('walkthrough.yaml', `session "${sid}": decision "${et.id}" type "${zt.type}" differs from English "${et.type}"`);
        return;
      }
      const eo = et.options ?? [];
      const zo = zt.options ?? [];
      if (!same(zo.map((o) => o.id), eo.map((o) => o.id))) {
        at('walkthrough.yaml', `session "${sid}": decision "${et.id}": option ids [${zo.map((o) => o.id).join(', ')}] differ from English [${eo.map((o) => o.id).join(', ')}]`);
        return;
      }
      eo.forEach((o, k) => {
        if (zo[k].fit !== o.fit) {
          at('walkthrough.yaml', `session "${sid}": decision "${et.id}": option "${o.id}" fit "${zo[k].fit}" differs from English "${o.fit}"`);
        }
      });
    });
  }
}

function loadModuleFiles(dir: string, slug: string, tag: string, errors: string[]): ModuleFiles | undefined {
  const before = errors.length;
  const meta = load(join(dir, 'module.yaml'), `${tag}${slug}/module.yaml`, ModuleMetaSchema, errors);
  const wt = load(join(dir, 'walkthrough.yaml'), `${tag}${slug}/walkthrough.yaml`, WalkthroughFileSchema, errors);
  const drills = load(join(dir, 'drills.yaml'), `${tag}${slug}/drills.yaml`, DrillsFileSchema, errors);
  const models = load(join(dir, 'models.yaml'), `${tag}${slug}/models.yaml`, ModelsFileSchema, errors);
  if (errors.length > before || !meta || !wt || !drills || !models) return undefined;
  return { meta, wt, drills, models };
}

export async function buildContent(opts: BuildOptions): Promise<void> {
  const { contentDir, outDir, locale } = opts;
  const isEn = locale === 'en';
  const tag = isEn ? '' : `${locale} `;
  const stageDir = join(contentDir, locale, 'stages', STAGE);
  const enStageDir = join(contentDir, 'en', 'stages', STAGE);
  const outStage = join(outDir, locale, STAGE);
  const errors: string[] = [];

  // Always start from a clean output so stale modules never linger.
  rmSync(outStage, { recursive: true, force: true });
  mkdirSync(outStage, { recursive: true });

  // zh-Hant may be absent, partial or complete; English is the reference for structure.
  const stageFile = join(stageDir, 'stage.yaml');
  let enStage: { title: string; modules: string[] } | undefined;
  if (!isEn && existsSync(join(enStageDir, 'stage.yaml'))) {
    enStage = load(join(enStageDir, 'stage.yaml'), 'stage.yaml', StageFileSchema, []);
  }

  let stageTitle = 'Foundations';
  let slugs: string[] = [];
  if (isEn) {
    // No stage authored yet: valid, produces an empty module list.
    if (!existsSync(stageFile)) {
      const empty: StageIndex = { stage: STAGE, title: stageTitle, modules: [] };
      writeFileSync(join(outStage, 'index.json'), JSON.stringify(empty, null, 2));
      return;
    }
    const stage = load(stageFile, 'stage.yaml', StageFileSchema, errors);
    stageTitle = stage?.title ?? stageTitle;
    slugs = stage?.modules ?? [];
    if (new Set(slugs).size !== slugs.length) errors.push('stage.yaml: duplicate module slug');
  } else {
    if (existsSync(stageFile)) {
      const stage = load(stageFile, `${tag}stage.yaml`, StageFileSchema, errors);
      stageTitle = stage?.title ?? stageTitle;
      for (const m of stage?.modules ?? []) {
        if (enStage && !enStage.modules.includes(m)) errors.push(`${tag}stage.yaml: module "${m}" does not exist in English`);
      }
    } else if (enStage) {
      stageTitle = enStage.title;
    }
    // Course order is English's. A module counts as present when its directory has files.
    const present = (slug: string) => existsSync(join(stageDir, slug)) && readdirSync(join(stageDir, slug)).length > 0;
    slugs = (enStage?.modules ?? []).filter(present);
    if (existsSync(stageDir)) {
      for (const e of readdirSync(stageDir, { withFileTypes: true })) {
        if (e.isDirectory() && !(enStage?.modules ?? []).includes(e.name)) {
          errors.push(`${tag}module "${e.name}" has no English counterpart in stage.yaml`);
        }
      }
    }
  }

  const reviewed = readReviewed(contentDir);
  const index: StageIndex = { stage: STAGE, title: stageTitle, modules: [] };
  const emit: { slug: string; bundle: ModuleBundle; models: unknown; reviewed: boolean }[] = [];
  const sessionIds = new Set<string>();
  const drillIds = new Set<string>();

  for (const slug of slugs) {
    const dir = join(stageDir, slug);
    if (!existsSync(dir) || !readdirSync(dir).length) {
      errors.push(`stage.yaml: module "${slug}" listed but directory not found`);
      continue;
    }
    const files = loadModuleFiles(dir, slug, tag, errors);
    if (!files) continue;
    const { meta, wt, drills, models } = files;

    if (meta.slug !== slug) {
      errors.push(`${tag}${slug}/module.yaml: slug "${meta.slug}" does not match directory "${slug}"`);
      continue;
    }
    const promptIds = meta.reflection_prompts.map((p) => p.id);
    if (new Set(promptIds).size !== promptIds.length) errors.push(`${tag}${slug}: duplicate reflection prompt id`);

    checkDrills(slug, meta.skills, drills, errors);
    for (const d of drills) {
      if (drillIds.has(d.id)) errors.push(`duplicate id "${d.id}" (also used in another module)`);
      drillIds.add(d.id);
    }
    // models.yaml must correspond 1:1 with drills.
    const ids = new Set(drills.map((d) => d.id));
    for (const id of ids) {
      if (!(id in models)) errors.push(`${tag}${slug}/models.yaml: no entry for "${id}"`);
    }
    for (const id of Object.keys(models)) {
      if (!ids.has(id)) errors.push(`${tag}${slug}/models.yaml: "${id}" has no drill`);
    }
    for (const s of wt.sessions) {
      if (!s.id.startsWith(`${slug}-`)) {
        errors.push(`${tag}${slug}: session id "${s.id}" does not belong to module "${slug}"`);
      }
      if (sessionIds.has(s.id)) errors.push(`duplicate id "${s.id}" (session)`);
      sessionIds.add(s.id);
      // schema already enforces decision shape; touch isDecision to keep the contract explicit
      void s.turns.filter(isDecision);
    }

    if (!isEn) {
      // Compare with the English module of the same slug; if English itself is broken, its own build reports that.
      const enFiles = loadModuleFiles(join(enStageDir, slug), slug, 'en ', []);
      if (enFiles) compareToEnglish(slug, enFiles, files, errors);
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
  // Printed in the deploy log so the project owner can see which mode a build produced.
  // The Supabase variables are read at build time: they must be build variables, and a new build must run after they change.
  const cloud = Boolean(process.env.VITE_SUPABASE_URL && process.env.VITE_SUPABASE_ANON_KEY);
  console.log(cloud
    ? '[mode] CLOUD: Supabase build variables found. The site will ask users to sign in.'
    : '[mode] LOCAL: no Supabase build variables. The site will run without sign-in.');
  (async () => {
    const base = {
      contentDir: resolve(process.env.CONTENT_DIR ?? 'content'),
      outDir: resolve(process.env.OUT_DIR ?? 'public/content'),
      includeUnreviewed: process.env.INCLUDE_UNREVIEWED === '1',
    };
    // Build every language; collect failures so one message names them all.
    const failures: string[] = [];
    for (const locale of LOCALES) {
      try {
        await buildContent({ ...base, locale });
      } catch (e) {
        failures.push(`[${locale}] ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (failures.length) {
      console.error(failures.join('\n'));
      process.exit(1);
    }
  })();
}
