"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { requireActiveTeamMember } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { chunk, fetchAll } from "@/lib/supabase/fetch-all";
import { toCsv, type CsvValue } from "@/lib/csv";
import type { Database } from "@/lib/types/supabase";
import { expenseCategoryLabel, paymentModeLabel } from "@/lib/finance/constants";
import { INVOICE_STATUSES } from "@/lib/invoices/constants";
import { round2 } from "@/lib/invoices/calc";
import { visitOptionLabel } from "@/lib/invoices/queries";
import { leadAttributeValues } from "@/lib/leads/fields";
import { todayIST } from "@/lib/visits/time";

// CSV exports for the admin lists. Each one fetches EVERY matching row (paging
// past PostgREST's 1,000-row cap with fetchAll), builds the CSV on the server and
// returns it as text; the browser saves it with downloadCsv().

type Client = SupabaseClient<Database>;

export type ExportResult = { csv: string; fileName: string } | { error: string };

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ID_PATTERN = /^[0-9a-f-]{36}$/i;

function validDate(value: string | null | undefined): string | null {
  return value && DATE_PATTERN.test(value) ? value : null;
}

function validId(value: string | null | undefined): string | null {
  return value && ID_PATTERN.test(value) ? value : null;
}

function fileName(base: string) {
  return `${base}-${todayIST()}.csv`;
}

function failure(error: unknown, what: string): ExportResult {
  return { error: error instanceof Error ? `Could not export ${what}: ${error.message}` : `Could not export ${what}.` };
}

const yesNo = (value: boolean) => (value ? "Yes" : "No");

type VisitInfo = { date: string | null; label: string };

/** Trip date and label for every given visit id (chunked .in() lookups). */
async function loadVisitInfo(supabase: Client, ids: (string | null)[]): Promise<Map<string, VisitInfo>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  const info = new Map<string, VisitInfo>();
  for (const part of chunk(unique)) {
    const { data, error } = await supabase
      .from("visits")
      .select("id, visit_date, program_category, source, headcount")
      .in("id", part);
    if (error) throw new Error(error.message);
    for (const v of data ?? []) info.set(v.id, { date: v.visit_date, label: visitOptionLabel(v) });
  }
  return info;
}

async function loadVillageNames(supabase: Client): Promise<Map<string, string>> {
  const rows = await fetchAll((from, to) =>
    supabase.from("villages").select("id, name").order("id").range(from, to),
  );
  return new Map(rows.map((v) => [v.id, v.name]));
}

// ---------------------------------------------------------------------------
// Proforma invoices
// ---------------------------------------------------------------------------

export async function exportProformaInvoices(filters: { status?: string } = {}): Promise<ExportResult> {
  await requireActiveTeamMember();
  const status = INVOICE_STATUSES.some((s) => s.id === filters.status) ? filters.status : null;
  try {
    const supabase = await createClient();
    const [invoices, linked] = await Promise.all([
      fetchAll((from, to) => {
        let query = supabase
          .from("proforma_invoices")
          .select(
            "id, pi_number, pi_date, status, is_external, billing_name, billing_gstin, visit_id, taxable_total, gst_total, grand_total",
          );
        if (status) query = query.eq("status", status);
        return query.order("pi_date", { ascending: false }).order("id").range(from, to);
      }),
      fetchAll((from, to) =>
        supabase
          .from("tax_invoices")
          .select("id, proforma_invoice_id, amount")
          .not("proforma_invoice_id", "is", null)
          .order("id")
          .range(from, to),
      ),
    ]);

    const received = new Map<string, number>();
    for (const t of linked) {
      if (t.proforma_invoice_id) {
        received.set(t.proforma_invoice_id, (received.get(t.proforma_invoice_id) ?? 0) + Number(t.amount));
      }
    }
    const visits = await loadVisitInfo(
      supabase,
      invoices.map((i) => i.visit_id),
    );
    const statusLabel = new Map<string, string>(INVOICE_STATUSES.map((s) => [s.id, s.label]));

    const rows: CsvValue[][] = invoices.map((inv) => {
      const visit = inv.visit_id ? visits.get(inv.visit_id) : undefined;
      const total = Number(inv.grand_total);
      const got = round2(received.get(inv.id) ?? 0);
      return [
        inv.pi_number,
        inv.pi_date,
        statusLabel.get(inv.status) ?? inv.status,
        yesNo(inv.is_external),
        inv.billing_name,
        inv.billing_gstin,
        visit?.date ?? null,
        visit?.label ?? null,
        Number(inv.taxable_total),
        Number(inv.gst_total),
        total,
        got,
        Math.max(0, round2(total - got)),
      ];
    });

    return {
      csv: toCsv(
        [
          "PI number",
          "PI date",
          "Status",
          "Uploaded",
          "Billed to",
          "GSTIN",
          "Trip date",
          "Trip",
          "Before GST",
          "GST",
          "Total",
          "Received (tax invoices)",
          "Balance",
        ],
        rows,
      ),
      fileName: fileName(status ? `proforma-invoices-${status}` : "proforma-invoices"),
    };
  } catch (error) {
    return failure(error, "proforma invoices");
  }
}

