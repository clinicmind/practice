/**
 * A stand-in for Supabase (auth, PostgREST) and Google (OAuth, Drive), as one `fetch`.
 * It models only the calls the function makes. Row level security is modelled by `visible`:
 * the real rules are tested against Postgres in supabase/tests/reports.test.ts.
 * All data is fictional.
 */
export type Calls = { url: string; method: string; headers: Record<string, string>; body: string }[];

export const ENV = {
  SUPABASE_URL: 'https://proj.supabase.test',
  SUPABASE_ANON_KEY: 'anon-key-fiction',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key-fiction',
  GOOGLE_CLIENT_ID: 'client-id-fiction',
  GOOGLE_CLIENT_SECRET: 'client-secret-fiction',
  GOOGLE_REFRESH_TOKEN: 'refresh-token-fiction',
};

export const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const S1 = id(1), A = id(11), B = id(12), X = id(21), SUP_OTHER = id(2);
export const C1 = id(101), C2 = id(102);
export const TOKENS: Record<string, string> = { 'tok-A': A, 'tok-B': B, 'tok-X': X, 'tok-S1': S1, 'tok-S2': SUP_OTHER };

type Report = { id: string; user_id: string; title: string; drive_file_id: string; deid_summary: unknown; status: string; created_at: string; delete_after: string };

export class FakeBackend {
  calls: Calls = [];
  reports: Report[] = [];
  audit: { actor_id: string; action: string; target_id: string; created_at: string }[] = [];
  files = new Map<string, { name: string; parent: string; text: string; trashed: boolean }>();
  folders: { id: string; name: string; parent: string | null }[] = [];
  profiles: Record<string, { role: string; cohort_id: string | null }> = {
    [A]: { role: 'student', cohort_id: C1 }, [B]: { role: 'student', cohort_id: C1 }, [X]: { role: 'student', cohort_id: C2 },
    [S1]: { role: 'supervisor', cohort_id: null }, [SUP_OTHER]: { role: 'supervisor', cohort_id: null },
  };
  cohorts: Record<string, { reports_enabled: boolean; term_end: string; supervisor_id: string }> = {
    [C1]: { reports_enabled: true, term_end: '2027-01-01', supervisor_id: S1 },
    [C2]: { reports_enabled: true, term_end: '2027-01-01', supervisor_id: SUP_OTHER },
  };
  /** Failure switches. */
  drive: { token?: 'invalid_grant' | 'down'; api?: 'down' | 'quota' | '401'; skipWrite?: boolean } = {};
  dbInsertFails = false;
  dbDeleteFails = false;
  now = '2026-11-23T10:00:00.000Z';
  private seq = 0;

  fetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const headers = Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    const body = typeof init.body === 'string' ? init.body : init.body instanceof URLSearchParams ? init.body.toString() : '';
    const method = init.method ?? 'GET';
    this.calls.push({ url: url.href, method, headers, body });
    const json = (status: number, v: unknown) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } });
    if (url.host === 'proj.supabase.test') return this.supabase(url, method, headers, body, json);
    if (url.host === 'oauth2.googleapis.com') return this.token(body, json);
    if (url.host === 'www.googleapis.com') return this.google(url, method, headers, body, json);
    throw new Error(`unexpected host ${url.host}`);
  };

  private supabase(url: URL, method: string, h: Record<string, string>, body: string, json: (s: number, v: unknown) => Response) {
    const bearer = (h.authorization ?? '').replace(/^Bearer /, '');
    if (url.pathname === '/auth/v1/user') {
      const uid = TOKENS[bearer];
      return uid ? json(200, { id: uid }) : json(401, { msg: 'invalid' });
    }
    const asService = bearer === ENV.SUPABASE_SERVICE_ROLE_KEY;
    const uid = asService ? null : TOKENS[bearer];
    if (!asService && !uid) return json(401, { message: 'invalid jwt' });
    const table = url.pathname.replace('/rest/v1/', '');
    const eq = (col: string) => { const v = url.searchParams.get(col); return v?.startsWith('eq.') ? v.slice(3) : undefined; };
    const prefer = h.prefer ?? '';
    if (table === 'profiles' && method === 'GET') {
      const p = this.profiles[eq('id') ?? ''];
      return json(200, p ? [p] : []);
    }
    if (table === 'cohorts' && method === 'GET') {
      const c = this.cohorts[eq('id') ?? ''];
      return json(200, c ? [{ reports_enabled: c.reports_enabled, term_end: c.term_end }] : []);
    }
    if (table === 'audit_log') {
      if (method === 'POST') {
        if (!asService) return json(403, {});
        const r = JSON.parse(body);
        this.audit.push({ ...r, created_at: this.now });
        return new Response(null, { status: 201 });
      }
      const since = url.searchParams.get('created_at')?.replace(/^gte\./, '') ?? '';
      const hit = this.audit.filter((a) => a.actor_id === eq('actor_id') && a.action === eq('action') && a.created_at >= since);
      return json(200, hit.map((a) => ({ id: a.target_id })));
    }
    if (table === 'reports') {
      if (method === 'POST') {
        if (!asService) return json(403, { message: 'permission denied' });
        if (this.dbInsertFails) return json(500, { message: 'boom' });
        const r = JSON.parse(body) as Report;
        this.reports.push({ ...({ status: 'submitted', created_at: this.now } as Partial<Report>), ...r });
        return prefer.includes('return=minimal') ? new Response(null, { status: 201 }) : json(201, [r]);
      }
      if (method === 'GET') {
        // Row level security: a student sees own rows, a supervisor sees their cohort's.
        const visible = (r: Report) => asService || r.user_id === uid || (this.profiles[r.user_id]?.cohort_id != null && this.cohorts[this.profiles[r.user_id]!.cohort_id!]?.supervisor_id === uid);
        // Filters the function uses: id=eq.X, or delete_after=lt.DATE (the purge), and an optional limit.
        const before = url.searchParams.get('delete_after')?.replace(/^lt\./, '');
        const wantId = eq('id');
        let hit = this.reports.filter((r) => visible(r) && (wantId === undefined ? before !== undefined : r.id === wantId) && (before === undefined || r.delete_after < before));
        const limit = Number(url.searchParams.get('limit') ?? NaN);
        if (Number.isFinite(limit)) hit = hit.slice(0, limit);
        return json(200, hit);
      }
      if (method === 'DELETE') {
        if (!asService) return json(403, { message: 'permission denied' });
        if (this.dbDeleteFails) return json(500, { message: 'boom' });
        this.reports = this.reports.filter((r) => r.id !== eq('id'));
        return new Response(null, { status: 204 });
      }
    }
    return json(404, { message: `fake: no route ${method} ${table}` });
  }

  private token(body: string, json: (s: number, v: unknown) => Response) {
    const p = new URLSearchParams(body);
    if (p.get('grant_type') !== 'refresh_token' || p.get('refresh_token') !== ENV.GOOGLE_REFRESH_TOKEN || p.get('client_id') !== ENV.GOOGLE_CLIENT_ID) return json(400, { error: 'invalid_grant' });
    if (this.drive.token === 'invalid_grant') return json(400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' });
    if (this.drive.token === 'down') return json(503, {});
    return json(200, { access_token: 'access-token-fiction', expires_in: 3600, token_type: 'Bearer' });
  }

  private google(url: URL, method: string, h: Record<string, string>, body: string, json: (s: number, v: unknown) => Response) {
    if (h.authorization !== 'Bearer access-token-fiction') return json(401, {});
    if (this.drive.api === '401') return json(401, {});
    if (this.drive.api === 'down') return json(503, {});
    const path = url.pathname.replace('/upload/drive/v3', '').replace('/drive/v3', '');
    if (path === '/files' && method === 'GET') {
      const q = url.searchParams.get('q') ?? '';
      const name = /name='((?:[^'\\]|\\.)*)'/.exec(q)?.[1]?.replace(/\\(.)/g, '$1');
      const parent = /'([^']+)' in parents/.exec(q)?.[1];
      const f = this.folders.find((x) => x.name === name && (x.parent ?? 'root') === parent);
      return json(200, { files: f ? [{ id: f.id }] : [] });
    }
    if (path === '/files' && method === 'POST' && url.searchParams.get('uploadType') === 'multipart') {
      if (this.drive.api === 'quota') return json(403, { error: { errors: [{ reason: 'storageQuotaExceeded' }] } });
      const meta = JSON.parse(/application\/json[^\r]*\r\n\r\n(.*?)\r\n--/s.exec(body)![1]!);
      const text = /text\/plain[^\r]*\r\n\r\n(.*)\r\n--[^\r]*--$/s.exec(body)![1]!;
      const fid = `file-${++this.seq}`;
      if (!this.drive.skipWrite) this.files.set(fid, { name: meta.name, parent: meta.parents[0], text, trashed: false });
      return json(200, { id: fid });
    }
    if (path === '/files' && method === 'POST') {
      const meta = JSON.parse(body);
      const f = { id: `folder-${++this.seq}`, name: meta.name as string, parent: (meta.parents?.[0] as string | undefined) ?? null };
      this.folders.push(f);
      return json(200, { id: f.id });
    }
    const m = /^\/files\/(.+)$/.exec(path);
    if (m) {
      const f = this.files.get(decodeURIComponent(m[1]!));
      if (!f) return json(404, { error: { errors: [{ reason: 'notFound' }] } });
      if (method === 'DELETE') { this.files.delete(decodeURIComponent(m[1]!)); return new Response(null, { status: 204 }); }
      if (url.searchParams.get('alt') === 'media') return new Response(f.text, { status: 200 });
      return json(200, { trashed: f.trashed });
    }
    return json(404, {});
  }
}
