import { describe, test, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { scan, scanHigh, summarize, RULES, SUGGESTIONS, type Finding } from '../src/index';

const here = path.dirname(fileURLToPath(import.meta.url));
const load = <T,>(f: string): T => YAML.parse(fs.readFileSync(path.join(here, 'corpus', f), 'utf8')) as T;
const positive = load<{ rule: string; text: string; expect: string[] }[]>('positive.yaml');
const negative = load<{ rule: string; text: string }[]>('negative.yaml');
const of = (text: string, rule: string) => scan(text).filter((f) => f.rule === rule);

describe('rule table', () => {
  test('has the 14 rules of spec 8.3 with their levels', () => {
    expect(RULES).toEqual([
      { id: 'hkid', level: 'high' }, { id: 'mo-bir', level: 'high' }, { id: 'phone', level: 'high' },
      { id: 'email', level: 'high' }, { id: 'url', level: 'high' },
      { id: 'full-date', level: 'medium' }, { id: 'dob', level: 'medium' }, { id: 'age-90', level: 'medium' },
      { id: 'address', level: 'medium' }, { id: 'institution', level: 'medium' }, { id: 'title-name', level: 'medium' },
      { id: 'cjk-name', level: 'low' }, { id: 'cap-name', level: 'low' }, { id: 'id-like', level: 'low' },
    ]);
  });
  test('every rule has a rewrite suggestion and corpus cases on both sides', () => {
    for (const r of RULES) {
      expect(SUGGESTIONS[r.id], r.id).toBeTruthy();
      expect(positive.filter((c) => c.rule === r.id).length, `${r.id} positive`).toBeGreaterThanOrEqual(4);
      expect(negative.filter((c) => c.rule === r.id).length, `${r.id} negative`).toBeGreaterThanOrEqual(4);
    }
  });
});

describe('positive corpus', () => {
  test.each(positive)('$rule finds $expect in "$text"', ({ rule, text, expect: want }) => {
    // Use the rule in isolation: overlap resolution is tested separately.
    const got = scan(text, { only: rule }).map((f) => f.match);
    expect(got).toEqual(want);
  });
});

describe('negative corpus', () => {
  test.each(negative)('$rule ignores "$text"', ({ rule, text }) => {
    expect(scan(text, { only: rule })).toEqual([]);
  });
});

describe('offsets and normalisation', () => {
  test('findings map back to original offsets', () => {
    const t = 'ID​：Ａ１２３４５６（３）end';
    const [f] = of(t, 'hkid');
    expect(t.slice(f.start, f.end)).toBe('Ａ１２３４５６（３）');
    expect(f.match).toBe('Ａ１２３４５６（３）');
  });
  test('zero-width characters inside an identifier do not hide it', () => {
    const t = 'tel 9​123‍4567 ok';
    const [f] = of(t, 'phone');
    expect(t.slice(f.start, f.end)).toBe('9​123‍4567');
  });
  test('identifier split across a line break is still found', () => {
    expect(of('phone 9123\n4567', 'phone').map((f) => f.match)).toEqual(['9123\n4567']);
  });
  test('offsets are correct after astral characters', () => {
    const t = '😀😀 mail a@b.co';
    const [f] = of(t, 'email');
    expect(t.slice(f.start, f.end)).toBe('a@b.co');
  });
  test('findings are sorted by start and never overlap', () => {
    const fs_ = scan('Mr Chan, tel 91234567, a@b.co, born in 1998, Flat 3B, 12/03/2026');
    for (let i = 1; i < fs_.length; i++) expect(fs_[i].start).toBeGreaterThanOrEqual(fs_[i - 1].end);
  });
});

describe('overlap', () => {
  test('higher level wins: a phone number is not also reported as id-like', () => {
    expect(scan('tel 91234567').map((f) => f.rule)).toEqual(['phone']);
  });
  test('title-name wins over cjk-name and cap-name', () => {
    expect(scan('陳先生').map((f) => f.rule)).toEqual(['title-name']);
    expect(scan('saw Mr Chan Tai Man').map((f) => f.rule)).toEqual(['title-name']);
  });
  test('same level keeps the longer match', () => {
    const fs_ = scan('born on 12/03/1998');
    expect(fs_).toHaveLength(1);
    expect(fs_[0].match).toBe('born on 12/03/1998');
  });
});

describe('scanHigh', () => {
  test('returns only high rules', () => {
    const t = 'Mr Chan 91234567 a@b.co 12/03/2026';
    expect(scanHigh(t).map((f) => f.rule)).toEqual(['phone', 'email']);
  });
});

describe('whole documents', () => {
  const clean = fs.readFileSync(path.join(here, 'corpus', 'clean-report.txt'), 'utf8');
  test('a clean fictional report has no high or medium findings', () => {
    expect(scan(clean).filter((f) => f.level !== 'low')).toEqual([]);
  });
  test('a clean fictional report has at most 2 low findings', () => {
    expect(scan(clean).length).toBeLessThanOrEqual(2);
  });
  test('30,000 characters scan in under 1000 ms', () => {
    const big = (clean + '\n').repeat(Math.ceil(30000 / clean.length)).slice(0, 30000);
    const t0 = performance.now();
    scan(big);
    expect(performance.now() - t0).toBeLessThan(1000);
  });
  test('pathological input does not hang', () => {
    const t0 = performance.now();
    scan('A'.repeat(30000)); scan('1 '.repeat(15000)); scan('陳'.repeat(30000)); scan('Flat '.repeat(6000));
    expect(performance.now() - t0).toBeLessThan(2000);
  });
  test('empty and whitespace input give no findings', () => {
    expect(scan('')).toEqual([]);
    expect(scan('  \n\t ')).toEqual([]);
  });
});

describe('summarize', () => {
  test('counts per rule and contains no matched text', () => {
    const t = 'call 91234567 or 61234567, Mr Chan';
    const fs_ = scan(t);
    const key = (f: Finding) => `${f.rule}:${f.start}:${f.match}`;
    const s = summarize(fs_, { [key(fs_[2])]: 'not-identifying' });
    expect(s).toEqual({
      phone: { found: 2, rewritten: 0, notIdentifying: 0 },
      'title-name': { found: 1, rewritten: 0, notIdentifying: 1 },
    });
    expect(JSON.stringify(s)).not.toContain('91234567');
    expect(JSON.stringify(s)).not.toContain('Chan');
  });
});

describe('portability', () => {
  test('source has no DOM or Node dependencies', () => {
    const dir = path.join(here, '..', 'src');
    for (const f of fs.readdirSync(dir)) {
      const src = fs.readFileSync(path.join(dir, f), 'utf8');
      expect(src, f).not.toMatch(/from 'node:|require\(|\bdocument\.|\bwindow\.|\bprocess\./);
    }
  });
});
