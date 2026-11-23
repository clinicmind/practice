-- AI feedback (phase 4, task 1).
-- Nothing here is used until a cohort's switch is turned on AND the owner has set a budget.
-- All writes are done by the `ai-feedback` Edge Function with the service role. Neither students nor
-- supervisors have any insert, update or delete policy on these tables, so nothing can be written
-- through the app. Authorisation is decided here, by row level security.

-- Per cohort switch. Off until the owner turns it on in the SQL Editor; no one can change it through the app
-- (cohorts has no update privilege for authenticated users).
alter table cohorts add column ai_enabled boolean not null default false;

-- One row per attempt. attempt_id is unique: that is what makes the function idempotent
-- (the function claims an attempt by inserting a 'pending' row first).
create table ai_feedback (
  id             uuid primary key default gen_random_uuid(),
  attempt_id     uuid not null unique references attempts (id) on delete cascade,
  status         text not null check (status in ('pending', 'done')),
  model          text,
  prompt_version text,
  settings       jsonb not null default '{}'::jsonb,   -- effort, thinking, max_tokens. No text.
  output         jsonb,                                -- criteria[3] {met, evidence}, suggestion, concern
  created_at     timestamptz not null default now(),
  check ((status = 'done') = (output is not null))
);

-- Token counts, money and labels only. There is deliberately no column that could hold text.
-- user_id and cohort_id are kept when an account or cohort goes away, so the monthly total stays right.
create table ai_usage (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid references auth.users (id) on delete set null,
  cohort_id          uuid references cohorts (id) on delete set null,
  kind               text not null check (kind in ('practice', 'report_draft', 'eval')),
  model              text not null check (char_length(model) <= 60),
  prompt_version     text check (char_length(prompt_version) <= 20),
  input_tokens       integer not null default 0 check (input_tokens >= 0),
  output_tokens      integer not null default 0 check (output_tokens >= 0),
  cache_write_tokens integer not null default 0 check (cache_write_tokens >= 0),
  cache_read_tokens  integer not null default 0 check (cache_read_tokens >= 0),
  cost_usd           numeric(10, 6) not null default 0 check (cost_usd >= 0),
  outcome            text not null check (outcome in ('ok', 'invalid', 'refusal', 'error', 'blocked')),
  counted            boolean not null default false,   -- counts toward the student's daily limit
  created_at         timestamptz not null default now()
);
create index ai_usage_user_idx on ai_usage (user_id, created_at desc);
create index ai_usage_created_idx on ai_usage (created_at);

-- The monthly budget. A single row. 0 means "everything stopped": the owner sets a number
-- (update ai_budget set monthly_limit_usd = ...) before any money can be spent.
create table ai_budget (
  id                boolean primary key default true check (id),
  monthly_limit_usd numeric(8, 2) not null check (monthly_limit_usd >= 0),
  warn_at           numeric(3, 2) not null default 0.80 check (warn_at > 0 and warn_at <= 1)
);
insert into ai_budget (id, monthly_limit_usd) values (true, 0);

alter table ai_feedback enable row level security;
alter table ai_usage    enable row level security;
alter table ai_budget   enable row level security;

-- ai_feedback: whoever can see the attempt can see its finished feedback. The subquery runs under the
-- caller's own rights on attempts, so it returns the student's own attempts or the supervisor's cohort's.
create policy ai_feedback_select on ai_feedback for select to authenticated
  using (status = 'done' and exists (select 1 from attempts a where a.id = ai_feedback.attempt_id));

-- ai_usage: a supervisor reads their own cohort's rows (cohorts_select lets them see only their cohorts),
-- plus the evaluation rows they wrote themselves. Students read nothing.
create policy ai_usage_select on ai_usage for select to authenticated
  using (
    exists (select 1 from cohorts c where c.id = ai_usage.cohort_id)
    or (kind = 'eval' and user_id = auth.uid())
  );

-- ai_budget: supervisors (anyone who owns a cohort) read it. Students read nothing.
create policy ai_budget_select on ai_budget for select to authenticated
  using (exists (select 1 from cohorts c));

-- Where the student's self-rating and the AI differ, one row per criterion. No response text, no evidence.
-- security_invoker: the view runs with the caller's rights, so row level security on attempts and
-- ai_feedback decides what each person sees.
create view ai_disagreements with (security_invoker = true) as
  select f.attempt_id,
         a.user_id,
         a.item_id,
         c.n as criterion_index,                                  -- 1 to 3
         a.criteria_met[c.n] as self_met,
         (f.output -> 'criteria' -> (c.n - 1) ->> 'met')::boolean as ai_met
  from ai_feedback f
  join attempts a on a.id = f.attempt_id
  cross join generate_series(1, 3) as c (n)
  where f.status = 'done'
    and a.criteria_met[c.n] is distinct from (f.output -> 'criteria' -> (c.n - 1) ->> 'met')::boolean;

grant select on ai_feedback, ai_usage, ai_budget, ai_disagreements to authenticated;
revoke all on ai_feedback, ai_usage, ai_budget, ai_disagreements from anon;
