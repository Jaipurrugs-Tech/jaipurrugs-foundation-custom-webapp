-- Security: anonymous visitors lose direct access to form submissions and answers.
--
-- Before: the anon RLS policies only checked that the form was published, so
-- anyone holding the public (publishable) key could read and change every
-- answer on every published form through the REST API, bypassing the
-- submitter-token checks in the app. Now the public form only works through the
-- app's server actions (src/lib/actions/submissions.ts), which use the
-- service-role client and check the submitter token, that the form is
-- published, and that each field belongs to the form. Guest feedback links keep
-- using their token-checked SECURITY DEFINER RPCs (feedback_session/save).

drop policy if exists "public_insert_submissions"    on public.form_submissions;
drop policy if exists "public_select_own_submission" on public.form_submissions;
drop policy if exists "public_update_own_submission" on public.form_submissions;
drop policy if exists "public_select_answers"        on public.form_answers;
drop policy if exists "public_insert_answers"        on public.form_answers;
drop policy if exists "public_update_answers"        on public.form_answers;

-- rls_auto_enable() is an event-trigger function (it switches RLS on for new
-- tables); it never needs to be callable through the API.
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;

-- form_answers.field_id is a cascading foreign key without an index.
create index if not exists form_answers_field_id_idx on public.form_answers (field_id);
