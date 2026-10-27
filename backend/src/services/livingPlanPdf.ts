import PDFDocument from "pdfkit";
import { z } from "zod";
import { badRequest } from "../utils/httpError";

/** Text only: no HTML, remote images, filesystem paths, or PDF instructions.
 * The client supplies the current editor snapshot, including unsaved entries.
 * Export never changes the stored plan or its revision.
 */
export const livingPlanReportSchema = z.object({
  year: z.number().int().min(1900).max(2200),
  archived: z.boolean(),
  sections: z.array(z.object({
    title: z.string().max(160), description: z.string().max(600), reviewed: z.boolean(),
    fields: z.array(z.object({ label: z.string().max(200), value: z.string().max(5000) }).strict()).min(1).max(20),
  }).strict()).length(11),
}).strict();

export type LivingPlanReport = z.infer<typeof livingPlanReportSchema>;

export const PLAN_PDF_NOTE = "A typed name is an acknowledgment only, not a verified digital signature. Financial values are user supplied and not independently verified; this is not a lender-ready certified statement.";

// PDFKit's built-in fonts cover WinAnsi. Never silently lose characters outside
// that set: the browser print option preserves the user's full Unicode text.
const WIN_ANSI = /^[\t\n\r\u0020-\u007e\u00a0-\u00ff\u0152\u0153\u0160\u0161\u0178\u017d\u017e\u0192\u02c6\u02dc\u2013-\u2014\u2018-\u201a\u201c-\u201e\u2020-\u2022\u2026\u2030\u2039\u203a\u20ac]*$/;

export async function createLivingPlanPdf(report: LivingPlanReport): Promise<Buffer> {
  for (const section of report.sections) {
    for (const text of [section.title, section.description, ...section.fields.flatMap((field) => [field.label, field.value])]) {
      if (!WIN_ANSI.test(text)) throw badRequest("Some characters need browser printing. Use Print / Save as PDF to preserve all of your text.");
    }
  }
  const doc = new PDFDocument({ size: "LETTER", margins: { top: 48, bottom: 48, left: 50, right: 50 },
    bufferPages: true, info: { Title: `My ${report.year} Annual Business Plan`, Author: "Boss Clinician" } });
  const chunks: Buffer[] = [];
  const complete = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  const width = 512;
  const room = (height: number) => { if (doc.y + height > 732) doc.addPage(); };
  doc.font("Helvetica-Bold").fontSize(23).fillColor("#30233e")
    .text(`My ${report.year} Annual Business Plan`, { width });
  doc.moveDown(0.4).font("Helvetica").fontSize(10).fillColor("#55505c")
    .text(`Boss Clinician${report.archived ? " · Archived plan" : ""} · ${report.sections.filter((section) => section.reviewed).length} of 11 sections reviewed`, { width });
  for (const section of report.sections) {
    room(110);
    doc.moveDown(1).font("Helvetica-Bold").fontSize(15).fillColor("#30233e").text(section.title, { width });
    doc.moveDown(0.3).font("Helvetica").fontSize(9).fillColor("#55505c")
      .text(`${section.reviewed ? "Reviewed" : "Not yet reviewed"} · ${section.description}`, { width });
    for (const field of section.fields) {
      doc.font("Helvetica-Bold").fontSize(10);
      room(doc.heightOfString(field.label, { width }) + 35);
      doc.moveDown(0.65).fillColor("#30233e").text(field.label, { width });
      // PDFKit wraps and paginates long values; fixed-height cells would cut them off.
      doc.moveDown(0.25).font("Helvetica").fontSize(11).fillColor("#20202a")
        .text(field.value || "Not entered", { width, lineGap: 3 });
    }
  }
  room(80);
  doc.moveDown(1.2).font("Helvetica").fontSize(9).fillColor("#55505c").text(PLAN_PDF_NOTE, { width });
  const pages = doc.bufferedPageRange();
  for (let index = 0; index < pages.count; index++) {
    doc.switchToPage(index);
    // Footers sit inside the reserved bottom margin. Without this temporary
    // margin change PDFKit moves each footer onto an extra, almost-empty page.
    const bottomMargin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font("Helvetica").fontSize(8).fillColor("#55505c")
      .text(`Boss Clinician · ${report.year} business plan · ${index + 1} / ${pages.count}`, 50, 756, { width, lineBreak: false });
    doc.page.margins.bottom = bottomMargin;
  }
  doc.end();
  return complete;
}
