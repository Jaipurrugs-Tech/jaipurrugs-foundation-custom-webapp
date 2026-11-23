# Phase 13 — Finance

Builds on [phase 12](12-services-invoices.md). Adds a **Finance** group to the sidebar: an overview, invoices (tax invoices), artisan payouts and expenses. **Services** and **Proforma invoices** move from Operations into this group (their URLs are unchanged).

Migration: `supabase/migrations/20261123100000_finance.sql` — **applied to the live project on 23 Nov 2026** (as migration `finance`). The three new tables in `src/lib/types/supabase.ts` are copied from the generated types. The whole file was not regenerated: the live schema lags the repo elsewhere (e.g. `message_rule_set_items.recipients`, `sync_visit_charges`), and a full regenerate breaks Messaging, Services and Invoices until those earlier migrations are applied.

## Pages

| Path | What it does |
|---|---|
| `/finance` | Overview for a period (This FY by default, Last FY, 3 / 12 months, or a custom range): cash received, artisan payouts, expenses and net; outstanding from clients and due to artisans (right now); income by stream (Rural Experience PIs excl. GST, JR Sales, JR Farms); expenses by category; month-by-month table. |
| `/finance/invoices` | **Invoices** — tax invoices for trips the client has paid (number, date, amount incl. GST, payment mode, PDF upload), each tied to a trip and optionally to the PI it settles; plus issued PIs with their balance. `?visit=<id>` opens the form for that trip. `/finance/payments` redirects here. |
| `/finance/payouts` | Completed trips whose *amount to artisans* isn't fully paid out, and the payouts ledger (payee, trip and/or village, date, amount, mode). |
| `/finance/expenses` | Expenses ledger with category filter and search; optional trip / village; receipt upload (PDF, PNG, JPEG, ≤ 5 MB). |

`/finance` is in `src/proxy.ts` and `ADMIN_PATH_PREFIXES`.

## Data model

- `tax_invoices` (was `invoice_payments`; renamed by `20261124100000_tax_invoices.sql`) — a tax invoice from the accounting system: `visit_id` (required, restrict), `invoice_number` (unique, case/space-insensitive), `invoice_date`, `amount`, `mode`, `reference`, `pdf_path` (in `finance-receipts`, under `tax-invoices/`), optional `proforma_invoice_id` (restrict: a PI with linked tax invoices can't be deleted). A linked PI must be issued/paid and belong to the same trip (or none). An `after` trigger (`proforma_invoice_sync_paid_status`) sets a linked PI to `paid` once its tax invoices ≥ `grand_total` (incl. GST), and back to `issued` when they drop below; draft and cancelled PIs are never touched.
- **Auto-fill from the PDF**: picking a file in the tax-invoice form calls `readTaxInvoiceFile` (`src/lib/finance/extract-invoice.ts`), which sends it to OpenAI's Responses API (`INVOICE_READER_MODEL`, default `gpt-5-mini`, key from Settings / `OPENAI_API_KEY`) with a strict JSON schema and fills invoice number, date, total incl. GST, payment mode/reference; the trip is picked when the billed name matches exactly one trip label, and that trip's PI is linked when the total equals its balance (±₹1). Nothing is saved until staff press Save; failures fall back to manual entry.
- The Trips grid's **Invoice** column lists a trip's tax invoices (number opens the PDF via a 10-minute signed URL); a trip without one shows *Add invoice*.
- `artisan_payouts` — `visit_id` (on delete set null), `village_id` (restrict), `payee`. What a trip owes is `visits.amount_to_artisans`; due = that minus the payouts linked to the trip, for completed trips.
- `expenses` — `category` from a fixed list (`src/lib/finance/constants.ts`), optional `visit_id` / `village_id`, `receipt_path` in the private **`finance-receipts`** bucket (shown via 1-hour signed URLs).
- Every table has its own `active_members_all_<table>` policy. No anon access.

## Rules

- Mutations go through `src/lib/actions/finance.ts`; validation lives in `src/lib/finance/schemas.ts`.
- Overview sums are done in `src/lib/finance/queries.ts` from the rows (no RPC yet). Lists are capped at 1,000 rows (newest first); if volumes grow, move the overview into a SQL function like `dashboard_revenue_stats()`.
- Money in on the overview is **tax invoices** by invoice date (cash basis); "Income" is what was invoiced/earned in the period, whether or not it's been received.
