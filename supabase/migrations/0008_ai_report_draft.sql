-- AI report draft (phase 4, task 12).
-- The `ai-report-draft` Edge Function (service role) stores one AI draft per report in `feedback`.
-- Rules enforced here, so a mistake in the function or the app cannot break them:
--   * a draft is marked `ai_draft`, has no author, and can never be released;
--   * students never see it (they see only released feedback, and an AI draft cannot be released);
--   * a supervisor reads the drafts of their own cohort but cannot edit, release or create one through the app.
-- A supervisor who wants to use a draft writes their OWN feedback row (author = themselves) and releases that.
-- Nothing here is used until a cohort's `ai_enabled` switch is on and the owner has set a budget.

alter table feedback add column ai_draft boolean not null default false;

-- A draft has no author, stays a draft, and is never released. (The flag, not "author is null", marks it:
-- author_id also becomes null when a supervisor's account is deleted, and that must not be blocked.)
alter table feedback add constraint feedback_ai_draft_never_released
  check (not ai_draft or (status = 'draft' and author_id is null and released_at is null));

-- One AI draft per report. Asking again replaces the text of this row; it never adds a second one.
create unique index feedback_one_ai_draft on feedback (report_id) where ai_draft;

-- Students: released feedback on their own report, and never an AI draft (defence in depth).
drop policy feedback_select on feedback;
create policy feedback_select on feedback for select to authenticated
  using (supervises_report(report_id) or (status = 'released' and not ai_draft and owns_report(report_id)));

-- Supervisors: insert and update their own rows only, and never a row flagged as an AI draft.
drop policy feedback_insert on feedback;
create policy feedback_insert on feedback for insert to authenticated
  with check (supervises_report(report_id) and author_id = auth.uid() and not ai_draft);
drop policy feedback_update on feedback;
create policy feedback_update on feedback for update to authenticated
  using (supervises_report(report_id) and not ai_draft)
  with check (supervises_report(report_id) and author_id = auth.uid() and not ai_draft);

-- Whose report a draft was made for, so the weekly limit (per student, not per supervisor) can be counted.
-- A uuid is not text from a report. Kept as null when the student's account goes away, so the total stays right.
alter table ai_usage add column subject_id uuid references auth.users (id) on delete set null;
create index ai_usage_subject_idx on ai_usage (subject_id, created_at desc) where kind = 'report_draft';
