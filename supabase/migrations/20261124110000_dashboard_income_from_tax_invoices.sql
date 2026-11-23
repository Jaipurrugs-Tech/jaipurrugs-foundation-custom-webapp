-- Dashboard income counts tax invoices.
--
-- A completed trip's income is now the total of its tax invoices (what the
-- client actually paid, incl. GST) when it has any, and otherwise its
-- amount_charged as before (issued/paid proforma invoices, excl. GST).
--
-- Both dashboard functions read a trip's income from one column of their
-- "counted" CTE, so only that expression changes; totals, % to artisans, the
-- monthly series and the per-category breakdown follow from it. The live
-- function bodies differ from the earlier migration files in this repo, so the
-- change is made on the current definitions with an exact text replacement,
-- and aborts if the expected text isn't found exactly once.

do $$
declare
  v_def text;
  v_old text;
  v_new text;
begin
  -- dashboard_stats(): counted CTE selects from "scoped s".
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p
  where p.proname = 'dashboard_stats' and p.pronamespace = 'public'::regnamespace;
  v_old := 's.amount_charged, s.amount_to_artisans';
  v_new := 'coalesce((select sum(t.amount) from public.tax_invoices t where t.visit_id = s.id), s.amount_charged) as amount_charged, s.amount_to_artisans';
  if v_def is null or (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'dashboard_stats() is not in the expected shape; update this migration';
  end if;
  execute replace(v_def, v_old, v_new);

  -- dashboard_revenue_stats(): counted CTE selects from "public.visits v".
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p
  where p.proname = 'dashboard_revenue_stats' and p.pronamespace = 'public'::regnamespace;
  v_old := 'v.amount_charged, v.amount_to_artisans';
  v_new := 'coalesce((select sum(t.amount) from public.tax_invoices t where t.visit_id = v.id), v.amount_charged) as amount_charged, v.amount_to_artisans';
  if v_def is null or (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'dashboard_revenue_stats() is not in the expected shape; update this migration';
  end if;
  execute replace(v_def, v_old, v_new);
end;
$$;
