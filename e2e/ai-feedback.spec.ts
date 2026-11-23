import { expect, test, type Page } from '@playwright/test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { en } from '../src/i18n/en';
import { zhHant } from '../src/i18n/zh-Hant';

// Two builds of the same app, from the fixture content: port 4173 is the normal build (what the live site is);
// port 4177 has AI feedback switched on with a stand-in backend. All text below is fictional.
const ON = 'http://127.0.0.1:4177';
const t = en.aiFeedback;
const ANSWER = 'What brought you here today? Please take your time with it.';

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}
const js = (dir: string) => files(dir).filter((p) => p.endsWith('.js'));

async function saveSelfCheck(page: Page, answer = ANSWER, ticks = 2) {
  await page.getByRole('textbox', { name: /your response/i }).fill(answer);
  await page.getByRole('button', { name: /submit response/i }).click();
  const boxes = page.getByRole('checkbox');
  for (let i = 0; i < ticks; i++) await boxes.nth(i).check();
  await page.getByRole('button', { name: /save self-check/i }).click();
  await expect(page.getByText('Example response')).toBeVisible();
}

test.describe('normal build: AI feedback does not exist', () => {
  test('after saving a self-check there is no AI button, and nothing is requested from an AI function', async ({ page }) => {
    const hits: string[] = [];
    page.on('request', (r) => /functions\/v1\/ai|ai_feedback|ai-feedback/.test(r.url()) && hits.push(r.url()));
    await page.goto('/m/intake/drills/easy');
    await saveSelfCheck(page);
    await page.waitForTimeout(300);
    await expect(page.getByRole('button', { name: t.askButton })).toHaveCount(0);
    await expect(page.getByText(t.panelHeading)).toHaveCount(0);
    expect(hits).toEqual([]);
  });

  test('the shipped files hold no AI client, no stand-in, no panel code and no function address', () => {
    for (const f of js('dist')) {
      const text = readFileSync(f, 'utf8');
      expect(text, f).not.toContain('functions/v1/ai-feedback');
      expect(text, f).not.toContain('e2e-fake-ai-feedback-api');
      expect(text, f).not.toContain('e2e-fake-supervisor-backend');
      expect(text, f).not.toContain('ai-criteria'); // the panel's markup
    }
  });

  test('the stand-in is in the AI build, so the check above can fail', () => {
    expect(js('dist-ai').some((f) => readFileSync(f, 'utf8').includes('e2e-fake-ai-feedback-api'))).toBe(true);
    expect(js('dist-ai').some((f) => readFileSync(f, 'utf8').includes('ai-criteria'))).toBe(true);
  });
});