// ---------------------------------------------------------------------------
// Tax invoices
// ---------------------------------------------------------------------------

export async function exportTaxInvoices(): Promise<ExportResult> {
  await requireActiveTeamMember();
  try {
    const supabase = await createClient();
    const invoices = await fetchAll((from, to) =>
      supabase
        .from("tax_invoices")
        .select(
          "id, invoice_number, invoice_date, visit_id, amount, mode, reference, notes, pdf_path, proforma_invoices(pi_number)",
        )
        .order("invoice_date", { ascending: false })
        .order("id")
        .range(from, to),
    );
    const visits = await loadVisitInfo(
      supabase,
      invoices.map((t) => t.visit_id),
    );

    const rows: CsvValue[][] = invoices.map((t) => {
      const visit = visits.get(t.visit_id);
      return [
        t.invoice_number,
        t.invoice_date,
        visit?.date ?? null,
        visit?.label ?? null,
        t.proforma_invoices?.pi_number ?? null,
        Number(t.amount),
        paymentModeLabel(t.mode),
        t.reference,
        t.notes,
        yesNo(Boolean(t.pdf_path)),
      ];
    });

    return {
      csv: toCsv(
        ["Invoice number", "Invoice date", "Trip date", "Trip", "PI number", "Amount", "Payment mode", "Reference", "Notes", "Has PDF"],
        rows,
      ),
      fileName: fileName("tax-invoices"),
    };
  } catch (error) {
    return failure(error, "tax invoices");
  }
}

// ---------------------------------------------------------------------------
// Artisan payouts
// ---------------------------------------------------------------------------

export async function exportArtisanPayouts(): Promise<ExportResult> {
  await requireActiveTeamMember();
  try {
    const supabase = await createClient();
    const [payouts, villages] = await Promise.all([
      fetchAll((from, to) =>
        supabase
          .from("artisan_payouts")
          .select("id, paid_on, payee, visit_id, village_id, amount, mode, reference, notes")
          .order("paid_on", { ascending: false })
          .order("id")
          .range(from, to),
      ),
      loadVillageNames(supabase),
    ]);
    const visits = await loadVisitInfo(
      supabase,
      payouts.map((p) => p.visit_id),
    );

    const rows: CsvValue[][] = payouts.map((p) => {
      const visit = p.visit_id ? visits.get(p.visit_id) : undefined;
      return [
        p.paid_on,
        p.payee,
        visit?.date ?? null,
        visit?.label ?? null,
        p.village_id ? (villages.get(p.village_id) ?? null) : null,
        Number(p.amount),
        paymentModeLabel(p.mode),
        p.reference,
        p.notes,
      ];
    });

    return {
      csv: toCsv(["Date", "Paid to", "Trip date", "Trip", "Village", "Amount", "Mode", "Reference", "Notes"], rows),
      fileName: fileName("artisan-payouts"),
    };
  } catch (error) {
    return failure(error, "artisan payouts");
  }
}

// ---------------------------------------------------------------------------
// Expenses
// ---------------------------------------------------------------------------

export type ExpenseExportFilters = {
  from?: string;
  to?: string;
  category?: string;
  visitId?: string;
  villageId?: string;
};

