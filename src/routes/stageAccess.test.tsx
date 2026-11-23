import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { buildContent } from '../../scripts/build-content';
import { App } from '../App';
import { en } from '../i18n/en';
import { LOCALE_KEY } from '../i18n';
import { zhHant } from '../i18n/zh-Hant';
import { createLocalStore } from '../progress/localStore';
import { buildFixture, Mem, PathSpy, renderCloud, serve, spy } from '../test/appHarness';
import { createFakeDb, type FakeDb } from '../test/fakeDb';
import { createFakeBackend, type ProfileRow } from '../test/fakeSupabase';

const STUDENT: ProfileRow = { id: 'stu', role: 'student', display_name: 'Pat', cohort_id: 'c1' };
const SUPERVISOR: ProfileRow = { id: 'sup', role: 'supervisor', display_name: 'Dr S', cohort_id: null };

let multi = '';
let single = '';
let demoUnreviewed = '';
let demoUnreviewedPreview = '';
beforeAll(async () => {
  multi = await buildFixture('multi');
  single = await buildFixture('ok-reviewed');
  // Same two stages, but the demo module has not been reviewed.
  const dir = mkdtempSync(join(tmpdir(), 'fx-demo-unreviewed-'));
  cpSync(join(__dirname, '..', '..', 'tests', 'fixtures', 'content', 'multi'), dir, { recursive: true });
  const review = readFileSync(join(dir, 'REVIEW.md'), 'utf8').split('\n').filter((l) => !l.includes('demo-intro')).join('\n');
  writeFileSync(join(dir, 'REVIEW.md'), review);
  demoUnreviewed = mkdtempSync(join(tmpdir(), 'out-demo-unreviewed-'));
  for (const locale of ['en', 'zh-Hant'] as const) await buildContent({ contentDir: dir, outDir: demoUnreviewed, locale });
  // The authoring preview ships such a stage. The app must still hide it from students and show it to supervisors.
  demoUnreviewedPreview = mkdtempSync(join(tmpdir(), 'out-demo-unreviewed-preview-'));
  for (const locale of ['en', 'zh-Hant'] as const) await buildContent({ contentDir: dir, outDir: demoUnreviewedPreview, locale, includeUnreviewed: true });
});
afterEach(() => vi.unstubAllGlobals());
beforeEach(() => { sessionStorage.clear(); localStorage.clear(); });

function cloud(profile: ProfileRow, rows: { cohort_id: string; stage: string }[] = []) {
  const db: FakeDb = createFakeDb();
  db.tables.cohort_stages = rows.map((r, i) => ({ id: `cs-${i}`, opened_by: 'sup', ...r }));
  return createFakeBackend({ userId: profile.id, profile, db });
}

describe('which stages a student can open (cloud)', () => {
  test('foundations is open without any row', async () => {
    serve(multi);
    renderCloud('/s/foundations', cloud(STUDENT));
    expect(await screen.findByRole('link', { name: /Intake \(fixture\)/ })).toBeVisible();
  });

  test('a stage nobody opened sends a student home with a reason', async () => {
    serve(multi);
    renderCloud('/s/demo', cloud(STUDENT));
    await waitFor(() => expect(spy.path).toBe('/'));
    expect(await screen.findByText(en.stage.stageNotOpenNotice)).toBeVisible();
  });

  test('the same for a module of that stage opened by its URL', async () => {
    serve(multi);
    renderCloud('/s/demo/m/demo-intro', cloud(STUDENT));
    await waitFor(() => expect(spy.path).toBe('/'));
    expect(screen.queryByRole('heading', { name: /Demo intro/ })).not.toBeInTheDocument();
  });

  test('a stage opened for the student’s cohort is open', async () => {
    serve(multi);
    renderCloud('/s/demo/m/demo-intro', cloud(STUDENT, [{ cohort_id: 'c1', stage: 'demo' }]));
    expect(await screen.findByRole('heading', { name: /Demo intro \(fixture\)/ })).toBeVisible();
  });

  test('a stage opened for another cohort stays closed', async () => {
    serve(multi);
    renderCloud('/s/demo', cloud(STUDENT, [{ cohort_id: 'c2', stage: 'demo' }]));
    await waitFor(() => expect(spy.path).toBe('/'));
  });

  test('a student with no cohort cannot open a stage either', async () => {
    serve(multi);
    renderCloud('/s/demo', cloud({ ...STUDENT, cohort_id: null }, [{ cohort_id: 'c1', stage: 'demo' }]));
    await waitFor(() => expect(spy.path).not.toBe('/s/demo'));
  });

  test('a supervisor can open every stage', async () => {
    serve(multi);
    renderCloud('/s/demo', cloud(SUPERVISOR));
    expect(await screen.findByRole('heading', { name: 'Demo stage (fixture)' })).toBeVisible();
  });

  test('a failed read of the open stages is an error with retry, not an open door', async () => {
    serve(multi);
    const fake = cloud(STUDENT);
    fake.db.failReads.add('cohort_stages');
    renderCloud('/s/demo', fake);
    expect(await screen.findByRole('alert')).toHaveTextContent(en.stage.loadError);
    expect(screen.queryByRole('heading', { name: 'Demo stage (fixture)' })).not.toBeInTheDocument();
  });

  test('local mode (no sign-in) opens every stage', async () => {
    serve(multi);
    const storage = new Mem();
    render(
      <MemoryRouter initialEntries={['/s/demo']}>
        <App store={createLocalStore(storage)} storage={storage} />
        <PathSpy />
      </MemoryRouter>,
    );
    expect(await screen.findByRole('heading', { name: 'Demo stage (fixture)' })).toBeVisible();
  });
});

