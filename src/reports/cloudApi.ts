import type { ReportsApi, SubmitResult } from './ReportsContext';

/**
 * The real backend for the report screens: the `reports` Edge Function for submit, get and delete,
 * and the reports table (through row level security) for the list. Only loaded when the build turns
 * reports on, so the normal build does not contain it.
 *
 * The student's own session token is sent, never a service key. The anon key is the public one.
 */
export type CloudDeps = {
  url: string;
  anonKey: string;
  getToken: () => Promise<string | null>;
  fetch?: typeof fetch;
};

export function createCloudReportsApi(deps: CloudDeps): ReportsApi {
  const doFetch = (u: string, i: RequestInit) => (deps.fetch ?? fetch)(u, i);
  const headers = (token: string): Record<string, string> => ({ apikey: deps.anonKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });

  /** One call to the function. Returns the parsed body too; a body that is not JSON becomes {}. */
  async function fn(token: string, payload: Record<string, unknown>) {
    const res = await doFetch(`${deps.url}/functions/v1/reports`, { method: 'POST', headers: headers(token), body: JSON.stringify(payload) });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { res, body };
  }

  return {
    async submit({ title, body }): Promise<SubmitResult> {
      const token = await deps.getToken();
      if (!token) return { ok: false, status: 401, message: 'unauthorized', code: 'unauthorized' };
      const { res, body: out } = await fn(token, { action: 'submit', title, body });
      if (res.status === 201 && typeof out.id === 'string') return { ok: true, id: out.id };
      if (res.status === 422 && Array.isArray(out.findings)) return { ok: false, status: 422, findings: out.findings as { rule: string; start: number; end: number }[] };
      const code = typeof out.error === 'string' ? out.error : undefined;
      return { ok: false, status: res.status, message: code ?? 'error', ...(code ? { code } : {}) };
    },

    async list() {
      const token = await deps.getToken();
      if (!token) throw new Error('not signed in');
      const res = await doFetch(`${deps.url}/rest/v1/reports?select=id,title,created_at&order=created_at.desc`, { headers: headers(token) });
      if (!res.ok) throw new Error(`list failed (${res.status})`);
      const rows = (await res.json()) as { id: string; title: string; created_at: string }[];
      return rows.map((r) => ({ id: r.id, title: r.title, createdAt: r.created_at }));
    },

    async get(id) {
      const token = await deps.getToken();
      if (!token) return { ok: false, status: 401 };
      const { res, body } = await fn(token, { action: 'get', id });
      if (res.ok && typeof body.title === 'string' && typeof body.body === 'string') return { ok: true, title: body.title, body: body.body };
      return { ok: false, status: res.status };
    },

    async remove(id) {
      const token = await deps.getToken();
      if (!token) return false;
      const { res } = await fn(token, { action: 'delete', id });
      return res.ok || res.status === 404; // already gone is as good as deleted
    },
  };
}
