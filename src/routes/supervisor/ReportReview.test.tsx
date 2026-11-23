import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { en } from '../../i18n/en';
import { DIMENSIONS } from '../../reports/ReportsContext';
import { buildFixture, renderCloud, serve, spy } from '../../test/appHarness';
import { createFakeDb, type FakeDb } from '../../test/fakeDb';
import { createFakeReviewApi, reviewRow } from '../../test/fakeReviewApi';
import { createFakeBackend, type FakeBackend } from '../../test/fakeSupabase';
import { ALICE, SUP, seedCohort } from '../../test/seedCohort';

// All names and text are fictional.
const t = en.reportsReview;
let built = '';
beforeAll(async () => { built = await buildFixture('ok-reviewed'); });
let db: FakeDb;
let fake: FakeBackend;
beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  serve(built);
  db = createFakeDb();
  seedCohort(db);
  fake = createFakeBackend({ userId: SUP, db });
});
afterEach(() => vi.unstubAllGlobals());

const BODY = { title: 'Week 3 summary', body: 'Fictional report text: the trainee and the client met for the third time.' };

describe('reports to review: the list', () => {
  test('shows title, student, date, status and what the scanner left, and marks heavily flagged reports', async () => {
    const f = createFakeReviewApi({
      rows: [
        reviewRow({ id: 'r1', title: 'Clean one', summary: {} }),
        reviewRow({ id: 'r2', title: 'Flagged one', studentName: 'Bea', status: 'reviewed', summary: { 'cjk-name': { found: 2 }, 'cap-name': { found: 2 } } }),
      ],
    });
    renderCloud('/supervisor/reports', fake, { reportsEnabled: true, reportsApi: f.api });
    const table = await screen.findByRole('table', { name: t.heading });
    const [clean, flagged] = within(table).getAllByRole('row').slice(1);
    expect(clean).toHaveTextContent('Clean one');
    expect(clean).toHaveTextContent('Alice');
    expect(clean).toHaveTextContent('2026-11-20');
    expect(clean).toHaveTextContent(t.statusSubmitted);
    expect(clean).toHaveTextContent(t.flagsNone);
    expect(within(clean!).queryByText(t.flagsHeavy)).toBeNull();
    expect(flagged).toHaveTextContent('Bea');
    expect(flagged).toHaveTextContent(t.statusReviewed);
    expect(flagged).toHaveTextContent(t.flagsTotal(4));
    expect(flagged).toHaveTextContent(en.reports.rules['cjk-name']!);
    expect(within(flagged!).getByText(t.flagsHeavy)).toBeVisible();
    expect(clean).toHaveTextContent(t.deleteAfter('2027-04-01'));
  });
  test('a title opens that report', async () => {
    const f = createFakeReviewApi({ rows: [reviewRow()], bodies: { r1: BODY } });
    renderCloud('/supervisor/reports', fake, { reportsEnabled: true, reportsApi: f.api });
    await userEvent.setup().click(await screen.findByRole('link', { name: 'Week 3 summary' }));
    expect(await screen.findByRole('heading', { name: 'Week 3 summary' })).toBeVisible();
    expect(spy.path).toBe('/supervisor/reports/r1');
  });
  test('says so when there are no reports', async () => {
    renderCloud('/supervisor/reports', fake, { reportsEnabled: true, reportsApi: createFakeReviewApi().api });
    expect(await screen.findByText(t.empty)).toBeVisible();
  });
  test('a failed load shows an error, and retry loads again', async () => {
    const f = createFakeReviewApi({ rows: [reviewRow()] });
    f.state.listFails = true;
    renderCloud('/supervisor/reports', fake, { reportsEnabled: true, reportsApi: f.api });
    expect(await screen.findByRole('alert')).toHaveTextContent(t.loadError);
    f.state.listFails = false;
    await userEvent.setup().click(screen.getByRole('button', { name: en.common.retry }));
    expect(await screen.findByRole('link', { name: 'Week 3 summary' })).toBeVisible();
  });
  test('the cohort page links to it', async () => {
    renderCloud('/supervisor', fake, { reportsEnabled: true, reportsApi: createFakeReviewApi().api });
    await userEvent.setup().click(await screen.findByRole('link', { name: t.link }));
    expect(await screen.findByRole('heading', { name: t.heading })).toBeVisible();
  });
});

