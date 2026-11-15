-- Supervisor dashboard support (phase 2, task 4).

-- Latest activity per student. security_invoker makes the view run with the
-- caller's privileges, so row level security on the three tables decides who
-- sees which student: a supervisor gets their own cohort, a student gets themselves.
create view student_activity with (security_invoker = true) as
select user_id, max(created_at) as last_active_at
from (
  select user_id, created_at from attempts
  union all select user_id, created_at from decisions
  union all select user_id, created_at from reflections
) a
group by user_id;

grant select on student_activity to authenticated;

-- A grant is audited by who and when, never by content. The trigger is security
-- definer because nobody can insert into audit_log directly.
create function audit_unlock() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into audit_log (actor_id, action, target_table, target_id)
  values (new.granted_by, 'grant_unlock', 'unlocks', new.id);
  return new;
end $$;

revoke all on function audit_unlock() from public;

create trigger unlocks_audit after insert on unlocks
  for each row execute function audit_unlock();
