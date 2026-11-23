"use server";

import { revalidatePath } from "next/cache";
import { requireActiveTeamMember } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { RECEIPT_BUCKET, RECEIPT_MAX_BYTES, RECEIPT_MIME_TYPES } from "@/lib/finance/constants";
import {
  expenseSchema,
  paymentSchema,
  payoutSchema,
  type ExpenseInput,
  type PaymentInput,
  type PayoutInput,
} from "@/lib/finance/schemas";
import { blankToNull } from "@/lib/visits/schemas";

export type FinanceActionResult = { error?: string };

function revalidateFinance() {
  revalidatePath("/finance", "layout");
  revalidatePath("/invoices");
  revalidatePath("/trips");
  revalidatePath("/dashboard");
}

// ---------------------------------------------------------------------------
// Payments received (against proforma invoices)
// ---------------------------------------------------------------------------

export async function savePayment(id: string | null, input: PaymentInput): Promise<FinanceActionResult> {
  const { email } = await requireActiveTeamMember();
  const parsed = paymentSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid payment." };
  const d = parsed.data;
  const row = {
    invoice_id: d.invoiceId,
    paid_on: d.paidOn,
    amount: d.amount,
    mode: d.mode,
    reference: blankToNull(d.reference),
    notes: blankToNull(d.notes),
  };

  const supabase = await createClient();
  const { error } = id
    ? await supabase.from("invoice_payments").update(row).eq("id", id)
    : await supabase.from("invoice_payments").insert({ ...row, created_by: email });
  if (error) {
    return {
      error:
        error.code === "23514"
          ? "Payments can only be recorded against an issued proforma invoice."
          : "Could not save the payment.",
    };
  }
  revalidateFinance();
  return {};
}

export async function deletePayment(id: string): Promise<FinanceActionResult> {
  await requireActiveTeamMember();
  const supabase = await createClient();
  const { error } = await supabase.from("invoice_payments").delete().eq("id", id);
  if (error) return { error: "Could not delete the payment." };
  revalidateFinance();
  return {};
}

// ---------------------------------------------------------------------------
// Artisan payouts
// ---------------------------------------------------------------------------

export async function savePayout(id: string | null, input: PayoutInput): Promise<FinanceActionResult> {
  const { email } = await requireActiveTeamMember();
  const parsed = payoutSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid payout." };
  const d = parsed.data;
  const row = {
    visit_id: d.visitId,
    village_id: d.villageId,
    payee: d.payee,
    paid_on: d.paidOn,
    amount: d.amount,
    mode: d.mode,
    reference: blankToNull(d.reference),
    notes: blankToNull(d.notes),
  };

  const supabase = await createClient();
  const { error } = id
    ? await supabase.from("artisan_payouts").update(row).eq("id", id)
    : await supabase.from("artisan_payouts").insert({ ...row, created_by: email });
  if (error) return { error: "Could not save the payout." };
  revalidateFinance();
  return {};
}

export async function deletePayout(id: string): Promise<FinanceActionResult> {
  await requireActiveTeamMember();
  const supabase = await createClient();
  const { error } = await supabase.from("artisan_payouts").delete().eq("id", id);
  if (error) return { error: "Could not delete the payout." };
  revalidateFinance();
  return {};
}

// ---------------------------------------------------------------------------
// Expenses and receipts
// ---------------------------------------------------------------------------

export async function saveExpense(
  id: string | null,
  input: ExpenseInput,
): Promise<FinanceActionResult & { id?: string }> {
  const { email } = await requireActiveTeamMember();
  const parsed = expenseSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid expense." };
  const d = parsed.data;
  const row = {
    expense_date: d.expenseDate,
    category: d.category,
    description: d.description,
    amount: d.amount,
    paid_to: blankToNull(d.paidTo),
    mode: d.mode,
    reference: blankToNull(d.reference),
    visit_id: d.visitId,
    village_id: d.villageId,
    notes: blankToNull(d.notes),
  };

  const supabase = await createClient();
  if (id) {
    const { error } = await supabase.from("expenses").update(row).eq("id", id);
    if (error) return { error: "Could not save the expense." };
    revalidateFinance();
    return { id };
  }
  const { data, error } = await supabase
    .from("expenses")
    .insert({ ...row, created_by: email })
    .select("id")
    .single();
  if (error || !data) return { error: "Could not save the expense." };
  revalidateFinance();
  return { id: data.id };
}

export async function deleteExpense(id: string): Promise<FinanceActionResult> {
  await requireActiveTeamMember();
  const supabase = await createClient();
  const { data: current } = await supabase.from("expenses").select("receipt_path").eq("id", id).maybeSingle();
  const { error } = await supabase.from("expenses").delete().eq("id", id);
  if (error) return { error: "Could not delete the expense." };
  if (current?.receipt_path) await supabase.storage.from(RECEIPT_BUCKET).remove([current.receipt_path]);
  revalidateFinance();
  return {};
}

const RECEIPT_EXTENSIONS: Record<string, string> = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
};

/** Attaches a receipt (PDF, PNG or JPEG) to an expense, replacing any earlier one. */
export async function uploadExpenseReceipt(expenseId: string, formData: FormData): Promise<FinanceActionResult> {
  await requireActiveTeamMember();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a file first." };
  if (!(RECEIPT_MIME_TYPES as readonly string[]).includes(file.type)) {
    return { error: "Upload the receipt as a PDF, PNG or JPEG." };
  }
  if (file.size > RECEIPT_MAX_BYTES) return { error: "Keep the receipt under 5 MB." };

  const supabase = await createClient();
  const { data: current } = await supabase.from("expenses").select("receipt_path").eq("id", expenseId).maybeSingle();
  if (!current) return { error: "Expense not found." };

  const path = `expenses/${expenseId}/${Date.now()}.${RECEIPT_EXTENSIONS[file.type]}`;
  const { error: uploadError } = await supabase.storage
    .from(RECEIPT_BUCKET)
    .upload(path, await file.arrayBuffer(), { contentType: file.type, upsert: false });
  if (uploadError) return { error: "Could not upload the receipt." };

  const { error } = await supabase.from("expenses").update({ receipt_path: path }).eq("id", expenseId);
  if (error) {
    await supabase.storage.from(RECEIPT_BUCKET).remove([path]);
    return { error: "Could not save the receipt." };
  }
  if (current.receipt_path && current.receipt_path !== path) {
    await supabase.storage.from(RECEIPT_BUCKET).remove([current.receipt_path]);
  }
  revalidateFinance();
  return {};
}

export async function removeExpenseReceipt(expenseId: string): Promise<FinanceActionResult> {
  await requireActiveTeamMember();
  const supabase = await createClient();
  const { data: current } = await supabase.from("expenses").select("receipt_path").eq("id", expenseId).maybeSingle();
  const { error } = await supabase.from("expenses").update({ receipt_path: null }).eq("id", expenseId);
  if (error) return { error: "Could not remove the receipt." };
  if (current?.receipt_path) await supabase.storage.from(RECEIPT_BUCKET).remove([current.receipt_path]);
  revalidateFinance();
  return {};
}
