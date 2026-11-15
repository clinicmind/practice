import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stringify } from 'yaml';

export interface FixtureModule {
  slug: string;
  title: string;
  skills: [string, string];
}

export const FIXTURE_MODULES: FixtureModule[] = [
  { slug: 'intake', title: 'Intake (fixture)', skills: ['open-question', 'restatement'] },
  { slug: 'alliance', title: 'Alliance (fixture)', skills: ['reflection-of-feeling', 'validation'] },
];

export const FIXTURE_VERSION = '1.0.0';
const LEVEL_CODE = { easy: 'e', medium: 'm', hard: 'h' } as const;

/** Deterministic fixture drills for one module: 3 levels x 10, 5 per skill per level. */
export function makeDrills(m: FixtureModule) {
  const drills: Record<string, unknown>[] = [];
  for (const level of ['easy', 'medium', 'hard'] as const) {
    for (let i = 1; i <= 10; i++) {
      const id = `${m.slug}-${LEVEL_CODE[level]}${String(i).padStart(2, '0')}`;
      drills.push({
        id,
        level,
        skill: m.skills[i % 2],
        context: `Fixture context for ${id}.`,
        client: `Fixture client statement for ${id}.`,
        criteria: [`${id} criterion one`, `${id} criterion two`, `${id} criterion three`],
      });
    }
  }
  return drills;
}

export function makeModels(m: FixtureModule) {
  const models: Record<string, unknown> = {};
  for (const d of makeDrills(m)) {
    const id = d.id as string;
    models[id] = {
      model_response: `Fixture demonstration for ${id}.`,
      why: `Fixture reason for ${id}.`,
      avoid: `Fixture pitfall for ${id}.`,
    };
  }
  return models;
}

export function makeWalkthrough(m: FixtureModule) {
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

export function makeModuleYaml(m: FixtureModule) {
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

/** Writes a complete, valid content tree to `dir`. `reviewed` = slugs registered in REVIEW.md. */
export function writeFixture(dir: string, reviewed: string[]) {
  const stage = join(dir, 'en', 'stages', 'foundations');
  w(join(stage, 'stage.yaml'), {
    stage: 'foundations',
    title: 'Foundations (fixture)',
    modules: FIXTURE_MODULES.map((m) => m.slug),
  });
  for (const m of FIXTURE_MODULES) {
    w(join(stage, m.slug, 'module.yaml'), makeModuleYaml(m));
    w(join(stage, m.slug, 'walkthrough.yaml'), makeWalkthrough(m));
    w(join(stage, m.slug, 'drills.yaml'), makeDrills(m));
    w(join(stage, m.slug, 'models.yaml'), makeModels(m));
  }
  const rows = reviewed.map((s) => `| ${s} | en | ${FIXTURE_VERSION} | 2026-01-01 |`);
  writeFileSync(
    join(dir, 'REVIEW.md'),
    ['# Review', '', '| slug | locale | version | reviewed_on |', '|---|---|---|---|', ...rows, ''].join('\n'),
  );
}
