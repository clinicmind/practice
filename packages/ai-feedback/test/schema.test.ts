import { test, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { checkOutput, FeedbackOutputSchema, JSON_SCHEMA } from '../src/index';
import { output, RESPONSE_ZH } from './fixtures';

const valid = [
  output(),
  output({ concern: 'off-task' }),
  output({ concern: 'risk-content' }),
  output({ criteria: [{ met: false, evidence: '' }, { met: false, evidence: '' }, { met: false, evidence: '' }] }),
];

test.each(valid)('accepts %#', (o) => {
  expect(FeedbackOutputSchema.safeParse(o).success).toBe(true);
  expect(checkOutput(o, RESPONSE_ZH, 'zh-Hant').ok).toBe(true);
});

test('rejects 2 or 4 criteria with criteria_count', () => {
  const c = output().criteria;
  const r2 = checkOutput(output({ criteria: c.slice(0, 2) }), RESPONSE_ZH, 'zh-Hant');
  const r4 = checkOutput(output({ criteria: [...c, c[0]] }), RESPONSE_ZH, 'zh-Hant');
  expect(r2).toEqual({ ok: false, reason: 'criteria_count' });
  expect(r4).toEqual({ ok: false, reason: 'criteria_count' });
});

test('rejects extra properties and wrong types with schema', () => {
  const bad: unknown[] = [
    null, 'text', [], {},
    { ...output(), extra: 1 },
    output({ concern: 'maybe' }),
    output({ suggestion: 5 }),
    output({ criteria: [{ met: 'yes', evidence: '' }, { met: true, evidence: '' }, { met: true, evidence: '' }] }),
    output({ criteria: [{ met: true, evidence: '', note: 'x' }, { met: true, evidence: '' }, { met: true, evidence: '' }] }),
    output({ criteria: 'none' }),
  ];
  for (const b of bad) expect(checkOutput(b, RESPONSE_ZH, 'zh-Hant')).toEqual({ ok: false, reason: 'schema' });
});

test('an empty suggestion is refused when concern is none, allowed otherwise', () => {
  expect(checkOutput(output({ suggestion: '  ' }), RESPONSE_ZH, 'zh-Hant')).toEqual({ ok: false, reason: 'schema' });
  expect(checkOutput(output({ suggestion: '', concern: 'off-task' }), RESPONSE_ZH, 'zh-Hant').ok).toBe(true);
});

test('JSON_SCHEMA is the structural subset only: strict objects, no length or item-count keywords', () => {
  const text = JSON.stringify(JSON_SCHEMA);
  for (const kw of ['minLength', 'maxLength', 'minItems', 'maxItems', 'minimum', 'maximum', 'pattern']) {
    expect(text).not.toContain(`"${kw}"`);
  }
  const objects: unknown[] = [];
  const walk = (n: unknown) => {
    if (n && typeof n === 'object') {
      const o = n as Record<string, unknown>;
      if (o.type === 'object') objects.push(o);
      Object.values(o).forEach(walk);
    }
  };
  walk(JSON_SCHEMA);
  expect(objects.length).toBe(2);
  for (const o of objects as { additionalProperties: unknown; required: string[]; properties: object }[]) {
    expect(o.additionalProperties).toBe(false);
    expect([...o.required].sort()).toEqual(Object.keys(o.properties).sort());
  }
});

test('the example outputs satisfy the zod schema and the key set of JSON_SCHEMA', () => {
  const props = Object.keys((JSON_SCHEMA as { properties: object }).properties).sort();
  expect(props).toEqual(Object.keys(output()).sort());
});

test('src has no DOM or Node imports', () => {
  const dir = join(__dirname, '..', 'src');
  for (const f of readdirSync(dir)) {
    const src = readFileSync(join(dir, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''); // 註解不算
    expect(src, f).not.toMatch(/from\s+['"]node:/);
    expect(src, f).not.toMatch(/\b(document|window|localStorage|process\.env)\b/);
    expect(src, f).not.toMatch(/\brequire\(/);
  }
});
