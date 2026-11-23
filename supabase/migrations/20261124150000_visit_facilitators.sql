-- A trip can have several facilitators.
--
-- visit_facilitators lists every facilitator on a trip, in the order they were
-- picked (position 0 = the main one). visits.facilitator_id stays as that main
-- facilitator, so the existing triggers keep copying their name/phone onto the
-- visit (poc_name, poc_phone, facilitator) for the agent and older readers.
-- The app writes both. Facilitators linked to trips can't be deleted
-- (deactivate them instead), as before.

create table public.visit_facilitators (
  visit_id       uuid not null references public.visits (id) on delete cascade,
  facilitator_id uuid not null references public.facilitators (id) on delete restrict,
  position       smallint not null default 0 check (position >= 0),
  created_at     timestamptz not null default now(),
  primary key (visit_id, facilitator_id)
);

create index visit_facilitators_facilitator_id_idx on public.visit_facilitators (facilitator_id);

alter table public.visit_facilitators enable row level security;

create policy "active_members_all_visit_facilitators"
on public.visit_facilitators for all to authenticated
using ( (select public.is_active_team_member()) )
with check ( (select public.is_active_team_member()) );

-- Every trip's current facilitator becomes its first (main) one.
insert into public.visit_facilitators (visit_id, facilitator_id, position)
select id, facilitator_id, 0 from public.visits where facilitator_id is not null;
