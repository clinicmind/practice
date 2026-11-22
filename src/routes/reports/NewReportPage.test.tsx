import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { scan } from '../../../packages/deid/src';
import { en } from '../../i18n/en';
import type { ReportSubmitter, SubmitResult } from '../../reports/ReportsContext';
import { CLEAN, renderReports } from './reportsTestUtils';

const s = en.reports;
beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });

type User = ReturnType<typeof userEvent.setup>;
const body = () => screen.getByLabelText(s.write.bodyLabel) as HTMLTextAreaElement;
const title = () => screen.getByLabelText(s.write.titleLabel, { exact: false }) as HTMLInputElement;

async function toStep2(user: User, submit?: ReportSubmitter) {
  renderReports('/reports/new', { enabled: true, api: submit ? { submit } : undefined });
  await user.click(await screen.findByRole('checkbox'));
  await user.click(screen.getByRole('button', { name: s.guidance.next }));
  await screen.findByLabelText(s.write.bodyLabel);
}
async function write(user: User, text: string, t = 'Week 3 notes') {
  await user.clear(title());
  await user.type(title(), t);
  fireEvent.change(body(), { target: { value: text } });
  // wait for the debounced scan to finish
  await waitFor(() => expect(screen.queryByText(s.write.checking)).toBeNull(), { timeout: 2000 });
}

