import { DIMENSIONS, type DriveStatus, type FeedbackRecord, type ReportsApi, type Scores, type SubmitResult } from './ReportsContext';

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
  /** The signed-in user's id, used to sign feedback (the database checks it against the token). */
  getUserId?: () => Promise<string | null>;
  fetch?: typeof fetch;
};

type FeedbackRow = { id: string; scores: Scores; comments: string; status: 'draft' | 'released'; released_at: string | null };
const FEEDBACK_COLS = 'id,scores,comments,status,released_at';
const toFeedback = (r: FeedbackRow): FeedbackRecord => ({ id: r.id, scores: r.scores ?? {}, comments: r.comments, status: r.status, releasedAt: r.released_at });
const DRIVE_STATES: readonly string[] = ['ok', 'auth', 'quota', 'unavailable', 'not_configured'];

export function createCloudReportsApi(deps: CloudDeps): ReportsApi {
  const doFetch = (u: string, i: RequestInit) => (deps.fetch ?? fetch)(u, i);
  const headers = (token: string): Record<string, string> => ({ apikey: deps.anonKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });

  /** One call to the function. Returns the parsed body too; a body that is not JSON becomes {}. */
  async function fn(token: string, payload: Record<string, unknown>) {
    const res = await doFetch(`${deps.url}/functions/v1/reports`, { method: 'POST', headers: headers(token), body: JSON.stringify(payload) });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { res, body };
  }

  const api: ReportsApi = {
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

    async releasedFeedback(reportId) {
      const token = await deps.getToken();
      if (!token) throw new Error('not signed in');
      const res = await doFetch(`${deps.url}/rest/v1/feedback?report_id=eq.${encodeURIComponent(reportId)}&status=eq.released&select=${FEEDBACK_COLS}&order=released_at.desc&limit=1`, { headers: headers(token) });
      if (!res.ok) throw new Error(`feedback failed (${res.status})`);
      const rows = (await res.json()) as FeedbackRow[];
      return rows[0] ? toFeedback(rows[0]) : null;
    },

    async listForReview() {
      const token = await deps.getToken();
      if (!token) throw new Error('not signed in');
      const [rep, prof] = await Promise.all([
        doFetch(`${deps.url}/rest/v1/reports?select=id,title,created_at,status,delete_after,user_id,deid_summary&order=created_at.desc`, { headers: headers(token) }),
        doFetch(`${deps.url}/rest/v1/profiles?select=id,display_name&role=eq.student`, { headers: headers(token) }),
      ]);
      if (!rep.ok || !prof.ok) throw new Error('review list failed');
      const names = new Map(((await prof.json()) as { id: string; display_name: string }[]).map((p) => [p.id, p.display_name]));
      const rows = (await rep.json()) as { id: string; title: string; created_at: string; status: 'submitted' | 'reviewed'; delete_after: string; user_id: string; deid_summary: Record<string, { found?: number }> | null }[];
      return rows.map((r) => ({
        id: r.id, title: r.title, createdAt: r.created_at, studentName: names.get(r.user_id) ?? '', status: r.status, deleteAfter: r.delete_after,
        summary: Object.fromEntries(Object.entries(r.deid_summary ?? {}).map(([rule, v]) => [rule, { found: Number(v?.found ?? 0) }])),
      }));
    },

    async myFeedback(reportId) {
      const token = await deps.getToken();
      if (!token) throw new Error('not signed in');
      const res = await doFetch(`${deps.url}/rest/v1/feedback?report_id=eq.${encodeURIComponent(reportId)}&select=${FEEDBACK_COLS}&order=created_at.desc&limit=1`, { headers: headers(token) });
      if (!res.ok) throw new Error(`feedback failed (${res.status})`);
      const rows = (await res.json()) as FeedbackRow[];
      return rows[0] ? toFeedback(rows[0]) : null;
    },

    async saveFeedback(reportId, input, release) {
      try {
        const token = await deps.getToken();
        const me = await deps.getUserId?.();
        if (!token || !me) return { ok: false };
        const scores = Object.fromEntries(DIMENSIONS.flatMap((d) => (input.scores[d] === undefined ? [] : [[d, input.scores[d]]])));
        const existing = await api.myFeedback(reportId);
        const wantRelease = release && existing?.status !== 'released'; // an already released review keeps its status and time
        const res = existing
          ? await doFetch(`${deps.url}/rest/v1/feedback?id=eq.${encodeURIComponent(existing.id)}`, {
              method: 'PATCH',
              headers: { ...headers(token), Prefer: 'return=representation' },
              body: JSON.stringify({ scores, comments: input.comments, ...(wantRelease ? { status: 'released', released_at: new Date().toISOString() } : {}) }),
            })
          : await doFetch(`${deps.url}/rest/v1/feedback`, {
              method: 'POST',
              headers: { ...headers(token), Prefer: 'return=representation' },
              body: JSON.stringify({ report_id: reportId, author_id: me, scores, comments: input.comments, ...(release ? { status: 'released', released_at: new Date().toISOString() } : {}) }),
            });
        if (!res.ok) return { ok: false };
        const row = ((await res.json().catch(() => [])) as FeedbackRow[])[0];
        return row ? { ok: true, record: toFeedback(row) } : { ok: false };
      } catch {
        return { ok: false };
      }
    },

    async purgeExpired() {
      const token = await deps.getToken();
      if (!token) return { ok: false, status: 401 };
      const { res, body } = await fn(token, { action: 'purge' });
      if (!res.ok || typeof body.purged !== 'number') return { ok: false, status: res.status };
      return { ok: true, purged: body.purged, failed: Number(body.failed ?? 0), more: body.more === true, driveError: typeof body.driveError === 'string' ? body.driveError : null };
    },

    async driveStatus(): Promise<DriveStatus | 'error'> {
      const token = await deps.getToken();
      if (!token) return 'error';
      const { res, body } = await fn(token, { action: 'drive_status' });
      return res.ok && typeof body.status === 'string' && DRIVE_STATES.includes(body.status) ? (body.status as DriveStatus) : 'error';
    },
  };
  return api;
}