export async function exportExpenses(filters: ExpenseExportFilters = {}): Promise<ExportResult> {
  await requireActiveTeamMember();
  const from = validDate(filters.from);
  const to = validDate(filters.to);
  const category = filters.category && /^[a-z_]{1,40}$/.test(filters.category) ? filters.category : null;
  const visitId = validId(filters.visitId);
  const villageId = validId(filters.villageId);
  try {
    const supabase = await createClient();
    const [expenses, villages] = await Promise.all([
      fetchAll((start, end) => {
        let query = supabase
          .from("expenses")
          .select(
            "id, expense_date, category, description, paid_to, amount, mode, reference, visit_id, village_id, receipt_path, notes",
          );
        if (from) query = query.gte("expense_date", from);
        if (to) query = query.lte("expense_date", to);
        if (category) query = query.eq("category", category);
        if (visitId) query = query.eq("visit_id", visitId);
        if (villageId) query = query.eq("village_id", villageId);
        return query.order("expense_date", { ascending: false }).order("id").range(start, end);
      }),
      loadVillageNames(supabase),
    ]);
    const visits = await loadVisitInfo(
      supabase,
      expenses.map((e) => e.visit_id),
    );

    const rows: CsvValue[][] = expenses.map((e) => {
      const visit = e.visit_id ? visits.get(e.visit_id) : undefined;
      return [
        e.expense_date,
        expenseCategoryLabel(e.category),
        e.description,
        e.paid_to,
        Number(e.amount),
        paymentModeLabel(e.mode),
        e.reference,
        visit?.date ?? null,
        visit?.label ?? null,
        e.village_id ? (villages.get(e.village_id) ?? null) : null,
        yesNo(Boolean(e.receipt_path)),
        e.notes,
      ];
    });

    const range = from || to ? `-${from ?? "start"}-to-${to ?? "today"}` : "";
    return {
      csv: toCsv(
        [
          "Date",
          "Category",
          "Description",
          "Paid to",
          "Amount",
          "Mode",
          "Reference",
          "Trip date",
          "Trip",
          "Village",
          "Has receipt",
          "Notes",
        ],
        rows,
      ),
      fileName: range ? `expenses${range}.csv` : fileName("expenses"),
    };
  } catch (error) {
    return failure(error, "expenses");
  }
}

// ---------------------------------------------------------------------------
// Leads
// ---------------------------------------------------------------------------

function attributeCell(value: unknown): CsvValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  return JSON.stringify(value);
}

export async function exportLeads(filters: { listId?: string } = {}): Promise<ExportResult> {
  await requireActiveTeamMember();
  const listId = validId(filters.listId);
  try {
    const supabase = await createClient();
    const [leads, lists, attributes, memberships] = await Promise.all([
      fetchAll((from, to) =>
        supabase
          .from("leads")
          .select("id, name, phone, attributes, created_at")
          .order("created_at", { ascending: false })
          .order("id")
          .range(from, to),
      ),
      fetchAll((from, to) => supabase.from("lead_lists").select("id, name").order("id").range(from, to)),
      fetchAll((from, to) =>
        supabase.from("lead_attributes").select("id, key, label, created_at").order("created_at").order("id").range(from, to),
      ),
      fetchAll((from, to) =>
        supabase
          .from("lead_list_members")
          .select("list_id, lead_id")
          .order("list_id")
          .order("lead_id")
          .range(from, to),
      ),
    ]);

    const listNames = new Map(lists.map((l) => [l.id, l.name]));
    const listsByLead = new Map<string, string[]>();
    for (const m of memberships) {
      const name = listNames.get(m.list_id);
      if (name) listsByLead.set(m.lead_id, [...(listsByLead.get(m.lead_id) ?? []), name]);
    }
    const inList = listId
      ? new Set(memberships.filter((m) => m.list_id === listId).map((m) => m.lead_id))
      : null;

    // Email is its own column (a custom attribute keyed "email", when one exists).
    const attributeColumns = attributes.filter((a) => a.key !== "email");
    const emailLabel = attributes.find((a) => a.key === "email")?.label ?? "Email";

    const rows: CsvValue[][] = leads
      .filter((lead) => !inList || inList.has(lead.id))
      .map((lead) => {
        const values = leadAttributeValues(lead);
        return [
          lead.name,
          lead.phone,
          attributeCell(values.email),
          ...attributeColumns.map((a) => attributeCell(values[a.key])),
          (listsByLead.get(lead.id) ?? []).sort().join("; "),
          lead.created_at.slice(0, 10),
        ];
      });

    const listSlug = listId
      ? (listNames.get(listId) ?? "list")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "")
      : "";
    return {
      csv: toCsv(
        ["Name", "Phone", emailLabel, ...attributeColumns.map((a) => a.label), "Lists", "Created"],
        rows,
      ),
      fileName: fileName(listSlug ? `leads-${listSlug}` : "leads"),
    };
  } catch (error) {
    return failure(error, "leads");
  }
}
