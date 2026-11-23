import { z } from "zod";
import { PROGRAM_CATEGORIES, VISITOR_CATEGORIES } from "@/lib/visits/constants";
import { DISCOUNT_TYPES, INVOICE_STATUSES, PRICING_UNITS } from "./constants";

// Validation for services and proforma invoices. Forms hold strings, so numbers
// accept "" (= not set) and are normalised here, once.

const blank = (v: unknown) => v === "" || v === undefined || v === null;

const ids = <T extends readonly { id: string }[]>(list: T) =>
  list.map((item) => item.id) as [T[number]["id"], ...T[number]["id"][]];

const optionalText = (max: number) => z.string().trim().max(max, `Keep this under ${max} characters.`);

const MAX_MONEY = 100_000_000;

function money(message: string) {
  return z.preprocess(
    (v) => (blank(v) ? NaN : Number(v)),
    z.number(message).min(0, "Amounts can't be negative.").max(MAX_MONEY, "That amount is too large."),
  );
}

const optionalMoney = z.preprocess(
  (v) => (blank(v) ? null : Number(v)),
  z.number("Amounts must be numbers.").min(0, "Amounts can't be negative.").max(MAX_MONEY, "That amount is too large.").nullable(),
);

function int(min: number, max: number, message: string) {
  return z.preprocess((v) => (blank(v) ? NaN : Number(v)), z.number(message).int(message).min(min, message).max(max, message));
}

const gstRate = z.preprocess(
  (v) => (blank(v) ? NaN : Number(v)),
  z.number("Enter the GST rate.").min(0, "GST can't be negative.").max(100, "GST can't be over 100%."),
);

const optionalUuid = z.preprocess((v) => (blank(v) ? null : v), z.string().uuid().nullable());

// ---------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------

export const slabSchema = z
  .object({
    minHeadcount: int(1, 100_000, "Slab headcounts must be whole numbers of 1 or more."),
    maxHeadcount: int(1, 100_000, "Slab headcounts must be whole numbers of 1 or more."),
    discountType: z.enum(ids(DISCOUNT_TYPES)),
    discountValue: money("Enter the slab's discount (0 for none)."),
    freeGuides: int(0, 1000, "Free guides must be a whole number."),
  })
  .refine((s) => s.maxHeadcount >= s.minHeadcount, { message: "A slab's 'to' headcount can't be below its 'from'." })
  .refine((s) => s.discountType !== "percent" || s.discountValue <= 100, { message: "A percentage discount can't be over 100%." });

export type SlabInput = z.input<typeof slabSchema>;

export const serviceSchema = z
  .object({
    name: z.string().trim().min(1, "Service name is required.").max(160),
    description: optionalText(2000),
    sacCode: optionalText(20),
    pricingUnit: z.enum(ids(PRICING_UNITS)),
    baseRate: money("Enter the base amount."),
    gstRate,
    extraGuideRate: optionalMoney,
    customPricingAbove: int(1, 100_000, "Enter the headcount above which pricing is custom."),
    programCategories: z.array(z.enum(ids(PROGRAM_CATEGORIES))).max(PROGRAM_CATEGORIES.length),
    visitorCategories: z.array(z.enum(ids(VISITOR_CATEGORIES))).max(VISITOR_CATEGORIES.length),
    villageIds: z.array(z.string().uuid()).max(200),
    slabs: z.array(slabSchema).max(30, "Up to 30 slabs."),
  })
  .superRefine((service, ctx) => {
    const sorted = [...service.slabs].sort((a, b) => a.minHeadcount - b.minHeadcount);
    for (let i = 0; i < sorted.length; i++) {
      const slab = sorted[i];
      if (slab.maxHeadcount > service.customPricingAbove) {
        ctx.addIssue({
          code: "custom",
          path: ["slabs"],
          message: `Slabs stop at ${service.customPricingAbove} guests; bigger groups are priced by hand on the PI.`,
        });
        return;
      }
      const next = sorted[i + 1];
      if (next && next.minHeadcount <= slab.maxHeadcount) {
        ctx.addIssue({
          code: "custom",
          path: ["slabs"],
          message: `Slabs ${slab.minHeadcount}–${slab.maxHeadcount} and ${next.minHeadcount}–${next.maxHeadcount} overlap.`,
        });
        return;
      }
    }
  });

export type ServiceInput = z.input<typeof serviceSchema>;

// ---------------------------------------------------------------------------
// Proforma invoices
// ---------------------------------------------------------------------------

