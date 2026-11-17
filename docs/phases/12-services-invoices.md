# Phase 12 — Services and Proforma Invoices (PIs)

Builds on [phase 11](11-visit-operations.md). Adds what the foundation charges for (**services**) and the **proforma invoices** raised against them, with a PDF download in the foundation's existing PI layout. A visit's charges are no longer typed on the visit: they come from its PIs.

Migration: `supabase/migrations/20261104130000_services_proforma_invoices.sql` — **written and dry-run (PGlite), not yet applied to the live project.** Apply it via the Supabase MCP connection, then regenerate `src/lib/types/supabase.ts` (the new tables and RPCs were added to it by hand to match the migration).

## Pages

| Path | What it does |
|---|---|
| `/services` | Services: name, SAC, per person / per group, base amount (excl. GST), GST rate, extra-guide rate, locations served (villages), programs and visitor types offered to (empty = all), headcount slabs. |
| `/invoices` | Tabs: **Invoices** (list, status menu, PDF download), **Terms & conditions** (library), **Settings** (company block, bank details, numbering prefix, default payment terms, footer, UPI QR upload). |
| `/invoices/new?visit=<id>` | New PI, optionally linked to a trip; billing name and guests are filled from the trip. |
| `/invoices/[id]` | Edit a PI; preview / download PDF once saved. |

Trips → a visit → **Payment** step and the detail panel list the visit's PIs and link to "New proforma invoice". Both paths are in `src/proxy.ts` and `ADMIN_PATH_PREFIXES`.

## Data model

- `services` + `service_villages` (locations) + `service_slabs`. Programs and visitor types are `text[]` checked against the same ids as `visits.program_category` / `visitor_category`.
- **Slabs** are headcount bands `[min, max]` with a discount (`percent` of the rate, or a flat `amount` per unit) and `free_guides`. An exclusion constraint (`btree_gist`) stops two bands of one service overlapping. Slabs stop at `custom_pricing_above` (default 50): **bigger groups get no slab** — the PI editor starts from the highest slab and makes the manager confirm the discount and free guides (“Use these values” or type them) before it saves.
- `proforma_invoices` (header, `visit_id` → `visits` `on delete set null`, `terms` jsonb copy of the chosen T&C, stored totals) and `proforma_invoice_items` (a **snapshot** of each line: description, second line, SAC, rate, quantity, discount label + discount per unit, GST rate; `service_id` `on delete set null`). Editing or deleting a service never changes an existing PI.
- `invoice_settings` (single row) and `invoice_terms` (library; `is_default` terms are ticked on new PIs).
- Every table has its own `active_members_all_<table>` policy (settings: select/update only). No anon access.

## Rules

- **Totals are computed in the database** by `public.proforma_invoice_recalc()`: line gross = round(rate × qty), line discount = round(discount × qty), GST per rate on the summed taxable value, all to the paisa. `src/lib/invoices/calc.ts` mirrors this for the editor and PDF (`round2` rounds the decimal value half-away-from-zero like `numeric`), but the stored totals are the truth.
- **Items are written only through `public.save_proforma_invoice(p_id, p_invoice, p_items)`** (security invoker, one transaction, replaces the lines and recalculates). Services are saved the same way with `public.save_service()`. Don't insert items directly.
- **PI numbers**: `<prefix>/<FY>/<seq>` assigned by a `before insert` trigger when left blank — FY is April–March (`28 Oct 2026` → `2627`), the sequence continues after the highest number already used for that prefix + FY (so a hand-typed `…/007` makes the next one `…/008`). Serialised with an advisory lock; `pi_number` is unique.
- **Revenue**: `visits.amount_charged` is maintained by a trigger as the sum of the visit's **issued and paid** PIs' taxable value (before GST). Drafts and cancelled PIs don't count. The visit form no longer has a revenue or invoice-ID field, and `visits.invoice_id` is dropped. `dashboard_stats()` is unchanged (it reads `amount_charged`); `dashboard_revenue_stats()` now counts the visit's issued / paid PIs as the Rural Experience invoice count. `amount_to_artisans` and JR / JR Farms sales stay on the visit.
- **QR code**: private bucket `invoice-assets` (PNG/JPEG, 2 MB — the PDF renderer can't embed WebP). Uploaded from Settings; the path is in `invoice_settings.upi_qr_path`. The Settings tab shows it via a 10-minute signed URL; the PDF action downloads it server-side and passes a data URI.
- **PDF**: drawn in the browser with `@react-pdf/renderer` (`src/lib/invoices/pdf-document.tsx`), loaded with a dynamic import only when someone previews or downloads (its ~1.2 MB chunk is not in any page bundle). It renders the **saved** PI (`getInvoicePdfData`), so the editor disables the PDF buttons while there are unsaved changes. Built-in Helvetica has no ₹ glyph — amounts print as plain numbers with "INR", as on the original PI.

## Do's

- Do price new lines from `suggestPricing()` and keep a line's typed values as overrides, so changing the group size re-prices only what wasn't edited by hand.
- Do keep any new money column `numeric(…, 2)` and compute totals in SQL.

## Don'ts

- Don't type charges on the visit again, or write `visits.amount_charged` from the app — it's derived.
- Don't make `invoice-assets` public or put the QR in `form-assets`.
- Don't expose services, prices or PIs to the WhatsApp agent without a deliberate decision: agent RPCs still never return amounts (phase 11, M3). The knowledge base remains the place for guest-facing price prose.

## Not yet done / to verify after applying the migration

- Apply the migration, regenerate types, then create a service with slabs, a PI for a test visit, mark it Issued and check the visit's revenue on Trips and the dashboard.
- Upload the UPI QR code (Proforma invoices → Settings) and download a PI to check it prints.
- The seller and bank details in `invoice_settings` are seeded from the existing PI; check them once in Settings.
