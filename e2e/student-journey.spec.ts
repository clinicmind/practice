import { expect, test, type Page } from '@playwright/test';

const LONG = 'A response that is long enough to count.';

async function answerDrill(page: Page, tickCount = 2) {
  await page.getByRole('textbox', { name: /your response/i }).fill(LONG);
  await page.getByRole('button', { name: /submit response/i }).click();
  const boxes = page.getByRole('checkbox');
  for (let i = 0; i < tickCount; i++) await boxes.nth(i).check();
  await page.getByRole('button', { name: /save self-check/i }).click();
  await expect(page.getByText('Example response')).toBeVisible();
}

test('student completes easy level and unlocks medium', async ({ page }) => {
  await page.goto('/m/intake');
  await expect(page.getByRole('link', { name: /medium/i })).toHaveCount(0);
  await page.getByRole('link', { name: /easy/i }).click();
  for (let i = 0; i < 8; i++) {
    await answerDrill(page);
    await page.getByRole('button', { name: /next question/i }).click();
  }
  await page.getByRole('link', { name: /back to module/i }).click();
  await expect(page.getByText('8 / 10 met')).toBeVisible();
  const medium = page.getByRole('link', { name: /medium/i });
  await expect(medium).toBeVisible();
  await medium.click();
  await expect(page).toHaveURL(/\/m\/intake\/drills\/medium$/);
  await expect(page.getByRole('textbox', { name: /your response/i })).toBeVisible();
});

test('seven met questions do not pass the level', async ({ page }) => {
  await page.goto('/m/intake/drills/easy');
  for (let i = 0; i < 7; i++) {
    await answerDrill(page);
    await page.getByRole('button', { name: /next question/i }).click();
  }
  await page.goto('/m/intake');
  await expect(page.getByText('7 / 10 met')).toBeVisible();
  await expect(page.getByRole('link', { name: /medium/i })).toHaveCount(0);
});

test('models.json is never requested before the first saved attempt', async ({ page }) => {
  const hits: string[] = [];
  page.on('request', (r) => r.url().includes('models.json') && hits.push(r.url()));
  await page.goto('/');
  await page.goto('/m/intake');
  await page.goto('/m/intake/walkthrough/intake-s1');
  await page.goto('/m/intake/reflect');
  await page.goto('/m/intake/drills/easy');
  await page.getByRole('textbox', { name: /your response/i }).fill(LONG);
  expect(hits).toHaveLength(0);
  await page.getByRole('button', { name: /submit response/i }).click();
  await page.getByRole('checkbox').first().check();
  await page.waitForTimeout(300);
  expect(hits).toHaveLength(0); // self-check step: still nothing
  const responded = page.waitForResponse((r) => r.url().includes('models.json'));
  await page.getByRole('button', { name: /save self-check/i }).click();
  await responded;
  await expect(page.getByText('Example response')).toBeVisible();
  expect(hits).toHaveLength(1);
});

test('progress survives a reload', async ({ page }) => {
  await page.goto('/m/intake/drills/easy');
  await answerDrill(page);
  await page.goto('/m/intake');
  await expect(page.getByText('1 / 10 met')).toBeVisible();
  await page.reload();
  await expect(page.getByText('1 / 10 met')).toBeVisible();
});

test('two tabs answering at once keep both answers', async ({ browser }) => {
  const ctx = await browser.newContext();
  const a = await ctx.newPage();
  const b = await ctx.newPage();
  await a.goto('/m/intake/drills/easy');
  await b.goto('/m/intake/drills/easy');
  await answerDrill(a);
  await answerDrill(b);
  await a.goto('/m/intake');
  await expect(a.getByText('1 / 10 met')).toBeVisible();
  const stored = await a.evaluate(() => JSON.parse(localStorage.getItem('cm.practice.v1')!).attempts.length);
  expect(stored).toBe(2);
  await ctx.close();
});

test('corrupt storage does not white-screen; backup kept and notice shown once', async ({ page }) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem('cm.practice.v1', '{broken');
      sessionStorage.setItem('seeded', '1');
    }
  });
  await page.goto('/');
  await expect(page.getByRole('status')).toContainText(/could not be read/i);
  await expect(page.getByRole('link', { name: /Intake \(fixture\)/ })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('cm.practice.v1.corrupt'))).toBe('{broken');
  await page.reload();
  await expect(page.getByRole('link', { name: /Intake \(fixture\)/ })).toBeVisible();
  await expect(page.getByText(/could not be read/i)).toHaveCount(0);
});

