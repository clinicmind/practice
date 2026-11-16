import type { ZodType } from 'zod';
import { z } from 'zod';
import {
  ModelsFileSchema,
  ModuleBundleSchema,
  StageIndexSchema,
  StageListSchema,
  type Model,
  type ModuleBundle,
  type StageIndex,
  type StageListItem,
} from './schema';

export class ContentLoadError extends Error {
  constructor(message: string, readonly url: string) {
    super(message);
    this.name = 'ContentLoadError';
  }
}

export type ContentLocale = 'en' | 'zh-Hant';
import { DEFAULT_STAGE } from '../stages';
const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;
const cache = new Map<string, Promise<unknown>>();

export function resetContentCache() {
  cache.clear();
}

function base(): string {
  const b = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';
  return b.endsWith('/') ? b : `${b}/`;
}

/** Fetches, validates and caches; failures are not cached so a retry can succeed. */
function load<T>(locale: ContentLocale, path: string, schema: ZodType<T, z.ZodTypeDef, unknown>): Promise<T> {
  const url = `${base()}content/${locale}/${path}`;
  const hit = cache.get(url);
  if (hit) return hit as Promise<T>;
  const p = (async () => {
    let res: Response;
    try {
      res = await fetch(url);
    } catch {
      throw new ContentLoadError('Network error while loading content', url);
    }
    if (!res.ok) throw new ContentLoadError(`Content request failed (${res.status})`, url);
    let raw: unknown;
    try {
      raw = await res.json();
    } catch {
      throw new ContentLoadError('Content was not valid JSON', url);
    }
    const parsed = schema.safeParse(raw);
    if (!parsed.success) throw new ContentLoadError('Content had an unexpected shape', url);
    return parsed.data;
  })();
  cache.set(url, p);
  p.catch(() => cache.delete(url));
  return p;
}

function checkSlug(slug: string) {
  if (!SLUG_RE.test(slug)) throw new ContentLoadError('Invalid module name', slug);
}
function checkStage(stage: string) {
  if (!SLUG_RE.test(stage)) throw new ContentLoadError('Invalid stage name', stage);
}

/** Every stage this build ships, foundations first. */
export const loadStages = (locale: ContentLocale = 'en'): Promise<StageListItem[]> => load(locale, 'stages.json', StageListSchema);

export async function loadStage(locale: ContentLocale = 'en', stage: string = DEFAULT_STAGE): Promise<StageIndex> {
  checkStage(stage);
  return load(locale, `${stage}/index.json`, StageIndexSchema);
}

export async function loadModule(slug: string, locale: ContentLocale = 'en', stage: string = DEFAULT_STAGE): Promise<ModuleBundle> {
  checkSlug(slug);
  checkStage(stage);
  return load(locale, `${stage}/${slug}/module.json`, ModuleBundleSchema);
}

/** Only call once the learner has saved an attempt for the item (spec §3.1). */
export async function loadModels(slug: string, locale: ContentLocale = 'en', stage: string = DEFAULT_STAGE): Promise<Record<string, Model>> {
  checkSlug(slug);
  checkStage(stage);
  return load(locale, `${stage}/${slug}/models.json`, ModelsFileSchema);
}
