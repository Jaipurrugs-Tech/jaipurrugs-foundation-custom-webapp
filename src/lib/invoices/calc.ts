// Pure pricing maths for services and proforma invoices, shared by the services page,
// the PI editor's live totals and the PDF. The database recomputes the saved totals
// (public.proforma_invoice_recalc) the same way and is the source of truth:
//   line gross    = round(rate × quantity)
//   line discount = round(discount per unit × quantity)
//   GST           = per GST rate, round(sum of taxable × rate / 100)
// Everything is rounded to the paisa.

import type { DiscountType } from "./constants";

/**
 * Rounds to the paisa, half away from zero, like Postgres `round(numeric, 2)`. Float noise
 * is cleared first (2700.75 × 18 / 100 is 486.13499999… as a float, but 486.135 exactly in
 * the database, which rounds it to 486.14), then the decimal is shifted by exponent, not by
 * multiplying, so 1.005 stays 1.005.
 */
export function round2(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const abs = Number(Math.abs(value).toFixed(8));
  const rounded = Number(`${Math.round(Number(`${abs}e2`))}e-2`);
  return value < 0 ? -rounded : rounded;
}

export type SlabLike = {
  min_headcount: number;
  max_headcount: number;
  discount_type: DiscountType | string;
  discount_value: number;
  free_guides: number;
};

export type PricedService = {
  base_rate: number;
  gst_rate: number;
  pricing_unit: string;
  extra_guide_rate: number | null;
  custom_pricing_above: number;
  slabs: SlabLike[];
};

export function sortSlabs<T extends SlabLike>(slabs: T[]): T[] {
  return [...slabs].sort((a, b) => a.min_headcount - b.min_headcount);
}

export function slabRangeLabel(slab: Pick<SlabLike, "min_headcount" | "max_headcount">) {
  return slab.min_headcount === slab.max_headcount
    ? `${slab.min_headcount}`
    : `${slab.min_headcount}–${slab.max_headcount}`;
}

export function slabDiscountLabel(slab: Pick<SlabLike, "discount_type" | "discount_value">) {
  if (!slab.discount_value) return "No discount";
  return slab.discount_type === "percent"
    ? `${slab.discount_value}% off`
    : `₹${slab.discount_value.toLocaleString("en-IN")} off`;
}

/** Discount per unit a slab gives on a rate. A flat amount never exceeds the rate. */
export function slabDiscountPerUnit(slab: Pick<SlabLike, "discount_type" | "discount_value">, rate: number) {
  if (!slab.discount_value || rate <= 0) return 0;
  return slab.discount_type === "percent"
    ? round2((rate * slab.discount_value) / 100)
    : Math.min(round2(slab.discount_value), rate);
}

export type SuggestedPricing = {
  /** The slab the suggestion comes from (for large groups: the highest slab), if any. */
  slab: SlabLike | null;
  /** True when the group is above the service's custom-pricing headcount: the manager decides. */
  isLargeGroup: boolean;
  discountPerUnit: number;
  discountLabel: string;
  freeGuides: number;
};

/**
 * What the slabs suggest for a group of `headcount`. Above `custom_pricing_above` no slab
 * applies; the highest slab is offered as a starting point and `isLargeGroup` is set so the
 * editor asks for the discount and free guides to be confirmed by hand.
 */
export function suggestPricing(service: PricedService, headcount: number, rate = service.base_rate): SuggestedPricing {
  const slabs = sortSlabs(service.slabs);
  const isLargeGroup = headcount > service.custom_pricing_above;
  const slab = isLargeGroup
    ? (slabs.at(-1) ?? null)
    : (slabs.find((s) => headcount >= s.min_headcount && headcount <= s.max_headcount) ?? null);
  if (!slab) {
    return { slab: null, isLargeGroup, discountPerUnit: 0, discountLabel: "", freeGuides: 0 };
  }
  const discountPerUnit = slabDiscountPerUnit(slab, rate);
  return {
    slab,
    isLargeGroup,
    discountPerUnit,
    discountLabel: discountPerUnit
      ? slab.discount_type === "percent"
        ? `Group discount (${slab.discount_value}%)`
        : "Group discount"
      : "",
    freeGuides: slab.free_guides,
  };
}

export function priceWithGst(rate: number, gstRate: number) {
  return round2(rate + round2((rate * gstRate) / 100));
}

export type LineValues = { rate: number; quantity: number; discountRate: number; gstRate: number };

