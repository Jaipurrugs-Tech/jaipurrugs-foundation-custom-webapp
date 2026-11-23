// Fixed value sets for the Finance module. The ids are what the database stores
// (see supabase/migrations/20261123100000_finance.sql).

export const PAYMENT_MODES = [
  { id: "bank_transfer", label: "Bank transfer" },
  { id: "upi", label: "UPI" },
  { id: "cash", label: "Cash" },
  { id: "cheque", label: "Cheque" },
  { id: "card", label: "Card" },
  { id: "other", label: "Other" },
] as const;

export type PaymentMode = (typeof PAYMENT_MODES)[number]["id"];

export const EXPENSE_CATEGORIES = [
  { id: "transport", label: "Transport" },
  { id: "food", label: "Food & refreshments" },
  { id: "accommodation", label: "Accommodation" },
  { id: "guide", label: "Guides" },
  { id: "facilitator", label: "Facilitator fees" },
  { id: "materials", label: "Materials" },
  { id: "marketing", label: "Marketing" },
  { id: "admin", label: "Admin & office" },
  { id: "other", label: "Other" },
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number]["id"];

export const RECEIPT_BUCKET = "finance-receipts";
export const RECEIPT_MAX_BYTES = 5 * 1024 * 1024;
export const RECEIPT_MIME_TYPES = ["application/pdf", "image/png", "image/jpeg"] as const;

function labelOf(list: readonly { id: string; label: string }[], id: string | null | undefined) {
  return list.find((item) => item.id === id)?.label ?? id ?? "";
}

export const paymentModeLabel = (id: string) => labelOf(PAYMENT_MODES, id);
export const expenseCategoryLabel = (id: string) => labelOf(EXPENSE_CATEGORIES, id);