describe('Google Drive link status', () => {
  const region = async () => within(await screen.findByRole('region', { name: t.drive.heading }));
  test('says it works', async () => {
    renderCloud('/supervisor/reports', fake, { reportsEnabled: true, reportsApi: createFakeReviewApi().api });
    expect(await (await region()).findByText(t.drive.ok)).toBeVisible();
  });
  test.each([['auth', t.drive.auth], ['quota', t.drive.quota], ['not_configured', t.drive.notConfigured]] as const)('%s is a clear alert', async (status, text) => {
    renderCloud('/supervisor/reports', fake, { reportsEnabled: true, reportsApi: createFakeReviewApi({ drive: status }).api });
    expect(await (await region()).findByRole('alert')).toHaveTextContent(text);
  });
  test('an expired authorisation names the file with the steps', async () => {
    renderCloud('/supervisor/reports', fake, { reportsEnabled: true, reportsApi: createFakeReviewApi({ drive: 'auth' }).api });
    expect(await (await region()).findByRole('alert')).toHaveTextContent('docs/SETUP-reports.md');
  });
  test('a failure to ask is its own message, and checking again asks again', async () => {
    const f = createFakeReviewApi({ drive: 'error' });
    renderCloud('/supervisor/reports', fake, { reportsEnabled: true, reportsApi: f.api });
    const r = await region();
    expect(await r.findByText(t.drive.checkError)).toBeVisible();
    f.state.drive = 'ok';
    await userEvent.setup().click(r.getByRole('button', { name: t.drive.recheck }));
    expect(await r.findByText(t.drive.ok)).toBeVisible();
    expect(f.api.driveStatus).toHaveBeenCalledTimes(2);
  });
  test('also shows on the cohort page, so a broken link is seen without looking for it', async () => {
    renderCloud('/supervisor', fake, { reportsEnabled: true, reportsApi: createFakeReviewApi({ drive: 'auth' }).api });
    expect(await (await region()).findByRole('alert')).toHaveTextContent(t.drive.auth);
  });
});

describe('delete expired reports', () => {
  const press = async () => {
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: t.purge.button }));
    return user;
  };
  test('asks first; cancelling deletes nothing', async () => {
    const f = createFakeReviewApi();
    renderCloud('/supervisor/reports', fake, { reportsEnabled: true, reportsApi: f.api });
    const user = await press();
    expect(screen.getByText(t.purge.confirm)).toBeVisible();
    await user.click(screen.getByRole('button', { name: t.purge.cancel }));
    expect(f.api.purgeExpired).not.toHaveBeenCalled();
    expect(screen.queryByText(t.purge.confirm)).toBeNull();
  });
  test('confirming deletes, says how many, and reloads the list', async () => {
    const f = createFakeReviewApi({ rows: [reviewRow({ id: 'old', title: 'Old one' })], purge: { ok: true, purged: 2, failed: 0, more: false, driveError: null } });
    renderCloud('/supervisor/reports', fake, { reportsEnabled: true, reportsApi: f.api });
    const user = await press();
    f.rows.length = 0; // the server removed them
    await user.click(screen.getByRole('button', { name: t.purge.confirmYes }));
    expect(await screen.findByText(t.purge.done(2))).toBeVisible();
    expect(f.api.purgeExpired).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Old one' })).toBeNull());
  });
  test('nothing to delete', async () => {
    renderCloud('/supervisor/reports', fake, { reportsEnabled: true, reportsApi: createFakeReviewApi().api });
    await (await press()).click(screen.getByRole('button', { name: t.purge.confirmYes }));
    expect(await screen.findByText(t.purge.none)).toBeVisible();
  });
  test('says when more remain, when some failed and when Drive is down', async () => {
    const f = createFakeReviewApi({ purge: { ok: true, purged: 50, failed: 1, more: true, driveError: 'drive_auth' } });
    renderCloud('/supervisor/reports', fake, { reportsEnabled: true, reportsApi: f.api });
    await (await press()).click(screen.getByRole('button', { name: t.purge.confirmYes }));
    expect(await screen.findByText(t.purge.more)).toBeVisible();
    expect(screen.getByText(t.purge.failed(1))).toBeVisible();
    expect(screen.getByText(t.purge.driveError)).toBeVisible();
  });
  test('a failed request says so', async () => {
    const f = createFakeReviewApi({ purge: { ok: false, status: 500 } });
    renderCloud('/supervisor/reports', fake, { reportsEnabled: true, reportsApi: f.api });
    await (await press()).click(screen.getByRole('button', { name: t.purge.confirmYes }));
    expect(await screen.findByText(t.purge.error)).toBeVisible();
  });
});

