import { describe, expect, it } from "vitest";
import { csvCell, toCsv } from "./csv";

describe("csvCell", () => {
  it("leaves plain values alone", () => {
    expect(csvCell("Manpura")).toBe("Manpura");
    expect(csvCell(4999.5)).toBe("4999.5");
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });

  it("quotes commas, quotes and new lines", () => {
    expect(csvCell("Jaipur, Rajasthan")).toBe('"Jaipur, Rajasthan"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("line 1\nline 2")).toBe('"line 1\nline 2"');
  });

  it("neutralises text that a spreadsheet would run as a formula", () => {
    expect(csvCell("=HYPERLINK(\"x\")")).toBe("\"'=HYPERLINK(\"\"x\"\")\"");
    expect(csvCell("+91 98290 56083")).toBe("'+91 98290 56083");
    expect(csvCell("-5")).toBe("'-5");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
  });

  it("does not touch negative numbers passed as numbers", () => {
    expect(csvCell(-5)).toBe("-5");
  });
});

describe("toCsv", () => {
  it("adds a BOM and CRLF line endings for Excel", () => {
    const csv = toCsv(["Name", "Amount"], [["Ilse", 5309]]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toBe("﻿Name,Amount\r\nIlse,5309\r\n");
  });
});
