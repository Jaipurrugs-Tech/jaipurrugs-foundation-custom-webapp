import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/lib/types/supabase";
import { round2 } from "@/lib/invoices/calc";
import { loadInvoiceVisitOptions, visitOptionLabel } from "@/lib/invoices/queries";
import { shiftMonth } from "@/lib/visits/time";
import { RECEIPT_BUCKET } from "./constants";

type Client = SupabaseClient<Database>;

// Lists are capped; the ledgers are newest first, so the cap only hides the oldest rows.
const LIST_LIMIT = 1000;

export type Option = { id: string; label: string };

// ---------------------------------------------------------------------------
// Shared lookups
// ---------------------------------------------------------------------------

/** Recent trips (not cancelled) for the "linked trip" pickers. */
export async function loadVisitOptions(supabase: Client): Promise<Option[]> {
  const visits = await loadInvoiceVisitOptions(supabase);
  return visits.map((v) => ({ id: v.id, label: v.label }));
}

export async function loadVillageOptions(supabase: Client): Promise<Option[]> {
  const { data } = await supabase.from("villages").select("id, name, is_active").order("name");
  return (data ?? []).map((v) => ({ id: v.id, label: v.is_active ? v.name : `${v.name} (inactive)` }));
}

/** Labels for the given visit ids, from the picker options where possible. */
async function visitLabels(supabase: Client, ids: string[], known: Option[]): Promise<Map<string, string>> {
  const labels = new Map(known.map((o) => [o.id, o.label]));
  const missing = [...new Set(ids)].filter((id) => !labels.has(id));
  if (missing.length > 0) {
    const { data } = await supabase
      .from("visits")
      .select("id, visit_date, program_category, source, headcount")
      .in("id", missing);
    for (const v of data ?? []) labels.set(v.id, visitOptionLabel(v));
  }
  return labels;
}

// ---------------------------------------------------------------------------
// Payments received
// ---------------------------------------------------------------------------

export type PaymentInvoice = {
  id: string;
  piNumber: string;
  piDate: string;
  status: string;
  billingName: string;
  grandTotal: number;
  received: number;
  balance: number;
  visitLabel: string | null;
};

export type PaymentRow = Tables<"invoice_payments"> & { piNumber: string; billingName: string };

/** Issued and paid PIs with what has been received against them. */
export async function loadPaymentInvoices(supabase: Client): Promise<PaymentInvoice[]> {
  const [{ data: invoices }, { data: payments }] = await Promise.all([
    supabase
      .from("proforma_invoices")
      .select("id, pi_number, pi_date, status, billing_name, grand_total, visits(visit_date, program_category, source, headcount)")
      .in("status", ["issued", "paid"])
      .order("pi_date", { ascending: false })
      .limit(LIST_LIMIT),
    supabase.from("invoice_payments").select("invoice_id, amount").limit(10 * LIST_LIMIT),
  ]);

  const received = new Map<string, number>();
  for (const p of payments ?? []) received.set(p.invoice_id, (received.get(p.invoice_id) ?? 0) + Number(p.amount));

  return (invoices ?? []).map((inv) => {
    const got = round2(received.get(inv.id) ?? 0);
    return {
      id: inv.id,
      piNumber: inv.pi_number,
      piDate: inv.pi_date,
      status: inv.status,
      billingName: inv.billing_name,
      grandTotal: Number(inv.grand_total),
      received: got,
      balance: Math.max(0, round2(Number(inv.grand_total) - got)),
      visitLabel: inv.visits ? visitOptionLabel(inv.visits) : null,
    };
  });
}

