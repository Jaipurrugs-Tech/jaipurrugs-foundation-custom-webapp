-- Phase 10 follow-up: WhatsApp inbox attachments.
-- Inbound WhatsApp media URLs need the Zernio API key and Meta deletes the
-- bytes after ~7 days, so the webhook copies each file into this PRIVATE
-- bucket on receipt; staff attachments are uploaded here before sending.
-- Admin access is via short-lived signed URLs only (AGENTS.md §5).
-- Path layout: <conversation_id>/<uuid>-<filename>

insert into storage.buckets (id, name, public, file_size_limit)
values ('inbox-media', 'inbox-media', false, 16777216)
on conflict (id) do update set public = false, file_size_limit = 16777216;

-- Webhook writes use the service role (bypasses RLS). Staff read (to mint
-- signed URLs) and upload through their own session.
create policy "active_members_select_inbox_media"
on storage.objects
for select
to authenticated
using ( bucket_id = 'inbox-media' and public.is_active_team_member() );

create policy "active_members_insert_inbox_media"
on storage.objects
for insert
to authenticated
with check ( bucket_id = 'inbox-media' and public.is_active_team_member() );

-- Lets a failed staff send remove the file it just uploaded.
create policy "active_members_delete_inbox_media"
on storage.objects
for delete
to authenticated
using ( bucket_id = 'inbox-media' and public.is_active_team_member() );
