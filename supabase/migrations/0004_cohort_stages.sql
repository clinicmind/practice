-- Stage unlocking (multi-stage support).
-- "foundations" is always open and is never listed here. Every other stage is
-- closed to a cohort until its supervisor opens it. A row means "open".
-- Authorisation is decided here, by row level security.

create table cohort_stages (
  id         uuid primary key default gen_random_uuid(),
  cohort_id  uuid not null references cohorts (id) on delete cascade,
  stage      text not null check (stage ~ '^[a-z0-9][a-z0-9-]*$' and char_length(stage) <= 40 and stage <> 'foundations'),
  opened_by  uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  unique (cohort_id, stage)
);

alter table cohort_stages enable row level security;

-- Used by the policies. Security definer so reading profiles/cohorts here does
-- not recurse into their own policies.
create function my_cohort_id() returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select cohort_id from profiles where id = auth.uid()
$$;

create function supervises_cohort(cohort uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from cohorts c where c.id = cohort and c.supervisor_id = auth.uid())
$$;

revoke all on function my_cohort_id() from public;
revoke all on function supervises_cohort(uuid) from public;
grant execute on function my_cohort_id() to authenticated;
grant execute on function supervises_cohort(uuid) to authenticated;

-- A student reads their own cohort's rows; a supervisor reads their cohorts'.
create policy cohort_stages_select on cohort_stages for select to authenticated
  using (cohort_id = my_cohort_id() or supervises_cohort(cohort_id));
-- Only the cohort's supervisor opens or closes a stage, and signs it.
create policy cohort_stages_insert on cohort_stages for insert to authenticated
  with check (supervises_cohort(cohort_id) and opened_by = auth.uid());
create policy cohort_stages_delete on cohort_stages for delete to authenticated
  using (supervises_cohort(cohort_id));

-- No update: a stage is open or it is not.
grant select, insert, delete on cohort_stages to authenticated;
revoke all on cohort_stages from anon;

-- Opening and closing are audited by who and when, never by content.
create function audit_cohort_stage() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    insert into audit_log (actor_id, action, target_table, target_id)
    values (new.opened_by, 'open_stage', 'cohort_stages', new.id);
    return new;
  end if;
  insert into audit_log (actor_id, action, target_table, target_id)
  values (auth.uid(), 'close_stage', 'cohort_stages', old.id);
  return old;
end $$;

revoke all on function audit_cohort_stage() from public;

create trigger cohort_stages_audit_open after insert on cohort_stages
  for each row execute function audit_cohort_stage();
create trigger cohort_stages_audit_close after delete on cohort_stages
  for each row execute function audit_cohort_stage();
