-- Keep existing records intact, but reject any future exact duplicate time logs.
create or replace function public.prevent_duplicate_time_entry()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if exists (
    select 1
    from public.time_entries
    where project_id = new.project_id
      and start_at = new.start_at
      and end_at = new.end_at
      and lower(btrim(description)) = lower(btrim(new.description))
      and id is distinct from new.id
  ) then
    raise exception using
      errcode = '23505',
      message = 'That exact time entry already exists. Edit the existing entry instead.';
  end if;

  return new;
end;
$$;

drop trigger if exists prevent_duplicate_time_entry on public.time_entries;

create trigger prevent_duplicate_time_entry
before insert or update on public.time_entries
for each row
execute function public.prevent_duplicate_time_entry();
