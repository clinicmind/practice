import { STORAGE_KEY } from './localStore';
import type { ProgressStore } from './types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Local ids are uuids already; anything else maps to a stable uuid-shaped id. */
export function toClientId(id: string): string {
  if (UUID.test(id)) return id.toLowerCase();
  // 4 x 32-bit FNV-1a-style hashes with different seeds → 128 bits, formatted as a v4-shaped uuid.
  const words = [0x811c9dc5, 0x01000193, 0xdeadbeef, 0x9e3779b9].map((seed) => {
    let h = seed >>> 0;
    for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193) >>> 0;
    return h.toString(16).padStart(8, '0');
  });
  const hex = words.join('');
  const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/**
 * Copies local progress into `remote`, then clears it. Safe to run twice: each
 * record keeps its id as the cloud client_id, so repeats are no-ops. If any
 * record fails, local data is left untouched and the error is rethrown.
 */
export async function importLocal(
  local: ProgressStore,
  remote: ProgressStore,
  storage: Storage,
): Promise<{ attempts: number; decisions: number; reflections: number }> {
  const [attempts, decisions, reflections] = await Promise.all([
    local.listAttempts(), local.listDecisions(), local.listReflections(),
  ]);
  const imported = new Set<string>();

  for (const a of attempts) {
    await remote.saveAttempt({ itemId: a.itemId, response: a.response, criteriaMet: a.criteriaMet, clientId: toClientId(a.id), createdAt: a.createdAt });
    imported.add(a.id);
  }
  for (const d of decisions) {
    await remote.saveDecision({
      sessionId: d.sessionId, decisionId: d.decisionId, optionId: d.optionId, response: d.response,
      clientId: toClientId(d.id), createdAt: d.createdAt,
    });
    imported.add(d.id);
  }
  for (const r of reflections) {
    await remote.saveReflection({ moduleSlug: r.moduleSlug, promptId: r.promptId, text: r.text, clientId: toClientId(r.id), createdAt: r.createdAt });
    imported.add(r.id);
  }

  // Only clear if nothing new arrived locally meanwhile (e.g. another tab).
  const [a2, d2, r2] = await Promise.all([local.listAttempts(), local.listDecisions(), local.listReflections()]);
  if ([...a2, ...d2, ...r2].every((x) => imported.has(x.id))) storage.removeItem(STORAGE_KEY);

  return { attempts: attempts.length, decisions: decisions.length, reflections: reflections.length };
}
