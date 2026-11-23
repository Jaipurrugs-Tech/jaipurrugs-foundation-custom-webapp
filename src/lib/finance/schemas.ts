import { z } from "zod";
import { EXPENSE_CATEGORIES, PAYMENT_MODES } from "./constants";

// Validation for payments, artisan payouts and expenses. Forms hold strings, so
// amounts accept "" (= not set) and are normalised here, once.

const blank = (v: unknown) => v === "" || v === undefined || v === null;

const ids = <T extends readonly { id: string }[]>(list: T) =>
  list.map((item) => item.id) as [T[number]["id"], ...T[number]["id"][]];

const optionalText = (max: number) => z.string().trim().max(max, `Keep this under ${max} characters.`);

const MAX_MONEY = 100_000_000;

const amount = z.preprocess(
  (v) => (blank(v) ? NaN : Number(v)),
  z
    .number("Enter the amount.")
    .gt(0, "The amount must be more than zero.")
    .max(MAX_MONEY, "That amount is too large.")
    .refine((n) => Math.round(n * 100) === Number((n * 100).toFixed(6)), "Use at most two decimal places."),
);

const date = (message: string) =>
  z
    .string(message)
    .regex(/^\d{4}-\d{2}-\d{2}$/, message)
    .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), message);

const optionalUuid = z.preprocess((v) => (blank(v) ? null : v), z.string().uuid().nullable());

const mode = z.enum(ids(PAYMENT_MODES), "Choose how it was paid.");

/** A tax invoice issued in the accounting system once the client has paid for a trip. */
export const taxInvoiceSchema = z.object({
  visitId: z.string("Choose the trip.").uuid("Choose the trip."),
  proformaInvoiceId: optionalUuid,
  invoiceNumber: z.string().trim().min(1, "Enter the tax invoice number.").max(100),
  invoiceDate: date("Enter the tax invoice date."),
  amount,
  mode,
  reference: optionalText(200),
  notes: optionalText(2000),
});

export type TaxInvoiceInput = z.input<typeof taxInvoiceSchema>;

export const payoutSchema = z.object({
  visitId: optionalUuid,
  villageId: optionalUuid,
  payee: z.string().trim().min(1, "Enter who was paid.").max(200),
  paidOn: date("Enter the date of the payout."),
  amount,
  mode,
  reference: optionalText(200),
  notes: optionalText(2000),
});

export type PayoutInput = z.input<typeof payoutSchema>;

export const expenseSchema = z.object({
  expenseDate: date("Enter the date of the expense."),
  category: z.enum(ids(EXPENSE_CATEGORIES), "Choose a category."),
  description: z.string().trim().min(1, "Describe the expense.").max(300),
  amount,
  paidTo: optionalText(200),
  mode,
  reference: optionalText(200),
  visitId: optionalUuid,
  villageId: optionalUuid,
  notes: optionalText(2000),
});

export type ExpenseInput = z.input<typeof expenseSchema>;
