# Keeping the live database and the repo in step

The live Supabase project (`eevzwnjjcedyuehpprgk`) is the source of truth. The files in
`supabase/migrations/` are the history of how it got there, and `src/lib/types/supabase.ts`
is generated from it.

## State as of 24 Nov 2026

- `src/lib/types/supabase.ts` was regenerated from the live project and the app typechecks
  against it with no changes, so every table, column and function the code uses exists live.
- The one real gap was the **message `recipients` column** (the messaging half of
  `20261103120000_revenue_streams_referral.sql` had never been applied, so saving a message
  rule or sequence item failed). Fixed by `20261124170000_reconcile_message_recipients.sql`.
  That file's seed (a disabled "referral request" sequence) was intentionally not applied.
- The live **migration history names don't match the file names** for the earlier phases:
  several files were applied by hand or under other names (for example the revenue half of
  `20261103120000_…` is recorded live as `visit_sales_and_invoice` + `dashboard_revenue_stats`,
  and `20261104130000_services_proforma_invoices.sql` isn't in the live history although its
  tables exist). Don't re-run old files against live to "catch up" — compare first.
- Some live function bodies were later edited in place by migrations here
  (`20261124110000`, `20261124120000`), so the full `create function` text in older files is
  no longer the live definition. Read the live definition (`pg_get_functiondef`) before
  changing a function.

## The routine for every schema change

1. Write the migration file under `supabase/migrations/` (timestamped, idempotent where
   reasonable).
2. Dry-run it on live inside `begin; … rollback;` and check the result.
3. Apply it through the Supabase MCP connection (`apply_migration`, same name as the file).
4. Regenerate `src/lib/types/supabase.ts` from the live project and commit it with the
   migration. Don't hand-edit the types file.
5. `npm run typecheck` must pass. RPCs that take `null` to mean "create" need an
   `as string` cast with a comment, because generated RPC argument types are never nullable.

To check for drift at any time: regenerate the types into a scratch file and diff against
`src/lib/types/supabase.ts`; any difference is drift.
