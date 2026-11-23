-- Payments received become tax invoices.
--
-- A tax invoice is issued in the accounting system once the client has paid
-- for a trip; here staff record its number, date, amount and payment mode and
-- upload its PDF. Every tax invoice belongs to a trip (visit). Linking the
-- proforma invoice it settles is optional; when linked, that PI still turns
-- 'paid' once its tax invoices cover its total, and back to 'issued' if they
-- no longer do.
--
-- invoice_payments (from 20261123100000_finance.sql) is renamed in place to
-- tax_invoices. Rows that exist are kept: their trip comes from the linked PI
-- and their number from their reference (or a placeholder to fix by hand).
-- PDFs live in the private finance-receipts bucket under tax-invoices/.

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------
drop trigger trg_invoice_payments_after_write on public.invoice_payments;
drop trigger trg_invoice_payments_check_invoice on public.invoice_payments;
drop function public.invoice_payments_after_write();
drop function public.invoice_payments_check_invoice();

alter table public.invoice_payments rename to tax_invoices;
alter table public.tax_invoices rename column invoice_id to proforma_invoice_id;
alter table public.tax_invoices rename column paid_on to invoice_date;
alter table public.tax_invoices alter column proforma_invoice_id drop not null;
alter table public.tax_invoices rename constraint invoice_payments_invoice_id_fkey to tax_invoices_proforma_invoice_id_fkey;
alter table public.tax_invoices rename constraint invoice_payments_amount_check to tax_invoices_amount_check;
alter table public.tax_invoices rename constraint invoice_payments_mode_check to tax_invoices_mode_check;

alter table public.tax_invoices
  add column visit_id       uuid references public.visits (id) on delete restrict,
  add column invoice_number text,
  add column pdf_path       text;

update public.tax_invoices t
set visit_id = p.visit_id
from public.proforma_invoices p
where p.id = t.proforma_invoice_id;

update public.tax_invoices
set invoice_number = coalesce(nullif(trim(reference), ''), 'TO-FIX-' || left(id::text, 8))
where invoice_number is null;

-- Rows whose PI has no trip can't be kept as tax invoices (there were none live).
delete from public.tax_invoices where visit_id is null;

alter table public.tax_invoices
  alter column visit_id set not null,
  alter column invoice_number set not null,
  add constraint tax_invoices_invoice_number_check check (length(trim(invoice_number)) > 0);

-- One tax invoice number is recorded once.
create unique index tax_invoices_invoice_number_key on public.tax_invoices (lower(trim(invoice_number)));

alter index public.invoice_payments_pkey rename to tax_invoices_pkey;
alter index public.invoice_payments_invoice_id_idx rename to tax_invoices_proforma_invoice_id_idx;
alter index public.invoice_payments_paid_on_idx rename to tax_invoices_invoice_date_idx;
create index tax_invoices_visit_id_idx on public.tax_invoices (visit_id);

alter trigger trg_invoice_payments_set_updated_at on public.tax_invoices rename to trg_tax_invoices_set_updated_at;
alter policy "active_members_all_invoice_payments" on public.tax_invoices rename to "active_members_all_tax_invoices";

-- ---------------------------------------------------------------------------
-- A linked PI must be issued (or paid) and belong to the same trip (or none).
-- ---------------------------------------------------------------------------
create function public.tax_invoices_check_proforma()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_status text;
  v_visit uuid;
begin
  if new.proforma_invoice_id is null then
    return new;
  end if;
  select p.status, p.visit_id into v_status, v_visit
  from public.proforma_invoices p where p.id = new.proforma_invoice_id;
  if v_status is null then
    raise exception 'Proforma invoice not found' using errcode = '23503';
  end if;
  if v_status not in ('issued', 'paid') then
    raise exception 'Only an issued proforma invoice can be linked to a tax invoice'
      using errcode = '23514';
  end if;
  if v_visit is not null and v_visit <> new.visit_id then
    raise exception 'The proforma invoice belongs to a different trip' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger trg_tax_invoices_check_proforma
before insert or update of proforma_invoice_id, visit_id on public.tax_invoices
for each row execute procedure public.tax_invoices_check_proforma();

-- ---------------------------------------------------------------------------
-- Keep a linked PI's paid status in step with its tax invoices.
-- ---------------------------------------------------------------------------
create or replace function public.proforma_invoice_sync_paid_status(p_invoice_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_invoice_id is null then
    return;
  end if;
  update public.proforma_invoices p
  set status = case
        when p.grand_total > 0 and coalesce(
          (select sum(t.amount) from public.tax_invoices t where t.proforma_invoice_id = p.id), 0
        ) >= p.grand_total then 'paid'
        else 'issued'
      end
  where p.id = p_invoice_id
    and p.status in ('issued', 'paid');
end;
$$;

create function public.tax_invoices_after_write()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform public.proforma_invoice_sync_paid_status(old.proforma_invoice_id);
  end if;
  if tg_op = 'INSERT' or (tg_op = 'UPDATE' and (new.proforma_invoice_id is distinct from old.proforma_invoice_id
      or new.amount is distinct from old.amount)) then
    perform public.proforma_invoice_sync_paid_status(new.proforma_invoice_id);
  end if;
  return null;
end;
$$;

create trigger trg_tax_invoices_after_write
after insert or update or delete on public.tax_invoices
for each row execute procedure public.tax_invoices_after_write();
