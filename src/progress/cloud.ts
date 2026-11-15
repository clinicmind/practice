import { StoreError, toStoreError } from './storeError';

export type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
export type Result = { data: unknown; error: { message?: string; code?: string } | null; status?: number };

/** Runs one request and turns every failure into a StoreError. */
export async function run(req: () => PromiseLike<Result>): Promise<unknown> {
  let res: Result;
  try {
    res = await req();
  } catch (e) {
    throw e instanceof StoreError ? e : new StoreError('network', e instanceof Error ? e.message : 'request failed');
  }
  if (res.error) throw toStoreError(res.error, res.status);
  return res.data;
}

/** PostgREST returns at most 1000 rows per request (Supabase's default); never rely on one page. */
export const PAGE_SIZE = 1000;

/** Reads every page. The query must have a stable order or pages can overlap or skip rows. */
export async function fetchAll(page: (from: number, to: number) => PromiseLike<Result>): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const rows = ((await run(() => page(from, from + PAGE_SIZE - 1))) ?? []) as Row[];
    out.push(...rows);
    if (rows.length < PAGE_SIZE) return out;
  }
}
