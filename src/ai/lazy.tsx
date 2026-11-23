import { lazy } from 'react';

/**
 * AI feedback screens are loaded only in builds that switch the feature on (VITE_AI_ENABLED, or the end-to-end
 * stand-in build), and in tests. In the normal production build this is a build-time `false`, so the bundler drops
 * the dynamic imports below and the screens are not part of the shipped files at all.
 */
export const AI_IN_BUILD: boolean =
  import.meta.env.VITE_AI_ENABLED === 'true' || import.meta.env.VITE_AI_FAKE_API === 'true' || import.meta.env.MODE === 'test';

export const LazyAiFeedbackPanel = AI_IN_BUILD
  ? lazy(() => import('../components/AiFeedbackPanel').then((m) => ({ default: m.AiFeedbackPanel })))
  : null;
export const LazyAiCohortPanel = AI_IN_BUILD
  ? lazy(() => import('../routes/supervisor/AiCohortPanel').then((m) => ({ default: m.AiCohortPanel })))
  : null;
export const LazyAiUsagePanel = AI_IN_BUILD
  ? lazy(() => import('../supervisor/AiUsagePanel').then((m) => ({ default: m.AiUsagePanel })))
  : null;
