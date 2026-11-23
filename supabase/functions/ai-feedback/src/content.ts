/**
 * Where the function gets a drill's content: the public, already-published files of the site
 * (`/content/<locale>/<stage>/<module>/module.json` and `models.json`). They are the same files the student
 * sees, and only reviewed modules are published, so this function can never grade against unreviewed text.
 * The requests carry no credentials and nothing about the student.
 *
 * The module is found from the drill id (`alliance-e01` → `alliance`) and the stage by trying each stage in
 * `stages.json`. If the module is not published in the asked-for language, English is used: that is what the
 * student's own screen shows in that case.
 */
import type { Locale } from '../../../../packages/ai-feedback/src';

export type FetchFn = typeof fetch;
export type DrillContent = { locale: Locale; context: string; client: string; criteria: [string, string, string]; modelResponse: string };

const DRILL_ID = /^(.+)-[emh]\d+$/;
const SLUG = /^[a-z0-9][a-z0-9-]*$/;

const isText = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

/** Returns null when the content is not published (404 everywhere); throws on any other failure. */
export async function loadDrill(siteUrl: string, fetchFn: FetchFn, itemId: string, locale: Locale): Promise<DrillContent | null> {
  const slug = DRILL_ID.exec(itemId)?.[1];
  if (!slug || !SLUG.test(slug)) return null;
  const base = siteUrl.replace(/\/+$/, '');
  const get = async (path: string): Promise<unknown | undefined> => {
    const r = await fetchFn(`${base}${path}`);
    if (r.status === 404) return undefined;
    if (!r.ok) throw new Error('content_unavailable');
    return r.json();
  };

  for (const loc of locale === 'en' ? (['en'] as const) : ([locale, 'en'] as const)) {
    const stages = await get(`/content/${loc}/stages.json`);
    if (!Array.isArray(stages)) continue;
    for (const s of stages) {
      const stage = (s as { stage?: unknown } | null)?.stage;
      if (typeof stage !== 'string' || !SLUG.test(stage)) continue;
      const mod = (await get(`/content/${loc}/${stage}/${slug}/module.json`)) as { drills?: unknown } | undefined;
      if (!mod) continue;
      const drill = (Array.isArray(mod.drills) ? mod.drills : []).find((d) => (d as { id?: unknown } | null)?.id === itemId) as
        | { context?: unknown; client?: unknown; criteria?: unknown }
        | undefined;
      const models = (await get(`/content/${loc}/${stage}/${slug}/models.json`)) as Record<string, { model_response?: unknown } | undefined> | undefined;
      const modelResponse = models?.[itemId]?.model_response;
      const c = drill?.criteria;
      if (!drill || !isText(drill.context) || !isText(drill.client) || !Array.isArray(c) || c.length !== 3 || !c.every(isText) || !isText(modelResponse)) continue;
      return { locale: loc, context: drill.context, client: drill.client, criteria: [c[0], c[1], c[2]], modelResponse };
    }
  }
  return null;
}
