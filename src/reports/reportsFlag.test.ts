import { describe, expect, test } from 'vitest';
import { reportsFlag } from './ReportsContext';

describe('reportsFlag', () => {
  test('is off unless the build sets it to exactly "true"', () => {
    expect(reportsFlag({})).toBe(false);
    expect(reportsFlag({ VITE_REPORTS_ENABLED: '' })).toBe(false);
    expect(reportsFlag({ VITE_REPORTS_ENABLED: 'false' })).toBe(false);
    expect(reportsFlag({ VITE_REPORTS_ENABLED: '1' })).toBe(false);
    expect(reportsFlag({ VITE_REPORTS_ENABLED: 'true' })).toBe(true);
  });
});
