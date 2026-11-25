import { lazy } from 'react';

/**
 * The extras screens are loaded only in builds that switch them on (VITE_PRACTICE_EXTRAS), and in tests.
 * In the normal production build this is a build-time `false`, so the bundler drops the dynamic imports
 * below and none of the extras code is part of the shipped files.
 */
export const EXTRAS_IN_BUILD: boolean =
  import.meta.env.VITE_PRACTICE_EXTRAS === 'true' || import.meta.env.MODE === 'test';

export const LazyReviseOnce = EXTRAS_IN_BUILD
  ? lazy(() => import('./ReviseOnce').then((m) => ({ default: m.ReviseOnce })))
  : null;
export const LazyPrepPage = EXTRAS_IN_BUILD
  ? lazy(() => import('./PrepPage').then((m) => ({ default: m.PrepPage })))
  : null;
export const LazyReviewPage = EXTRAS_IN_BUILD
  ? lazy(() => import('./ReviewPage').then((m) => ({ default: m.ReviewPage })))
  : null;
export const LazyHomeCards = EXTRAS_IN_BUILD
  ? lazy(() => import('./HomeCards').then((m) => ({ default: m.HomeCards })))
  : null;
