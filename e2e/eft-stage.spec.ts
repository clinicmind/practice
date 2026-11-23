import { expect, test } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { en } from '../src/i18n/en';
import { zhHant } from '../src/i18n/zh-Hant';

// Both bundles are built from the REAL course content (see e2e/build-variants.sh).
const REAL = 'http://127.0.0.1:4175'; // normal build: EFT has no reviewed module
const EFT = 'http://127.0.0.1:4176'; // test-only review rows register EFT module 1

test.describe('normal build: the EFT stage does not exist yet', () => {
  test.use({ baseURL: REAL });

  test('the shipped files list foundations only, in both languages, and have no EFT files', () => {
    for (const loc of ['en', 'zh-Hant']) {
      const list = JSON.parse(readFileSync(`dist-real/content/${loc}/stages.json`, 'utf8'));
      expect(list.map((s: { stage: string }) => s.stage)).toEqual(['foundations']);
      expect(existsSync(`dist-real/content/${loc}/eft`)).toBe(false);
    }
  });

  test('the home page is the plain foundations page, with no stage list', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'Foundations' })).toBeVisible();
    await expect(page.getByText(en.stage.listHeading)).toHaveCount(0);
    await expect(page.getByText(/Emotion-Focused/)).toHaveCount(0);
    await expect(page.getByText(en.stage.lede)).toBeVisible();
    await expect(page.getByRole('link', { name: /Intake/ })).toBeVisible();
  });

  test('the EFT routes are not found, and old bookmarks still work', async ({ page }) => {
    await page.goto('/s/eft');
    await expect(page.getByRole('heading', { name: en.notFound.heading })).toBeVisible();
    await page.goto('/s/eft/m/eft-attunement');
    await expect(page.getByRole('heading', { name: en.notFound.heading })).toBeVisible();
    await page.goto('/m/intake');
    await expect(page).toHaveURL(/\/s\/foundations\/m\/intake$/);
  });

  test('Traditional Chinese is also plain: foundations only', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('cm.practice.locale', 'zh-Hant'));
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: '基礎' })).toBeVisible();
    await expect(page.getByText(/情緒聚焦治療/)).toHaveCount(0);
  });
});

test.describe('with EFT module 1 reviewed: the stage and the module show', () => {
  test.use({ baseURL: EFT });

  test('the home page lists both stages and opens EFT with its content notice', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: en.stage.listHeading })).toBeVisible();
    await expect(page.getByRole('link', { name: /Foundations/ })).toBeVisible();
    await page.getByRole('link', { name: /Emotion-Focused Therapy/ }).click();
    await expect(page).toHaveURL(/\/s\/eft$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Emotion-Focused Therapy' })).toBeVisible();
    const note = page.getByRole('complementary', { name: en.eft.noticeLabel });
    await expect(note).toContainText('father has died');
    await expect(note).toContainText('talk it over with your supervisor');
    await expect(page.getByText(en.stage.lede)).toHaveCount(0); // that line is foundations-only
    await expect(page.getByRole('link', { name: /Attunement and empathic exploration/ })).toBeVisible();
  });

  test('module 1 opens: introduction, both sessions, practice, reflection', async ({ page }) => {
    await page.goto('/s/eft/m/eft-attunement');
    await expect(page.getByRole('heading', { name: /Attunement and empathic exploration/ })).toBeVisible();
    await expect(page.getByText(/Client R/)).toBeVisible();
    await expect(page.getByText(/empathic exploration/i).first()).toBeVisible();
    await expect(page.getByRole('link', { name: /Session 1/ })).toBeVisible();
    await page.getByRole('link', { name: /Session 1/ }).click();
    await expect(page).toHaveURL(/\/s\/eft\/m\/eft-attunement\/walkthrough\/eft-attunement-s1$/);
    await expect(page.getByText(/I just want some tools/)).toBeVisible();
  });

  test('the first practice question loads, and an old foundations link still works', async ({ page }) => {
    await page.goto('/s/eft/m/eft-attunement/drills/easy');
    await expect(page.getByText(/stand in the hallway/)).toBeVisible();
    await expect(page.getByRole('textbox', { name: /your response/i })).toBeVisible();
    await page.goto('/m/intake');
    await expect(page).toHaveURL(/\/s\/foundations\/m\/intake$/);
  });

  test('Traditional Chinese shows the Chinese stage, notice and module', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('cm.practice.locale', 'zh-Hant'));
    await page.goto('/s/eft');
    await expect(page.getByRole('heading', { level: 1, name: '情緒聚焦治療' })).toBeVisible();
    const note = page.getByRole('complementary', { name: zhHant.eft.noticeLabel });
    await expect(note).toContainText('父親已經過世');
    await expect(note).toContainText('找督導談一談');
    await expect(page.getByRole('link', { name: /同理調頻與同理探索/ })).toBeVisible();
    await page.goto('/s/eft/m/eft-attunement/drills/easy');
    await expect(page.getByText(/我回到家，家裡很靜/)).toBeVisible();
  });
});
