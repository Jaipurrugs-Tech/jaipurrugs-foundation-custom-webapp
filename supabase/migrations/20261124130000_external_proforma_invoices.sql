-- Proforma invoices made outside this platform (before it, or in Word/Excel)
-- can be uploaded against a trip.
--
-- An uploaded PI is a normal proforma_invoices row with is_external = true,
-- its PDF in the private finance-receipts bucket (pdf_path, under
-- proforma-invoices/), and its totals typed in (or read from the PDF) instead
-- of computed from line items. Issued/paid ones count as the trip's revenue
-- exactly like platform PIs (the existing sync trigger reads taxable_total).
--
-- An uploaded PI has no line items, and must never get any: saving it through
-- save_proforma_invoice() would recompute its totals from zero lines. The
-- trigger below refuses items for external PIs, so that can't happen.

alter table public.proforma_invoices
  add column is_external boolean not null default false,
  add column pdf_path    text;

create function public.proforma_invoice_items_reject_external()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if exists (select 1 from public.proforma_invoices p where p.id = new.invoice_id and p.is_external) then
    raise exception 'An uploaded proforma invoice has no line items; edit its totals instead'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger trg_proforma_invoice_items_reject_external
before insert or update of invoice_id on public.proforma_invoice_items
for each row execute procedure public.proforma_invoice_items_reject_external();
