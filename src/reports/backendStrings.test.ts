import { describe, expect, test } from 'vitest';
import { en } from '../i18n/en';
import { zhHant } from '../i18n/zh-Hant';

// Every error code the Edge Function can return must have words in both languages.
const CODES = ['unauthorized', 'not_allowed', 'reports_disabled', 'body_length', 'title_identifying', 'rate_limited', 'drive_auth', 'drive_quota', 'drive_unavailable', 'storage_failed', 'server_error'];

describe('reportsBackend strings', () => {
  test.each([['en', en], ['zh-Hant', zhHant]])('%s has a message for every error code', (_l, t) => {
    for (const c of CODES) expect(t.reportsBackend.errors[c], c).toMatch(/\S/);
  });
  test('the Drive messages say that nothing was stored', () => {
    expect(en.reportsBackend.errors.drive_auth).toMatch(/nothing was stored/i);
    expect(zhHant.reportsBackend.errors.drive_auth).toMatch(/沒有儲存/);
  });
});
