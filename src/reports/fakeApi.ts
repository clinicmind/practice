import { scanHigh } from '../../packages/deid/src';
import { defaultReportsApi, type ReportsApi } from './ReportsContext';

/**
 * Stand-in for the real backend, used only by the end-to-end build (VITE_REPORTS_FAKE_API=true).
 * It refuses high-level findings the way the server will, and keeps accepted reports in memory.
 */
export const FAKE_API_MARKER = 'e2e-fake-reports-api';

export function createFakeApi(): ReportsApi {
  const store = new Map<string, { title: string; body: string }>();
  return {
    ...defaultReportsApi, // no supervisor in the stand-in: review is covered by unit tests
    async submit({ title, body }) {
      const high = scanHigh(body);
      if (high.length > 0) return { ok: false, status: 422, findings: high.map(({ rule, start, end }) => ({ rule, start, end })) };
      const id = `${FAKE_API_MARKER}-${store.size + 1}`;
      store.set(id, { title, body });
      return { ok: true, id };
    },
    async list() { return [...store].map(([id, r]) => ({ id, title: r.title, createdAt: '2026-01-01T00:00:00Z' })); },
    async get(id) { const r = store.get(id); return r ? { ok: true, ...r } : { ok: false, status: 404 }; },
    async remove(id) { return store.delete(id); },
  };
}