export async function loadPayments(supabase: Client): Promise<PaymentRow[]> {
  const { data } = await supabase
    .from("invoice_payments")
    .select("*, proforma_invoices(pi_number, billing_name)")
    .order("paid_on", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(LIST_LIMIT);
  return (data ?? []).map(({ proforma_invoices, ...p }) => ({
    ...p,
    amount: Number(p.amount),
    piNumber: proforma_invoices?.pi_number ?? "—",
    billingName: proforma_invoices?.billing_name ?? "",
  }));
}

// ---------------------------------------------------------------------------
// Artisan payouts
// ---------------------------------------------------------------------------

export type PayoutRow = Tables<"artisan_payouts"> & { visitLabel: string | null; villageName: string | null };

export type PendingPayout = {
  visitId: string;
  label: string;
  villageIds: string[];
  villageNames: string[];
  owed: number;
  paid: number;
  pending: number;
};

export async function loadPayouts(
  supabase: Client,
  visitOptions: Option[],
  villageOptions: Option[],
): Promise<PayoutRow[]> {
  const { data } = await supabase
    .from("artisan_payouts")
    .select("*")
    .order("paid_on", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(LIST_LIMIT);
  const rows = data ?? [];
  const labels = await visitLabels(
    supabase,
    rows.flatMap((r) => (r.visit_id ? [r.visit_id] : [])),
    visitOptions,
  );
  const villages = new Map(villageOptions.map((v) => [v.id, v.label]));
  return rows.map((r) => ({
    ...r,
    amount: Number(r.amount),
    visitLabel: r.visit_id ? (labels.get(r.visit_id) ?? null) : null,
    villageName: r.village_id ? (villages.get(r.village_id) ?? null) : null,
  }));
}

/** Completed trips whose "amount to artisans" isn't fully paid out yet. */
export async function loadPendingPayouts(supabase: Client, villageOptions: Option[]): Promise<PendingPayout[]> {
  const { data: visits } = await supabase
    .from("visits")
    .select("id, visit_date, program_category, source, headcount, amount_to_artisans")
    .eq("status", "completed")
    .gt("amount_to_artisans", 0)
    .order("visit_date", { ascending: false, nullsFirst: false })
    .limit(LIST_LIMIT);
  const rows = visits ?? [];
  if (rows.length === 0) return [];

  const ids = rows.map((v) => v.id);
  const [{ data: payouts }, { data: villageRows }] = await Promise.all([
    supabase.from("artisan_payouts").select("visit_id, amount").in("visit_id", ids),
    supabase.from("visit_villages").select("visit_id, village_id").in("visit_id", ids),
  ]);
  const paid = new Map<string, number>();
  for (const p of payouts ?? []) {
    if (p.visit_id) paid.set(p.visit_id, (paid.get(p.visit_id) ?? 0) + Number(p.amount));
  }
  const villagesByVisit = new Map<string, string[]>();
  for (const row of villageRows ?? []) {
    villagesByVisit.set(row.visit_id, [...(villagesByVisit.get(row.visit_id) ?? []), row.village_id]);
  }
  const villageNames = new Map(villageOptions.map((v) => [v.id, v.label]));

  return rows
    .map((v) => {
      const owed = Number(v.amount_to_artisans ?? 0);
      const done = round2(paid.get(v.id) ?? 0);
      const villageIds = villagesByVisit.get(v.id) ?? [];
      return {
        visitId: v.id,
        label: visitOptionLabel(v),
        villageIds,
        villageNames: villageIds.map((id) => villageNames.get(id) ?? "—"),
        owed,
        paid: done,
        pending: round2(owed - done),
      };
    })
    .filter((v) => v.pending > 0);
}

// ---------------------------------------------------------------------------
// Expenses
// ---------------------------------------------------------------------------

export type ExpenseRow = Tables<"expenses"> & {
  visitLabel: string | null;
  villageName: string | null;
  /** Short-lived signed URL to view the receipt, if one is attached. */
  receiptUrl: string | null;
};

export async function loadExpenses(
  supabase: Client,
  visitOptions: Option[],
  villageOptions: Option[],
): Promise<ExpenseRow[]> {
  const { data } = await supabase
    .from("expenses")
    .select("*")
    .order("expense_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(LIST_LIMIT);
  const rows = data ?? [];
  const labels = await visitLabels(
    supabase,
    rows.flatMap((r) => (r.visit_id ? [r.visit_id] : [])),
    visitOptions,
  );
  const villages = new Map(villageOptions.map((v) => [v.id, v.label]));

  const paths = rows.flatMap((r) => (r.receipt_path ? [r.receipt_path] : []));
  const urls = new Map<string, string>();
  if (paths.length > 0) {
    const { data: signed } = await supabase.storage.from(RECEIPT_BUCKET).createSignedUrls(paths, 3600);
    for (const s of signed ?? []) if (s.path && s.signedUrl) urls.set(s.path, s.signedUrl);
  }

  return rows.map((r) => ({
    ...r,
    amount: Number(r.amount),
    visitLabel: r.visit_id ? (labels.get(r.visit_id) ?? null) : null,
    villageName: r.village_id ? (villages.get(r.village_id) ?? null) : null,
    receiptUrl: r.receipt_path ? (urls.get(r.receipt_path) ?? null) : null,
  }));
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

export type FinanceMonth = { month: string; received: number; payouts: number; expenses: number; net: number };

export type FinanceOverview = {
  /** Issued + paid PIs dated in the period, excluding GST. */
  ruralExperience: number;
  gst: number;
  /** Sales attributed to trips completed in the period. */
  jrSales: number;
  jrFarms: number;
  income: number;
  received: number;
  payouts: number;
  expenses: number;
  /** Money in minus money out, in the period. */
  net: number;
  outstanding: { amount: number; invoices: number };
  pendingPayouts: { amount: number; visits: number };
  expensesByCategory: { category: string; amount: number }[];
  months: FinanceMonth[];
};

function monthsBetween(from: string, to: string): string[] {
  const months: string[] = [];
  for (let m = from.slice(0, 7); m <= to.slice(0, 7) && months.length < 120; m = shiftMonth(m, 1)) months.push(m);
  return months;
}

export async function loadFinanceOverview(supabase: Client, from: string, to: string): Promise<FinanceOverview> {
  const villageOptions = await loadVillageOptions(supabase);
  const [
    { data: invoices },
    { data: sales },
    { data: payments },
    { data: payouts },
    { data: expenses },
    paymentInvoices,
    pending,
  ] = await Promise.all([
    supabase
      .from("proforma_invoices")
      .select("taxable_total, gst_total")
      .in("status", ["issued", "paid"])
      .gte("pi_date", from)
      .lte("pi_date", to)
      .limit(10 * LIST_LIMIT),
    supabase
      .from("visit_sales")
      .select("channel, amount, visits!inner(visit_date, status)")
      .eq("visits.status", "completed")
      .gte("visits.visit_date", from)
      .lte("visits.visit_date", to)
      .limit(10 * LIST_LIMIT),
    supabase.from("invoice_payments").select("paid_on, amount").gte("paid_on", from).lte("paid_on", to).limit(10 * LIST_LIMIT),
    supabase.from("artisan_payouts").select("paid_on, amount").gte("paid_on", from).lte("paid_on", to).limit(10 * LIST_LIMIT),
    supabase
      .from("expenses")
      .select("expense_date, category, amount")
      .gte("expense_date", from)
      .lte("expense_date", to)
      .limit(10 * LIST_LIMIT),
    loadPaymentInvoices(supabase),
    loadPendingPayouts(supabase, villageOptions),
  ]);

  const sum = (rows: { amount: number | string }[] | null | undefined) =>
    round2((rows ?? []).reduce((s, r) => s + Number(r.amount), 0));

  const ruralExperience = round2((invoices ?? []).reduce((s, i) => s + Number(i.taxable_total), 0));
  const gst = round2((invoices ?? []).reduce((s, i) => s + Number(i.gst_total), 0));
  const jrSales = sum((sales ?? []).filter((s) => s.channel === "jr_sales"));
  const jrFarms = sum((sales ?? []).filter((s) => s.channel === "jr_farms"));
  const received = sum(payments);
  const paidOut = sum(payouts);
  const spent = sum(expenses);

  const byCategory = new Map<string, number>();
  for (const e of expenses ?? []) byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + Number(e.amount));

  const months = monthsBetween(from, to).map((month) => {
    const inMonth = <T,>(rows: T[] | null | undefined, key: (r: T) => string) =>
      (rows ?? []).filter((r) => key(r).startsWith(month));
    const r = sum(inMonth(payments, (p) => p.paid_on));
    const p = sum(inMonth(payouts, (p) => p.paid_on));
    const e = sum(inMonth(expenses, (x) => x.expense_date));
    return { month, received: r, payouts: p, expenses: e, net: round2(r - p - e) };
  });

  const owing = paymentInvoices.filter((i) => i.balance > 0);

  return {
    ruralExperience,
    gst,
    jrSales,
    jrFarms,
    income: round2(ruralExperience + jrSales + jrFarms),
    received,
    payouts: paidOut,
    expenses: spent,
    net: round2(received - paidOut - spent),
    outstanding: { amount: round2(owing.reduce((s, i) => s + i.balance, 0)), invoices: owing.length },
    pendingPayouts: { amount: round2(pending.reduce((s, v) => s + v.pending, 0)), visits: pending.length },
    expensesByCategory: [...byCategory.entries()]
      .map(([category, amount]) => ({ category, amount: round2(amount) }))
      .sort((a, b) => b.amount - a.amount),
    months,
  };
}
