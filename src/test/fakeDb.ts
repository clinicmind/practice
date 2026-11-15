/**
 * An in-memory stand-in for the slice of supabase-js the progress store uses:
 * from(t).select().eq().order() / .upsert(rows, { onConflict, ignoreDuplicates }).select() / .single().
 * It has the real unique constraint on (user_id, client_id) and can inject
 * network loss, an expired token, and "the Nth write fails".
 */
type Row = Record<string, unknown>;
type Err = { message: string; code: string; details: string; hint: string };
type Res = { data: unknown; error: Err | null; status: number };

export interface FakeDb {
  client: { from(table: string): Query };
  tables: Record<string, Row[]>;
  networkDown: boolean;
  authExpired: boolean;
  /** Let n more writes succeed, then fail every write as a network error until reset. */
  failWritesAfter(n: number): void;
  restore(): void;
  writes: number;
}

export function createFakeDb(): FakeDb {
  let clock = Date.parse('2026-11-15T00:00:00.000Z');
  let allowed = Infinity;
  const db: FakeDb = {
    tables: { attempts: [], decisions: [], reflections: [] },
    networkDown: false,
    authExpired: false,
    writes: 0,
    failWritesAfter(n) { allowed = n; },
    restore() { allowed = Infinity; db.networkDown = false; db.authExpired = false; },
    client: { from: (t) => new Query(db, t, () => (clock += 1), () => (allowed-- > 0)) },
  };
  return db;
}

const NETWORK: Res = { data: null, status: 0, error: { message: 'TypeError: Failed to fetch', code: '', details: '', hint: '' } };
const EXPIRED: Res = { data: null, status: 401, error: { message: 'JWT expired', code: 'PGRST301', details: '', hint: '' } };

class Query implements PromiseLike<Res> {
  private op: 'select' | 'upsert' = 'select';
  private rows: Row[] = [];
  private opts: { onConflict?: string; ignoreDuplicates?: boolean } = {};
  private filters: [string, unknown][] = [];
  private orders: string[] = [];
  private mode: 'many' | 'single' | 'maybe' = 'many';

  constructor(private db: FakeDb, private table: string, private tick: () => number, private mayWrite: () => boolean) {}

  select(_cols?: string) { return this; }
  upsert(rows: Row | Row[], opts: { onConflict?: string; ignoreDuplicates?: boolean } = {}) {
    this.op = 'upsert'; this.rows = Array.isArray(rows) ? rows : [rows]; this.opts = opts; return this;
  }
  eq(col: string, val: unknown) { this.filters.push([col, val]); return this; }
  order(col: string) { this.orders.push(col); return this; }
  single() { this.mode = 'single'; return this; }
  maybeSingle() { this.mode = 'maybe'; return this; }

  private run(): Res {
    if (this.db.networkDown) return NETWORK;
    if (this.db.authExpired) return EXPIRED;
    const table = (this.db.tables[this.table] ??= []);
    let out: Row[];
    if (this.op === 'upsert') {
      if (!this.mayWrite()) return NETWORK;
      this.db.writes++;
      const keys = (this.opts.onConflict ?? 'id').split(',').map((s) => s.trim());
      out = [];
      for (const r of this.rows) {
        const dup = table.some((e) => keys.every((k) => e[k] === r[k]));
        if (dup) {
          if (this.opts.ignoreDuplicates) continue;
          return { data: null, status: 409, error: { message: 'duplicate', code: '23505', details: '', hint: '' } };
        }
        const row = { id: crypto.randomUUID(), created_at: new Date(this.tick()).toISOString(), ...r };
        table.push(row);
        out.push(row);
      }
    } else {
      out = table.filter((r) => this.filters.every(([c, v]) => r[c] === v));
      for (const o of [...this.orders].reverse()) {
        out = [...out].sort((a, b) => (String(a[o]) < String(b[o]) ? -1 : String(a[o]) > String(b[o]) ? 1 : 0));
      }
    }
    out = out.map((r) => ({ ...r }));
    if (this.mode === 'many') return { data: out, error: null, status: 200 };
    if (out.length === 1) return { data: out[0], error: null, status: 200 };
    if (this.mode === 'maybe' && out.length === 0) return { data: null, error: null, status: 200 };
    return { data: null, status: 406, error: { message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116', details: '', hint: '' } };
  }

  then<A = Res, B = never>(ok?: ((v: Res) => A | PromiseLike<A>) | null, bad?: ((r: unknown) => B | PromiseLike<B>) | null) {
    return Promise.resolve().then(() => this.run()).then(ok, bad);
  }
}
