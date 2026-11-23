-- Reports (phase 3, tasks 3-4).
-- The text of a report is NOT stored here. It lives in the owner's Google Drive,
-- written by the `reports` Edge Function; this table keeps the title, counts and
-- the Drive file id. Students cannot write to `reports` at all: the only way in
-- is the Edge Function (service role), which scans the text again first.
-- Authorisation is decided here, by row level security.

-- Per cohort switch. Off until the owner has confirmed the placement's policy.
-- The owner turns it on in the SQL Editor; no one can change it through the app.
alter table cohorts add column reports_enabled boolean not null default false;

create table reports (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  title         text not null check (char_length(title) between 1 and 100),
  drive_file_id text not null check (char_length(drive_file_id) between 1 and 200),
  -- Counts per rule only. Never the matched text.
  deid_summary  jsonb not null default '{}'::jsonb,
  status        text not null default 'submitted' check (status in ('submitted', 'reviewed')),
  created_at    timestamptz not null default now(),
  delete_after  date not null
);
create index reports_user_idx on reports (user_id, created_at desc);

create table feedback (
  id          uuid primary key default gen_random_uuid(),
  report_id   uuid not null references reports (id) on delete cascade,
  author_id   uuid references auth.users (id) on delete set null,   -- null = AI draft (phase 4)
  scores      jsonb not null default '{}'::jsonb,
  comments    text not null default '' check (char_length(comments) <= 10000),
  status      text not null default 'draft' check (status in ('draft', 'released')),
  created_at  timestamptz not null default now(),
  released_at timestamptz
);
create index feedback_report_idx on feedback (report_id);

alter table reports  enable row level security;
alter table feedback enable row level security;

-- reports: a student reads their own; a supervisor reads their cohort's.
-- No insert, update or delete policy: writes go through the Edge Function only.
create policy reports_select on reports for select to authenticated
  using (user_id = auth.uid() or is_supervisor_of(user_id));

-- feedback: a supervisor reads and writes it for their cohort's reports and signs it.
-- A student reads only released feedback on their own report. Drafts are never visible.
create function supervises_report(report uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from reports r where r.id = report and is_supervisor_of(r.user_id))
$$;
create function owns_report(report uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from reports r where r.id = report and r.user_id = auth.uid())
$$;
revoke all on function supervises_report(uuid) from public;
revoke all on function owns_report(uuid) from public;
grant execute on function supervises_report(uuid) to authenticated;
grant execute on function owns_report(uuid) to authenticated;

create policy feedback_select on feedback for select to authenticated
  using (supervises_report(report_id) or (status = 'released' and owns_report(report_id)));
create policy feedback_insert on feedback for insert to authenticated
  with check (supervises_report(report_id) and author_id = auth.uid());
create policy feedback_update on feedback for update to authenticated
  using (supervises_report(report_id))
  with check (supervises_report(report_id) and author_id = auth.uid());

grant select on reports to authenticated;
grant select, insert, update on feedback to authenticated;
revoke all on reports, feedback from anon;
