export type Draft = { response: string; ticks: boolean[] };

const key = (itemId: string) => `cm.draft.${itemId}`;

/** Unsaved answers live in sessionStorage so they survive a sign-in round trip. */
export function loadDraft(itemId: string): Draft | null {
  try {
    const raw = sessionStorage.getItem(key(itemId));
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<Draft>;
    if (typeof v.response !== 'string' || !Array.isArray(v.ticks) || v.ticks.length !== 3 || !v.ticks.every((t) => typeof t === 'boolean')) return null;
    return { response: v.response, ticks: v.ticks };
  } catch {
    return null;
  }
}

export function saveDraft(itemId: string, draft: Draft): void {
  try { sessionStorage.setItem(key(itemId), JSON.stringify(draft)); } catch { /* best effort */ }
}

export function clearDraft(itemId: string): void {
  try { sessionStorage.removeItem(key(itemId)); } catch { /* best effort */ }
}
