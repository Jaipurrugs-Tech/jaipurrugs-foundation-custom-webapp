-- A trip can belong to several programs.
--
-- visits.program_categories (text[], at least one, from the fixed set) is the
-- source of truth. visits.program_category stays as the first chosen program,
-- kept in step by a trigger, so everything that still reads the single column
-- (agent RPCs, services, older code) keeps working:
--   * writing program_categories sets program_category to its first element;
--   * writing only program_category (older callers) sets program_categories to
--     just that program.
-- program_categories has no column default on purpose: an insert that sets only
-- program_category must reach the trigger with an empty list.
-- The dashboard functions' Program filter now matches a trip that includes the
-- program. Their live bodies have drifted from the older migration files, so
-- the filter is rewritten in place and the migration aborts if it isn't found.

alter table public.visits add column program_categories text[];

update public.visits set program_categories = array[program_category];

alter table public.visits
  alter column program_categories set not null,
  add constraint visits_program_categories_check check (
    cardinality(program_categories) >= 1
    and program_categories <@ array['rural_experience', 'industrial_visit', 'village_field_visit']
  );

create index visits_program_categories_idx on public.visits using gin (program_categories);

create function public.visits_sync_program_categories()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and new.program_category is distinct from old.program_category
     and new.program_categories is not distinct from old.program_categories then
    -- An older caller changed only the single program.
    new.program_categories := array[new.program_category];
  elsif new.program_categories is null or cardinality(new.program_categories) = 0 then
    new.program_categories := array[new.program_category];
  else
    -- No duplicates, order kept.
    new.program_categories := array(
      select p from unnest(new.program_categories) with ordinality as u(p, i)
      group by p order by min(i)
    );
    new.program_category := new.program_categories[1];
  end if;
  return new;
end;
$$;

create trigger trg_visits_sync_program_categories
before insert or update on public.visits
for each row execute procedure public.visits_sync_program_categories();

-- Dashboard Program filter: "includes this program".
do $$
declare
  v_name text;
  v_def text;
  v_new text;
begin
  foreach v_name in array array['dashboard_stats', 'dashboard_revenue_stats', 'dashboard_feedback_stats'] loop
    select pg_get_functiondef(p.oid) into v_def
    from pg_proc p where p.proname = v_name and p.pronamespace = 'public'::regnamespace;
    if v_def is null then
      raise exception '%() not found', v_name;
    end if;
    v_new := regexp_replace(v_def, '(\m[a-z]+)\.program_category = p_program', 'p_program = any(\1.program_categories)', 'g');
    if v_new = v_def then
      raise exception '%() has no program filter in the expected shape; update this migration', v_name;
    end if;
    execute v_new;
  end loop;
end;
$$;