export function lineAmounts(line: LineValues) {
  const gross = round2(line.rate * line.quantity);
  const discount = round2(line.discountRate * line.quantity);
  return { gross, discount, taxable: round2(gross - discount) };
}

export type InvoiceTotals = {
  subtotal: number;
  discountTotal: number;
  taxableTotal: number;
  gstByRate: { rate: number; taxable: number; gst: number }[];
  gstTotal: number;
  grandTotal: number;
};

export function invoiceTotals(lines: LineValues[]): InvoiceTotals {
  let subtotal = 0;
  let discountTotal = 0;
  const byRate = new Map<number, number>();
  for (const line of lines) {
    const { gross, discount, taxable } = lineAmounts(line);
    subtotal += gross;
    discountTotal += discount;
    byRate.set(line.gstRate, (byRate.get(line.gstRate) ?? 0) + taxable);
  }
  const gstByRate = [...byRate.entries()]
    .sort(([a], [b]) => a - b)
    .map(([rate, taxable]) => ({ rate, taxable: round2(taxable), gst: round2((taxable * rate) / 100) }));
  const taxableTotal = round2(gstByRate.reduce((sum, g) => sum + g.taxable, 0));
  const gstTotal = round2(gstByRate.reduce((sum, g) => sum + g.gst, 0));
  return {
    subtotal: round2(subtotal),
    discountTotal: round2(discountTotal),
    taxableTotal,
    gstByRate,
    gstTotal,
    grandTotal: round2(taxableTotal + gstTotal),
  };
}

/** The line printed under the first service: "Guests: 12 | Guide: 3 (free of charge)". */
export function groupDetailsText(guests: number, guides: number, freeGuides: number) {
  const parts = [`Guests: ${guests}`];
  if (guides > 0) {
    const free = Math.min(freeGuides, guides);
    parts.push(
      free >= guides
        ? `Guide: ${guides} (free of charge)`
        : free > 0
          ? `Guide: ${guides} (${free} free of charge)`
          : `Guide: ${guides}`,
    );
  }
  return parts.join(" | ");
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

const amountFormat = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const plainFormat = new Intl.NumberFormat("en-IN", { useGrouping: false, maximumFractionDigits: 2 });
const rupeeFormat = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2,
  minimumFractionDigits: 0,
});

/** 59988 -> "59,988.00" (Indian grouping), as printed in the PI's amount column. */
export function formatAmount(value: number) {
  return amountFormat.format(value);
}

/** 4999 -> "4999", as printed in the PI's rate and quantity columns. */
export function formatPlain(value: number) {
  return plainFormat.format(value);
}

/** 4999 -> "₹4,999" for the admin UI (never the PDF: its font has no ₹ glyph). */
export function formatRupees(value: number | null | undefined) {
  return value === null || value === undefined ? "—" : rupeeFormat.format(value);
}

/** "2026-10-28" -> "28.10.2026", the PI's date format. */
export function formatPiDate(isoDate: string) {
  const [y, m, d] = isoDate.split("-");
  return y && m && d ? `${d}.${m}.${y}` : isoDate;
}

// ---------------------------------------------------------------------------
// Amount in words (Indian numbering: thousand, lakh, crore)
// ---------------------------------------------------------------------------

const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
  "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function belowHundred(n: number): string {
  if (n < 20) return ONES[n];
  return TENS[Math.floor(n / 10)] + (n % 10 ? ` ${ONES[n % 10]}` : "");
}

function belowThousand(n: number): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  return [hundreds ? `${ONES[hundreds]} Hundred` : "", rest ? belowHundred(rest) : ""].filter(Boolean).join(" ");
}

function indianWords(n: number): string {
  if (n === 0) return "Zero";
  const crore = Math.floor(n / 10_000_000);
  const lakh = Math.floor(n / 100_000) % 100;
  const thousand = Math.floor(n / 1000) % 100;
  const rest = n % 1000;
  return [
    crore ? `${indianWords(crore)} Crore` : "",
    lakh ? `${belowHundred(lakh)} Lakh` : "",
    thousand ? `${belowHundred(thousand)} Thousand` : "",
    rest ? belowThousand(rest) : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/** 28320 -> "INR Twenty Eight Thousand Three Hundred Twenty Only". */
export function amountInWords(amount: number): string {
  const total = Math.round(round2(Math.abs(amount)) * 100);
  const rupees = Math.floor(total / 100);
  const paise = total % 100;
  return `INR ${indianWords(rupees)}${paise ? ` and ${belowHundred(paise)} Paise` : ""} Only`;
}
