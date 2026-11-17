-- Settings → Configuration: manage OpenAI API keys from the admin panel instead
-- of (only) the OPENAI_API_KEY env var. The env var stays as a fallback.
--
-- The secret itself is stored encrypted in Supabase Vault. This table holds only
-- non-secret metadata (label, last-4 hint, which key is active). Every function
-- that touches the secret is SECURITY DEFINER and executable by the service role
-- only — the browser/anon/authenticated roles can never read a key back, and the
-- app never sends a stored key to the client (only the hint).

create table public.openai_api_keys (
  id              uuid primary key default gen_random_uuid(),
  label           text not null check (length(trim(label)) between 1 and 60),
  -- Last four characters of the key, for display ("••••abcd"). Not secret.
  key_hint        text not null check (length(key_hint) = 4),
  vault_secret_id uuid not null,
  is_active       boolean not null default false,
  created_by      text,
  created_at      timestamptz not null default now()
);

-- At most one key is active at a time.
create unique index openai_api_keys_one_active
  on public.openai_api_keys (is_active) where is_active;

alter table public.openai_api_keys enable row level security;

-- Staff can list key metadata. There are deliberately NO insert/update/delete
-- policies: all writes go through the service-role functions below.
create policy "active_members_select_openai_api_keys"
on public.openai_api_keys
for select
to authenticated
using ( (select public.is_active_team_member()) );

-- Stores the key in Vault and registers it. Optionally makes it the active key.
create or replace function public.add_openai_api_key(
  p_label text,
  p_key text,
  p_created_by text,
  p_make_active boolean
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret_id uuid;
  v_id uuid;
begin
  if p_key is null or length(trim(p_key)) < 20 then
    raise exception 'API key is too short';
  end if;

  v_secret_id := vault.create_secret(
    trim(p_key),
    'openai_api_key_' || gen_random_uuid()::text,
    'OpenAI API key managed from Settings'
  );

  if p_make_active then
    update public.openai_api_keys set is_active = false where is_active;
  end if;

  insert into public.openai_api_keys (label, key_hint, vault_secret_id, is_active, created_by)
  values (trim(p_label), right(trim(p_key), 4), v_secret_id, p_make_active, p_created_by)
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.set_active_openai_api_key(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.openai_api_keys where id = p_id) then
    raise exception 'Key not found';
  end if;
  update public.openai_api_keys set is_active = false where is_active and id <> p_id;
  update public.openai_api_keys set is_active = true where id = p_id;
end;
$$;

-- Removes the key row and its Vault secret. If it was the active key, no key is
-- active afterwards and the app falls back to the OPENAI_API_KEY env var.
create or replace function public.delete_openai_api_key(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret_id uuid;
begin
  delete from public.openai_api_keys where id = p_id returning vault_secret_id into v_secret_id;
  if v_secret_id is not null then
    delete from vault.secrets where id = v_secret_id;
  end if;
end;
$$;

-- Decrypted key for one stored row (used to test a key from Settings).
create or replace function public.get_openai_api_key(p_id uuid)
returns text
language sql
security definer
set search_path = ''
stable
as $$
  select s.decrypted_secret
  from public.openai_api_keys k
  join vault.decrypted_secrets s on s.id = k.vault_secret_id
  where k.id = p_id;
$$;

-- Decrypted active key, or null when none is active (caller falls back to env).
create or replace function public.get_active_openai_api_key()
returns text
language sql
security definer
set search_path = ''
stable
as $$
  select s.decrypted_secret
  from public.openai_api_keys k
  join vault.decrypted_secrets s on s.id = k.vault_secret_id
  where k.is_active
  limit 1;
$$;

-- Supabase grants EXECUTE on new public functions to anon/authenticated by
-- default; take that away so only the service role can call these.
revoke all on function public.add_openai_api_key(text, text, text, boolean) from public, anon, authenticated;
revoke all on function public.set_active_openai_api_key(uuid) from public, anon, authenticated;
revoke all on function public.delete_openai_api_key(uuid) from public, anon, authenticated;
revoke all on function public.get_openai_api_key(uuid) from public, anon, authenticated;
revoke all on function public.get_active_openai_api_key() from public, anon, authenticated;

grant execute on function public.add_openai_api_key(text, text, text, boolean) to service_role;
grant execute on function public.set_active_openai_api_key(uuid) to service_role;
grant execute on function public.delete_openai_api_key(uuid) to service_role;
grant execute on function public.get_openai_api_key(uuid) to service_role;
grant execute on function public.get_active_openai_api_key() to service_role;
