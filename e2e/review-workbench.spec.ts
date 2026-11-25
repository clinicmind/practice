import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

// The review workbench is one self-contained file opened straight from disk (file://), so these tests
// need no web server. Built from the multi-stage fixture, which has English and Traditional Chinese.
const FIXTURE = join(process.cwd(), 'tests', 'fixtures', 'content', 'multi');
const outDir = mkdtempSync(join(tmpdir(), 'wb-e2e-'));
let url = '';
let ids: string[] = [];

test.beforeAll(() => {
  const root = process.cwd();
  execFileSync(
    'npx',
    ['tsx', '-e', `import { buildWorkbench } from './scripts/build-review-workbench';
      const r = buildWorkbench({ contentDir: ${JSON.stringify(FIXTURE)}, reviewsDir: ${JSON.stringify(join(outDir, 'none'))}, outDir: ${JSON.stringify(outDir)}, stage: 'demo' });
      console.log(r.file);`],
    { cwd: root, encoding: 'utf8' },
  );
  const file = join(outDir, readdirSync(outDir).find((f) => f.endsWith('.html'))!);
  url = `file://${file}`;
  const data = JSON.parse(/id="wb-data">([\s\S]*?)<\/script>/.exec(readFileSync(file, 'utf8'))![1]);
  ids = data.modules[0].ids;
});

const article = (page: import('@playwright/test').Page, id: string) => page.locator(`article.item[data-id="${id}"]`);

test.describe('review workbench opened from a file', () => {
  test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

  test('starts at 0 of N and counts a decision when "同意" is pressed', async ({ page }) => {
    await page.goto(url);
    await expect(page.locator('#seen')).toHaveText('0');
    await expect(page.locator('#total')).toHaveText(String(ids.length));
    await article(page, 'demo-intro-e01').getByRole('button', { name: '同意' }).click();
    await expect(page.locator('#seen')).toHaveText('1');
    await expect(article(page, 'demo-intro-e01').getByRole('button', { name: '同意' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('the decision and the note are still there after a reload', async ({ page }) => {
    await page.goto(url);
    const card = article(page, 'demo-intro-e02');
    await card.getByRole('button', { name: '要修改' }).click();
    await card.getByLabel('備註').fill('標準 2 沒有試探詞');
    await article(page, 'demo-intro').getByRole('button', { name: '同意' }).click();
    await page.reload();
    await expect(page.locator('#seen')).toHaveText('2');
    await expect(article(page, 'demo-intro-e02').getByRole('button', { name: '要修改' })).toHaveAttribute('aria-pressed', 'true');
    await expect(article(page, 'demo-intro-e02').getByLabel('備註')).toHaveValue('標準 2 沒有試探詞');
    await expect(article(page, 'demo-intro').getByRole('button', { name: '同意' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('"複製決定" puts valid JSON in the clipboard, in the agreed shape', async ({ page }) => {
    await page.goto(url);
    await article(page, 'demo-intro-e02').getByRole('button', { name: '要修改' }).click();
    await article(page, 'demo-intro-e02').getByLabel('備註').fill('改成「也許」');
    await article(page, 'demo-intro-e01').getByRole('button', { name: '同意' }).click();
    await page.getByRole('button', { name: '複製決定' }).click();
    await expect(page.locator('#toast')).toContainText('已複製');
    const text = await page.evaluate(() => navigator.clipboard.readText());
    const json = JSON.parse(text);
    expect(json).toEqual({
      stage: 'demo',
      module: 'demo-intro',
      version: '1.0.0',
      decisions: [
        { id: 'demo-intro-e01', status: 'agree', note: '' },
        { id: 'demo-intro-e02', status: 'revise', note: '改成「也許」' },
      ],
    });
  });

  test('pressing the same button again takes the decision back', async ({ page }) => {
    await page.goto(url);
    const btn = article(page, 'demo-intro-e03').getByRole('button', { name: '同意' });
    await btn.click();
    await btn.click();
    await expect(page.locator('#seen')).toHaveText('0');
    await expect(article(page, 'demo-intro-e03').getByLabel('備註')).toBeDisabled();
  });

  test('still works when the browser refuses to store anything', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', {
        get() { throw new DOMException('denied', 'SecurityError'); },
      });
    });
    await page.goto(url);
    await article(page, 'demo-intro-e01').getByRole('button', { name: '同意' }).click();
    await expect(page.locator('#seen')).toHaveText('1');
    await expect(page.locator('#storage-warning')).toBeVisible();
    await page.getByRole('button', { name: '複製決定' }).click();
    const json = JSON.parse(await page.evaluate(() => navigator.clipboard.readText()));
    expect(json.decisions).toEqual([{ id: 'demo-intro-e01', status: 'agree', note: '' }]);
  });

  test('when the clipboard is refused, the JSON is shown ready to copy by hand', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('no')) } });
      document.execCommand = () => false;
    });
    await page.goto(url);
    await article(page, 'demo-intro-e01').getByRole('button', { name: '同意' }).click();
    await page.getByRole('button', { name: '複製決定' }).click();
    const box = page.locator('#fallback textarea');
    await expect(box).toBeVisible();
    expect(JSON.parse(await box.inputValue()).decisions).toHaveLength(1);
  });

  test('English and Chinese sit side by side on a desktop, and stack on a phone', async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 800 });
    await page.goto(url);
    const cols = article(page, 'demo-intro-e01').locator('.col');
    const [a, b] = [await cols.nth(0).boundingBox(), await cols.nth(1).boundingBox()];
    expect(b!.x).toBeGreaterThan(a!.x + a!.width - 2);
    expect(Math.abs(a!.y - b!.y)).toBeLessThan(2);
    await page.setViewportSize({ width: 375, height: 800 });
    const [c, d] = [await cols.nth(0).boundingBox(), await cols.nth(1).boundingBox()];
    expect(d!.y).toBeGreaterThan(c!.y + c!.height - 2);
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(376);
  });
});
