import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stringify } from 'yaml';

export type FixtureLocale = 'en' | 'zh-Hant';

export interface FixtureModule {
  slug: string;
  title: string;
  skills: [string, string];
}

export const FIXTURE_MODULES: FixtureModule[] = [
  { slug: 'intake', title: 'Intake (fixture)', skills: ['open-question', 'restatement'] },
  { slug: 'alliance', title: 'Alliance (fixture)', skills: ['reflection-of-feeling', 'validation'] },
];

/** A second stage with one module, for multi-stage tests. Slug and skills carry the stage prefix, as the build requires. */
export const DEMO_STAGE = 'demo';
export const DEMO_MODULE: FixtureModule = { slug: 'demo-intro', title: 'Demo intro (fixture)', skills: ['demo-skill-a', 'demo-skill-b'] };

export const FIXTURE_VERSION = '1.0.0';
const LEVEL_CODE = { easy: 'e', medium: 'm', hard: 'h' } as const;

/** Deterministic fixture drills for one module: 3 levels x 10, 5 per skill per level. */
export function makeDrills(m: FixtureModule, loc: FixtureLocale = 'en') {
  const drills: Record<string, unknown>[] = [];
  for (const level of ['easy', 'medium', 'hard'] as const) {
    for (let i = 1; i <= 10; i++) {
      const id = `${m.slug}-${LEVEL_CODE[level]}${String(i).padStart(2, '0')}`;
      drills.push({
        id,
        level,
        skill: m.skills[i % 2],
        context: loc === 'en' ? `Fixture context for ${id}.` : `測試用情境（${id}）。`,
        client: loc === 'en' ? `Fixture client statement for ${id}.` : `測試用個案說的話（${id}）。`,
        criteria: loc === 'en'
          ? [`${id} criterion one`, `${id} criterion two`, `${id} criterion three`]
          : [`${id} 標準一`, `${id} 標準二`, `${id} 標準三`],
      });
    }
  }
  return drills;
}

export function makeModels(m: FixtureModule, loc: FixtureLocale = 'en') {
  const models: Record<string, unknown> = {};
  for (const d of makeDrills(m)) {
    const id = d.id as string;
    models[id] = loc === 'en'
      ? {
          model_response: `Fixture demonstration for ${id}.`,
          why: `Fixture reason for ${id}.`,
          avoid: `Fixture pitfall for ${id}.`,
        }
      : {
          model_response: `測試用示範回應（${id}）。`,
          why: `測試用原因（${id}）。`,
          avoid: `測試用失誤（${id}）。`,
        };
  }
  return models;
}

export function makeWalkthrough(m: FixtureModule, loc: FixtureLocale = 'en') {
  if (loc === 'zh-Hant') return makeWalkthroughZh(m);
  const s = `${m.slug}-s1`;
  return {
    sessions: [
      {
        id: s,
        title: 'Session 1',
        turns: [
          { id: 't1', speaker: 'therapist', text: `Welcome (${m.slug}).` },
          { id: 't2', speaker: 'client', text: 'I am not sure where to start.' },
          {
            id: 'd1',
            type: 'choice',
            prompt: 'What would you say next?',
            options: [
              { id: 'a', text: 'Option A text', fit: 'strong', note: 'Why A fits.' },
              { id: 'b', text: 'Option B text', fit: 'workable', note: 'Why B is workable.' },
              { id: 'c', text: 'Option C text', fit: 'weak', note: 'Why C is weak.' },
            ],
            actual: 'What the therapist actually said (d1).',
            rationale: 'Rationale for d1.',
          },
          { id: 't3', speaker: 'client', text: 'It has been a hard few weeks.' },
          {
            id: 'd2',
            type: 'free',
            prompt: 'Write your own response.',
            actual: 'What the therapist actually said (d2).',
            rationale: 'Rationale for d2.',
          },
          { id: 't4', speaker: 'therapist', text: 'Thank you for telling me.' },
        ],
        notes: {
          goals: `Goals note (${m.slug}).`,
          alliance: `Alliance note (${m.slug}).`,
          formulation_update: `Formulation note (${m.slug}).`,
        },
      },
    ],
  };
}