describe('reviewing one report', () => {
  const open = async (f = createFakeReviewApi({ rows: [reviewRow()], bodies: { r1: BODY } })) => {
    renderCloud('/supervisor/reports/r1', fake, { reportsEnabled: true, reportsApi: f.api });
    await screen.findByRole('heading', { name: 'Week 3 summary' });
    return { f, user: userEvent.setup() };
  };
  const score = async (user: ReturnType<typeof userEvent.setup>, dim: (typeof DIMENSIONS)[number], n: 1 | 2 | 3 | 4) => {
    const group = screen.getByRole('group', { name: t.rubric[dim]!.title });
    await user.click(within(group).getByRole('radio', { name: new RegExp(`^${t.levelNames[n - 1]}`) }));
  };
  const fillAll = async (user: ReturnType<typeof userEvent.setup>) => {
    for (const d of DIMENSIONS) await score(user, d, 3);
    await user.type(screen.getByLabelText(t.review.comments), 'Fictional comment.');
  };

  test('shows the report text, who wrote it and when', async () => {
    await open();
    expect(screen.getByText(BODY.body)).toBeVisible();
    expect(screen.getByText(t.review.by('Alice', '2026-11-20'))).toBeVisible();
  });
  test('says the rubric is not reviewed yet, and lists six dimensions with four levels each', async () => {
    await open();
    expect(screen.getByText(t.review.rubricUnreviewed)).toBeVisible();
    for (const d of DIMENSIONS) {
      const group = screen.getByRole('group', { name: t.rubric[d]!.title });
      expect(within(group).getAllByRole('radio')).toHaveLength(4);
      expect(group).toHaveTextContent(t.rubric[d]!.levels[2]!);
    }
  });
  test('a draft can be saved with some dimensions blank, and stays a draft', async () => {
    const { f, user } = await open();
    await score(user, 'picture', 2);
    await user.click(screen.getByRole('button', { name: t.review.saveDraft }));
    expect(await screen.findByText(t.review.savedDraft)).toBeVisible();
    expect(f.api.saveFeedback).toHaveBeenCalledWith('r1', { scores: { picture: 2 }, comments: '' }, false);
    expect(f.feedback.get('r1')!.status).toBe('draft');
    expect(f.api.releasedFeedback).not.toHaveBeenCalled();
  });
  test('an earlier draft is loaded back into the form', async () => {
    const f = createFakeReviewApi({ rows: [reviewRow()], bodies: { r1: BODY } });
    f.feedback.set('r1', { id: 'f1', scores: { picture: 4, ethics: 1 }, comments: 'Earlier draft', status: 'draft', releasedAt: null });
    await open(f);
    expect(screen.getByLabelText(t.review.comments)).toHaveValue('Earlier draft');
    expect(within(screen.getByRole('group', { name: t.rubric.picture!.title })).getByRole('radio', { name: new RegExp(`^${t.levelNames[3]}`) })).toBeChecked();
    expect(screen.getByText(t.review.draftNote)).toBeVisible();
  });
  test('release is blocked until all six scores and a comment are there', async () => {
    const { f, user } = await open();
    const release = screen.getByRole('button', { name: t.review.release });
    expect(release).toBeDisabled();
    expect(screen.getByText(t.review.releaseHint)).toBeVisible();
    for (const d of DIMENSIONS.slice(0, 5)) await score(user, d, 3);
    await user.type(screen.getByLabelText(t.review.comments), 'Fictional comment.');
    expect(release).toBeDisabled(); // one dimension still blank
    await score(user, 'ethics', 3);
    expect(release).toBeEnabled();
    await user.clear(screen.getByLabelText(t.review.comments));
    await user.type(screen.getByLabelText(t.review.comments), '   ');
    expect(release).toBeDisabled(); // a blank comment is not a comment
    expect(f.api.saveFeedback).not.toHaveBeenCalled();
  });
  test('releasing asks first, then releases and marks the report reviewed', async () => {
    const { f, user } = await open();
    await fillAll(user);
    await user.click(screen.getByRole('button', { name: t.review.release }));
    expect(screen.getByText(t.review.releaseConfirm)).toBeVisible();
    expect(f.api.saveFeedback).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: t.review.releaseYes }));
    expect(await screen.findByText(t.review.savedReleased)).toBeVisible();
    expect(f.api.saveFeedback).toHaveBeenCalledWith('r1', expect.objectContaining({ comments: 'Fictional comment.' }), true);
    expect(f.rows[0]!.status).toBe('reviewed');
    expect(screen.getByText(t.review.releasedNote('2026-11-23'))).toBeVisible();
    expect(screen.queryByRole('button', { name: t.review.release })).toBeNull();
    expect(screen.getByRole('button', { name: t.review.saveChanges })).toBeVisible();
  });
  test('cancelling the confirmation releases nothing', async () => {
    const { f, user } = await open();
    await fillAll(user);
    await user.click(screen.getByRole('button', { name: t.review.release }));
    await user.click(screen.getByRole('button', { name: t.review.cancel }));
    expect(f.api.saveFeedback).not.toHaveBeenCalled();
    expect(screen.queryByText(t.review.releaseConfirm)).toBeNull();
  });
  test('a failed save keeps what was typed and says so', async () => {
    const { f, user } = await open();
    await user.type(screen.getByLabelText(t.review.comments), 'Keep me');
    f.state.saveFails = true;
    await user.click(screen.getByRole('button', { name: t.review.saveDraft }));
    expect(await screen.findByRole('alert')).toHaveTextContent(t.review.saveError);
    expect(screen.getByLabelText(t.review.comments)).toHaveValue('Keep me');
  });
  test('deleting asks first, then removes the report and returns to the list', async () => {
    const { f, user } = await open();
    await user.click(screen.getByRole('button', { name: t.review.deleteButton }));
    expect(screen.getByText(t.review.deleteConfirm)).toBeVisible();
    expect(f.api.remove).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: t.review.deleteYes }));
    await waitFor(() => expect(spy.path).toBe('/supervisor/reports'));
    expect(f.api.remove).toHaveBeenCalledWith('r1');
    expect(f.rows).toHaveLength(0);
  });
  test('a report whose file is gone, a Drive failure and an unknown id each get their own message', async () => {
    for (const [status, text] of [[410, t.review.gone], [502, t.review.driveDown], [404, t.review.notFound]] as const) {
      const f = createFakeReviewApi({ rows: [reviewRow()], bodies: { r1: status } });
      const { unmount } = renderCloud('/supervisor/reports/r1', fake, { reportsEnabled: true, reportsApi: f.api });
      expect(await screen.findByText(text)).toBeVisible();
      unmount();
    }
  });
});

