import { expect, test, type Page } from '@playwright/test';
import { readdirSync, readFileSync, statSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

// Port 4173 is the normal build: the live site as students get it (fixes on, extras off).
// Port 4178 has VITE_PRACTICE_EXTRAS=true. All text below is fictional.
const ON = 'http://127.0.0.1:4178';
const LONG = 'A response that is long enough to count.';
const SHOTS = process.env.SHOT_DIR;

function js(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? js(p) : p.endsWith('.js') ? [p] : [];
  });
}
// Code that only exists in the extras screens.
const MARKERS = ['cm.review.v1', 'revise-pair', 'prep-blank'];

async function answer(page: Page, ticks = 2) {
  await page.getByRole('textbox', { name: /your response/i }).fill(LONG);
  await page.getByRole('button', { name: /submit response/i }).click();
  for (let i = 0; i < ticks; i++) await page.getByRole('checkbox').nth(i).check();
  await page.getByRole('button', { name: /save self-check/i }).click();
  await expect(page.getByText('Example response')).toBeVisible();
}
const noOverflow = async (page: Page) => {
  const [sw, cw] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(sw).toBeLessThanOrEqual(cw);
};
async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true });
}

test.describe('phone and accessibility fixes (live for everyone)', () => {
  test.use({ viewport: { width: 320, height: 320 } }); // a short viewport stands in for the on-screen keyboard
  test('the client\'s words stay on screen while typing, and fold to one line', async ({ page }) => {
    await page.goto('/m/intake/drills/easy');
    const bar = page.locator('.client-bar');
    const box = page.getByRole('textbox', { name: /your response/i });
    await box.fill('x\n'.repeat(30));
    await box.focus();
    // What a phone does when the keyboard opens: bring the focused box into view, at the bottom of what is left.
    await box.evaluate((el) => el.scrollIntoView({ block: 'end' }));
    const inView = async () => bar.evaluate((el) => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= window.innerHeight; });
    await expect(bar).toContainText('Fixture client statement for intake-e01');
    expect(await inView()).toBe(true);
    await expect(box).toBeInViewport();
    const full = (await bar.boundingBox())!.height;
    const toggle = page.getByRole('button', { name: /client's words/i });
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect((await bar.boundingBox())!.height).toBeLessThanOrEqual(full);
    expect(await inView()).toBe(true);
    await noOverflow(page);
  });
});

test.describe('fixes at 360px', () => {
  test.use({ viewport: { width: 360, height: 740 } });
  test('a half-written answer survives a language switch and a reload', async ({ page }) => {
    await page.goto('/m/intake/drills/easy');
    await page.getByRole('textbox', { name: /your response/i }).fill('Half written answer');
    await page.getByRole('button', { name: '繁體中文' }).click();
    await expect(page.getByRole('textbox', { name: '你的回應' })).toHaveValue('Half written answer');
    await page.getByRole('button', { name: 'English' }).click();
    await expect(page.getByRole('textbox', { name: 'Your response' })).toHaveValue('Half written answer');
    await page.reload();
    await expect(page.getByRole('textbox', { name: 'Your response' })).toHaveValue('Half written answer');
  });

  test('the result is in words, and the keyboard reaches the reason', async ({ page }) => {
    await page.goto('/m/intake/drills/easy');
    await answer(page, 2);
    const list = page.getByRole('list', { name: 'Your self-check' });
    await expect(list.locator('li').nth(0)).toContainText('Ticked');
    await expect(list.locator('li').nth(2)).toContainText('Not ticked');
    await expect(page.getByText('Counted as met.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Your response' })).toBeFocused();
    await page.keyboard.press('Tab');
    const region = page.getByRole('region', { name: 'Example response' });
    await expect(region).toBeFocused();
    await expect(region).toContainText('Fixture reason for intake-e01');
    await noOverflow(page);
    await shot(page, 'normal-360-review');
  });
});

test.describe('extras are off in the normal build', () => {
  test('no extras code in the shipped files, no extras page, no revise box, nothing stored', async ({ page }) => {
    for (const f of js('dist')) {
      const text = readFileSync(f, 'utf8');
      for (const m of MARKERS) expect(text, `${f} contains ${m}`).not.toContain(m);
    }
    const requested: string[] = [];
    page.on('request', (r) => requested.push(r.url()));
    await page.goto('/m/intake/drills/easy');
    await answer(page);
    await expect(page.getByText('Revise once more')).toHaveCount(0);
    await page.goto('/');
    await expect(page.getByRole('link', { name: /supervision prep/i })).toHaveCount(0);
    for (const url of ['/review', '/supervision-prep']) {
      await page.goto(url);
      await expect(page.getByRole('heading', { name: /page not found/i })).toBeVisible();
    }
    expect(await page.evaluate(() => localStorage.getItem('cm.review.v1'))).toBeNull();
    expect(requested.filter((u) => /extras|ReviseOnce|PrepPage|ReviewPage|HomeCards/.test(u))).toEqual([]);
  });
});