test.describe('AI-on build: student', () => {
  test.use({ baseURL: ON });

  test('save → button → panel with the marked words; reload keeps it', async ({ page }) => {
    await page.goto('/m/intake/drills/easy');
    await saveSelfCheck(page);
    const ask = page.getByRole('button', { name: t.askButton });
    await expect(ask).toBeVisible();
    await ask.click();
    await expect(page.getByText(t.caveat)).toBeVisible();
    const rows = page.getByRole('list', { name: t.tableCaption }).getByRole('listitem');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(1)).toContainText(t.differs); // self-check [met, met, not met] against the stand-in's [met, not met, met]
    await expect(page.locator('.ai-response mark')).toContainText('What brought you here');

    // Reload: back at the question, the stored check is shown without pressing anything.
    await page.reload();
    await expect(page.getByRole('heading', { name: t.previousSummary })).toBeVisible();
    await expect(page.getByText(t.caveat)).toBeVisible();
    await expect(page.getByRole('button', { name: t.askButton })).toHaveCount(0);
  });

  test('nothing is asked of the AI until the button is pressed', async ({ page }) => {
    await page.goto('/m/intake/drills/easy');
    await saveSelfCheck(page);
    await expect(page.getByRole('button', { name: t.askButton })).toBeVisible();
    await expect(page.getByText(t.caveat)).toHaveCount(0);
    expect(await page.evaluate(() => sessionStorage.getItem('e2e-fake-ai-feedback-api-results'))).toBeNull();
  });

  test('a response the stand-in marks as risk content shows only the safety line', async ({ page }) => {
    await page.goto('/m/intake/drills/easy');
    await saveSelfCheck(page, 'This is a fictional risk-words answer, long enough to count.');
    await page.getByRole('button', { name: t.askButton }).click();
    await expect(page.getByText(t.riskNote)).toBeVisible();
    await expect(page.getByText(t.suggestionHeading)).toHaveCount(0);
    await expect(page.getByRole('list', { name: t.tableCaption })).toHaveCount(0);
  });

  test('an error shows its message and drills keep working', async ({ page }) => {
    await page.goto('/m/intake/drills/easy');
    await saveSelfCheck(page, 'This is a fictional budget-gone answer, long enough to count.');
    await page.getByRole('button', { name: t.askButton }).click();
    await expect(page.getByRole('alert')).toHaveText(t.errors.budget_exhausted!);
    await expect(page.getByRole('button', { name: /next question/i })).toBeEnabled();
  });

  test('the same screens work in Traditional Chinese', async ({ page }) => {
    await page.goto('/m/intake/drills/easy');
    await page.getByRole('button', { name: '繁體中文' }).click();
    await page.getByRole('textbox').fill(ANSWER);
    await page.getByRole('button', { name: zhHant.drill.submit }).click();
    await page.getByRole('checkbox').first().check();
    await page.getByRole('checkbox').nth(1).check();
    await page.getByRole('button', { name: zhHant.drill.saveSelfCheck }).click();
    await page.getByRole('button', { name: zhHant.aiFeedback.askButton }).click();
    await expect(page.getByText(zhHant.aiFeedback.caveat)).toBeVisible();
    await expect(page.getByText(zhHant.aiFeedback.differs).first()).toBeVisible();
  });

  test.describe('at 360px wide', () => {
    test.use({ viewport: { width: 360, height: 740 } });
    test('the panel does not scroll sideways', async ({ page }) => {
      await page.goto('/m/intake/drills/easy');
      await saveSelfCheck(page);
      await page.getByRole('button', { name: t.askButton }).click();
      await expect(page.getByText(t.caveat)).toBeVisible();
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(over).toBeLessThanOrEqual(0);
    });
  });
});

test.describe('AI-on build: supervisor (seeded stand-in database)', () => {
  test.use({ baseURL: ON });
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => sessionStorage.setItem('e2e-fake-user', 'sup'));
  });

  test('class page: risk flag first, differences by student, usage against the limit', async ({ page }) => {
    await page.goto('/supervisor');
    const s = t.supervisor;
    await expect(page.getByRole('heading', { name: s.heading })).toBeVisible();
    await expect(page.getByRole('region', { name: s.riskHeading }).getByRole('link', { name: s.riskItem('Bea', 'intake-e02') })).toBeVisible();
    const diffs = page.getByRole('table', { name: s.caption });
    await expect(diffs.getByRole('row').nth(1)).toContainText('Alice');
    await expect(page.getByRole('region', { name: t.usage.heading })).toContainText('US$');
    await expect(page.getByRole('progressbar', { name: t.usage.barLabel })).toBeVisible();
  });

  test('student page: each checked response shows its differences', async ({ page }) => {
    await page.goto('/supervisor');
    await page.getByRole('link', { name: 'Alice' }).first().click();
    await expect(page.getByText(t.supervisor.selfOnly('intake-e02 criterion one'))).toBeVisible();
    await expect(page.getByText(t.supervisor.aiOnly('intake-e01 criterion three'))).toBeVisible();
    await expect(page.getByText(t.supervisor.agreeFlag)).toBeVisible();
  });

  test.describe('at 360px wide', () => {
    test.use({ viewport: { width: 360, height: 740 } });
    test('the class page does not scroll the page sideways', async ({ page }) => {
      await page.goto('/supervisor');
      await expect(page.getByRole('heading', { name: t.supervisor.heading })).toBeVisible();
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(over).toBeLessThanOrEqual(0);
    });
  });
});