function makeWalkthroughZh(m: FixtureModule) {
  return {
    sessions: [
      {
        id: `${m.slug}-s1`,
        title: '第一次會談',
        turns: [
          { id: 't1', speaker: 'therapist', text: `歡迎你來（${m.slug}）。` },
          { id: 't2', speaker: 'client', text: '我不知道從哪裡開始。' },
          {
            id: 'd1',
            type: 'choice',
            prompt: '你接下來會說什麼？',
            options: [
              { id: 'a', text: '選項 A 的內容', fit: 'strong', note: 'A 為什麼貼切。' },
              { id: 'b', text: '選項 B 的內容', fit: 'workable', note: 'B 為什麼可行。' },
              { id: 'c', text: '選項 C 的內容', fit: 'weak', note: 'C 為什麼不貼切。' },
            ],
            actual: '治療師實際說的話（d1）。',
            rationale: 'd1 的原因。',
          },
          { id: 't3', speaker: 'client', text: '這幾個星期很辛苦。' },
          {
            id: 'd2',
            type: 'free',
            prompt: '寫下你自己的回應。',
            actual: '治療師實際說的話（d2）。',
            rationale: 'd2 的原因。',
          },
          { id: 't4', speaker: 'therapist', text: '謝謝你告訴我。' },
        ],
        notes: {
          goals: `目標筆記（${m.slug}）。`,
          alliance: `治療聯盟筆記（${m.slug}）。`,
          formulation_update: `個案概念化筆記（${m.slug}）。`,
        },
      },
    ],
  };
}

export function makeModuleYaml(m: FixtureModule, loc: FixtureLocale = 'en') {
  if (loc === 'zh-Hant') {
    return {
      slug: m.slug,
      title: `${m.title.replace(' (fixture)', '')}（測試）`,
      version: FIXTURE_VERSION,
      intro: `${m.slug} 模組的簡介。`,
      skills: m.skills,
      reflection_prompts: [
        { id: 'r1', text: '這個模組中，什麼讓你印象最深？' },
        { id: 'r2', text: '你接下來會試什麼？' },
      ],
    };
  }
  return {
    slug: m.slug,
    title: m.title,
    version: FIXTURE_VERSION,
    intro: `Intro for ${m.title}.`,
    skills: m.skills,
    reflection_prompts: [
      { id: 'r1', text: 'What stood out for you in this module?' },
      { id: 'r2', text: 'What will you try next?' },
    ],
  };
}

function w(file: string, data: unknown) {
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, stringify(data));
}

/** Writes the module files of one locale under `stage`. */
export function writeModule(stage: string, m: FixtureModule, loc: FixtureLocale) {
  w(join(stage, m.slug, 'module.yaml'), makeModuleYaml(m, loc));
  w(join(stage, m.slug, 'walkthrough.yaml'), makeWalkthrough(m, loc));
  w(join(stage, m.slug, 'drills.yaml'), makeDrills(m, loc));
  w(join(stage, m.slug, 'models.yaml'), makeModels(m, loc));
}

/**
 * Writes a complete, valid content tree to `dir`. `reviewed` = English slugs registered in REVIEW.md.
 * `zh` = slugs that also get a zh-Hant module; `zhReviewed` = the subset registered as reviewed in zh-Hant.
 */
export function writeFixture(
  dir: string,
  reviewed: string[],
  zh: { present: string[]; reviewed: string[] } = { present: [], reviewed: [] },
  opts: { demoStage?: boolean } = {},
) {
  const stage = join(dir, 'en', 'stages', 'foundations');
  w(join(stage, 'stage.yaml'), {
    stage: 'foundations',
    title: 'Foundations (fixture)',
    modules: FIXTURE_MODULES.map((m) => m.slug),
  });
  for (const m of FIXTURE_MODULES) writeModule(stage, m, 'en');
  if (zh.present.length) {
    const zhStage = join(dir, 'zh-Hant', 'stages', 'foundations');
    w(join(zhStage, 'stage.yaml'), { stage: 'foundations', title: '基礎（測試）', modules: zh.present });
    for (const m of FIXTURE_MODULES.filter((x) => zh.present.includes(x.slug))) writeModule(zhStage, m, 'zh-Hant');
  }
  if (opts.demoStage) {
    const enDemo = join(dir, 'en', 'stages', DEMO_STAGE);
    w(join(enDemo, 'stage.yaml'), { stage: DEMO_STAGE, title: 'Demo stage (fixture)', modules: [DEMO_MODULE.slug] });
    writeModule(enDemo, DEMO_MODULE, 'en');
    const zhDemo = join(dir, 'zh-Hant', 'stages', DEMO_STAGE);
    w(join(zhDemo, 'stage.yaml'), { stage: DEMO_STAGE, title: '示範階段（測試）', modules: [DEMO_MODULE.slug] });
    writeModule(zhDemo, DEMO_MODULE, 'zh-Hant');
    reviewed = [...reviewed, DEMO_MODULE.slug];
    zh = { ...zh, reviewed: [...zh.reviewed, DEMO_MODULE.slug] };
  }
  const rows = [
    ...reviewed.map((s) => `| ${s} | en | ${FIXTURE_VERSION} | 2026-01-01 |`),
    ...zh.reviewed.map((s) => `| ${s} | zh-Hant | ${FIXTURE_VERSION} | 2026-01-01 |`),
  ];
  writeFileSync(
    join(dir, 'REVIEW.md'),
    ['# Review', '', '| slug | locale | version | reviewed_on |', '|---|---|---|---|', ...rows, ''].join('\n'),
  );
}