export const invoiceItemSchema = z
  .object({
    serviceId: optionalUuid,
    description: z.string().trim().min(1, "Every line needs a description.").max(300),
    details: optionalText(500),
    sacCode: optionalText(20),
    rate: money("Enter the rate for every line."),
    quantity: z.preprocess(
      (v) => (blank(v) ? NaN : Number(v)),
      z.number("Enter the quantity for every line.").gt(0, "Quantities must be more than 0.").max(100_000, "That quantity is too large."),
    ),
    discountLabel: optionalText(120),
    discountRate: z.preprocess(
      (v) => (blank(v) ? 0 : Number(v)),
      z.number("Discounts must be numbers.").min(0, "Discounts can't be negative.").max(MAX_MONEY),
    ),
    gstRate,
  })
  .refine((item) => item.discountRate <= item.rate, { message: "A line's discount can't be more than its rate." });

export type InvoiceItemInput = z.input<typeof invoiceItemSchema>;

export const invoiceTermSnapshotSchema = z.object({
  title: z.string().trim().max(120),
  body: z.string().trim().min(1).max(2000),
});

export type InvoiceTermSnapshot = z.infer<typeof invoiceTermSnapshotSchema>;

export const invoiceSchema = z
  .object({
    piNumber: optionalText(60),
    piDate: z.string("Pick the PI date.").regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the PI date."),
    status: z.enum(ids(INVOICE_STATUSES)),
    visitId: optionalUuid,
    billingName: z.string().trim().min(1, "Enter who the PI is billed to.").max(200),
    billingAddress: optionalText(1000),
    billingGstin: z
      .string()
      .trim()
      .toUpperCase()
      .refine((v) => v === "" || /^[0-9]{2}[A-Z0-9]{13}$/.test(v), "A GSTIN is 15 characters, starting with the 2-digit state code."),
    paymentTerms: optionalText(200),
    guests: int(0, 100_000, "Guests must be a whole number."),
    guides: int(0, 10_000, "Guides must be a whole number."),
    freeGuides: int(0, 10_000, "Free guides must be a whole number."),
    terms: z.array(invoiceTermSnapshotSchema).max(40),
    notes: optionalText(2000),
    items: z.array(invoiceItemSchema).min(1, "Add at least one line.").max(50, "A PI can have up to 50 lines."),
  })
  .refine((pi) => pi.freeGuides <= pi.guides, { message: "Free guides can't be more than the number of guides.", path: ["freeGuides"] });

export type InvoiceInput = z.input<typeof invoiceSchema>;

export const invoiceStatusSchema = z.enum(ids(INVOICE_STATUSES));

// ---------------------------------------------------------------------------
// Settings and terms
// ---------------------------------------------------------------------------

export const invoiceSettingsSchema = z.object({
  sellerName: z.string().trim().min(1, "Enter the company name.").max(200),
  sellerAddress: z.string().trim().min(1, "Enter the company address.").max(500),
  sellerPhone: optionalText(40),
  sellerStateName: optionalText(60),
  sellerStateCode: optionalText(4),
  sellerGstin: optionalText(15),
  bankAccountName: optionalText(200),
  bankAccountNumber: optionalText(40),
  bankIfsc: optionalText(20),
  bankName: optionalText(120),
  bankAddress: optionalText(300),
  numberPrefix: z
    .string()
    .trim()
    .min(1, "Enter the PI number prefix.")
    .max(40)
    .regex(/^[A-Za-z0-9][A-Za-z0-9/_-]*[A-Za-z0-9]$|^[A-Za-z0-9]$/, "Use letters, digits, / - or _, without a trailing slash."),
  defaultPaymentTerms: optionalText(200),
  footerNote: optionalText(300),
});

export type InvoiceSettingsInput = z.input<typeof invoiceSettingsSchema>;

export const invoiceTermSchema = z.object({
  title: z.string().trim().min(1, "Give the term a short title.").max(120),
  body: z.string().trim().min(1, "Enter the term's text.").max(2000),
  isDefault: z.boolean(),
});

export type InvoiceTermInput = z.input<typeof invoiceTermSchema>;

/** A proforma invoice made outside the platform, uploaded with its PDF. */
export const externalInvoiceSchema = z
  .object({
    visitId: optionalUuid,
    piNumber: z.string().trim().min(1, "Enter the PI number as printed.").max(80),
    piDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the PI date.")
      .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), "Enter the PI date."),
    billingName: z.string().trim().min(1, "Enter who it is billed to.").max(200),
    status: z.enum(["issued", "paid", "cancelled"], "Pick the status."),
    grandTotal: money("Enter the total (incl. GST)."),
    gstTotal: money("Enter the GST (0 if none)."),
    notes: optionalText(2000),
  })
  .refine((d) => d.gstTotal <= d.grandTotal, { message: "GST can't be more than the total.", path: ["gstTotal"] });

export type ExternalInvoiceInput = z.input<typeof externalInvoiceSchema>;
