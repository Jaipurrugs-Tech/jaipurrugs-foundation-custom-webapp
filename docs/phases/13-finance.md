# Phase 13 — Finance

Builds on [phase 12](12-services-invoices.md). Adds a **Finance** group to the sidebar: an overview, payments received, artisan payouts and expenses. **Services** and **Proforma invoices** move from Operations into this group (their URLs are unchanged).

Migration: `supabase/migrations/20261123100000_finance.sql` — **applied to the live project on 23 Nov 2026** (as migration `finance`). The three new tables in `src/lib/types/supabase.ts` are copied from the generated types. The whole file was not regenerated: the live schema lags the repo elsewhere (e.g. `message_rule_set_items.recipients`, `sync_visit_charges`), and a full regenerate breaks Messaging, Services and Invoices until those earlier migrations are applied.

## Pages

| Path | What it does |
|---|---|
| `/finance` | Overview for a period (This FY by default, Last FY, 3 / 12 months, or a custom range): cash received, artisan payouts, expenses and net; outstanding from clients and due to artisans (right now); income by stream (Rural Experience PIs excl. GST, JR Sales, JR Farms); expenses by category; month-by-month table. |
| `/finance/payments` | Issued PIs with total, received and balance; record / edit / delete payments (date, amount, mode, reference). |
| `/finance/payouts` | Completed trips whose *amount to artisans* isn't fully paid out, and the payouts ledger (payee, trip and/or village, date, amount, mode). |
| `/finance/expenses` | Expenses ledger with category filter and search; optional trip / village; receipt upload (PDF, PNG, JPEG, ≤ 5 MB). |

`/finance` is in `src/proxy.ts` and `ADMIN_PATH_PREFIXES`.

## Data model

- `invoice_payments` — `invoice_id` → `proforma_invoices` **on delete restrict** (a PI with payments can't be deleted; cancel it, or delete its payments first). A `before` trigger only accepts payments against `issued` or `paid` PIs. An `after` trigger (`proforma_invoice_sync_paid_status`) sets the PI to `paid` once payments ≥ `grand_total` (incl. GST), and back to `issued` when they drop below. Draft and cancelled PIs are never touched. Both statuses count as revenue, so this never changes a trip's `amount_charged`.
- `artisan_payouts` — `visit_id` (on delete set null), `village_id` (restrict), `payee`. What a trip owes is `visits.amount_to_artisans`; due = that minus the payouts linked to the trip, for completed trips.
- `expenses` — `category` from a fixed list (`src/lib/finance/constants.ts`), optional `visit_id` / `village_id`, `receipt_path` in the private **`finance-receipts`** bucket (shown via 1-hour signed URLs).
- Every table has its own `active_members_all_<table>` policy. No anon access.

## Rules

- Mutations go through `src/lib/actions/finance.ts`; validation lives in `src/lib/finance/schemas.ts`.
- Overview sums are done in `src/lib/finance/queries.ts` from the rows (no RPC yet). Lists are capped at 1,000 rows (newest first); if volumes grow, move the overview into a SQL function like `dashboard_revenue_stats()`.
- Money in on the overview is **payments received** (cash basis); "Income" is what was invoiced/earned in the period, whether or not it's been received.
