// @vitest-environment node
import { describe, expect, test } from 'vitest';
import { budgetState } from '../packages/ai-feedback/src/limits';
import { budgetLevel } from '../src/supervisor/aiUsage';
import { buildReport, parseCsv, toUsageRows } from './ai-usage-report';

const CSV = [
  'kind,model,input_tokens,output_tokens,cache_write_tokens,cache_read_tokens,cost_usd,outcome,created_at',
  'practice,claude-haiku-5-5,100,50,0,900,0.0004,ok,2026-11-01T00:00:00Z',
  'practice,claude-haiku-5-5,100,50,900,0,0.0006,ok,2026-11-01T00:01:00Z',
  '"practice",claude-haiku-5-5,0,0,0,0,0.0001,refusal,2026-11-01T00:02:00Z',
  'report_draft,claude-sonnet-5-5,8000,2000,0,0,0.04,ok,2026-11-02T00:00:00Z',
].join('\n');
const PER = [{ name: 'low' as const, perRequestUsd: 0.0002 }, { name: 'mid' as const, perRequestUsd: 0.0003 }, { name: 'high' as const, perRequestUsd: 0.0006 }];

describe('ai usage report', () => {
  test('parses quoted fields and CRLF', () => {
    expect(parseCsv('a,b\r\n"x,y","he said ""hi"""\r\n')).toEqual([{ a: 'x,y', b: 'he said "hi"' }]);
  });
  test('reproduces the numbers from a fixture CSV', () => {
    const { markdown, aboveHigh } = buildReport(toUsageRows(parseCsv(CSV)), PER);
    expect(markdown).toContain('4 (practice 3, report draft 1, eval 0)');
    expect(markdown).toContain('US$0.0411');
    // cache read 900 of (read 900 + write 900 + input 8200) = 9%
    expect(markdown).toContain('| Cache hit rate | 9% |');
    expect(markdown).toContain('| Discarded (invalid, refusal, error) | 25% |');
    expect(markdown).toContain('US$0.00050'); // (0.0004 + 0.0006) / 2 kept practice calls
    expect(aboveHigh).toBe(false);
  });
  test('flags usage above the cost document’s high scenario', () => {
    const r = buildReport(toUsageRows(parseCsv(CSV)), [{ name: 'low', perRequestUsd: 0.0001 }, { name: 'mid', perRequestUsd: 0.0002 }, { name: 'high', perRequestUsd: 0.0004 }]);
    expect(r.aboveHigh).toBe(true);
    expect(r.markdown).toContain('Above the high scenario');
  });
  test('an unknown kind or outcome is an error, not silently counted', () => {
    expect(() => toUsageRows(parseCsv(CSV.replace('ok,2026-11-02', 'weird,2026-11-02')))).toThrow(/row 5/);
  });
  test('the site’s budget levels agree with the function’s budgetState', () => {
    for (const [spent, limit] of [[0, 10], [7.9, 10], [8, 10], [9.99, 10], [10, 10], [12, 10]] as const) {
      expect(budgetLevel(spent, { monthlyLimitUsd: limit, warnAt: 0.8 })).toBe(budgetState(spent, limit, 0.8));
    }
    expect(budgetLevel(0, { monthlyLimitUsd: 0, warnAt: 0.8 })).toBe('unset');
    expect(budgetLevel(0, null)).toBe('unset');
  });
});
