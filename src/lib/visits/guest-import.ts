import { DEFAULT_COUNTRY_CODE } from "./constants";
import { guestSchema } from "./schemas";

// Bulk guest upload (CSV / XLSX). Parsing and validation are pure so the browser can
// preview a file and the server action can re-validate the very same rows — the server
// never trusts what the browser says is valid. File reading happens in the browser; the
// server action receives already-parsed rows.

export const MAX_IMPORT_ROWS = 500;
export const MAX_IMPORT_FILE_BYTES = 1_000_000;

export type RawGuestRow = { name: string; phone: string; email: string };

export type ParsedGuestRow = RawGuestRow & {
  /** 1-based position among the file's data rows, so errors point at the right line. */
  row: number;
};

export type ValidGuestRow = { row: number; name: string; phone: string; email: string | null };
export type RowProblem = { row: number; name: string; phone: string; reason: string };

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

// Example rows use @example.com so they can be recognised and skipped if a file is
// uploaded with them still in place (nobody wants a WhatsApp sent to a sample number).
const EXAMPLE_EMAIL_DOMAIN = "@example.com";

const TEMPLATE_ROWS: RawGuestRow[] = [
  { name: "Asha Sharma", phone: "+91 98765 43210", email: "asha.sharma@example.com" },
  { name: "John Smith", phone: "+44 7700 900123", email: "john.smith@example.com" },
];

