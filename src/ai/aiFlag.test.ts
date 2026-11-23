import { describe, expect, test } from 'vitest';
import { aiFlag } from './AiContext';

describe('aiFlag', () => {
  test('is off unless the build sets it to exactly "true"', () => {
    expect(aiFlag({})).toBe(false);
    expect(aiFlag({ VITE_AI_ENABLED: '' })).toBe(false);
    expect(aiFlag({ VITE_AI_ENABLED: 'false' })).toBe(false);
    expect(aiFlag({ VITE_AI_ENABLED: '1' })).toBe(false);
    expect(aiFlag({ VITE_AI_ENABLED: 'true' })).toBe(true);
  });
});