describe('new report', () => {
  test('step 2 is unreachable until the guidance box is ticked', async () => {
    const user = userEvent.setup();
    renderReports('/reports/new', { enabled: true });
    const next = await screen.findByRole('button', { name: s.guidance.next });
    expect(next).toBeDisabled();
    expect(screen.queryByLabelText(s.write.bodyLabel)).toBeNull();
    await user.click(screen.getByRole('checkbox'));
    expect(next).toBeEnabled();
    await user.click(next);
    expect(await screen.findByLabelText(s.write.bodyLabel)).toBeVisible();
  });

  test('findings are listed with rule label, level and suggestion; clicking one selects it in the text', async () => {
    const user = userEvent.setup();
    await toStep2(user);
    const text = CLEAN + ' Mr Chan came late.';
    await write(user, text);
    const f = scan(text).find((x) => x.rule === 'title-name')!;
    const item = (await screen.findByText(s.rules['title-name'])).closest('li')!;
    expect(within(item).getByText(s.level.medium)).toBeVisible();
    expect(within(item).getByText(s.suggestions['title-name'])).toBeVisible();
    await user.click(within(item).getByRole('button', { name: s.findings.locate }));
    expect(body().selectionStart).toBe(f.start);
    expect(body().selectionEnd).toBe(f.end);
    expect(body().value.slice(body().selectionStart, body().selectionEnd)).toBe('Mr Chan');
    expect(document.activeElement).toBe(body());
  });

  test('each finding quotes the matched text, so the student does not have to count characters', async () => {
    const user = userEvent.setup();
    await toStep2(user);
    await write(user, CLEAN + ' Mr Chan came late.');
    const item = (await screen.findByText(s.rules['title-name'])).closest('li')!;
    expect(within(item).getByText('Mr Chan').tagName).toBe('Q');
  });

  test('high finding has no "not identifying" button', async () => {
    const user = userEvent.setup();
    await toStep2(user);
    await write(user, CLEAN + ' Call 91234567.');
    const item = (await screen.findByText(s.rules.phone)).closest('li')!;
    expect(within(item).getByText(s.level.high)).toBeVisible();
    expect(within(item).queryByRole('button', { name: s.findings.notIdentifying })).toBeNull();
    expect(within(item).getByText(s.findings.mustRewrite)).toBeVisible();
  });

  test('editing the text discards resolutions for findings that changed', async () => {
    const user = userEvent.setup();
    await toStep2(user);
    await write(user, CLEAN + ' Mr Chan came late.');
    await user.click(await screen.findByRole('button', { name: s.findings.notIdentifying }));
    expect(screen.getByText(s.findings.marked)).toBeVisible();
    expect(screen.getByRole('button', { name: s.write.next })).toBeEnabled();
    await write(user, CLEAN + ' Mr Wong came late.');
    expect(await screen.findByRole('button', { name: s.findings.notIdentifying })).toBeVisible();
    expect(screen.queryByText(s.findings.marked)).toBeNull();
    expect(screen.getByRole('button', { name: s.write.next })).toBeDisabled();
  });

  test('submit stays disabled while any finding is unresolved or text is out of the 200–30,000 range, and says why', async () => {
    const user = userEvent.setup();
    await toStep2(user);
    const next = screen.getByRole('button', { name: s.write.next });
    await write(user, 'too short');
    expect(next).toBeDisabled();
    expect(screen.getByText(s.blockers.short(200))).toBeVisible();
    await write(user, 'a '.repeat(15_001));
    expect(next).toBeDisabled();
    expect(screen.getByText(s.blockers.long(30_000))).toBeVisible();
    await write(user, CLEAN + ' Call 91234567. Mr Chan came late.');
    expect(next).toBeDisabled();
    expect(screen.getByText(s.blockers.high(1))).toBeVisible();
    expect(screen.getByText(s.blockers.unresolved(1))).toBeVisible();
    await write(user, CLEAN);
    expect(next).toBeEnabled();
    // The final step needs the declaration as well.
    await user.click(next);
    const submit = await screen.findByRole('button', { name: s.confirm.submit });
    expect(submit).toBeDisabled();
    await user.click(screen.getByRole('checkbox'));
    expect(submit).toBeEnabled();
  });

  test('the title is checked too, and is required', async () => {
    const user = userEvent.setup();
    await toStep2(user);
    await write(user, CLEAN, 'Notes on Mr Chan');
    expect(screen.getByRole('button', { name: s.write.next })).toBeDisabled();
    expect(screen.getByText(s.blockers.titleIdentifying)).toBeVisible();
    await user.clear(title());
    expect(screen.getByText(s.blockers.titleEmpty)).toBeVisible();
    await user.type(title(), 'Week 3 notes');
    expect(screen.getByRole('button', { name: s.write.next })).toBeEnabled();
  });

  test('the "this check can miss things" warning is visible on steps 2 and 3', async () => {
    const user = userEvent.setup();
    await toStep2(user);
    expect(screen.getByText(s.warning)).toBeVisible();
    await write(user, CLEAN);
    await user.click(screen.getByRole('button', { name: s.write.next }));
    await screen.findByRole('button', { name: s.confirm.submit });
    expect(screen.getByText(s.warning)).toBeVisible();
    expect(screen.getByText(s.warning).textContent).toBe(
      'This check can miss things. You are responsible for removing every detail that could identify a client.',
    );
  });

  test('server rejection shows rule names and positions and returns to step 2 with the text intact', async () => {
    const user = userEvent.setup();
    const reject: SubmitResult = { ok: false, status: 422, findings: [{ rule: 'phone', start: 4, end: 12 }] };
    const submit = vi.fn<ReportSubmitter>(async () => reject);
    await toStep2(user, submit);
    await write(user, CLEAN);
    await user.click(screen.getByRole('button', { name: s.write.next }));
    await user.click(await screen.findByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: s.confirm.submit }));
    expect(submit).toHaveBeenCalledWith({ title: 'Week 3 notes', body: CLEAN });
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText(s.rejected.item(s.rules.phone, 5, 12))).toBeVisible();
    expect(await screen.findByLabelText(s.write.bodyLabel)).toBeVisible();
    expect(body().value).toBe(CLEAN);
    expect(title().value).toBe('Week 3 notes');
    // Locating the server's finding selects that span.
    await user.click(within(alert).getByRole('button', { name: s.findings.locate }));
    expect([body().selectionStart, body().selectionEnd]).toEqual([4, 12]);
  });

  test('a successful submit shows the done step', async () => {
    const user = userEvent.setup();
    await toStep2(user, async () => ({ ok: true, id: 'r1' }));
    await write(user, CLEAN);
    await user.click(screen.getByRole('button', { name: s.write.next }));
    await user.click(await screen.findByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: s.confirm.submit }));
    expect(await screen.findByRole('heading', { name: s.done.heading })).toBeVisible();
  });

  test('with the default (no backend) submitter the student is told reports are not open and the text is kept', async () => {
    const user = userEvent.setup();
    await toStep2(user);
    await write(user, CLEAN);
    await user.click(screen.getByRole('button', { name: s.write.next }));
    await user.click(await screen.findByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: s.confirm.submit }));
    expect(await screen.findByRole('alert')).toHaveTextContent(s.notOpen);
    expect(screen.getByRole('button', { name: s.confirm.submit })).toBeEnabled();
  });

  test('another failure shows the status and keeps the text', async () => {
    const user = userEvent.setup();
    await toStep2(user, async () => ({ ok: false, status: 500, message: 'x' }));
    await write(user, CLEAN);
    await user.click(screen.getByRole('button', { name: s.write.next }));
    await user.click(await screen.findByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: s.confirm.submit }));
    expect(await screen.findByRole('alert')).toHaveTextContent(s.failed.error(500));
  });

  test('pasting a file or image is ignored with a message; only text is accepted', async () => {
    const user = userEvent.setup();
    await toStep2(user);
    await write(user, 'abc');
    const file = new File(['x'], 'scan.png', { type: 'image/png' });
    const proceeded = fireEvent.paste(body(), { clipboardData: { files: [file], items: [], types: ['Files'], getData: () => '' } });
    expect(proceeded).toBe(false); // default prevented
    expect(body().value).toBe('abc');
    expect(screen.getByText(s.paste.fileIgnored)).toBeVisible();
  });

  test('dropping a file onto the text box is ignored too', async () => {
    const user = userEvent.setup();
    await toStep2(user);
    const file = new File(['x'], 'a.docx');
    const proceeded = fireEvent.drop(body(), { dataTransfer: { files: [file], items: [], types: ['Files'] } });
    expect(proceeded).toBe(false);
    expect(screen.getByText(s.paste.fileIgnored)).toBeVisible();
  });
});

describe('chinese interface', () => {
  test('shows rule names and suggestions in Traditional Chinese', async () => {
    localStorage.setItem('cm.practice.locale', 'zh-Hant');
    const user = userEvent.setup();
    renderReports('/reports/new', { enabled: true });
    await user.click(await screen.findByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: '繼續' }));
    const ta = await screen.findByLabelText('報告內容');
    fireEvent.change(ta, { target: { value: CLEAN + ' 請打 91234567。' } });
    expect(await screen.findByText('電話號碼', {}, { timeout: 2000 })).toBeVisible();
    expect(screen.getByText('請移除電話號碼。')).toBeVisible();
    expect(screen.getByText(/這個檢查可能會漏/)).toBeVisible();
  });
});
