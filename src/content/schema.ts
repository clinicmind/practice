import { z } from 'zod';

export const LEVELS = ['easy', 'medium', 'hard'] as const;
export const LevelSchema = z.enum(LEVELS);
export type Level = z.infer<typeof LevelSchema>;

const text = z.string().trim().min(1);

export const DrillSchema = z
  .object({
    id: text,
    level: LevelSchema,
    skill: text,
    context: text,
    client: text,
    criteria: z.tuple([text, text, text]),
  })
  .strict();
export type Drill = z.infer<typeof DrillSchema>;

export const ModelSchema = z
  .object({ model_response: text, why: text, avoid: text })
  .strict();
export type Model = z.infer<typeof ModelSchema>;

export const TurnSchema = z
  .object({
    id: text,
    speaker: z.enum(['therapist', 'client']),
    text,
  })
  .strict();
export type Turn = z.infer<typeof TurnSchema>;

export const OptionSchema = z
  .object({
    id: text,
    text,
    fit: z.enum(['strong', 'workable', 'weak']),
    note: text,
  })
  .strict();
export type Option = z.infer<typeof OptionSchema>;

export const DecisionPointSchema = z
  .object({
    id: text,
    type: z.enum(['choice', 'free']),
    prompt: text,
    options: z.array(OptionSchema).optional(),
    actual: text,
    rationale: text,
  })
  .strict()
  .superRefine((d, ctx) => {
    if (d.type === 'choice') {
      const opts = d.options ?? [];
      if (opts.length !== 3) {
        ctx.addIssue({
          code: 'custom',
          path: ['options'],
          message: `decision "${d.id}": expected 3 options, got ${opts.length}`,
        });
      } else if (!opts.some((o) => o.fit === 'strong')) {
        ctx.addIssue({
          code: 'custom',
          path: ['options'],
          message: `decision "${d.id}": needs at least one option with fit "strong"`,
        });
      }
      if (new Set(opts.map((o) => o.id)).size !== opts.length) {
        ctx.addIssue({
          code: 'custom',
          path: ['options'],
          message: `decision "${d.id}": duplicate option id`,
        });
      }
    } else if (d.options !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['options'],
        message: `decision "${d.id}": free decisions must not have options`,
      });
    }
  });
export type DecisionPoint = z.infer<typeof DecisionPointSchema>;

/** A turn is a decision point exactly when it carries a `type` field. */
export function isDecision(t: Turn | DecisionPoint): t is DecisionPoint {
  return 'type' in t;
}

const TurnOrDecisionSchema = z.unknown().transform((v, ctx) => {
  const schema =
    v !== null && typeof v === 'object' && 'type' in v ? DecisionPointSchema : TurnSchema;
  const r = schema.safeParse(v);
  if (!r.success) {
    for (const issue of r.error.issues) ctx.addIssue(issue);
    return z.NEVER;
  }
  return r.data as Turn | DecisionPoint;
}) as unknown as z.ZodType<Turn | DecisionPoint, z.ZodTypeDef, unknown>;

export const SessionSchema = z
  .object({
    id: text,
    title: text,
    turns: z.array(TurnOrDecisionSchema).min(1),
    notes: z.object({ goals: text, alliance: text, formulation_update: text }).strict(),
  })
  .strict()
  .superRefine((s, ctx) => {
    if (!s.turns.some(isDecision)) {
      ctx.addIssue({
        code: 'custom',
        path: ['turns'],
        message: `session "${s.id}": needs at least one decision point`,
      });
    }
    const seen = new Set<string>();
    for (const t of s.turns) {
      if (seen.has(t.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['turns'],
          message: `session "${s.id}": duplicate id "${t.id}"`,
        });
      }
      seen.add(t.id);
    }
  });
export type Session = z.infer<typeof SessionSchema>;

export const ModuleMetaSchema = z
  .object({
    slug: text,
    title: text,
    version: z.string().regex(/^\d+\.\d+\.\d+$/, 'version must be semver (x.y.z)'),
    intro: text,
    skills: z.tuple([text, text]),
    reflection_prompts: z.array(z.object({ id: text, text }).strict()).min(1),
  })
  .strict();
export type ModuleMeta = z.infer<typeof ModuleMetaSchema>;

export const ModuleBundleSchema = z.object({
  meta: ModuleMetaSchema,
  sessions: z.array(SessionSchema),
  drills: z.array(DrillSchema),
});
export type ModuleBundle = z.infer<typeof ModuleBundleSchema>;

export const StageIndexSchema = z.object({
  stage: text,
  title: text,
  modules: z.array(z.object({ slug: text, title: text, reviewed: z.boolean() })),
});
export type StageIndex = z.infer<typeof StageIndexSchema>;

/** stage.yaml as authored: ordered module slugs. */
export const StageFileSchema = z
  .object({ stage: text, title: text, modules: z.array(text) })
  .strict();

export const DrillsFileSchema = z.array(DrillSchema);
export const ModelsFileSchema = z.record(text, ModelSchema);
export const WalkthroughFileSchema = z
  .object({ sessions: z.array(SessionSchema).min(1) })
  .strict();
