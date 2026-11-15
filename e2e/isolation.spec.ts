import { expect, test } from '@playwright/test';
import { createCohortAs, createUser, hasBackend, joinAs, makeSupervisor, signInBrowser } from './helpers/backend';

// NOT RUN in the phase 2 build session: there was no Supabase project. Needs the E2E_SUPABASE_* variables
// (see helpers/backend.ts) and an app built against the same project.
test.skip(!hasBackend, 'needs E2E_SUPABASE_URL / _ANON_KEY / _SERVICE_KEY');

const SECRET = 'student A private words, long enough to count as met';

async function answerOne(page: import('@playwright/test').Page, text: string) {
  await page.goto('/m/intake/drills/easy');
  await page.getByRole('textbox', { name: /your response/i }).fill(text);
  await page.getByRole('button', { name: /submit response/i }).click();
  const boxes = page.getByRole('checkbox');
  await boxes.nth(0).check();
  await boxes.nth(1).check();
  await page.getByRole('button', { name: /save self-check/i }).click();
  await expect(page.getByText('Example response')).toBeVisible();
}

test('student B never receives student A data', async ({ browser }) => {
  const sup = await createUser('sup'); await makeSupervisor(sup, 'Sup');
  const { code } = await createCohortAs(sup, 'Iso');
  const a = await createUser('a'), b = await createUser('b');
  await joinAs(a, code, 'Pseudonym A'); await joinAs(b, code, 'Pseudonym B');

  const ctxA = await browser.newContext(); await signInBrowser(ctxA, a);
  await answerOne(await ctxA.newPage(), SECRET);

  const ctxB = await browser.newContext(); await signInBrowser(ctxB, b);
  const pageB = await ctxB.newPage();
  const bodies: string[] = [];
  pageB.on('response', async (r) => {
    if (r.url().includes('/rest/v1/')) bodies.push(await r.text().catch(() => ''));
  });
  await pageB.goto('/');
  await pageB.goto('/m/intake');
  await pageB.goto('/m/intake/drills/easy');
  await pageB.waitForLoadState('networkidle');
  expect(bodies.length).toBeGreaterThan(0);
  for (const body of bodies) {
    expect(body).not.toContain(a.id);
    expect(body).not.toContain(SECRET);
  }
});

test('progress made on one device appears on another after sign-in', async ({ browser }) => {
  const sup = await createUser('sup2'); await makeSupervisor(sup, 'Sup2');
  const { code } = await createCohortAs(sup, 'Devices');
  const s = await createUser('dev'); await joinAs(s, code, 'Dev');

  const phone = await browser.newContext(); await signInBrowser(phone, s);
  await answerOne(await phone.newPage(), SECRET);

  const laptop = await browser.newContext(); await signInBrowser(laptop, s);
  const page = await laptop.newPage();
  await page.goto('/m/intake/drills/easy');
  await expect(page.getByText(SECRET)).toBeVisible(); // listed under "Earlier attempts"
});
