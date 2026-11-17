-- Phase 12: services (priced offerings) and proforma invoices (PIs).
-- See docs/phases/12-services-invoices.md.
--
-- * services: a base rate (excl. GST), a GST rate, how it is priced (per person
--   or per group), the locations (villages) it runs in, and the programs and
--   visitor categories it is offered to (empty = all).
-- * service_slabs: headcount bands with a group discount and the number of
--   guides that come free. Above a service's `custom_pricing_above` headcount
--   (default 50) there is no slab: the discount and free guides are set by
--   hand on the PI.
-- * proforma_invoices / proforma_invoice_items: the PI, linked to a visit, with
--   its lines as a snapshot (editing a service never changes an existing PI).
--   Totals are computed in the database. Items are written only through
--   public.save_proforma_invoice(), which recomputes them.
-- * A visit's Rural Experience revenue (visits.amount_charged) is now derived
--   from its issued / paid PIs (taxable value, excl. GST) instead of being typed
--   on the visit, and visits.invoice_id (never used: 0 rows) is dropped.
-- * invoice-assets: a private bucket for the UPI QR code printed on PIs.

create extension if not exists btree_gist with schema extensions;

-- ---------------------------------------------------------------------------
-- Services
-- ---------------------------------------------------------------------------
create table public.services (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null check (length(trim(name)) > 0),
  description           text,
  -- HSN / SAC code printed with the line on a PI.
  sac_code              text,
  pricing_unit          text not null default 'per_person' check (pricing_unit in ('per_person', 'per_group')),
  -- Base amount, before GST.
  base_rate             numeric(12, 2) not null check (base_rate >= 0),
  gst_rate              numeric(5, 2) not null default 18 check (gst_rate between 0 and 100),
  -- Rate for each guide beyond the free allowance. Null: charged at base_rate.
  extra_guide_rate      numeric(12, 2) check (extra_guide_rate is null or extra_guide_rate >= 0),
  -- Groups larger than this get a discount and free guides set by hand on the PI.
  custom_pricing_above  integer not null default 50 check (custom_pricing_above between 1 and 100000),
  -- Empty array = offered on every program / to every visitor category.
  program_categories    text[] not null default '{}'
                        check (program_categories <@ array['rural_experience', 'industrial_visit', 'village_field_visit']),
  visitor_categories    text[] not null default '{}'
                        check (visitor_categories <@ array[
                          'buyer', 'partner', 'collaborator', 'student', 'entrepreneur', 'designer', 'architect',
                          'tourist', 'corporate', 'individual', 'group', 'tour_agency'
                        ]),
  is_active             boolean not null default true,
  created_by            text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create unique index services_name_key on public.services (lower(trim(name)));

create trigger trg_services_set_updated_at
before update on public.services
for each row execute procedure public.set_updated_at();

alter table public.services enable row level security;

create policy "active_members_all_services"
on public.services for all to authenticated
using ( (select public.is_active_team_member()) )
with check ( (select public.is_active_team_member()) );

-- The locations a service runs in. Removing a village just drops it from its services.
create table public.service_villages (
  service_id  uuid not null references public.services (id) on delete cascade,
  village_id  uuid not null references public.villages (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (service_id, village_id)
);

create index service_villages_village_id_idx on public.service_villages (village_id);

alter table public.service_villages enable row level security;

create policy "active_members_all_service_villages"
on public.service_villages for all to authenticated
using ( (select public.is_active_team_member()) )
with check ( (select public.is_active_team_member()) );

-- Headcount bands: the group discount and how many guides go free of charge.
create table public.service_slabs (
  id              uuid primary key default gen_random_uuid(),
  service_id      uuid not null references public.services (id) on delete cascade,
  min_headcount   integer not null check (min_headcount >= 1),
  max_headcount   integer not null,
  -- 'percent' of the rate, or a flat 'amount' off each unit (per person, or per group).
  discount_type   text not null default 'percent' check (discount_type in ('percent', 'amount')),
  discount_value  numeric(12, 2) not null default 0 check (discount_value >= 0),
  free_guides     integer not null default 0 check (free_guides between 0 and 1000),
  created_at      timestamptz not null default now(),
  constraint service_slabs_range_check check (max_headcount >= min_headcount),
  constraint service_slabs_percent_check check (discount_type <> 'percent' or discount_value <= 100),
  -- Two bands of one service never overlap.
  constraint service_slabs_no_overlap
    exclude using gist (service_id with =, int4range(min_headcount, max_headcount, '[]') with &&)
);

alter table public.service_slabs enable row level security;

create policy "active_members_all_service_slabs"
on public.service_slabs for all to authenticated
using ( (select public.is_active_team_member()) )
with check ( (select public.is_active_team_member()) );

-- Saves a service with its locations and slabs in one transaction. p_id null = create.
create function public.save_service(p_id uuid, p_service jsonb, p_village_ids uuid[], p_slabs jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
  v_above integer := coalesce((p_service->>'custom_pricing_above')::integer, 50);
begin
  if jsonb_typeof(coalesce(p_slabs, '[]'::jsonb)) <> 'array' then
    raise exception 'Slabs must be an array' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(coalesce(p_slabs, '[]'::jsonb)) s
    where (s->>'max_headcount')::integer > v_above
  ) then
    raise exception 'A slab goes beyond the custom-pricing headcount' using errcode = '22023';
  end if;

  if p_id is null then
    insert into public.services (
      name, description, sac_code, pricing_unit, base_rate, gst_rate, extra_guide_rate,
      custom_pricing_above, program_categories, visitor_categories, created_by
    )
    values (
      p_service->>'name',
      p_service->>'description',
      p_service->>'sac_code',
      p_service->>'pricing_unit',
      (p_service->>'base_rate')::numeric,
      (p_service->>'gst_rate')::numeric,
      (p_service->>'extra_guide_rate')::numeric,
      v_above,
      coalesce(array(select jsonb_array_elements_text(p_service->'program_categories')), '{}'),
      coalesce(array(select jsonb_array_elements_text(p_service->'visitor_categories')), '{}'),
      p_service->>'created_by'
    )
    returning id into v_id;
  else
    update public.services set
      name = p_service->>'name',
      description = p_service->>'description',
      sac_code = p_service->>'sac_code',
      pricing_unit = p_service->>'pricing_unit',
      base_rate = (p_service->>'base_rate')::numeric,
      gst_rate = (p_service->>'gst_rate')::numeric,
      extra_guide_rate = (p_service->>'extra_guide_rate')::numeric,
      custom_pricing_above = v_above,
      program_categories = coalesce(array(select jsonb_array_elements_text(p_service->'program_categories')), '{}'),
      visitor_categories = coalesce(array(select jsonb_array_elements_text(p_service->'visitor_categories')), '{}')
    where id = p_id
    returning id into v_id;
    if v_id is null then
      raise exception 'Service not found' using errcode = 'P0002';
    end if;
    delete from public.service_villages where service_id = v_id;
    delete from public.service_slabs where service_id = v_id;
  end if;

  insert into public.service_villages (service_id, village_id)
  select v_id, vid from unnest(coalesce(p_village_ids, '{}')) as vid
  on conflict do nothing;

  insert into public.service_slabs (service_id, min_headcount, max_headcount, discount_type, discount_value, free_guides)
  select v_id,
         (s->>'min_headcount')::integer,
         (s->>'max_headcount')::integer,
         s->>'discount_type',
         (s->>'discount_value')::numeric,
         (s->>'free_guides')::integer
  from jsonb_array_elements(coalesce(p_slabs, '[]'::jsonb)) s;

  return v_id;
end;
$$;

revoke execute on function public.save_service(uuid, jsonb, uuid[], jsonb) from public, anon;
grant execute on function public.save_service(uuid, jsonb, uuid[], jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Invoice settings (single row): the seller block, bank details, UPI QR code,
-- numbering and defaults printed on every PI.
-- ---------------------------------------------------------------------------
create table public.invoice_settings (
  id                     boolean primary key default true check (id),
  seller_name            text not null default 'Jaipur Rugs Company Pvt Ltd',
  seller_address         text not null default E'G-250, Mansarovar Industrial Area\nMansarovar, Jaipur, Rajasthan, 302020',
  seller_phone           text default '1417103400',
  seller_state_name      text default 'Rajasthan',
  seller_state_code      text default '08',
  seller_gstin           text default '08AABCJ6934C1ZP',
  bank_account_name      text default 'Jaipur Rugs Company Pvt Ltd.',
  bank_account_number    text default '2987002100154928',
  bank_ifsc              text default 'PUNB0298700',
  bank_name              text default 'Punjab National Bank',
  bank_address           text default 'IBB, Sarojani Marg, C-Scheme, Jaipur, Rajasthan',
  -- Object path in the private invoice-assets bucket.
  upi_qr_path            text,
  -- PI numbers are <prefix>/<financial year, e.g. 2627>/<sequence, 3 digits>.
  number_prefix          text not null default 'PI/RJ/RV' check (length(trim(number_prefix)) > 0),
  default_payment_terms  text default '100% Advance',
  footer_note            text default 'This is a computer generated document, no signature required',
  updated_by             text,
  updated_at             timestamptz not null default now()
);

insert into public.invoice_settings (id) values (true);

create trigger trg_invoice_settings_set_updated_at
before update on public.invoice_settings
for each row execute procedure public.set_updated_at();

alter table public.invoice_settings enable row level security;

create policy "active_members_select_invoice_settings"
on public.invoice_settings for select to authenticated
using ( (select public.is_active_team_member()) );

create policy "active_members_update_invoice_settings"
on public.invoice_settings for update to authenticated
using ( (select public.is_active_team_member()) )
with check ( (select public.is_active_team_member()) );

-- Reusable terms & conditions; a PI keeps a copy of the ones chosen for it.
create table public.invoice_terms (
  id          uuid primary key default gen_random_uuid(),
  title       text not null check (length(trim(title)) > 0),
  body        text not null check (length(trim(body)) > 0),
  -- Ticked automatically on a new PI.
  is_default  boolean not null default false,
  is_active   boolean not null default true,
  position    integer not null default 0,
  created_by  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger trg_invoice_terms_set_updated_at
before update on public.invoice_terms
for each row execute procedure public.set_updated_at();

alter table public.invoice_terms enable row level security;

create policy "active_members_all_invoice_terms"
on public.invoice_terms for all to authenticated
using ( (select public.is_active_team_member()) )
with check ( (select public.is_active_team_member()) );

-- ---------------------------------------------------------------------------
-- Proforma invoices
-- ---------------------------------------------------------------------------
create table public.proforma_invoices (
  id               uuid primary key default gen_random_uuid(),
  -- Assigned by the trigger below when left blank.
  pi_number        text not null unique check (length(trim(pi_number)) > 0),
  pi_date          date not null default ((now() at time zone 'Asia/Kolkata')::date),
  -- Only issued and paid PIs count as a visit's revenue.
  status           text not null default 'draft' check (status in ('draft', 'issued', 'paid', 'cancelled')),
  visit_id         uuid references public.visits (id) on delete set null,
  billing_name     text not null check (length(trim(billing_name)) > 0),
  billing_address  text,
  billing_gstin    text,
  payment_terms    text,
  guests           integer not null default 0 check (guests between 0 and 100000),
  guides           integer not null default 0 check (guides between 0 and 10000),
  free_guides      integer not null default 0 check (free_guides >= 0),
  -- Copy of the chosen terms: [{ "title": text, "body": text }].
  terms            jsonb not null default '[]'::jsonb check (jsonb_typeof(terms) = 'array'),
  notes            text,
  -- Maintained by public.proforma_invoice_recalc().
  subtotal         numeric(14, 2) not null default 0,
  discount_total   numeric(14, 2) not null default 0,
  taxable_total    numeric(14, 2) not null default 0,
  gst_total        numeric(14, 2) not null default 0,
  grand_total      numeric(14, 2) not null default 0,
  created_by       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint proforma_invoices_free_guides_within_guides check (free_guides <= guides)
);

create index proforma_invoices_visit_id_idx on public.proforma_invoices (visit_id);
create index proforma_invoices_pi_date_idx on public.proforma_invoices (pi_date desc);

create trigger trg_proforma_invoices_set_updated_at
before update on public.proforma_invoices
for each row execute procedure public.set_updated_at();

alter table public.proforma_invoices enable row level security;

create policy "active_members_all_proforma_invoices"
on public.proforma_invoices for all to authenticated
using ( (select public.is_active_team_member()) )
with check ( (select public.is_active_team_member()) );

create table public.proforma_invoice_items (
  id              uuid primary key default gen_random_uuid(),
  invoice_id      uuid not null references public.proforma_invoices (id) on delete cascade,
  position        integer not null,
  -- The service this line came from; the line itself is a snapshot.
  service_id      uuid references public.services (id) on delete set null,
  description     text not null check (length(trim(description)) > 0),
  -- Second line under the description, e.g. "Guests: 12 | Guide: 3 (free of charge)".
  details         text,
  sac_code        text,
  rate            numeric(12, 2) not null check (rate >= 0),
  quantity        numeric(10, 2) not null check (quantity > 0),
  -- Discount per unit, printed as its own row ("- Goodwill Discount").
  discount_label  text,
  discount_rate   numeric(12, 2) not null default 0 check (discount_rate >= 0),
  gst_rate        numeric(5, 2) not null check (gst_rate between 0 and 100),
  created_at      timestamptz not null default now(),
  constraint proforma_invoice_items_discount_check check (discount_rate <= rate)
);

create index proforma_invoice_items_invoice_id_idx on public.proforma_invoice_items (invoice_id, position);
create index proforma_invoice_items_service_id_idx on public.proforma_invoice_items (service_id);

alter table public.proforma_invoice_items enable row level security;

create policy "active_members_all_proforma_invoice_items"
on public.proforma_invoice_items for all to authenticated
using ( (select public.is_active_team_member()) )
with check ( (select public.is_active_team_member()) );

-- PI numbers: <prefix>/<FY>/<seq>. The financial year runs April-March, so
-- 28 Oct 2026 is FY 2026-27 -> "2627". The sequence continues from the highest
-- number already used for that prefix and year, so a hand-entered number (e.g.
-- carrying on from PIs made before this app) is picked up.
create function public.proforma_invoices_before_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_prefix text;
  v_fy text;
  v_base text;
  v_seq integer;
begin
  new.pi_number := nullif(trim(new.pi_number), '');
  if new.pi_number is null then
    select trim(number_prefix) into v_prefix from public.invoice_settings where id;
    v_fy := case
      when extract(month from new.pi_date) >= 4
        then to_char(new.pi_date, 'YY') || to_char(new.pi_date + interval '1 year', 'YY')
      else to_char(new.pi_date - interval '1 year', 'YY') || to_char(new.pi_date, 'YY')
    end;
    v_base := coalesce(nullif(v_prefix, ''), 'PI') || '/' || v_fy || '/';
    -- Serialise numbering for this prefix + year.
    perform pg_advisory_xact_lock(hashtext('proforma_invoice_number:' || v_base));
    select coalesce(max(substr(pi_number, length(v_base) + 1)::integer), 0) + 1
    into v_seq
    from public.proforma_invoices
    where starts_with(pi_number, v_base)
      and substr(pi_number, length(v_base) + 1) ~ '^\d{1,9}$';
    new.pi_number := v_base || lpad(v_seq::text, 3, '0');
  end if;
  return new;
end;
$$;

create trigger trg_proforma_invoices_before_insert
before insert on public.proforma_invoices
for each row execute procedure public.proforma_invoices_before_insert();

-- Recomputes a PI's totals from its lines. GST is worked out per rate on the
-- summed taxable value, rounded to the paisa. src/lib/invoices/calc.ts mirrors this
-- for the live preview; the database is the source of truth.
create function public.proforma_invoice_recalc(p_invoice_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  with lines as (
    select round(rate * quantity, 2) as gross,
           round(discount_rate * quantity, 2) as discount,
           gst_rate
    from public.proforma_invoice_items
    where invoice_id = p_invoice_id
  ),
  by_rate as (
    select gst_rate, sum(gross - discount) as taxable
    from lines
    group by gst_rate
  ),
  t as (
    select (select coalesce(sum(gross), 0) from lines) as subtotal,
           (select coalesce(sum(discount), 0) from lines) as discount_total,
           (select coalesce(sum(taxable), 0) from by_rate) as taxable_total,
           (select coalesce(sum(round(taxable * gst_rate / 100, 2)), 0) from by_rate) as gst_total
  )
  update public.proforma_invoices p
  set subtotal = t.subtotal,
      discount_total = t.discount_total,
      taxable_total = t.taxable_total,
      gst_total = t.gst_total,
      grand_total = t.taxable_total + t.gst_total
  from t
  where p.id = p_invoice_id;
end;
$$;

revoke execute on function public.proforma_invoice_recalc(uuid) from public, anon;
grant execute on function public.proforma_invoice_recalc(uuid) to authenticated;

-- Saves a PI and its lines in one transaction. p_id null = create (the number is
-- assigned unless one is given). Returns the PI's id.
create function public.save_proforma_invoice(p_id uuid, p_invoice jsonb, p_items jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' then
    raise exception 'Items must be an array' using errcode = '22023';
  end if;

  if p_id is null then
    insert into public.proforma_invoices (
      pi_number, pi_date, status, visit_id, billing_name, billing_address, billing_gstin,
      payment_terms, guests, guides, free_guides, terms, notes, created_by
    )
    values (
      p_invoice->>'pi_number',
      coalesce((p_invoice->>'pi_date')::date, (now() at time zone 'Asia/Kolkata')::date),
      coalesce(p_invoice->>'status', 'draft'),
      (p_invoice->>'visit_id')::uuid,
      p_invoice->>'billing_name',
      p_invoice->>'billing_address',
      p_invoice->>'billing_gstin',
      p_invoice->>'payment_terms',
      coalesce((p_invoice->>'guests')::integer, 0),
      coalesce((p_invoice->>'guides')::integer, 0),
      coalesce((p_invoice->>'free_guides')::integer, 0),
      coalesce(p_invoice->'terms', '[]'::jsonb),
      p_invoice->>'notes',
      p_invoice->>'created_by'
    )
    returning id into v_id;
  else
    update public.proforma_invoices set
      -- A blank number on edit keeps the current one.
      pi_number = coalesce(nullif(trim(p_invoice->>'pi_number'), ''), pi_number),
      pi_date = coalesce((p_invoice->>'pi_date')::date, pi_date),
      status = coalesce(p_invoice->>'status', status),
      visit_id = (p_invoice->>'visit_id')::uuid,
      billing_name = p_invoice->>'billing_name',
      billing_address = p_invoice->>'billing_address',
      billing_gstin = p_invoice->>'billing_gstin',
      payment_terms = p_invoice->>'payment_terms',
      guests = coalesce((p_invoice->>'guests')::integer, 0),
      guides = coalesce((p_invoice->>'guides')::integer, 0),
      free_guides = coalesce((p_invoice->>'free_guides')::integer, 0),
      terms = coalesce(p_invoice->'terms', '[]'::jsonb),
      notes = p_invoice->>'notes'
    where id = p_id
    returning id into v_id;
    if v_id is null then
      raise exception 'Proforma invoice not found' using errcode = 'P0002';
    end if;
    delete from public.proforma_invoice_items where invoice_id = v_id;
  end if;

  insert into public.proforma_invoice_items (
    invoice_id, position, service_id, description, details, sac_code,
    rate, quantity, discount_label, discount_rate, gst_rate
  )
  select v_id,
         ord::integer,
         (e->>'service_id')::uuid,
         e->>'description',
         e->>'details',
         e->>'sac_code',
         (e->>'rate')::numeric,
         (e->>'quantity')::numeric,
         e->>'discount_label',
         coalesce((e->>'discount_rate')::numeric, 0),
         (e->>'gst_rate')::numeric
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) with ordinality as t(e, ord);

  perform public.proforma_invoice_recalc(v_id);
  return v_id;
end;
$$;

revoke execute on function public.save_proforma_invoice(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.save_proforma_invoice(uuid, jsonb, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- A visit's Rural Experience revenue comes from its PIs.
-- ---------------------------------------------------------------------------
create function public.sync_visit_charges(p_visit_id uuid)
returns void
language sql
security invoker
set search_path = ''
as $$
  update public.visits v
  set amount_charged = (
    select sum(p.taxable_total)
    from public.proforma_invoices p
    where p.visit_id = p_visit_id and p.status in ('issued', 'paid')
  )
  where v.id = p_visit_id;
$$;

revoke execute on function public.sync_visit_charges(uuid) from public, anon;
grant execute on function public.sync_visit_charges(uuid) to authenticated;

create function public.proforma_invoices_sync_visit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') and old.visit_id is not null then
    perform public.sync_visit_charges(old.visit_id);
  end if;
  if tg_op in ('INSERT', 'UPDATE') and new.visit_id is not null
     and (tg_op = 'INSERT' or new.visit_id is distinct from old.visit_id
          or new.status is distinct from old.status or new.taxable_total is distinct from old.taxable_total) then
    perform public.sync_visit_charges(new.visit_id);
  end if;
  return null;
end;
$$;

create trigger trg_proforma_invoices_sync_visit
after insert or delete or update of visit_id, status, taxable_total on public.proforma_invoices
for each row execute procedure public.proforma_invoices_sync_visit();

-- ---------------------------------------------------------------------------
-- Dashboard: the Rural Experience invoice count is now the visit's issued / paid
-- PIs (visits.invoice_id is dropped below). Otherwise unchanged.
-- ---------------------------------------------------------------------------
create or replace function public.dashboard_revenue_stats(
  p_from date,
  p_to date,
  p_program text default 'rural_experience',
  p_visitor_category text default null,
  p_booking_channel text default null,
  p_village_id uuid default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'Invalid date range' using errcode = '22023';
  end if;
  if p_to - p_from > 366 * 6 then
    raise exception 'Date range too large' using errcode = '22023';
  end if;

  with
  counted as (
    select v.id, v.headcount, v.visitor_category, v.amount_charged, v.amount_to_artisans
    from public.visits v
    where v.status = 'completed'
      and v.visit_date between p_from and p_to
      and (p_program is null or p_program = 'all' or v.program_category = p_program)
      and (p_visitor_category is null or v.visitor_category = p_visitor_category)
      and (p_booking_channel is null or v.booking_channel = p_booking_channel)
      and (p_village_id is null or exists (
        select 1 from public.visit_villages vv where vv.visit_id = v.id and vv.village_id = p_village_id))
  ),
  sales as (
    select s.visit_id, s.channel, s.amount
    from public.visit_sales s
    join counted c on c.id = s.visit_id
  ),
  sales_by_visit as (
    select visit_id,
           coalesce(sum(amount) filter (where channel = 'jr_sales'), 0) as jr_sales,
           coalesce(sum(amount) filter (where channel = 'jr_farms'), 0) as jr_farms
    from sales
    group by visit_id
  )
  select jsonb_build_object(
    'streams', jsonb_build_object(
      'rural_experience', jsonb_build_object(
        'amount', (select coalesce(sum(amount_charged), 0) from counted),
        'invoices', (
          select count(*)
          from public.proforma_invoices p
          join counted c on c.id = p.visit_id
          where p.status in ('issued', 'paid')
        ),
        'visits', (select count(*) from counted where coalesce(amount_charged, 0) > 0)
      ),
      'jr_sales', jsonb_build_object(
        'amount', (select coalesce(sum(amount), 0) from sales where channel = 'jr_sales'),
        'invoices', (select count(*) from sales where channel = 'jr_sales'),
        'visits', (select count(distinct visit_id) from sales where channel = 'jr_sales')
      ),
      'jr_farms', jsonb_build_object(
        'amount', (select coalesce(sum(amount), 0) from sales where channel = 'jr_farms'),
        'invoices', (select count(*) from sales where channel = 'jr_farms'),
        'visits', (select count(distinct visit_id) from sales where channel = 'jr_farms')
      )
    ),
    'by_category', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'category', category,
                 'bookings', bookings,
                 'visitors', visitors,
                 'revenue', revenue,
                 'jr_sales', jr_sales,
                 'jr_farms', jr_farms,
                 'artisan_payments', artisan_payments
               )
               order by bookings desc, revenue desc, category)
      from (
        select coalesce(c.visitor_category, 'unspecified') as category,
               count(*) as bookings,
               coalesce(sum(c.headcount), 0) as visitors,
               coalesce(sum(c.amount_charged), 0) as revenue,
               coalesce(sum(sv.jr_sales), 0) as jr_sales,
               coalesce(sum(sv.jr_farms), 0) as jr_farms,
               coalesce(sum(c.amount_to_artisans), 0) as artisan_payments
        from counted c
        left join sales_by_visit sv on sv.visit_id = c.id
        group by coalesce(c.visitor_category, 'unspecified')
      ) t
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

revoke execute on function public.dashboard_revenue_stats(date, date, text, text, text, uuid) from public, anon;

-- Charges are managed on PIs now; this column was never filled in.
alter table public.visits drop column invoice_id;

-- ---------------------------------------------------------------------------
-- Storage: private bucket for the UPI QR code (and any other PI asset). PNG or
-- JPEG only: the PDF renderer can't embed WebP. Read
-- through short-lived signed URLs only (AGENTS.md §5).
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('invoice-assets', 'invoice-assets', false, 2097152, array['image/png', 'image/jpeg'])
on conflict (id) do nothing;

create policy "active_members_select_invoice_assets"
on storage.objects for select to authenticated
using ( bucket_id = 'invoice-assets' and (select public.is_active_team_member()) );

create policy "active_members_insert_invoice_assets"
on storage.objects for insert to authenticated
with check ( bucket_id = 'invoice-assets' and (select public.is_active_team_member()) );

create policy "active_members_update_invoice_assets"
on storage.objects for update to authenticated
using ( bucket_id = 'invoice-assets' and (select public.is_active_team_member()) )
with check ( bucket_id = 'invoice-assets' and (select public.is_active_team_member()) );

create policy "active_members_delete_invoice_assets"
on storage.objects for delete to authenticated
using ( bucket_id = 'invoice-assets' and (select public.is_active_team_member()) );
