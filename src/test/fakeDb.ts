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
  /** Reads of these tables fail as network errors. */
  failReads: Set<string>;
  authExpired: boolean;
  /** Let n more writes succeed, then fail every write as a network error until reset. */
  failWritesAfter(n: number): void;
  restore(): void;
  writes: number;
  /** Every select that ran, for asserting what the app asked for. */
  reads: { table: string; filters: [string, unknown][] }[];
}

export function createFakeDb(): FakeDb {
  let clock = Date.parse('2026-11-15T00:00:00.000Z');
  let allowed = Infinity;
  const db: FakeDb = {
    tables: { profiles: [], cohorts: [], attempts: [], decisions: [], reflections: [], unlocks: [], audit_log: [] },
    networkDown: false,
    failReads: new Set<string>(),
    authExpired: false,
    writes: 0,
    reads: [],
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
  private orders: { col: string; asc: boolean }[] = [];
  private window: [number, number] | null = null;
  private mode: 'many' | 'single' | 'maybe' = 'many';

  constructor(private db: FakeDb, private table: string, private tick: () => number, private mayWrite: () => boolean) {}

  select(_cols?: string) { return this; }
  upsert(rows: Row | Row[], opts: { onConflict?: string; ignoreDuplicates?: boolean } = {}) {
    this.op = 'upsert'; this.rows = Array.isArray(rows) ? rows : [rows]; this.opts = opts; return this;
  }
  eq(col: string, val: unknown) { this.filters.push([col, val]); return this; }
  order(col: string, o: { ascending?: boolean } = {}) { this.orders.push({ col, asc: o.ascending !== false }); return this; }
  range(from: number, to: number) { this.window = [from, to]; return this; }
  single() { this.mode = 'single'; return this; }
  maybeSingle() { this.mode = 'maybe'; return this; }

  /** The student_activity view: latest created_at per user over the three progress tables. */
  private activity(): Row[] {
    const latest = new Map<string, string>();
    for (const t of ['attempts', 'decisions', 'reflections']) {
      for (const r of this.db.tables[t] ?? []) {
        const u = String(r.user_id), c = String(r.created_at);
        if (!latest.has(u) || c > latest.get(u)!) latest.set(u, c);
      }
    }
    return [...latest].map(([user_id, last_active_at]) => ({ user_id, last_active_at }));
  }

  private run(): Res {
    if (this.db.networkDown || (this.op === 'select' && this.db.failReads.has(this.table))) return NETWORK;
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
      const source = this.table === 'student_activity' ? this.activity() : table;
      out = source.filter((r) => this.filters.every(([c, v]) => r[c] === v));
      for (const o of [...this.orders].reverse()) {
        const sign = o.asc ? 1 : -1;
        out = [...out].sort((a, b) => (String(a[o.col]) < String(b[o.col]) ? -sign : String(a[o.col]) > String(b[o.col]) ? sign : 0));
      }
      if (this.window) out = out.slice(this.window[0], this.window[1] + 1);
    }
    out = out.map((r) => ({ ...r }));
    this.db.reads.push({ table: this.table, filters: [...this.filters] });
    if (this.mode === 'many') return { data: out, error: null, status: 200 };
    if (out.length === 1) return { data: out[0], error: null, status: 200 };
    if (this.mode === 'maybe' && out.length === 0) return { data: null, error: null, status: 200 };
    return { data: null, status: 406, error: { message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116', details: '', hint: '' } };
  }

  then<A = Res, B = never>(ok?: ((v: Res) => A | PromiseLike<A>) | null, bad?: ((r: unknown) => B | PromiseLike<B>) | null) {
    return Promise.resolve().then(() => this.run()).then(ok, bad);
  }
}
