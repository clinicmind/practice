import { expect, test } from '@playwright/test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { en } from '../src/i18n/en';
import { zhHant } from '../src/i18n/zh-Hant';

// The supervisor page needs a signed-in supervisor and a database. The AI-on build (port 4177) carries a seeded
// stand-in for both, switched on by sessionStorage `e2e-fake-user` = "sup-triage". All names and text are fictional.
const ON = 'http://127.0.0.1:4177';
const t = en.supervisorTriage;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}

test('the normal build has no stand-in triage backend; the e2e build does', () => {
  const js = (d: string) => files(d).filter((p) => p.endsWith('.js')).map((p) => readFileSync(p, 'utf8'));
  expect(js('dist').some((x) => x.includes('e2e-fake-triage-backend'))).toBe(false);
  expect(js('dist-ai').some((x) => x.includes('e2e-fake-triage-backend'))).toBe(true);
});

test.describe('supervisor: look at this first', () => {
  test.use({ baseURL: ON });
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => sessionStorage.setItem('e2e-fake-user', 'sup-triage'));
  });

  test('shows the three blocks and the how-to guide', async ({ page }) => {
    await page.goto('/supervisor');
    const hardest = page.getByRole('region', { name: t.hardest.heading });
    await expect(hardest.getByRole('listitem')).toHaveCount(3);
    await expect(hardest.getByRole('listitem').first()).toContainText(t.hardest.rate(1, 5, 20));
    await expect(hardest.getByRole('listitem').first()).toContainText('intake-e01 criterion two');

    const care = page.getByRole('region', { name: t.checkIn.heading });
    await expect(care.getByRole('link', { name: 'Eve' })).toBeVisible();
    await expect(care.getByRole('link', { name: 'Dan' })).toHaveCount(0);

    const talk = page.getByRole('region', { name: t.discuss.heading });
    await expect(talk.getByText('ok', { exact: true })).toBeVisible();
    await expect(talk.getByText(t.discuss.intro)).toBeVisible();

    await page.getByText(en.supervisorGuide.summary).click();
    for (const s of en.supervisorGuide.sections) {
      await expect(page.getByRole('heading', { name: s.title })).toBeVisible();
    }
    await expect(page.getByRole('listitem').filter({ hasText: en.supervisorGuide.sections[0]!.steps[0]! })).toBeVisible();
  });

  test('works in Traditional Chinese, and a student link opens that student', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('cm.practice.locale', 'zh-Hant'));
    await page.goto('/supervisor');
    const z = zhHant.supervisorTriage;
    await expect(page.getByRole('region', { name: z.hardest.heading })).toBeVisible();
    await expect(page.getByRole('region', { name: z.hardest.heading }).getByRole('listitem').first()).toContainText('intake-e01 標準二');
    await page.getByRole('region', { name: z.checkIn.heading }).getByRole('link', { name: 'Eve' }).click();
    await expect(page).toHaveURL(/\/supervisor\/students\/stu-eve$/);
  });

  test('on a 360px phone nothing runs off the side', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await page.goto('/supervisor');
    await expect(page.getByRole('region', { name: t.discuss.heading })).toBeVisible();
    await page.getByText(en.supervisorGuide.summary).click();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
