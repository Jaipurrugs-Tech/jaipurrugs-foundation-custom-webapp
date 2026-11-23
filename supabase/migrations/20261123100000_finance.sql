-- Finance module: payments received against proforma invoices, payouts to
-- artisan families, and expenses (with receipts).
--
-- * invoice_payments: money received against an issued PI. Recording payments
--   moves the PI between 'issued' and 'paid' on its own: fully paid -> 'paid',
--   anything less -> 'issued'. Draft and cancelled PIs can't take payments.
--   A PI with payments can't be deleted (cancel it instead).
-- * artisan_payouts: money paid to artisan families. What a visit owes them is
--   visits.amount_to_artisans; a payout may name the visit, the village, both
--   or neither (e.g. a lump-sum settlement).
-- * expenses: the foundation's costs, optionally against a visit and/or a
--   village, with a receipt in the private finance-receipts bucket.
-- Every table is team-members-only (no anon access).

-- ---------------------------------------------------------------------------
-- Payments received
-- ---------------------------------------------------------------------------
create table public.invoice_payments (
  id          uuid primary key default gen_random_uuid(),
  invoice_id  uuid not null references public.proforma_invoices (id) on delete restrict,
  paid_on     date not null default ((now() at time zone 'Asia/Kolkata')::date),
  amount      numeric(14, 2) not null check (amount > 0),
  mode        text not null default 'bank_transfer'
              check (mode in ('bank_transfer', 'upi', 'cash', 'cheque', 'card', 'other')),
  reference   text,
  notes       text,
  created_by  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index invoice_payments_invoice_id_idx on public.invoice_payments (invoice_id);
create index invoice_payments_paid_on_idx on public.invoice_payments (paid_on desc);

create trigger trg_invoice_payments_set_updated_at
before update on public.invoice_payments
for each row execute procedure public.set_updated_at();

alter table public.invoice_payments enable row level security;

create policy "active_members_all_invoice_payments"
on public.invoice_payments for all to authenticated
using ( (select public.is_active_team_member()) )
with check ( (select public.is_active_team_member()) );

-- Only issued (or already paid) PIs take payments.
create function public.invoice_payments_check_invoice()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_status text;
begin
  select p.status into v_status from public.proforma_invoices p where p.id = new.invoice_id;
  if v_status is null then
    raise exception 'Proforma invoice not found' using errcode = '23503';
  end if;
  if v_status not in ('issued', 'paid') then
    raise exception 'Payments can only be recorded against an issued proforma invoice'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger trg_invoice_payments_check_invoice
before insert or update of invoice_id on public.invoice_payments
for each row execute procedure public.invoice_payments_check_invoice();

-- Fully paid -> 'paid'; anything less -> 'issued'. Leaves draft/cancelled alone.
create function public.proforma_invoice_sync_paid_status(p_invoice_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.proforma_invoices p
  set status = case
        when p.grand_total > 0 and coalesce(
          (select sum(ip.amount) from public.invoice_payments ip where ip.invoice_id = p.id), 0
        ) >= p.grand_total then 'paid'
        else 'issued'
      end
  where p.id = p_invoice_id
    and p.status in ('issued', 'paid');
end;
$$;

create function public.invoice_payments_after_write()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform public.proforma_invoice_sync_paid_status(old.invoice_id);
  end if;
  if tg_op in ('INSERT', 'UPDATE') and (tg_op = 'INSERT' or new.invoice_id is distinct from old.invoice_id
      or new.amount is distinct from old.amount) then
    perform public.proforma_invoice_sync_paid_status(new.invoice_id);
  end if;
  return null;
end;
$$;

create trigger trg_invoice_payments_after_write
after insert or update or delete on public.invoice_payments
for each row execute procedure public.invoice_payments_after_write();

-- ---------------------------------------------------------------------------
-- Artisan payouts
-- ---------------------------------------------------------------------------
create table public.artisan_payouts (
  id          uuid primary key default gen_random_uuid(),
  visit_id    uuid references public.visits (id) on delete set null,
  -- Villages are deactivated, not deleted, once they have history.
  village_id  uuid references public.villages (id) on delete restrict,
  -- The artisan family, group or SHG that was paid.
  payee       text not null check (length(trim(payee)) > 0),
  paid_on     date not null default ((now() at time zone 'Asia/Kolkata')::date),
  amount      numeric(14, 2) not null check (amount > 0),
  mode        text not null default 'bank_transfer'
              check (mode in ('bank_transfer', 'upi', 'cash', 'cheque', 'card', 'other')),
  reference   text,
  notes       text,
  created_by  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index artisan_payouts_visit_id_idx on public.artisan_payouts (visit_id);
create index artisan_payouts_village_id_idx on public.artisan_payouts (village_id);
create index artisan_payouts_paid_on_idx on public.artisan_payouts (paid_on desc);

create trigger trg_artisan_payouts_set_updated_at
before update on public.artisan_payouts
for each row execute procedure public.set_updated_at();

alter table public.artisan_payouts enable row level security;

create policy "active_members_all_artisan_payouts"
on public.artisan_payouts for all to authenticated
using ( (select public.is_active_team_member()) )
with check ( (select public.is_active_team_member()) );

-- ---------------------------------------------------------------------------
-- Expenses
-- ---------------------------------------------------------------------------
create table public.expenses (
  id            uuid primary key default gen_random_uuid(),
  expense_date  date not null default ((now() at time zone 'Asia/Kolkata')::date),
  category      text not null
                check (category in ('transport', 'food', 'accommodation', 'guide', 'facilitator',
                                    'materials', 'marketing', 'admin', 'other')),
  description   text not null check (length(trim(description)) > 0),
  amount        numeric(14, 2) not null check (amount > 0),
  paid_to       text,
  mode          text not null default 'bank_transfer'
                check (mode in ('bank_transfer', 'upi', 'cash', 'cheque', 'card', 'other')),
  reference     text,
  visit_id      uuid references public.visits (id) on delete set null,
  village_id    uuid references public.villages (id) on delete restrict,
  -- Object path in the private finance-receipts bucket.
  receipt_path  text,
  notes         text,
  created_by    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index expenses_expense_date_idx on public.expenses (expense_date desc);
create index expenses_visit_id_idx on public.expenses (visit_id);
create index expenses_village_id_idx on public.expenses (village_id);

create trigger trg_expenses_set_updated_at
before update on public.expenses
for each row execute procedure public.set_updated_at();

alter table public.expenses enable row level security;

create policy "active_members_all_expenses"
on public.expenses for all to authenticated
using ( (select public.is_active_team_member()) )
with check ( (select public.is_active_team_member()) );

-- ---------------------------------------------------------------------------
-- Storage: private bucket for expense receipts (PDF, PNG, JPEG; 5 MB)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('finance-receipts', 'finance-receipts', false, 5242880, array['application/pdf', 'image/png', 'image/jpeg'])
on conflict (id) do nothing;

create policy "active_members_select_finance_receipts"
on storage.objects for select to authenticated
using ( bucket_id = 'finance-receipts' and (select public.is_active_team_member()) );

create policy "active_members_insert_finance_receipts"
on storage.objects for insert to authenticated
with check ( bucket_id = 'finance-receipts' and (select public.is_active_team_member()) );

create policy "active_members_update_finance_receipts"
on storage.objects for update to authenticated
using ( bucket_id = 'finance-receipts' and (select public.is_active_team_member()) )
with check ( bucket_id = 'finance-receipts' and (select public.is_active_team_member()) );

create policy "active_members_delete_finance_receipts"
on storage.objects for delete to authenticated
using ( bucket_id = 'finance-receipts' and (select public.is_active_team_member()) );
