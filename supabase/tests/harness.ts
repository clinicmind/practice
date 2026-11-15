import { PGlite } from '@electric-sql/pglite';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export type Row = Record<string, unknown>;
export interface Client {
  query(sql: string, params?: unknown[]): Promise<{ rows: Row[]; affectedRows: number }>;
}
export interface TestDb {
  as(userId: string | null): Client;
  admin: Client;
  close(): Promise<void>;
}

const MIGRATIONS_DIR = join(__dirname, '..', 'migrations');

// Minimal stand-in for what Supabase provides: the auth schema with users and
// uid(), and the anon / authenticated roles. Everything else is our migrations.
const SUPABASE_SHIM = `
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create role anon nologin;
  create role authenticated nologin;
  grant usage on schema auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
  grant usage on schema public to anon, authenticated;
`;

/**
 * In-process Postgres (pglite) with the migrations applied. `as(id)` runs each
 * query in its own transaction under the `authenticated` role (or `anon` for
 * null) with the JWT subject claim set, so row level security applies exactly
 * as it does for a PostgREST request.
 */
export async function createDb(): Promise<TestDb> {
  const db = new PGlite();
  await db.exec(SUPABASE_SHIM);
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) await db.exec(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'));

  const admin: Client = {
    async query(sql, params) {
      const r = await db.query<Row>(sql, params);
      return { rows: r.rows, affectedRows: r.affectedRows ?? 0 };
    },
  };
  const as = (userId: string | null): Client => ({
    async query(sql, params) {
      return db.transaction(async (tx) => {
        await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId ?? '']);
        await tx.exec(`set local role ${userId ? 'authenticated' : 'anon'}`);
        const r = await tx.query<Row>(sql, params);
        return { rows: r.rows, affectedRows: r.affectedRows ?? 0 };
      });
    },
  });
  return { as, admin, close: () => db.close() };
}
