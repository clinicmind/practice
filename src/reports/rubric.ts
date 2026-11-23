import { DIMENSIONS, type Dimension, type Score } from './ReportsContext';

/**
 * The report rubric has six dimensions with four levels each (spec §9). The wording of the levels
 * lives in the i18n files under `reportsReview.rubric`. It is a DRAFT: the owner has not reviewed
 * it. Flip this to true only after the owner approves the wording in both languages; until then the
 * supervisor screens say so. It lives here, not in content/, so it is not part of the content review file.
 */
export const RUBRIC_REVIEWED = false;

export const SCORES: readonly Score[] = [1, 2, 3, 4];
export { DIMENSIONS };
export type { Dimension };

/** A release needs all six scores and a comment; the database enforces the same rule. */
export function canRelease(scores: Partial<Record<Dimension, number>>, comments: string): boolean {
  return DIMENSIONS.every((d) => scores[d] !== undefined) && comments.trim().length > 0;
}
