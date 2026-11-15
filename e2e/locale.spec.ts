import { expect, test, type Page } from '@playwright/test';

const FOOTER_ZH = '訓練工具。不適用於處於危機中的個案。如有人有風險，請依實習機構的守則處理，並聯絡督導。';

const lang = (page: Page) => page.evaluate(() => document.documentElement.lang);

test('language choice is remembered after a reload and <html lang> follows it', async ({ page }) => {
  await page.goto('/');
  expect(await lang(page)).toBe('en');
  await page.getByRole('button', { name: '繁體中文' }).click();
  await expect(page.getByText(FOOTER_ZH)).toBeVisible();
  expect(await lang(page)).toBe('zh-Hant');
  await page.reload();
  await expect(page.getByText(FOOTER_ZH)).toBeVisible();
  expect(await lang(page)).toBe('zh-Hant');
  expect(await page.evaluate(() => localStorage.getItem('cm.practice.locale'))).toBe('zh-Hant');
  await page.getByRole('button', { name: 'English' }).click();
  await expect(page.getByRole('button', { name: '繁體中文' })).toBeVisible();
  expect(await lang(page)).toBe('en');
});

test.describe('browser language', () => {
  test.use({ locale: 'zh-HK' });
  test('a zh browser with no saved choice starts in Traditional Chinese', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText(FOOTER_ZH)).toBeVisible();
    expect(await lang(page)).toBe('zh-Hant');
  });
});

test.describe('browser language en', () => {
  test.use({ locale: 'en-US' });
  test('an English browser starts in English', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: '繁體中文' })).toBeVisible();
    expect(await lang(page)).toBe('en');
  });
});

test('the switch works with the keyboard alone', async ({ page }) => {
  await page.goto('/');
  const btn = page.getByRole('button', { name: '繁體中文' });
  await expect(btn).toBeVisible();
  await btn.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'English' })).toBeFocused();
  expect(await lang(page)).toBe('zh-Hant');
  await page.keyboard.press('Space');
  await expect(page.getByRole('button', { name: '繁體中文' })).toBeFocused();
  expect(await lang(page)).toBe('en');
});

test('typed text survives a language switch', async ({ page }) => {
  await page.goto('/m/intake/drills/easy');
  await page.getByRole('textbox', { name: /your response/i }).fill('half written answer');
  await page.getByRole('button', { name: '繁體中文' }).click();
  await expect(page.getByRole('textbox', { name: '你的回應' })).toHaveValue('half written answer');
});

test('an unreviewed Chinese module shows English with a notice; a reviewed one does not', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '繁體中文' }).click();
  // Finish the intake walkthrough so alliance unlocks.
  await page.goto('/m/intake/walkthrough/intake-s1');
  await page.getByRole('radio').first().check();
  await page.getByRole('button', { name: '確認選擇' }).click();
  await page.getByRole('textbox', { name: '你的回應' }).fill('an answer');
  await page.getByRole('button', { name: '送出回應' }).click();
  await page.goto('/m/intake');
  await expect(page.getByText('此模組的中文版尚未提供，現在顯示英文版。')).toHaveCount(0);
  await expect(page.getByText('intake 模組的簡介。')).toBeVisible();
  await page.goto('/m/alliance');
  await expect(page.getByText('此模組的中文版尚未提供，現在顯示英文版。')).toBeVisible();
  await expect(page.getByText('Intro for Alliance (fixture).')).toBeVisible();
});

test.describe('narrow screen', () => {
  test.use({ viewport: { width: 360, height: 740 } });
  const routes = ['/', '/login', '/m/intake', '/m/intake/walkthrough/intake-s1', '/m/intake/drills/easy', '/m/intake/reflect', '/nowhere'];
  for (const route of routes) {
    test(`Chinese interface has no horizontal scroll at 360px: ${route}`, async ({ page }) => {
      await page.addInitScript(() => localStorage.setItem('cm.practice.locale', 'zh-Hant'));
      await page.goto(route);
      await expect(page.getByText(FOOTER_ZH)).toBeVisible();
      await page.waitForLoadState('networkidle');
      const { scroll, client } = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        client: document.documentElement.clientWidth,
      }));
      expect(scroll).toBeLessThanOrEqual(client);
    });
  }
});