test.describe('extras on (VITE_PRACTICE_EXTRAS=true build)', () => {
  test.use({ baseURL: ON });
  test('the extras code is in this build', () => {
    const all = js('dist-extras').map((f) => readFileSync(f, 'utf8')).join('\n');
    for (const m of MARKERS) expect(all).toContain(m);
  });

  for (const [label, viewport] of [['desktop', { width: 1100, height: 800 }], ['360', { width: 360, height: 740 }]] as const) {
    test(`revise once more, ${label}: two versions side by side, not saved, no effect on passing`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto('/m/intake/drills/easy');
      await answer(page, 2);
      await page.getByRole('textbox', { name: 'Your second version' }).fill('Second try, with the example in mind.');
      await page.getByRole('radio', { name: /criterion three/ }).check();
      await page.getByRole('button', { name: 'Put the two versions side by side' }).click();
      const pair = page.getByRole('group', { name: 'Your two versions' });
      await expect(pair).toContainText(LONG);
      await expect(pair).toContainText('Second try, with the example in mind.');
      await noOverflow(page);
      await shot(page, `extras-${label}-revise`);
      const state = JSON.parse((await page.evaluate(() => localStorage.getItem('cm.practice.v1')))!);
      expect(state.attempts).toHaveLength(1);
      expect(JSON.stringify(state)).not.toContain('Second try');
      await page.goto('/m/intake');
      await expect(page.getByText('1 / 10 met')).toBeVisible();
    });
  }

  test('supervision prep sheet: choose up to 3, print layout shows only the sheet, no account details', async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 900 });
    await page.goto('/m/intake/drills/easy');
    for (let i = 0; i < 4; i++) {
      await answer(page);
      await page.getByRole('button', { name: /next question/i }).click();
    }
    await page.goto('/m/intake/reflect');
    await page.getByRole('textbox').first().fill('What I noticed in this module.');
    await page.getByRole('button', { name: 'Save reflection' }).first().click();
    await page.goto('/');
    await page.getByRole('link', { name: 'Supervision prep sheet' }).click();
    const boxes = page.getByRole('checkbox');
    await expect(boxes).toHaveCount(4);
    for (let i = 0; i < 3; i++) await boxes.nth(i).check();
    await expect(boxes.nth(3)).toBeDisabled();
    await page.getByRole('radio', { name: /What I noticed/ }).check();
    await shot(page, 'extras-desktop-prep');
    await page.emulateMedia({ media: 'print' });
    await expect(page.locator('.site-header')).toBeHidden();
    await expect(page.locator('.no-print').first()).toBeHidden();
    const sheet = page.getByRole('article', { name: /Deliberate practice reflection \(fictional client/ });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole('heading')).toHaveText([
      'Deliberate practice reflection (fictional client: do not write real client information)',
      'What I practised this week', 'What I tried', 'What I want to practise in supervision',
    ]);
    await expect(sheet.getByText('What I noticed in this module.')).toBeVisible();
    const pdf = await page.pdf();
    expect(pdf.length).toBeGreaterThan(1000);
    await page.emulateMedia({ media: 'screen' });
    await page.setViewportSize({ width: 360, height: 740 });
    await noOverflow(page);
    await shot(page, 'extras-360-prep');
  });

  test('mixed review: card, answer first, earlier answer and example after, progress unchanged', async ({ page }) => {
    await page.addInitScript(() => {
      if (localStorage.getItem('cm.practice.v1')) return;
      const at = new Date(Date.now() - 5 * 86_400_000).toISOString();
      const mk = (id: string, n: number) => ({ id: `a-${id}`, itemId: id, response: `Earlier answer for ${id}, long enough.`, criteriaMet: [0, 1, 2].map((k) => k < n), createdAt: at });
      localStorage.setItem('cm.practice.v1', JSON.stringify({ version: 1, attempts: [mk('intake-e01', 2), mk('intake-e02', 3), mk('intake-e03', 3)], decisions: [], reflections: [] }));
    });
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto('/');
    await expect(page.getByText(/3 earlier questions are ready/)).toBeVisible();
    await shot(page, 'extras-360-home');
    await page.getByRole('link', { name: 'Start mixed review' }).click();
    await expect(page.getByText('Review 1 of 3')).toBeVisible();
    await expect(page.getByText(/Intake \(fixture\)/)).toHaveCount(0);
    await expect(page.getByText('Earlier answer for intake-e01')).toHaveCount(0);
    await page.getByRole('textbox', { name: 'Your answer now' }).fill('From memory.');
    await page.getByRole('button', { name: 'Show my earlier answer and the example' }).click();
    await expect(page.getByText('Earlier answer for intake-e01, long enough.')).toBeVisible();
    await expect(page.getByText('Fixture demonstration for intake-e01.')).toBeVisible();
    await noOverflow(page);
    await shot(page, 'extras-360-review');
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByRole('button', { name: 'Skip this one' }).click();
    await page.getByRole('button', { name: 'Skip this one' }).click();
    await expect(page.getByText('You reviewed 1 and skipped 2.')).toBeVisible();
    const state = JSON.parse((await page.evaluate(() => localStorage.getItem('cm.practice.v1')))!);
    expect(state.attempts).toHaveLength(3);
    const log = JSON.parse((await page.evaluate(() => localStorage.getItem('cm.review.v1')))!);
    expect(log.map((e: { kind: string }) => e.kind)).toEqual(['done', 'skipped', 'skipped']);
  });
});
