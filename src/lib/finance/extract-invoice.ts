import "server-only";
import { PAYMENT_MODES } from "./constants";

// Reads a tax invoice (PDF or image) with OpenAI and returns the fields the
// Invoices form needs. Uses the Responses API directly with a strict JSON
// schema, so the reply is always the same shape. Server-only: the API key never
// reaches the browser.

export type ExtractedTaxInvoice = {
  /** False when the file doesn't look like an invoice at all. */
  isInvoice: boolean;
  invoiceNumber: string | null;
  /** YYYY-MM-DD */
  invoiceDate: string | null;
  /** The grand total payable, including GST. */
  amount: number | null;
  /** The value before GST (taxable value), if shown. */
  taxableAmount: number | null;
  /** The total GST (CGST + SGST + IGST), if shown. */
  gstAmount: number | null;
  /** Who the invoice is billed to. */
  customerName: string | null;
  paymentMode: (typeof PAYMENT_MODES)[number]["id"] | null;
  paymentReference: string | null;
};

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "is_invoice",
    "invoice_number",
    "invoice_date",
    "grand_total",
    "taxable_amount",
    "gst_amount",
    "customer_name",
    "payment_mode",
    "payment_reference",
  ],
  properties: {
    is_invoice: { type: "boolean", description: "True if the document is an invoice, proforma invoice, quotation or bill." },
    invoice_number: { type: ["string", "null"], description: "The invoice number exactly as printed." },
    invoice_date: { type: ["string", "null"], description: "The invoice date as YYYY-MM-DD." },
    grand_total: {
      type: ["number", "null"],
      description: "The final total payable in rupees including GST/taxes, as a plain number (no commas or symbols).",
    },
    taxable_amount: {
      type: ["number", "null"],
      description: "The value before GST (taxable value / sub-total after discounts), in rupees.",
    },
    gst_amount: { type: ["number", "null"], description: "Total GST charged (CGST + SGST + IGST), in rupees." },
    customer_name: { type: ["string", "null"], description: "The name of the person or company billed (Bill to / Buyer)." },
    payment_mode: {
      type: ["string", "null"],
      enum: [...PAYMENT_MODES.map((m) => m.id), null],
      description: "How it was paid, only if the invoice states it.",
    },
    payment_reference: {
      type: ["string", "null"],
      description: "UTR / transaction / cheque number, only if printed on the invoice.",
    },
  },
} as const;

const PROMPTS = {
  tax: "Read this tax invoice and extract its details for our accounts.",
  proforma: "Read this proforma invoice (or quotation / estimate) and extract its details for our accounts.",
} as const;

const PROMPT_RULES = `
- invoice_number: the invoice number exactly as printed (not a PO, order or GSTIN number).
- invoice_date: the invoice date, converted to YYYY-MM-DD. Indian invoices write dates day-first (e.g. 05/11/2026 is 5 November 2026).
- grand_total: the final amount payable including GST, in rupees.
- taxable_amount and gst_amount: the value before GST and the total GST, if the document shows them.
- customer_name: who it is billed to (Bill to / Buyer / Customer), not the seller.
- payment_mode and payment_reference: only if the invoice actually states them; otherwise null.
Use null for anything not present. Never guess.`;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function cleanText(value: unknown, max = 200): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function money(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value * 100) / 100 : null;
}

export async function extractTaxInvoice({
  bytes,
  mimeType,
  fileName,
  apiKey,
  model,
  kind = "tax",
}: {
  bytes: ArrayBuffer;
  mimeType: string;
  fileName: string;
  apiKey: string;
  model: string;
  /** Which document this is; only changes the wording of the request. */
  kind?: keyof typeof PROMPTS;
}): Promise<ExtractedTaxInvoice> {
  const dataUrl = `data:${mimeType};base64,${Buffer.from(bytes).toString("base64")}`;
  const filePart =
    mimeType === "application/pdf"
      ? { type: "input_file", filename: fileName || "invoice.pdf", file_data: dataUrl }
      : { type: "input_image", image_url: dataUrl, detail: "high" };

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      reasoning: { effort: "low" },
      input: [{ role: "user", content: [filePart, { type: "input_text", text: `${PROMPTS[kind]}\n${PROMPT_RULES}` }] }],
      text: { format: { type: "json_schema", name: "tax_invoice", strict: true, schema: SCHEMA } },
    }),
    signal: AbortSignal.timeout(90_000),
    cache: "no-store",
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`OpenAI returned HTTP ${response.status}: ${detail.slice(0, 300)}`);
  }

  const body = (await response.json()) as {
    output?: { type?: string; content?: { type?: string; text?: string }[] }[];
  };
  const text = body.output
    ?.flatMap((item) => item.content ?? [])
    .find((part) => part.type === "output_text")?.text;
  if (!text) throw new Error("OpenAI returned no answer.");
  const raw = JSON.parse(text) as Record<string, unknown>;

  const date = cleanText(raw.invoice_date, 10);
  const total = typeof raw.grand_total === "number" && Number.isFinite(raw.grand_total) && raw.grand_total > 0
    ? Math.round(raw.grand_total * 100) / 100
    : null;
  const mode = PAYMENT_MODES.find((m) => m.id === raw.payment_mode)?.id ?? null;

  return {
    isInvoice: raw.is_invoice === true,
    invoiceNumber: cleanText(raw.invoice_number, 100),
    invoiceDate: date && DATE_PATTERN.test(date) && !Number.isNaN(Date.parse(`${date}T00:00:00Z`)) ? date : null,
    amount: total,
    taxableAmount: money(raw.taxable_amount),
    gstAmount: money(raw.gst_amount),
    customerName: cleanText(raw.customer_name),
    paymentMode: mode,
    paymentReference: cleanText(raw.payment_reference),
  };
}