describe('the home page', () => {
  test('one stage: home is the foundations route itself, with no stage list', async () => {
    serve(single);
    renderCloud('/', cloud(STUDENT));
    expect(await screen.findByRole('heading', { level: 1, name: 'Foundations (fixture)' })).toBeVisible();
    expect(screen.getByText(en.stage.lede)).toBeVisible();
    expect(screen.getByRole('link', { name: /Intake \(fixture\)/ })).toBeVisible();
    expect(screen.queryByText(en.stage.listHeading)).not.toBeInTheDocument();
    expect(spy.path).toBe('/');
  });

  test('one stage: the home page and the foundations page never read cohort_stages', async () => {
    serve(single);
    const fake = cloud(STUDENT);
    fake.db.failReads.add('cohort_stages');
    renderCloud('/', fake);
    expect(await screen.findByRole('heading', { level: 1, name: 'Foundations (fixture)' })).toBeVisible();
    expect(fake.db.reads.some((r) => r.table === 'cohort_stages')).toBe(false);
  });

  test('foundations opens even when the cohort_stages table cannot be read', async () => {
    serve(multi);
    const fake = cloud(STUDENT);
    fake.db.failReads.add('cohort_stages');
    renderCloud('/s/foundations', fake);
    expect(await screen.findByRole('link', { name: /Intake \(fixture\)/ })).toBeVisible();
  });

  test('one stage in local mode looks the same', async () => {
    serve(single);
    const storage = new Mem();
    render(
      <MemoryRouter initialEntries={['/']}>
        <App store={createLocalStore(storage)} storage={storage} />
      </MemoryRouter>,
    );
    expect(await screen.findByRole('heading', { level: 1, name: 'Foundations (fixture)' })).toBeVisible();
    expect(screen.queryByText(en.stage.listHeading)).not.toBeInTheDocument();
  });

  test('more than one stage: home lists the stages', async () => {
    serve(multi);
    renderCloud('/', cloud(STUDENT, [{ cohort_id: 'c1', stage: 'demo' }]));
    expect(await screen.findByRole('heading', { level: 1, name: en.stage.listHeading })).toBeVisible();
    expect(screen.getByRole('link', { name: /Foundations \(fixture\)/ })).toHaveAttribute('href', '/s/foundations');
    expect(screen.getByRole('link', { name: /Demo stage \(fixture\)/ })).toHaveAttribute('href', '/s/demo');
    expect(screen.queryByText(en.stage.lede)).not.toBeInTheDocument();
  });

  test('a stage that is not open to the student is listed but is not a link', async () => {
    serve(multi);
    renderCloud('/', cloud(STUDENT));
    const row = (await screen.findByText(/Demo stage \(fixture\)/)).closest('li')!;
    expect(row.querySelector('a')).toBeNull();
    expect(within(row).getByText(en.stage.stageNotOpen)).toBeVisible();
    expect(screen.getByRole('link', { name: /Foundations \(fixture\)/ })).toBeVisible();
  });

  test('a stage with nothing reviewed is hidden from students, so one stage means the plain home page', async () => {
    serve(demoUnreviewedPreview);
    renderCloud('/', cloud(STUDENT, [{ cohort_id: 'c1', stage: 'demo' }]));
    expect(await screen.findByRole('heading', { level: 1, name: 'Foundations (fixture)' })).toBeVisible();
    expect(screen.queryByText(en.stage.listHeading)).not.toBeInTheDocument();
  });

  test('in a preview build a supervisor sees the stage that is not reviewed yet, marked', async () => {
    serve(demoUnreviewedPreview);
    renderCloud('/', cloud(SUPERVISOR));
    const row = (await screen.findByText(/Demo stage \(fixture\)/)).closest('li')!;
    expect(within(row).getByText(en.stage.unreviewed)).toBeVisible();
  });

  test('in the normal build a stage with nothing reviewed is not shipped at all, even to a supervisor', async () => {
    serve(demoUnreviewed);
    renderCloud('/', cloud(SUPERVISOR));
    expect(await screen.findByRole('heading', { level: 1, name: 'Foundations (fixture)' })).toBeVisible();
    expect(screen.queryByText(/Demo stage/)).not.toBeInTheDocument();
  });

  test('the stage list follows the interface language', async () => {
    serve(multi);
    localStorage.setItem(LOCALE_KEY, 'zh-Hant');
    renderCloud('/', cloud(STUDENT, [{ cohort_id: 'c1', stage: 'demo' }]));
    expect(await screen.findByRole('heading', { level: 1, name: zhHant.stage.listHeading })).toBeVisible();
    expect(screen.getByRole('link', { name: /示範階段（測試）/ })).toBeVisible();
  });

  test('the foundations-only lede is not shown on another stage', async () => {
    serve(multi);
    renderCloud('/s/demo', cloud(STUDENT, [{ cohort_id: 'c1', stage: 'demo' }]));
    await screen.findByRole('heading', { name: 'Demo stage (fixture)' });
    expect(screen.queryByText(en.stage.lede)).not.toBeInTheDocument();
  });
});
