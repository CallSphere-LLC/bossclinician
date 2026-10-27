import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { createLivingPlanPdf, livingPlanReportSchema, type LivingPlanReport } from "./livingPlanPdf";

function drawnText(pdf: Buffer): string {
  const raw = pdf.toString("latin1");
  let text = "";
  for (const match of raw.matchAll(/stream\r?\n/g)) {
    const start = match.index! + match[0].length;
    const end = raw.indexOf("endstream", start);
    try {
      const stream = inflateSync(Buffer.from(raw.slice(start, end), "latin1")).toString("latin1");
      for (const run of stream.matchAll(/<([0-9a-fA-F]+)>/g)) text += Buffer.from(run[1], "hex").toString("latin1");
    } catch { /* Non-text streams are irrelevant to the drawn text. */ }
  }
  return text;
}

const report = (): LivingPlanReport => ({ year: 2026, archived: false, sections: Array.from({ length: 11 }, (_, index) => ({
  title: index === 0 ? "Executive Summary" : `Section ${index}`, description: "Annual strategy", reviewed: index === 0,
  fields: [{ label: `Field ${index}`, value: index === 10 ? "LASTSECTIONVALUE" : `Value ${index}` }],
})) });

describe("Living Business Plan PDF", () => {
  it("creates a real paginated PDF with every section and long final values intact", async () => {
    const input = report();
    input.sections[3].fields[0].value = "Long business strategy ".repeat(170) + "ENDOFSTRATEGY";
    input.sections[0].fields.push({ label: "Financial target", value: "$125,000.25" });
    const before = JSON.stringify(input);
    const pdf = await createLivingPlanPdf(input);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    const pageCount = (pdf.toString("latin1").match(/\/Type \/Page\b/g) ?? []).length;
    expect(pageCount).toBeGreaterThan(1);
    const text = drawnText(pdf);
    expect(text).toContain("Executive Summary");
    expect(text).toContain("$125,000.25");
    expect(text).toContain("ENDOFSTRATEGY");
    expect(text).toContain("LASTSECTIONVALUE");
    expect(text).toContain("not a verified digital signature");
    expect(text).toContain(`${pageCount} / ${pageCount}`);
    expect(JSON.stringify(input)).toBe(before);
  });
  it("rejects oversized/foreign report shapes and never silently drops unsupported characters", async () => {
    const input = report();
    expect(livingPlanReportSchema.safeParse({ ...input, path: "/etc/passwd" }).success).toBe(false);
    input.sections[0].fields[0].value = "x".repeat(5001);
    expect(livingPlanReportSchema.safeParse(input).success).toBe(false);
    input.sections[0].fields[0].value = "Practice 東京";
    await expect(createLivingPlanPdf(input)).rejects.toThrow("Print / Save as PDF");
  });
  it("accepts accented Latin, smart quotes, dashes, bullets and common currency symbols", async () => {
    const input = report();
    input.sections[0].fields[0].value = 'José’s practice — “Care” • £250 €300 ¥400 $500…';
    expect((await createLivingPlanPdf(input)).subarray(0, 5).toString()).toBe("%PDF-");
  });
  it("embeds licensed Unicode fonts and text mappings for Greek, Cyrillic and emoji", async () => {
    const input = report();
    input.sections[0].fields[0].value = "Δημήτρης • Елена • 😀 👩🏽‍⚕️";
    const pdf = await createLivingPlanPdf(input);
    const raw = pdf.toString("latin1");
    expect(raw).toContain("NotoSans");
    expect(raw).toContain("NotoEmoji");
    let mappings = "";
    for (const match of raw.matchAll(/stream\r?\n/g)) {
      const start = match.index! + match[0].length;
      try {
        const stream = inflateSync(Buffer.from(raw.slice(start, raw.indexOf("endstream", start)), "latin1")).toString("latin1");
        if (stream.includes("begincmap")) mappings += stream.toLowerCase();
      } catch { /* Not every stream is compressed text. */ }
    }
    for (const glyph of ["Δ", "Е", "😀", "👩🏽‍⚕️"]) expect(mappings.replace(/\s+/g, "")).toContain(Buffer.from(glyph, "utf16le").swap16().toString("hex"));
  });
});
