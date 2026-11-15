import { expect, test } from '@playwright/test';
import { createCohortAs, createUser, hasBackend, joinAs, makeSupervisor, signInBrowser } from './helpers/backend';

// NOT RUN in the phase 2 build session: there was no Supabase project.
test.skip(!hasBackend, 'needs E2E_SUPABASE_URL / _ANON_KEY / _SERVICE_KEY');

test('supervisor sees A and B; the other supervisor sees neither', async ({ browser }) => {
  const s1 = await createUser('s1'); await makeSupervisor(s1, 'Sup One');
  const s2 = await createUser('s2'); await makeSupervisor(s2, 'Sup Two');
  const c1 = await createCohortAs(s1, 'Cohort One');
  await createCohortAs(s2, 'Cohort Two');
  const a = await createUser('sa'), b = await createUser('sb');
  await joinAs(a, c1.code, 'Student Alpha'); await joinAs(b, c1.code, 'Student Beta');

  const ctx1 = await browser.newContext(); await signInBrowser(ctx1, s1);
  const p1 = await ctx1.newPage(); await p1.goto('/supervisor');
  await expect(p1.getByRole('link', { name: 'Student Alpha' })).toBeVisible();
  await expect(p1.getByRole('link', { name: 'Student Beta' })).toBeVisible();

  const ctx2 = await browser.newContext(); await signInBrowser(ctx2, s2);
  const p2 = await ctx2.newPage(); await p2.goto('/supervisor');
  await expect(p2.getByRole('heading', { name: 'Cohort Two' })).toBeVisible();
  await expect(p2.getByText('Student Alpha')).toHaveCount(0);
  await expect(p2.getByText('Student Beta')).toHaveCount(0);
  await p2.goto(`/supervisor/students/${a.id}`);
  await expect(p2.getByText(/not found in your cohorts/i)).toBeVisible();
});

test('a student who opens /supervisor sees the not-found page', async ({ browser }) => {
  const s = await createUser('s3'); await makeSupervisor(s, 'Sup Three');
  const { code } = await createCohortAs(s, 'Cohort Three');
  const st = await createUser('st'); await joinAs(st, code, 'Student');
  const ctx = await browser.newContext(); await signInBrowser(ctx, st);
  const page = await ctx.newPage(); await page.goto('/supervisor');
  await expect(page.getByRole('heading', { name: /page not found/i })).toBeVisible();
});
