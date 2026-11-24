import { describe, expect, it } from "vitest";
import { expenseSchema, taxInvoiceSchema } from "./schemas";

const trip = "6e94485d-2d20-46ec-bab5-eadc38195b57";

describe("taxInvoiceSchema", () => {
  const valid = {
    visitId: trip,
    proformaInvoiceId: "",
    invoiceNumber: " SRT/26-27/0147 ",
    invoiceDate: "2026-11-16",
    amount: "5309",
    mode: "upi" as const,
    reference: "",
    notes: "",
  };

  it("accepts a normal tax invoice and normalises it", () => {
    const parsed = taxInvoiceSchema.parse(valid);
    expect(parsed.amount).toBe(5309);
    expect(parsed.invoiceNumber).toBe("SRT/26-27/0147");
    expect(parsed.proformaInvoiceId).toBeNull();
  });

  it("rejects zero, negative and over-precise amounts", () => {
    for (const amount of ["0", "-10", "10.123", ""]) {
      expect(taxInvoiceSchema.safeParse({ ...valid, amount }).success).toBe(false);
    }
  });

  it("requires a trip and a real date", () => {
    expect(taxInvoiceSchema.safeParse({ ...valid, visitId: "" }).success).toBe(false);
    expect(taxInvoiceSchema.safeParse({ ...valid, invoiceDate: "16/11/2026" }).success).toBe(false);
  });
});

describe("expenseSchema", () => {
  it("only allows the fixed categories", () => {
    const base = {
      expenseDate: "2026-11-20",
      category: "transport" as const,
      description: "Tempo hire",
      amount: "1200",
      paidTo: "",
      mode: "cash" as const,
      reference: "",
      visitId: "",
      villageId: "",
      notes: "",
    };
    expect(expenseSchema.safeParse(base).success).toBe(true);
    expect(expenseSchema.safeParse({ ...base, category: "party" }).success).toBe(false);
  });
});
