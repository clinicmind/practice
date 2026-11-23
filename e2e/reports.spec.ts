import { expect, test } from '@playwright/test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Two builds of the same app: port 4173 is the normal build (what the live site is), port 4174 has reports on
// and a stand-in backend. All text below is fictional.
const ON = 'http://127.0.0.1:4174';
const FILL = 'The trainee noted that the client spoke slowly and paused often before answering. '.repeat(4);
const CLEAN = FILL + 'We agreed to look at one small step this week.';

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}

test.describe('normal build: reports do not exist', () => {
  test('no reports link on the start page', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'ClinicMind Practice' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Reports' })).toHaveCount(0);
  });
  test('typing /reports/new shows the not-found page', async ({ page }) => {
    await page.goto('/reports/new');
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
    await expect(page.getByLabel('Report text')).toHaveCount(0);
  });
  test('the supervisor review pages do not exist either', async ({ page }) => {
    for (const path of ['/supervisor/reports', '/supervisor/reports/00000000-0000-4000-8000-000000000001']) {
      await page.goto(path);
      await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
    }
  });
  test('the stand-in backend is not in the normal bundle, and is in the reports build', () => {
    const marker = 'e2e-fake-reports-api';
    const has = (dir: string) => files(dir).filter((p) => p.endsWith('.js')).some((p) => readFileSync(p, 'utf8').includes(marker));
    expect(has('dist')).toBe(false);
    expect(has('dist-reports')).toBe(true);
  });
  test('the real backend client (the reports Edge Function address) is not in the normal bundle', () => {
    const has = (dir: string) => files(dir).filter((p) => p.endsWith('.js')).some((p) => readFileSync(p, 'utf8').includes('functions/v1/reports'));
    expect(has('dist')).toBe(false);
  });
});

test.describe('reports-on build', () => {
  test('a report with a phone number cannot be submitted; after rewriting it can', async ({ page }) => {
    await page.goto(`${ON}/`);
    await page.getByRole('link', { name: 'Reports' }).click();
    await page.getByRole('link', { name: 'Write a new report' }).click();

    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Continue', exact: true }).click();

    await page.getByLabel('Title', { exact: false }).fill('Week 3 notes');
    const body = page.getByLabel('Report text');
    await body.fill(`${CLEAN} Call me on 9123 4567.`);

    const next = page.getByRole('button', { name: 'Continue to final check' });
    await expect(page.getByText('Phone number', { exact: true })).toBeVisible();
    await expect(page.getByText('This check can miss things.', { exact: false })).toBeVisible();
    await expect(next).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Not identifying' })).toHaveCount(0);

    // Clicking the finding selects that span in the text box.
    await page.getByRole('button', { name: 'Show in text' }).click();
    const selected = await body.evaluate((el: HTMLTextAreaElement) => el.value.slice(el.selectionStart, el.selectionEnd));
    expect(selected).toBe('9123 4567');

    // Rewrite.
    await body.fill(`${CLEAN} Call me on the clinic line.`);
    await expect(next).toBeEnabled();
    await next.click();

    const submit = page.getByRole('button', { name: 'Submit report' });
    await expect(submit).toBeDisabled();
    await expect(page.getByText('This check can miss things.', { exact: false })).toBeVisible();
    await page.getByRole('checkbox').check();
    await submit.click();
    await expect(page.getByRole('heading', { name: 'Report submitted' })).toBeVisible();

    // It is in the list, and can be deleted after a confirm step.
    await page.getByRole('link', { name: 'Go to your reports' }).click();
    await expect(page.getByText('Week 3 notes')).toBeVisible();
    await page.getByRole('button', { name: 'Delete' }).click();
    await page.getByRole('button', { name: 'Yes, delete it' }).click();
    await expect(page.getByText('You have no reports yet.')).toBeVisible();
  });

  test('the same screens work in Traditional Chinese', async ({ page }) => {
    await page.goto(`${ON}/reports/new`);
    await page.getByRole('button', { name: '繁體中文' }).click();
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: '繼續', exact: true }).click();
    await page.getByLabel('報告內容').fill(`${CLEAN} 電話 91234567。`);
    await expect(page.getByText('電話號碼', { exact: true })).toBeVisible();
    await expect(page.getByText('請移除電話號碼。')).toBeVisible();
    await expect(page.getByText('這個檢查可能會漏', { exact: false })).toBeVisible();
  });
});
