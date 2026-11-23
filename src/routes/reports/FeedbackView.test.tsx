import { screen, within } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { en } from '../../i18n/en';
import { createFakeReviewApi, reviewRow } from '../../test/fakeReviewApi';
import { renderReports } from './reportsTestUtils';

// All text is fictional.
const t = en.reportsReview;
const BODY = { title: 'Week 3 summary', body: 'Fictional report text.' };
const FULL = { picture: 3, formulation: 2, link: 3, process: 4, self: 2, ethics: 1 } as const;

describe('feedback on the student’s report page', () => {
  test('released feedback shows each dimension with its level and the level’s description, and the comments', async () => {
    const f = createFakeReviewApi({ rows: [reviewRow()], bodies: { r1: BODY } });
    f.feedback.set('r1', { id: 'f1', scores: { ...FULL }, comments: 'Fictional comment about the report.', status: 'released', releasedAt: '2026-11-23T08:00:00Z' });
    renderReports('/reports/r1', { enabled: true, api: f.api });
    const region = within(await screen.findByRole('region', { name: t.student.heading }));
    expect(region.getByText(t.student.releasedOn('2026-11-23'))).toBeVisible();
    expect(region.getByText('Fictional comment about the report.')).toBeVisible();
    const item = within(region.getByRole('listitem', { name: t.rubric.picture!.title }));
    expect(item.getByText(new RegExp(t.levelNames[2]!))).toBeVisible();
    expect(item.getByText(t.rubric.picture!.levels[2]!)).toBeVisible();
    expect(region.getByText(t.rubric.ethics!.levels[0]!)).toBeVisible();
    expect(region.getAllByRole('listitem')).toHaveLength(6);
  });
  test('a draft is never shown', async () => {
    const f = createFakeReviewApi({ rows: [reviewRow()], bodies: { r1: BODY } });
    f.feedback.set('r1', { id: 'f1', scores: { ...FULL }, comments: 'Secret draft comment', status: 'draft', releasedAt: null });
    renderReports('/reports/r1', { enabled: true, api: f.api });
    expect(await screen.findByText(BODY.body)).toBeVisible();
    expect(screen.queryByRole('region', { name: t.student.heading })).toBeNull();
    expect(document.body).not.toHaveTextContent('Secret draft comment');
  });
  test('a report with no feedback shows no feedback section', async () => {
    const f = createFakeReviewApi({ rows: [reviewRow()], bodies: { r1: BODY } });
    renderReports('/reports/r1', { enabled: true, api: f.api });
    expect(await screen.findByText(BODY.body)).toBeVisible();
    expect(screen.queryByRole('region', { name: t.student.heading })).toBeNull();
  });
  test('if the feedback cannot be loaded, the report is still shown, with a message', async () => {
    const f = createFakeReviewApi({ rows: [reviewRow()], bodies: { r1: BODY } });
    f.api.releasedFeedback.mockRejectedValueOnce(new Error('boom'));
    renderReports('/reports/r1', { enabled: true, api: f.api });
    expect(await screen.findByText(BODY.body)).toBeVisible();
    expect(await screen.findByRole('alert')).toHaveTextContent(t.student.loadError);
  });
  test('the student never calls the supervisor-only functions', async () => {
    const f = createFakeReviewApi({ rows: [reviewRow()], bodies: { r1: BODY } });
    renderReports('/reports/r1', { enabled: true, api: f.api });
    await screen.findByText(BODY.body);
    for (const name of ['listForReview', 'myFeedback', 'saveFeedback', 'purgeExpired', 'driveStatus'] as const) expect(f.api[name]).not.toHaveBeenCalled();
  });
});
