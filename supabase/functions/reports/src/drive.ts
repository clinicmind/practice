/**
 * Google Drive, over plain `fetch`. Uses the `drive.file` scope: the app can see only the files and
 * folders it created itself. Authorised as the owner, with a refresh token kept in the function's
 * secrets. Nothing here logs, and no error carries a token or any text from a report.
 */
export type DriveEnv = { GOOGLE_CLIENT_ID?: string; GOOGLE_CLIENT_SECRET?: string; GOOGLE_REFRESH_TOKEN?: string };
export type FetchFn = typeof fetch;

/** auth: the owner's authorisation is gone or missing. quota: Drive is full. unavailable: anything else. */
export type DriveErrorKind = 'auth' | 'quota' | 'unavailable';
export class DriveError extends Error {
  constructor(public kind: DriveErrorKind) {
    super(`drive_${kind}`);
  }
}

export type Drive = {
  /** Creates (or finds) the folder for a cohort and writes the text into it. Returns the Drive file id. */
  createFile(cohortFolder: string, name: string, text: string): Promise<string>;
  /** The text, or null when the file is gone (deleted, or in the Drive trash). */
  readFile(id: string): Promise<string | null>;
  /** A file that is already gone counts as deleted. */
  deleteFile(id: string): Promise<void>;
  /** Proves the authorisation works: gets an access token and makes one cheap Drive call. Throws DriveError. */
  check(): Promise<void>;
};

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const ROOT_FOLDER = 'ClinicMind Practice Reports';
const FOLDER = 'application/vnd.google-apps.folder';

export function createDrive(env: DriveEnv, fetchFn: FetchFn): Drive {
  let token: string | null = null;

  async function send(url: string, init: RequestInit): Promise<Response> {
    try {
      return await fetchFn(url, init);
    } catch {
      throw new DriveError('unavailable');
    }
  }

  async function accessToken(): Promise<string> {
    if (token) return token;
    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_REFRESH_TOKEN) throw new DriveError('auth');
    const res = await send(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        refresh_token: env.GOOGLE_REFRESH_TOKEN,
        grant_type: 'refresh_token',
      }),
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      // invalid_grant: revoked, expired (app still in Testing), or password changed. invalid_client: wrong secret.
      throw new DriveError(j.error === 'invalid_grant' || j.error === 'invalid_client' || res.status === 400 || res.status === 401 ? 'auth' : 'unavailable');
    }
    const j = (await res.json().catch(() => null)) as { access_token?: string } | null;
    if (!j?.access_token) throw new DriveError('unavailable');
    token = j.access_token;
    return token;
  }

  async function call(url: string, init: RequestInit = {}): Promise<Response> {
    const res = await send(url, { ...init, headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${await accessToken()}` } });
    if (res.status === 401) throw new DriveError('auth');
    return res;
  }

  /** Maps a failed Drive response to an error. 403 is quota when Drive says so, otherwise a permission problem. */
  async function fail(res: Response): Promise<never> {
    const j = (await res.json().catch(() => ({}))) as { error?: { errors?: { reason?: string }[]; status?: string } };
    const reasons = (j.error?.errors ?? []).map((e) => e.reason);
    if (reasons.includes('storageQuotaExceeded')) throw new DriveError('quota');
    if (res.status === 403 && !reasons.some((r) => r === 'rateLimitExceeded' || r === 'userRateLimitExceeded')) throw new DriveError('auth');
    throw new DriveError('unavailable');
  }

  const q = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

  async function ensureFolder(name: string, parent: string | null): Promise<string> {
    const query = `name='${q(name)}' and mimeType='${FOLDER}' and trashed=false and '${parent ?? 'root'}' in parents`;
    const found = await call(`${API}/files?${new URLSearchParams({ q: query, fields: 'files(id)', pageSize: '1', spaces: 'drive' })}`);
    if (!found.ok) await fail(found);
    const list = ((await found.json().catch(() => null)) as { files?: { id: string }[] } | null)?.files ?? [];
    if (list[0]?.id) return list[0].id;
    const made = await call(`${API}/files?fields=id`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mimeType: FOLDER, ...(parent ? { parents: [parent] } : {}) }),
    });
    if (!made.ok) await fail(made);
    const id = ((await made.json().catch(() => null)) as { id?: string } | null)?.id;
    if (!id) throw new DriveError('unavailable');
    return id;
  }

  return {
    async createFile(cohortFolder, name, text) {
      const root = await ensureFolder(ROOT_FOLDER, null);
      const folder = await ensureFolder(cohortFolder, root);
      const boundary = `b-${crypto.randomUUID()}`;
      const meta = JSON.stringify({ name, parents: [folder], mimeType: 'text/plain' });
      const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${text}\r\n--${boundary}--`;
      const res = await call(`${UPLOAD}/files?uploadType=multipart&fields=id`, {
        method: 'POST',
        headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
        body,
      });
      if (!res.ok) await fail(res);
      const id = ((await res.json().catch(() => null)) as { id?: string } | null)?.id;
      if (!id) throw new DriveError('unavailable');
      return id;
    },

    async readFile(id) {
      const meta = await call(`${API}/files/${encodeURIComponent(id)}?fields=trashed`);
      if (meta.status === 404) return null;
      if (!meta.ok) await fail(meta);
      // Deleting in the Drive web page only moves a file to the trash; it still reads over the API.
      if (((await meta.json().catch(() => ({}))) as { trashed?: boolean }).trashed) return null;
      const res = await call(`${API}/files/${encodeURIComponent(id)}?alt=media`);
      if (res.status === 404) return null;
      if (!res.ok) await fail(res);
      return await res.text();
    },

    async check() {
      const res = await call(`${API}/files?${new URLSearchParams({ fields: 'files(id)', pageSize: '1', spaces: 'drive' })}`);
      if (!res.ok) await fail(res);
    },

    async deleteFile(id) {
      const res = await call(`${API}/files/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (res.status === 404 || res.ok) return;
      await fail(res);
    },
  };
}
