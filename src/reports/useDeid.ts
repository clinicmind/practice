import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { findingKey, scan, summarize, type DeidSummary, type Finding, type Resolution } from '../../packages/deid/src';

export const MIN_LENGTH = 200;
export const MAX_LENGTH = 30_000;
export const DEBOUNCE_MS = 300;

export type LengthStatus = 'short' | 'ok' | 'long';
export const lengthStatusOf = (n: number): LengthStatus => (n < MIN_LENGTH ? 'short' : n > MAX_LENGTH ? 'long' : 'ok');

type Counts = Record<string, number>;
const NONE: Finding[] = [];

/**
 * Debounced de-identification check for report text.
 * - Findings come from the last scanned text. While the text has changed since, `pending` is true and nothing can be submitted.
 * - A resolution lives only while its finding (same rule, position and text) still exists.
 * - A finding that disappears is counted as rewritten, unless it only moved because earlier text changed.
 */
export function useDeid(text: string) {
  const [scanned, setScanned] = useState(text);
  useEffect(() => {
    if (text === scanned) return;
    const t = setTimeout(() => setScanned(text), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [text, scanned]);

  const pending = text !== scanned;
  const lengthStatus = lengthStatusOf(text.length);
  // Over-long text is never scanned: it cannot be submitted anyway, and scanning it could stall the page.
  const findings = useMemo(() => (scanned.length > MAX_LENGTH ? NONE : scan(scanned)), [scanned]);

  const [marked, setMarked] = useState<Record<string, 'not-identifying'>>({});
  const [gone, setGone] = useState<Counts>({});

  const prev = useRef<Finding[]>(findings);
  useEffect(() => {
    const before = prev.current;
    prev.current = findings;
    if (before === findings) return;
    const nowKeys = new Set(findings.map(findingKey));
    const beforeKeys = new Set(before.map(findingKey));
    // Newcomers that look like a vanished finding (same rule and text) are the same finding, moved.
    const newcomers = findings.filter((f) => !beforeKeys.has(findingKey(f)));
    const removed: Counts = {};
    for (const f of before) {
      if (nowKeys.has(findingKey(f))) continue;
      const i = newcomers.findIndex((n) => n.rule === f.rule && n.match === f.match);
      if (i >= 0) newcomers.splice(i, 1);
      else removed[f.rule] = (removed[f.rule] ?? 0) + 1;
    }
    if (Object.keys(removed).length) {
      setGone((g) => {
        const next = { ...g };
        for (const [r, n] of Object.entries(removed)) next[r] = (next[r] ?? 0) + n;
        return next;
      });
    }
  }, [findings]);

  const resolutions = useMemo(() => {
    const keys = new Set(findings.map(findingKey));
    return Object.fromEntries(Object.entries(marked).filter(([k]) => keys.has(k))) as Record<string, Resolution>;
  }, [findings, marked]);

  const resolve = useCallback((key: string, r: 'not-identifying') => {
    const f = findings.find((x) => findingKey(x) === key);
    if (!f || f.level === 'high') return; // high findings can only be rewritten
    setMarked((m) => ({ ...m, [key]: r }));
  }, [findings]);

  const unresolve = useCallback((key: string) => {
    setMarked((m) => { const { [key]: _drop, ...rest } = m; return rest; });
  }, []);

  const unresolved = findings.filter((f) => !resolutions[findingKey(f)]).length;
  const hasHigh = findings.some((f) => f.level === 'high');
  const canSubmit = !pending && lengthStatus === 'ok' && unresolved === 0 && !hasHigh;

  const summary = useMemo<DeidSummary>(() => {
    const s = summarize(findings, resolutions);
    for (const [rule, n] of Object.entries(gone)) {
      const row = (s[rule] ??= { found: 0, rewritten: 0, notIdentifying: 0 });
      row.found += n;
      row.rewritten += n;
    }
    return s;
  }, [findings, resolutions, gone]);

  return { findings, resolutions, resolve, unresolve, unresolved, canSubmit, summary, pending, lengthStatus };
}
