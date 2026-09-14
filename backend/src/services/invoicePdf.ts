import PDFDocument from "pdfkit";
import { formatAmount } from "../utils/money";
import type { BusinessDetails } from "./businessIdentity";

/**
 * The receipt a customer keeps, as a PDF attached to their confirmation email.
 *
 * This is a financial document, not a nicety. It is what somebody attaches to an
 * expense claim, hands to a bookkeeper, or produces months later when a card
 * statement is queried — so three properties are non-negotiable:
 *
 *  - **Every figure is passed in, never recomputed.** The amounts here come from
 *    the order that Stripe actually charged against. A PDF that recalculates a
 *    total and disagrees with the card statement is a chargeback with paperwork.
 *  - **It fits on one page.** Every variable-length string is capped and the
 *    line-item table is bounded, because the half of a two-page receipt that
 *    gets printed is never reliably the half with the total on it.
 *  - **Only built-in PDF fonts.** No font file to ship, none to go missing from
 *    a container image and take the receipt down with it.
 */

const INK = "#1A1523";
const MUTED = "#6B6478";
const RULE = "#DDD8E4";
const PLUM = "#4C1D63";

export interface InvoiceLine {
  title: string;
  quantity: number;
  amountCents: number;
}

export interface InvoiceInput {
  business: BusinessDetails;
  orderId: number;
  /** The receipt record's number ("R-2026-00009"), the reference the HTML receipt leads with. */
  receiptNumber?: string;
  /** Stripe's payment intent id, printed as the transaction reference. */
  transactionReference: string;
  issuedAt: Date;
  buyerName: string;
  buyerEmail: string;
  /** Already-formatted address lines from the order, in print order. */
  buyerAddressLines: string[];
  paymentMethod: string;
  lines: InvoiceLine[];
  subtotalCents: number;
  discountCents: number;
  couponCode: string;
  taxCents: number;
  totalCents: number;
  currency: string;
  /**
   * The receipt logo's bytes, already checked by `receiptLogo` to be a PNG or a
   * JPEG — the only two formats pdfkit draws. Absent means a text heading.
   */
  logo?: Buffer | null;
}

function pdfToBuffer(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.end();
  });
}

function longDate(value: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(value);
}

/** The filename a buyer sees in their mail client and their downloads folder. */
export function invoiceFilename(orderId: number, issuedAt: Date): string {
  const date = issuedAt.toISOString().slice(0, 10);
  return `receipt-${date}-${orderId}.pdf`;
}

