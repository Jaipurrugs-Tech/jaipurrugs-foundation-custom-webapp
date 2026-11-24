-- Reconcile the live database with the repo: message recipients.
--
-- The messaging half of 20261103120000_revenue_streams_referral.sql never
-- reached the live project (its revenue half was applied separately, as the
-- live migrations "visit_sales_and_invoice" and "dashboard_revenue_stats").
-- Without it, saving a message rule or sequence item fails, because the app
-- writes a `recipients` column that didn't exist. This applies exactly that
-- missing part: the column on both tables, the recipients filter in
-- private.materialize_visit_sends(), and re-materialising when the primary POC
-- changes. The migration's seed ("referral request" sequence) is deliberately
-- not included. Idempotent, so it is safe on a database that already has it.

alter table public.message_rule_set_items
  add column if not exists recipients text not null default 'all' check (recipients in ('all', 'primary'));
alter table public.visit_message_rules
  add column if not exists recipients text not null default 'all' check (recipients in ('all', 'primary'));

-- Same as before, plus the recipients filter.
create or replace function private.materialize_visit_sends(p_visit_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.visits%rowtype;
  st public.visit_settings%rowtype;
  r record;
  g record;
  v_run timestamptz;
  v_exp timestamptz;
  v_status text;
  v_err text;
begin
  select * into v from public.visits where id = p_visit_id;
  if not found then
    return;
  end if;
  select * into st from public.visit_settings where id;

  if v.status = 'cancelled' then
    update public.scheduled_whatsapp_sends
    set status = 'cancelled', last_error = 'visit cancelled', claimed_at = null
    where visit_id = p_visit_id and status = 'queued';
    return;
  end if;

  -- Anything still waiting is recomputed below; whatever is no longer wanted stays cancelled.
  update public.scheduled_whatsapp_sends
  set status = 'cancelled', last_error = 'recomputed', claimed_at = null
  where visit_id = p_visit_id and status = 'queued';

  for r in
    select * from public.visit_message_rules where visit_id = p_visit_id and enabled
  loop
    if r.anchor = 'on_complete' then
      if v.status <> 'completed' or v.completed_at is null then
        continue;
      end if;
      v_run := v.completed_at + make_interval(mins => r.offset_minutes);
    elsif r.anchor = 'before_start' then
      if v.start_at is null then
        continue;
      end if;
      v_run := v.start_at - make_interval(mins => r.offset_minutes);
    else
      if v.start_at is null then
        continue;
      end if;
      v_run := v.start_at + make_interval(mins => r.offset_minutes);
    end if;

    v_exp := case
      when r.anchor = 'before_start' then v.start_at
      else v_run + make_interval(days => st.expiry_days)
    end;

    v_status := 'queued';
    v_err := null;
    -- A reminder whose time has already passed is not sent late.
    if r.anchor = 'before_start' and v_run < now() - interval '2 minutes' then
      v_status := 'skipped';
      v_err := 'missed_window';
    end if;

    for g in
      select vg.id
      from public.visit_guests vg
      join public.leads l on l.id = vg.lead_id
      where vg.visit_id = p_visit_id
        and vg.status <> 'no_show'
        and not l.whatsapp_opt_out
        and (r.recipients = 'all' or vg.is_primary)
    loop
      insert into public.scheduled_whatsapp_sends (rule_id, visit_id, visit_guest_id, run_at, expires_at, status, last_error)
      values (r.id, p_visit_id, g.id, v_run, v_exp, v_status, v_err)
      on conflict (rule_id, visit_guest_id) do update
        set run_at = excluded.run_at,
            expires_at = excluded.expires_at,
            status = excluded.status,
            last_error = excluded.last_error,
            attempts = 0,
            claimed_at = null,
            send_started_at = null
        where public.scheduled_whatsapp_sends.status in ('queued', 'cancelled', 'skipped');
    end loop;
  end loop;
end;
$$;

revoke all on function private.materialize_visit_sends(uuid) from public, anon, authenticated;

-- Changing who the primary POC is changes who a primary-only message goes to.
drop trigger if exists trg_visit_guests_materialize on public.visit_guests;
create trigger trg_visit_guests_materialize
after insert or delete or update of status, is_primary on public.visit_guests
for each row execute procedure private.trg_materialize_visit_child();
