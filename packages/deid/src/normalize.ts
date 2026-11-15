/**
 * Normalises text for matching and keeps a map back to the original string.
 * - Unicode NFKC per code point (full-width digits, letters and brackets become ASCII).
 * - Zero-width characters are dropped, so they cannot be used to split an identifier.
 * `starts[i]` and `ends[i]` are the UTF-16 offsets, in the original text, of the code point
 * that produced unit `i` of the normalised text.
 */
export type Normalized = { text: string; starts: number[]; ends: number[] };

const ZERO_WIDTH = new Set([0x200b, 0x200c, 0x200d, 0x2060, 0xfeff]);

export function normalize(input: string): Normalized {
  const out: string[] = [];
  const starts: number[] = [];
  const ends: number[] = [];
  let i = 0;
  while (i < input.length) {
    const cp = input.codePointAt(i)!;
    const len = cp > 0xffff ? 2 : 1;
    if (!ZERO_WIDTH.has(cp)) {
      const n = String.fromCodePoint(cp).normalize('NFKC');
      for (let k = 0; k < n.length; k++) {
        out.push(n[k]);
        starts.push(i);
        ends.push(i + len);
      }
    }
    i += len;
  }
  return { text: out.join(''), starts, ends };
}