test('deep links to locked content redirect with a reason (server fallback works)', async ({ page }) => {
  await page.goto('/m/intake/drills/hard');
  await expect(page).toHaveURL(/\/m\/intake$/);
  await expect(page.getByRole('status')).toContainText(/pass medium first/i);
  await page.goto('/m/alliance');
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('status')).toContainText(/finish the intake.*walkthrough first/i);
  await page.goto('/nowhere/at/all');
  await expect(page.getByRole('heading', { name: /page not found/i })).toBeVisible();
});

test.describe('usable at 360px wide', () => {
  test.use({ viewport: { width: 360, height: 740 } });
  test('no horizontal scroll on stage, module, drill, walkthrough pages', async ({ page }) => {
    const noOverflow = async () => {
      const [sw, cw] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
      expect(sw).toBeLessThanOrEqual(cw);
    };
    await page.goto('/');
    await expect(page.getByRole('link', { name: /Intake/ })).toBeVisible();
    await noOverflow();
    await page.goto('/m/intake');
    await expect(page.getByRole('heading', { name: /Intake/ })).toBeVisible();
    await noOverflow();
    await page.goto('/m/intake/drills/easy');
    await page.getByRole('textbox', { name: /your response/i }).fill('x'.repeat(200));
    await page.getByRole('button', { name: /submit response/i }).click();
    await noOverflow();
    await page.getByRole('checkbox').first().check();
    await page.getByRole('button', { name: /save self-check/i }).click();
    await expect(page.getByText('Example response')).toBeVisible();
    await noOverflow();
    await page.goto('/m/intake/walkthrough/intake-s1');
    await expect(page.getByText(/What would you say next/)).toBeVisible();
    await noOverflow();
    await page.getByRole('radio').first().check();
    await page.getByRole('button', { name: /confirm choice/i }).click();
    await expect(page.getByText(/What the therapist actually said/).first()).toBeVisible();
    await noOverflow();
    await page.goto('/m/intake/reflect');
    await expect(page.getByRole('heading', { name: /Reflect/ })).toBeVisible();
    await noOverflow();
  });
});

test('whole drill can be done with the keyboard only', async ({ page }) => {
  await page.goto('/m/intake/drills/easy');
  const tabTo = async (name: RegExp, role: 'textbox' | 'button' | 'checkbox' | 'radio') => {
    const target = page.getByRole(role, { name });
    for (let i = 0; i < 40; i++) {
      if (await target.evaluate((el) => el === document.activeElement).catch(() => false)) return;
      await page.keyboard.press('Tab');
    }
    throw new Error(`could not reach ${role} ${name} with Tab`);
  };
  await tabTo(/your response/i, 'textbox');
  await page.keyboard.type(LONG);
  await tabTo(/submit response/i, 'button');
  await page.keyboard.press('Enter');
  await tabTo(/criterion one/i, 'checkbox');
  await page.keyboard.press('Space');
  await tabTo(/criterion two/i, 'checkbox');
  await page.keyboard.press('Space');
  await tabTo(/save self-check/i, 'button');
  await page.keyboard.press('Enter');
  await expect(page.getByText('Example response')).toBeVisible();
  await tabTo(/next question/i, 'button');
  await page.keyboard.press('Enter');
  await expect(page.getByText('Question 2 of 10')).toBeVisible();
});

test('walkthrough can be done with the keyboard only', async ({ page }) => {
  await page.goto('/m/intake/walkthrough/intake-s1');
  const tabTo = async (name: RegExp, role: 'textbox' | 'button' | 'radio') => {
    const target = page.getByRole(role, { name });
    for (let i = 0; i < 40; i++) {
      if (await target.evaluate((el) => el === document.activeElement).catch(() => false)) return;
      await page.keyboard.press('Tab');
    }
    throw new Error(`could not reach ${role} ${name} with Tab`);
  };
  await tabTo(/Option A text/, 'radio');
  await page.keyboard.press('ArrowDown'); // radio groups move with arrows: now Option B
  await tabTo(/confirm choice/i, 'button');
  await page.keyboard.press('Enter');
  await expect(page.getByText('Why B is workable.')).toBeVisible();
  await tabTo(/your response/i, 'textbox');
  await page.keyboard.type('my own words');
  await tabTo(/submit response/i, 'button');
  await page.keyboard.press('Enter');
  await expect(page.getByText(/Goals note/)).toBeVisible();
});