export async function renderInvoicePdf(input: InvoiceInput): Promise<Buffer> {
  const money = (cents: number): string => formatAmount(cents, input.currency);

  const doc = new PDFDocument({
    size: "LETTER",
    margin: 0,
    info: {
      Title: `Receipt ${input.orderId} — ${input.business.name}`,
      Author: input.business.name,
      Subject: `Order ${input.orderId}`,
    },
  });

  const left = 56;
  const right = doc.page.width - 56;
  const width = right - left;
  let y = 56;

  /* ------------------------------------------------------------- the seller */

  if (input.logo) {
    // Fitted into a fixed box so a tall logo cannot push the total off the page.
    // A file that passed the signature check but still will not decode costs the
    // receipt its logo, never the receipt itself.
    try {
      doc.image(input.logo, left, y, { fit: [180, 52] });
      y += 64;
    } catch {
      // Drawn without it.
    }
  }

  doc.font("Helvetica-Bold").fontSize(15).fillColor(PLUM);
  doc.text(input.business.name.slice(0, 70), left, y, { width });
  y += 22;

  doc.font("Helvetica").fontSize(9).fillColor(MUTED);
  const sellerLines = [
    input.business.email,
    ...input.business.addressLines,
    // Worded exactly as the HTML receipt words it, so the two copies agree.
    input.business.taxId ? `Tax ID ${input.business.taxId}` : "",
  ].filter((line) => line !== "");
  for (const line of sellerLines) {
    doc.text(line, left, y, { width: width / 2 });
    y += 12;
  }

  y += 18;
  doc.moveTo(left, y).lineTo(right, y).lineWidth(0.75).strokeColor(RULE).stroke();
  y += 24;

  /* ------------------------------------------------------------- the headline */

  doc.font("Helvetica-Bold").fontSize(18).fillColor(INK);
  doc.text("Your purchase is confirmed", left, y, { width });
  y += 26;

  doc.font("Helvetica").fontSize(9).fillColor(MUTED);
  doc.text("Amount paid", left, y);
  doc.font("Helvetica-Bold").fontSize(20).fillColor(INK);
  doc.text(money(input.totalCents), left, y + 12);
  y += 52;

  /* ------------------------------------------- who bought it, and the refs */

  const columnWidth = width / 2 - 12;
  const rightColumn = left + width / 2 + 12;
  const blockTop = y;

  doc.font("Helvetica-Bold").fontSize(9).fillColor(INK);
  doc.text("Purchased by", left, y, { width: columnWidth });
  doc.font("Helvetica").fontSize(9).fillColor(MUTED);
  let leftY = y + 14;
  for (const line of [input.buyerName, input.buyerEmail, ...input.buyerAddressLines]
    .filter((line) => line !== "")
    .slice(0, 7)) {
    doc.text(line.slice(0, 90), left, leftY, { width: columnWidth });
    leftY += 12;
  }

  doc.font("Helvetica-Bold").fontSize(9).fillColor(INK);
  doc.text("Details", rightColumn, blockTop, { width: columnWidth });
  doc.font("Helvetica").fontSize(9).fillColor(MUTED);
  let rightY = blockTop + 14;
  const references: [string, string][] = [
    ["Date", longDate(input.issuedAt)],
    ...(input.receiptNumber ? [["Receipt no.", input.receiptNumber] as [string, string]] : []),
    ["Order no.", String(input.orderId)],
    ["Transaction no.", input.transactionReference || "—"],
    ["Payment method", input.paymentMethod || "—"],
  ];
  for (const [label, value] of references) {
    doc.text(`${label}: ${value.slice(0, 60)}`, rightColumn, rightY, { width: columnWidth });
    rightY += 12;
  }

  y = Math.max(leftY, rightY) + 22;

  /* ------------------------------------------------------------ the items */

  doc.moveTo(left, y).lineTo(right, y).lineWidth(0.75).strokeColor(RULE).stroke();
  y += 12;

  doc.font("Helvetica-Bold").fontSize(9).fillColor(MUTED);
  doc.text("OFFER", left, y, { width: width - 110 });
  doc.text("AMOUNT", right - 110, y, { width: 110, align: "right" });
  y += 16;
  doc.moveTo(left, y).lineTo(right, y).lineWidth(0.75).strokeColor(RULE).stroke();
  y += 12;

  doc.font("Helvetica").fontSize(10).fillColor(INK);
  // Bounded so a bundle with fifty products cannot push the total off the page.
  // The count of what was dropped still prints, because a receipt that silently
  // omits a line the customer paid for is one they are right to query.
  const shown = input.lines.slice(0, 12);
  for (const line of shown) {
    doc.font("Helvetica").fontSize(10).fillColor(INK);
    doc.text(line.title.slice(0, 70), left, y, { width: width - 120 });
    doc.text(money(line.amountCents), right - 110, y, { width: 110, align: "right" });
    y += 14;
    if (line.quantity > 1) {
      doc.font("Helvetica").fontSize(8).fillColor(MUTED);
      doc.text(`Quantity: ${line.quantity}`, left, y, { width: width - 120 });
      y += 12;
    }
    y += 4;
  }
  if (input.lines.length > shown.length) {
    doc.font("Helvetica-Oblique").fontSize(8).fillColor(MUTED);
    doc.text(`and ${input.lines.length - shown.length} more item(s)`, left, y);
    y += 14;
  }

  y += 6;
  doc.moveTo(left, y).lineTo(right, y).lineWidth(0.75).strokeColor(RULE).stroke();
  y += 12;

  /* ------------------------------------------------------------ the totals */

  // Subtotal and tax always print, $0.00 included, matching the HTML receipt: a
  // receipt handed to an accountant has to show that no tax was charged rather
  // than leave it to be inferred. The discount prints only when there was one.
  const summary: [string, string, boolean][] = [];
  summary.push(["Subtotal", money(input.subtotalCents), false]);
  if (input.discountCents > 0) {
    const label = input.couponCode ? `Coupon: ${input.couponCode}` : "Discount";
    summary.push([label, `-${money(input.discountCents)}`, false]);
  }
  summary.push(["Tax", money(input.taxCents), false]);
  summary.push(["Total paid", money(input.totalCents), true]);

  for (const [label, value, bold] of summary) {
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(bold ? 11 : 10);
    doc.fillColor(bold ? INK : MUTED);
    doc.text(label.slice(0, 50), left, y, { width: width - 120 });
    doc.fillColor(INK);
    doc.text(value, right - 110, y, { width: 110, align: "right" });
    y += bold ? 18 : 15;
  }

  /* ------------------------------------------------------------- the footer */

  // Her own note sits directly above the standard line, bounded to four lines of
  // small type so it can never reach up into the totals.
  const footerNote = (input.business.footerNote ?? "").trim();
  if (footerNote !== "") {
    doc.font("Helvetica").fontSize(8).fillColor(INK);
    const noteHeight = Math.min(doc.heightOfString(footerNote, { width, align: "center" }), 44);
    doc.text(footerNote, left, doc.page.height - 80 - noteHeight, {
      width,
      height: 44,
      align: "center",
      ellipsis: true,
    });
  }

  doc.font("Helvetica").fontSize(8).fillColor(MUTED);
  doc.text(
    `Keep this receipt for your records. Questions about this order? Write to ${
      input.business.email || "us"
    } and quote order ${input.orderId}.`,
    left,
    doc.page.height - 72,
    { width, align: "center" }
  );

  return pdfToBuffer(doc);
}
