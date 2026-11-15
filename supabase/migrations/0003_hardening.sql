-- Hardening after review of 0001 and 0002. Nothing here changes who may read what.

-- 1. No privilege for anon on anything in public, stated explicitly. Row level
--    security already returns nothing to anon; this removes the dependency on
--    default privileges being in the expected state.
revoke all on all tables in schema public from anon;
revoke all on all functions in schema public from anon;
revoke all on all sequences in schema public from anon;

-- 2. Size limits. A student writes these rows directly, so the database must
--    bound them.
alter table attempts
  add constraint attempts_response_len check (char_length(response) <= 5000),
  add constraint attempts_item_len check (char_length(item_id) between 1 and 100),
  add constraint attempts_criteria_flat check (array_ndims(criteria_met) = 1);
alter table decisions
  add constraint decisions_response_len check (response is null or char_length(response) <= 5000),
  add constraint decisions_ids_len check (
    char_length(session_id) between 1 and 100 and char_length(decision_id) between 1 and 100
    and (option_id is null or char_length(option_id) <= 100));
alter table reflections
  add constraint reflections_text_len check (char_length(text) <= 5000),
  add constraint reflections_ids_len check (
    char_length(module_slug) between 1 and 100 and char_length(prompt_id) between 1 and 100);

-- 3. "Latest attempt wins". A client may supply created_at so that progress
--    imported from the browser keeps its dates, but never a time in the future:
--    that would pin one row as the latest for ever.
create function clamp_created_at() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if new.created_at is null or new.created_at > now() then
    new.created_at := now();
  end if;
  return new;
end $$;

create trigger attempts_clamp_created before insert on attempts
  for each row execute function clamp_created_at();
create trigger decisions_clamp_created before insert on decisions
  for each row execute function clamp_created_at();
create trigger reflections_clamp_created before insert on reflections
  for each row execute function clamp_created_at();

-- 4. A student whose cohort was deleted (cohort_id set to null) could not join
--    another: join_cohort treated any existing profile as final. Such a student
--    may now join. Students in a cohort keep it; supervisors are never changed.
create or replace function join_cohort(code text, display_name text)
returns table (cohort_id uuid, error_code text)
language plpgsql security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
declare
  uid uuid := auth.uid();
  name_clean text := btrim(coalesce(display_name, ''));
  norm text := upper(btrim(coalesce(code, '')));
  found cohorts%rowtype;
  existing profiles%rowtype;
  failures int;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  if char_length(name_clean) not between 1 and 40 then
    return query select null::uuid, 'invalid_display_name'::text;
    return;
  end if;

  select count(*) into failures from join_attempts j
   where j.user_id = uid and not j.ok and j.created_at > now() - interval '1 hour';
  if failures >= 10 then
    return query select null::uuid, 'rate_limited'::text;
    return;
  end if;

  select * into found from cohorts c where c.invite_code = norm;
  if found.id is null then
    insert into join_attempts (user_id, ok) values (uid, false);
    return query select null::uuid, 'invalid_code'::text;
    return;
  end if;

  if found.term_end < current_date then
    return query select null::uuid, 'cohort_closed'::text;
    return;
  end if;

  select * into existing from profiles p where p.id = uid;
  if existing.id is not null then
    if existing.role = 'student' and existing.cohort_id is null then
      update profiles set cohort_id = found.id where id = uid;
      insert into join_attempts (user_id, ok) values (uid, true);
      return query select found.id, null::text;
      return;
    end if;
    return query select existing.cohort_id, null::text;
    return;
  end if;

  insert into profiles (id, role, display_name, cohort_id) values (uid, 'student', name_clean, found.id);
  insert into join_attempts (user_id, ok) values (uid, true);
  return query select found.id, null::text;
end $$;

revoke all on function join_cohort(text, text) from public;
grant execute on function join_cohort(text, text) to authenticated;
revoke all on function clamp_created_at() from public;
