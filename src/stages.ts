import { useParams } from 'react-router-dom';

/** The original stage: always open, and where old bookmarks (/m/:slug) lead. */
export const DEFAULT_STAGE = 'foundations';

/** Where a stage lives. */
export const stagePath = (stage: string) => `/s/${stage}`;

/** Where a module (or a page inside it) lives: modulePath('demo', 'demo-intro', 'drills', 'easy'). */
export const modulePath = (stage: string, slug: string, ...rest: string[]) =>
  [stagePath(stage), 'm', slug, ...rest].join('/');

/** The stage of the current route. Routes without one (the home page) mean foundations. */
export function useStageParam(): string {
  return useParams().stage ?? DEFAULT_STAGE;
}
