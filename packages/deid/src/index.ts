import { normalize } from './normalize';
import { RULE_SET, type Level } from './rules';

export type { Level };
export type Finding = { rule: string; level: Level; start: number; end: number; match: string };
export type Resolution = 'rewritten' | 'not-identifying';
export type DeidSummary = Record<string, { found: number; rewritten: number; notIdentifying: number }>;

export const RULES: { id: string; level: Level }[] = RULE_SET.map(({ id, level }) => ({ id, level }));

export const SUGGESTIONS: Record<string, string> = {
  hkid: 'Remove the ID number. It is never needed in a learning report.',
  'mo-bir': 'Remove the ID number. It is never needed in a learning report.',
  phone: 'Remove the phone number.',
  email: 'Remove the email address.',
  url: 'Remove the link.',
  'full-date': 'Use a relative time, for example "Week 3" or "two months before intake".',
  dob: 'Use an age band, for example "in her late twenties".',
  'age-90': 'Write "aged 90 or over".',
  address: 'Remove the address, or describe it generally, for example "public housing".',
  institution: 'Describe the kind of place, for example "a public hospital" or "a secondary school".',
  'title-name': 'Use a client code or a role, for example "Client A" or "her teacher".',
  'cjk-name': 'If this is a name, use a client code or a role, for example "個案 A".',
  'cap-name': 'If this is a name, use a client code or a role, for example "Client A" or "her friend".',
  'id-like': 'If this is a record or case number, remove it.',
};

const RANK: Record<Level, number> = { high: 3, medium: 2, low: 1 };

/** Stable key for one finding; changes whenever the text around it is edited. */
export const findingKey = (f: Finding): string => `${f.rule}:${f.start}:${f.match}`;

export function scan(text: string, opts: { only?: string; levels?: Level[] } = {}): Finding[] {
  const norm = normalize(text);
  if (norm.text.length === 0) return [];
  const candidates: (Finding & { ns: number; ne: number })[] = [];
  for (const rule of RULE_SET) {
    if (opts.only && rule.id !== opts.only) continue;
    if (opts.levels && !opts.levels.includes(rule.level)) continue;
    for (const s of rule.find(norm.text)) {
      if (s.end <= s.start) continue;
      const start = norm.starts[s.start];
      const end = norm.ends[s.end - 1];
      candidates.push({ rule: rule.id, level: rule.level, start, end, match: text.slice(start, end), ns: s.start, ne: s.end });
    }
  }
  // Higher level first, then longer, then earlier. Accept greedily; overlapping lower candidates are dropped.
  candidates.sort((a, b) => RANK[b.level] - RANK[a.level] || b.ne - b.ns - (a.ne - a.ns) || a.ns - b.ns);
  const taken: (Finding & { ns: number; ne: number })[] = [];
  const used = new Uint8Array(norm.text.length);
  for (const c of candidates) {
    let free = true;
    for (let i = c.ns; i < c.ne; i++) if (used[i]) { free = false; break; }
    if (!free) continue;
    for (let i = c.ns; i < c.ne; i++) used[i] = 1;
    taken.push(c);
  }
  taken.sort((a, b) => a.ns - b.ns);
  return taken.map(({ rule, level, start, end, match }) => ({ rule, level, start, end, match }));
}

/** Server-side re-check: only rules that must never pass. */
export function scanHigh(text: string): Finding[] {
  return scan(text, { levels: ['high'] });
}

/** Counts only. The result never contains matched text. */
export function summarize(findings: Finding[], resolutions: Record<string, Resolution>): DeidSummary {
  const out: DeidSummary = {};
  for (const f of findings) {
    const row = (out[f.rule] ??= { found: 0, rewritten: 0, notIdentifying: 0 });
    row.found++;
    const r = resolutions[findingKey(f)];
    if (r === 'rewritten') row.rewritten++;
    else if (r === 'not-identifying') row.notIdentifying++;
  }
  return out;
}