function csvCell(value: string) {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function guestTemplateCsv(): string {
  const lines = [["name", "phone", "email"], ...TEMPLATE_ROWS.map((r) => [r.name, r.phone, r.email])];
  return lines.map((line) => line.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

const HEADER_ALIASES: Record<keyof RawGuestRow, string[]> = {
  name: ["name", "fullname", "guestname", "guest", "visitorname", "visitor"],
  phone: ["phone", "phonenumber", "mobile", "mobilenumber", "whatsapp", "whatsappnumber", "contact", "contactnumber"],
  email: ["email", "emailaddress", "mail", "emailid"],
};

function normalizeHeader(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function fieldForHeader(header: string): keyof RawGuestRow | null {
  const key = normalizeHeader(header);
  for (const field of Object.keys(HEADER_ALIASES) as (keyof RawGuestRow)[]) {
    if (HEADER_ALIASES[field].includes(key)) return field;
  }
  return null;
}

/** RFC 4180 style: quoted cells, doubled quotes, newlines inside quotes. */
function parseCsvCells(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/** Excel's "Save as CSV" uses ; in many locales; sheets exported as text use tabs. */
function detectDelimiter(headerLine: string) {
  const counts = [",", ";", "\t"].map((d) => ({ d, n: headerLine.split(d).length - 1 }));
  counts.sort((a, b) => b.n - a.n);
  return counts[0].n > 0 ? counts[0].d : ",";
}

export type ParseResult = { rows: ParsedGuestRow[]; error?: string };

type Cell = string | number | boolean | Date | null | undefined;

/** A phone typed into a spreadsheet is usually a numeric cell; print it as plain digits (no exponent). */
function cellText(cell: Cell): string {
  if (cell === null || cell === undefined) return "";
  if (typeof cell === "number") return Number.isInteger(cell) ? BigInt(cell).toString() : String(cell);
  if (cell instanceof Date) return "";
  return String(cell).trim();
}

/** Turns a header row + data rows (from a CSV or a sheet) into guest rows. */
function cellsToGuests(cells: Cell[][]): ParseResult {
  const nonBlank = cells.filter((r) => r.some((c) => cellText(c) !== ""));
  if (nonBlank.length === 0) return { rows: [], error: "The file is empty." };

  const fieldByColumn = nonBlank[0].map((h) => fieldForHeader(cellText(h)));
  if (!fieldByColumn.includes("name") || !fieldByColumn.includes("phone")) {
    return {
      rows: [],
      error: 'The first row must be a header with at least "name" and "phone" columns. Download the template to see the format.',
    };
  }

  const rows: ParsedGuestRow[] = nonBlank.slice(1).map((line, index) => {
    const row: RawGuestRow = { name: "", phone: "", email: "" };
    fieldByColumn.forEach((field, column) => {
      if (field && row[field] === "") row[field] = cellText(line[column]);
    });
    return { ...row, row: index + 1 };
  });
  return { rows };
}

export function parseCsvGuests(input: string): ParseResult {
  const text = input.replace(/^\uFEFF/, "");
  const firstLine = text.split(/\r\n|\n|\r/, 1)[0] ?? "";
  return cellsToGuests(parseCsvCells(text, detectDelimiter(firstLine)));
}

/** First sheet of an .xlsx workbook. Loaded on demand so the reader isn't in the page's main bundle. */
export async function parseXlsxGuests(file: File): Promise<ParseResult> {
  try {
    const { readSheet } = await import("read-excel-file/universal");
    // The library types date cells as the Date constructor (a typing slip); at runtime they are Dates.
    return cellsToGuests((await readSheet(file)) as unknown as Cell[][]);
  } catch {
    return { rows: [], error: "Couldn't read that Excel file. Make sure it is a valid .xlsx workbook." };
  }
}

export async function parseGuestFile(file: File): Promise<ParseResult> {
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".xlsx")) return parseXlsxGuests(file);
  if (lower.endsWith(".csv") || lower.endsWith(".txt")) return parseCsvGuests(await file.text());
  return { rows: [], error: "Upload a .csv or .xlsx file." };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * The stored form of a phone number. Bare 10-digit (or 0-prefixed) numbers are Indian,
 * matching the "+91" default of the single-guest form; anything longer is taken to
 * already include its country code. Returns null when there aren't enough digits.
 */
export function canonicalGuestPhone(input: string): string | null {
  const trimmed = input.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 8) return null;
  if (trimmed.startsWith("+")) return `+${digits}`;
  if (digits.startsWith("00") && digits.length > 10) return `+${digits.slice(2)}`;
  if (digits.length === 10) return `${DEFAULT_COUNTRY_CODE} ${digits}`;
  if (digits.length === 11 && digits.startsWith("0")) return `${DEFAULT_COUNTRY_CODE} ${digits.slice(1)}`;
  if (digits.length > 10) return `+${digits}`;
  return null;
}

export function isTemplateExample(row: RawGuestRow) {
  return row.email.trim().toLowerCase().endsWith(EXAMPLE_EMAIL_DOMAIN);
}

/** Last 10 digits — the same key leads are de-duplicated on (see normalizePhone). */
function phoneKey(phone: string) {
  return phone.replace(/\D/g, "").slice(-10);
}

export type ValidatedImport = {
  valid: ValidGuestRow[];
  problems: RowProblem[];
  /** Rows skipped because they are the template's examples, not an error. */
  examples: number;
};

/** Validates every row and drops repeats within the file (same phone twice). */
export function validateGuestRows(rows: ParsedGuestRow[]): ValidatedImport {
  const valid: ValidGuestRow[] = [];
  const problems: RowProblem[] = [];
  const seen = new Map<string, number>();
  let examples = 0;

  for (const raw of rows) {
    // Completely blank rows (e.g. trailing commas) are ignored silently.
    if (!raw.name && !raw.phone && !raw.email) continue;
    const base = { row: raw.row, name: raw.name, phone: raw.phone };

    if (isTemplateExample(raw)) {
      examples++;
      continue;
    }
    if (/\d\.?\d*e\+?\d+/i.test(raw.phone)) {
      problems.push({ ...base, reason: "Phone looks like scientific notation (Excel). Format the column as text." });
      continue;
    }

    const parsed = guestSchema.safeParse({ name: raw.name, phone: raw.phone, email: raw.email });
    if (!parsed.success) {
      problems.push({ ...base, reason: parsed.error.issues[0]?.message ?? "Invalid row." });
      continue;
    }
    const phone = canonicalGuestPhone(parsed.data.phone);
    if (!phone) {
      problems.push({ ...base, reason: "Enter a valid phone number (at least 8 digits)." });
      continue;
    }

    const key = phoneKey(phone);
    const firstSeenAt = seen.get(key);
    if (firstSeenAt !== undefined) {
      problems.push({ ...base, reason: `Same phone number as row ${firstSeenAt}.` });
      continue;
    }
    seen.set(key, raw.row);
    valid.push({ row: raw.row, name: parsed.data.name, phone, email: parsed.data.email ? parsed.data.email : null });
  }

  return { valid, problems, examples };
}
