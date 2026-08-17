import { describe, it, expect } from "vitest";
import { csvCell, toCsv } from "./reports";
import type { ReportResult } from "../../services/reports/queries";

/**
 * The CSV export writes values the business owner did not author — an offer
 * title typed by a customer-facing form, a cancellation note somebody wrote on
 * their way out, an affiliate's own name. Excel, Numbers and Sheets all execute
 * a cell that begins `=`, `+`, `-` or `@`, so an export is a way to run code on
 * the machine of whoever opens it unless every cell is defused first.
 *
 * These tests pin that. They are cheap and the failure they prevent is somebody
 * opening the monthly numbers and having a formula reach out to a URL.
 */

describe("csvCell", () => {
  it("quotes everything, so commas and newlines cannot break the row", () => {
    expect(csvCell("Practice, Protection")).toBe('"Practice, Protection"');
    expect(csvCell("line one\nline two")).toBe('"line one\nline two"');
  });

  it("doubles an embedded quote rather than ending the field early", () => {
    expect(csvCell('She said "no"')).toBe('"She said ""no"""');
  });

  it("defuses a cell a spreadsheet would run as a formula", () => {
    // The classic: opens a shell on some configurations, exfiltrates on others.
    expect(csvCell("=1+1")).toBe(`"'=1+1"`);
    expect(csvCell("+44 7700 900000")).toBe(`"'+44 7700 900000"`);
    expect(csvCell("-2")).toBe(`"'-2"`);
    expect(csvCell("@SUM(A1:A9)")).toBe(`"'@SUM(A1:A9)"`);
    expect(csvCell("\tHYPERLINK")).toBe(`"'\tHYPERLINK"`);
  });

  it("leaves an ordinary value alone", () => {
    expect(csvCell("Fully Booked Toolkit")).toBe('"Fully Booked Toolkit"');
    expect(csvCell(4970)).toBe('"4970"');
    expect(csvCell(null)).toBe('""');
  });
});

describe("toCsv", () => {
  const result: ReportResult = {
    series: [
      {
        label: "Money coming in",
        format: "money",
        points: [
          { date: "2026-03-01", value: 49700 },
          { date: "2026-03-02", value: 0 },
        ],
      },
    ],
    totals: {
      total: { label: "Money coming in", value: 49700, format: "money" },
      secondary: { label: "Payments taken", value: 1, format: "count" },
    },
    breakdown: [{ label: "=cmd|'/c calc'!A1", value: 49700, count: 1 }],
    breakdownLabel: "What was bought",
    breakdownValueLabel: "Money in",
    breakdownCountLabel: "Payments",
    breakdownFormat: "money",
    breakdownCountFormat: "count",
    currency: "usd",
  };

  const csv = toCsv("Money coming in", { from: "2026-03-01", to: "2026-03-02" }, result);

  it("writes money as a plain decimal a spreadsheet can add up", () => {
    // Not "$497.00": a currency symbol makes the column text, and a column of
    // text is a column nobody can sum.
    expect(csv).toContain('"Money coming in","497.00"');
    expect(csv).toContain('"2026-03-01","497.00"');
  });

  it("counts stay whole numbers", () => {
    expect(csv).toContain('"Payments taken","1"');
  });

  it("defuses a formula that arrived in the data", () => {
    expect(csv).toContain(`"'=cmd|'/c calc'!A1"`);
  });

  it("uses CRLF line endings", () => {
    expect(csv.split("\r\n").length).toBeGreaterThan(5);
  });

  it("names the currency only when it is not the default", () => {
    expect(csv).not.toContain('"Currency"');
    const mixed = toCsv("x", { from: "2026-03-01", to: "2026-03-02" }, {
      ...result,
      currency: "mixed",
    });
    expect(mixed).toContain('"Currency","MIXED"');
  });
});
