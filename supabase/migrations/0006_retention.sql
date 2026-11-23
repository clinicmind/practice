-- Retention and review (phase 3, tasks 4-5).
--  1. delete_after follows the cohort's term_end (+ 90 days) when the owner changes it.
--  2. feedback: scores are checked, a released review is complete and cannot go back to a draft,
--     and releasing marks the report reviewed and writes an audit row (no text in it).
-- Deleting expired reports is done by the `reports` Edge Function (it must delete the Drive file
-- too), so there is no SQL purge function here. Who may see expired reports is row level security,
-- as for every other read of `reports`.

-- ---------------------------------------------------------------- retention

create function sync_report_expiry() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update reports r set delete_after = new.term_end + 90
  from profiles p
  where p.id = r.user_id and p.cohort_id = new.id;
  return null;
end $$;
revoke all on function sync_report_expiry() from public;

create trigger cohorts_sync_report_expiry
  after update of term_end on cohorts
  for each row when (old.term_end is distinct from new.term_end)
  execute function sync_report_expiry();

-- ---------------------------------------------------------------- feedback rules

-- At most the six dimensions of the report rubric, each scored 1 to 4.
create function feedback_scores_valid(scores jsonb) returns boolean
language sql immutable as $$
  select jsonb_typeof(scores) = 'object' and not exists (
    select 1 from jsonb_each(scores) e
    where e.key not in ('picture', 'formulation', 'link', 'process', 'self', 'ethics')
       or jsonb_typeof(e.value) <> 'number'
       or e.value::text not in ('1', '2', '3', '4')
  )
$$;
create function feedback_scores_count(scores jsonb) returns integer
language sql immutable as $$
  select case when jsonb_typeof(scores) = 'object' then (select count(*)::int from jsonb_object_keys(scores)) else 0 end
$$;

alter table feedback add constraint feedback_scores_valid check (feedback_scores_valid(scores));
alter table feedback add constraint feedback_release_complete check (
  status = 'draft'
  or (released_at is not null and btrim(comments) <> '' and feedback_scores_count(scores) = 6)
);

create function release_feedback_effects() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'UPDATE' and old.status = 'released' and new.status <> 'released' then
    raise exception 'released feedback cannot go back to a draft';
  end if;
  if new.status = 'released' and (tg_op = 'INSERT' or old.status <> 'released') then
    update reports set status = 'reviewed' where id = new.report_id;
    insert into audit_log (actor_id, action, target_table, target_id)
    values (auth.uid(), 'release_feedback', 'feedback', new.id);
  end if;
  return new;
end $$;
revoke all on function release_feedback_effects() from public;

create trigger feedback_release_effects
  before insert or update on feedback
  for each row execute function release_feedback_effects();
