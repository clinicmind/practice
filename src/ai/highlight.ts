/**
 * Where the AI's quoted words sit inside the student's own response, so they can be marked.
 * The server only accepts a quote that is a substring of the response (runs of whitespace may differ),
 * so a quote that cannot be found here is simply not marked: nothing is invented.
 */
export type Segment = { text: string; marked: boolean };

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function locate(response: string, quote: string): [number, number] | null {
  const q = quote.trim();
  if (q === '') return null;
  const exact = response.indexOf(q);
  if (exact >= 0) return [exact, exact + q.length];
  // The server folds runs of whitespace before comparing; do the same here.
  const pattern = q.split(/\s+/).map(escape).join('\\s+');
  const m = new RegExp(pattern).exec(response);
  return m ? [m.index, m.index + m[0].length] : null;
}

export function highlight(response: string, quotes: string[]): Segment[] {
  const ranges = quotes.map((q) => locate(response, q)).filter((r): r is [number, number] => r !== null).sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  const out: Segment[] = [];
  let at = 0;
  for (const [s, e] of merged) {
    if (s > at) out.push({ text: response.slice(at, s), marked: false });
    out.push({ text: response.slice(s, e), marked: true });
    at = e;
  }
  if (at < response.length) out.push({ text: response.slice(at), marked: false });
  return out.length > 0 ? out : [{ text: response, marked: false }];
}
