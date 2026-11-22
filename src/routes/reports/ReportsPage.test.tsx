import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { en } from '../../i18n/en';
import type { ReportsApi } from '../../reports/ReportsContext';
import { renderReports } from './reportsTestUtils';

const s = en.reports;
beforeEach(() => { localStorage.clear(); });

const rows = [
  { id: 'r1', title: 'Week 3 notes', createdAt: '2026-11-02T10:00:00Z' },
  { id: 'r2', title: 'Week 4 notes', createdAt: '2026-11-09T10:00:00Z' },
];

describe('reports visibility', () => {
  test('reports link is hidden when reports are not enabled, and /reports/new is a not-found page', async () => {
    renderReports('/reports/new');
    expect(await screen.findByRole('heading', { name: en.notFound.heading })).toBeVisible();
    expect(screen.queryByRole('link', { name: s.nav })).toBeNull();
    expect(screen.queryByLabelText(s.write.bodyLabel)).toBeNull();
  });

  test.each(['/reports', '/reports/r1'])('%s is also not found when disabled', async (url) => {
    renderReports(url);
    expect(await screen.findByRole('heading', { name: en.notFound.heading })).toBeVisible();
  });

  test('home page shows no reports link by default', async () => {
    renderReports('/');
    await screen.findByRole('link', { name: en.appName });
    expect(screen.queryByRole('link', { name: s.nav })).toBeNull();
  });

  test('when enabled the link is shown in the header', async () => {
    renderReports('/', { enabled: true });
    expect(await screen.findByRole('link', { name: s.nav })).toHaveAttribute('href', '/reports');
  });
});

describe('reports list', () => {
  test('lists the student reports and links to write a new one', async () => {
    renderReports('/reports', { enabled: true, api: { list: async () => rows } });
    expect(await screen.findByText('Week 3 notes')).toBeVisible();
    expect(screen.getByText('Week 4 notes')).toBeVisible();
    expect(screen.getByRole('link', { name: s.newReport })).toHaveAttribute('href', '/reports/new');
  });

  test('shows a message when the list cannot be loaded (default, no backend)', async () => {
    renderReports('/reports', { enabled: true });
    expect(await screen.findByText(s.loadError)).toBeVisible();
  });

  test('student can delete own report after a confirm step', async () => {
    const user = userEvent.setup();
    const remove = vi.fn<ReportsApi['remove']>(async () => true);
    renderReports('/reports', { enabled: true, api: { list: async () => rows, remove } });
    const item = (await screen.findByText('Week 3 notes')).closest('li')!;
    await user.click(within(item).getByRole('button', { name: s.list.delete }));
    expect(remove).not.toHaveBeenCalled();
    expect(within(item).getByText(s.list.deletePrompt)).toBeVisible();
    // Cancelling keeps it.
    await user.click(within(item).getByRole('button', { name: s.list.cancel }));
    expect(within(item).queryByText(s.list.deletePrompt)).toBeNull();
    await user.click(within(item).getByRole('button', { name: s.list.delete }));
    await user.click(within(item).getByRole('button', { name: s.list.confirmDelete }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith('r1'));
    await waitFor(() => expect(screen.queryByText('Week 3 notes')).toBeNull());
    expect(screen.getByText('Week 4 notes')).toBeVisible();
  });

  test('a failed delete keeps the report and says so', async () => {
    const user = userEvent.setup();
    renderReports('/reports', { enabled: true, api: { list: async () => rows, remove: async () => false } });
    const item = (await screen.findByText('Week 3 notes')).closest('li')!;
    await user.click(within(item).getByRole('button', { name: s.list.delete }));
    await user.click(within(item).getByRole('button', { name: s.list.confirmDelete }));
    expect(await screen.findByText(s.list.deleteError)).toBeVisible();
    expect(screen.getByText('Week 3 notes')).toBeVisible();
  });
});

describe('one report', () => {
  test('shows title and text', async () => {
    renderReports('/reports/r1', { enabled: true, api: { get: async () => ({ ok: true, title: 'Week 3 notes', body: 'Fictional body.' }) } });
    expect(await screen.findByRole('heading', { name: 'Week 3 notes' })).toBeVisible();
    expect(screen.getByText('Fictional body.')).toBeVisible();
  });
  test('when the Drive file is gone the page says the file no longer exists', async () => {
    renderReports('/reports/r1', { enabled: true, api: { get: async () => ({ ok: false, status: 410 }) } });
    expect(await screen.findByText(s.report.gone)).toBeVisible();
  });
  test('another student report reads as not found', async () => {
    renderReports('/reports/r9', { enabled: true, api: { get: async () => ({ ok: false, status: 404 }) } });
    expect(await screen.findByText(s.report.notFound)).toBeVisible();
  });
});