describe('who can see these pages, and the live site', () => {
  test('with reports off the pages do not exist, no link shows, and the backend is never called', async () => {
    const f = createFakeReviewApi({ rows: [reviewRow()] });
    const first = renderCloud('/supervisor/reports', fake, { reportsEnabled: false, reportsApi: f.api });
    expect(await screen.findByRole('heading', { name: en.notFound.heading })).toBeVisible();
    first.unmount();
    renderCloud('/supervisor', fake, { reportsEnabled: false, reportsApi: f.api });
    await screen.findByRole('heading', { name: en.supervisor.heading });
    expect(screen.queryByRole('link', { name: t.link })).toBeNull();
    expect(screen.queryByRole('region', { name: t.drive.heading })).toBeNull();
    for (const fn of Object.values(f.api)) expect(fn).not.toHaveBeenCalled();
  });
  test('with reports off the review route is not found either', async () => {
    renderCloud('/supervisor/reports/r1', fake, { reportsEnabled: false, reportsApi: createFakeReviewApi().api });
    expect(await screen.findByRole('heading', { name: en.notFound.heading })).toBeVisible();
  });
  test('a student who opens them sees not-found and nothing is read', async () => {
    const f = createFakeReviewApi({ rows: [reviewRow()] });
    renderCloud('/supervisor/reports', createFakeBackend({ userId: ALICE, db }), { reportsEnabled: true, reportsApi: f.api });
    expect(await screen.findByRole('heading', { name: en.notFound.heading })).toBeVisible();
    expect(f.api.listForReview).not.toHaveBeenCalled();
    expect(f.api.driveStatus).not.toHaveBeenCalled();
  });
});
