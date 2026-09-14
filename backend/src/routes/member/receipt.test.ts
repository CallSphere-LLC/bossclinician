import zlib from "zlib";
import { describe, expect, it } from "vitest";
import { readBusinessDetails } from "../../services/businessIdentity";
import { renderReceipt, type ReceiptView } from "../../services/receiptDocument";
import { renderInvoicePdf } from "../../services/invoicePdf";

/**
 * The words a PDF actually draws.
 *
 * pdfkit deflates its content streams and writes the glyphs of a built-in font
 * as hex strings with kerning numbers between them, so neither the raw bytes nor
 * the inflated stream contains anything a test can read. Inflating each stream
 * and joining its hex runs back together gives the printed text — with the
 * kerning dropped, which is why a run may be split mid-word and the assertions
 * below look for whole values rather than sentences.
 */
function pdfText(pdf: Buffer): string {
  const raw = pdf.toString("latin1");
  let out = "";
  const marker = /stream\r?\n/g;
  let match: RegExpExecArray | null;
  while ((match = marker.exec(raw)) !== null) {
    const start = match.index + match[0].length;
    const end = raw.indexOf("endstream", start);
    if (end === -1) break;
    const body = Buffer.from(raw.slice(start, end), "latin1");
    let content: string;
    try {
      content = zlib.inflateSync(body).toString("latin1");
    } catch {
      content = body.toString("latin1");
    }
    for (const run of content.matchAll(/<([0-9a-fA-F]+)>/g)) {
      out += Buffer.from(run[1], "hex").toString("latin1");
    }
  }
  return out;
}

/** A paid receipt with nothing customised, as the base for each case. */
function view(overrides: Partial<ReceiptView> = {}): ReceiptView {
  return {
    business: {
      name: "Boss Clinician LLC",
      addressLines: ["848 N Rainbow Blvd", "Las Vegas, NV 89107"],
      email: "support@bossclinician.com",
      taxId: "",
    },
    title: "Receipt",
    refundPolicy: "",
    billedToName: "Priya Formtest",
    billedToEmail: "success+priya@simulator.amazonses.com",
    reference: "#41",
    description: "ZZ Test — checkout probe",
    paid: true,
    paidAt: "2026-09-04T00:00:00.000Z",
    issuedAt: "2026-09-04T00:00:00.000Z",
    currency: "usd",
    lines: [{ title: "ZZ Test — checkout probe", quantity: 1, amountCents: 1900 }],
    subtotalCents: 1900,
    discountCents: 0,
    couponCode: "",
    taxCents: 0,
    totalCents: 1900,
    ...overrides,
  };
}

/**
 * The receipt for an order a coupon took to nothing.
 *
 * This is the order on file — $19.00 less MADHAVFREE, total $0.00, status paid —
 * and it is the case a receipt is most easily got wrong on: every figure on it
 * is zero except the ones that explain why.
 */
function freeView(overrides: Partial<ReceiptView> = {}): ReceiptView {
  return view({
    subtotalCents: 1900,
    discountCents: 1900,
    couponCode: "MADHAVFREE",
    totalCents: 0,
    ...overrides,
  });
}

describe("receipt customiser", () => {
  it("prints the tax number the business settings promise to print", () => {
    const html = renderReceipt(view({
      business: { ...view().business, taxId: "88-1691637" },
    }));

    expect(html).toContain("Tax ID 88-1691637");
  });

  it("leaves the tax line off entirely when no number is set", () => {
    expect(renderReceipt(view())).not.toContain("Tax ID");
  });

  it("uses her own title for the document and its window title", () => {
    const html = renderReceipt(view({ title: "Payment confirmation" }));

    expect(html).toContain("<h1>Payment confirmation</h1>");
    expect(html).toContain("<title>Payment confirmation #41");
    expect(html).not.toContain("<h1>Receipt</h1>");
  });

  it("prints the refund policy at the foot so the terms travel with the money", () => {
    const html = renderReceipt(view({
      refundPolicy: "Refunds are available within 14 days of purchase.",
    }));

    expect(html).toContain("Refunds are available within 14 days of purchase.");
  });

  it("escapes a policy and title typed by a person", () => {
    const html = renderReceipt(view({
      title: "<script>alert(1)</script>",
      refundPolicy: "<img onerror=alert(1)>",
    }));

    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain("<img onerror");
    expect(html).toContain("&lt;script&gt;");
  });

  it("reads the tax number off the business setting", () => {
    const details = readBusinessDetails([
      { key: "business", value: { name: "Boss Clinician LLC", taxId: "88-1691637" } },
    ]);

    expect(details.taxId).toBe("88-1691637");
    expect(details.name).toBe("Boss Clinician LLC");
  });

  it("reads the footer note and logo off the business setting", () => {
    const details = readBusinessDetails([
      {
        key: "business",
        value: { name: "ZZ Co", footerNote: "  Line one\nLine two  ", logoUrl: "/uploads/logo.png" },
      },
    ]);

    expect(details.footerNote).toBe("Line one\nLine two");
    expect(details.logoUrl).toBe("/uploads/logo.png");
  });

  it("prints her footer note at the foot of the receipt, escaped", () => {
    const html = renderReceipt(view({
      business: { ...view().business, footerNote: "Thank you <b>so</b> much\nEIN on file" },
    }));

    expect(html).toContain('<div class="note">Thank you &lt;b&gt;so&lt;/b&gt; much\nEIN on file</div>');
  });

  it("heads the receipt with the logo, and only ever as an inline image", () => {
    const withLogo = renderReceipt(view({ logoDataUri: "data:image/png;base64,iVBORw0KGgo=" }));
    expect(withLogo).toContain('<img class="logo" src="data:image/png;base64,iVBORw0KGgo="');

    // The page's policy allows data: images alone; anything else never renders.
    const remote = renderReceipt(view({ logoDataUri: "https://example.com/x.png" }));
    expect(remote).not.toContain("<img");
  });

  it("leaves the logo and the note off when neither is set", () => {
    const html = renderReceipt(view());
    expect(html).not.toContain("<img");
    expect(html).not.toContain('class="note"');
  });

  it("draws the logo and prints the footer note in the PDF", async () => {
    const TINY_PNG =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const input = {
      business: { ...view().business, taxId: "88-1691637", footerNote: "ZZNOTE12345" },
      orderId: 9,
      transactionReference: "",
      issuedAt: new Date("2026-09-04T15:50:23.680Z"),
      buyerName: "ZZ Buyer",
      buyerEmail: "success+buyer@simulator.amazonses.com",
      buyerAddressLines: [],
      paymentMethod: "No payment due",
      lines: [{ title: "ZZ Test", quantity: 1, amountCents: 1900 }],
      subtotalCents: 1900,
      discountCents: 1900,
      couponCode: "MADHAVFREE",
      taxCents: 0,
      totalCents: 0,
      currency: "usd",
    };

    const pdf = await renderInvoicePdf({ ...input, logo: Buffer.from(TINY_PNG, "base64") });
    expect(pdf.toString("latin1")).toMatch(/\/Subtype \/Image/);
    const text = pdfText(pdf);
    expect(text).toContain("ZZNOTE12345");
    expect(text).toContain("88-1691637");

    // A logo pdfkit cannot decode costs the receipt its logo, not the receipt.
    const broken = await renderInvoicePdf({ ...input, logo: Buffer.from("not an image") });
    expect(broken.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(broken.toString("latin1")).not.toMatch(/\/Subtype \/Image/);
  });
});

describe("a receipt for a purchase a coupon took to zero", () => {
  it("still renders as a paid receipt, with the discount that explains it", () => {
    const html = renderReceipt(freeView());

    // Not "Not yet paid": nothing is owed, and a receipt that implies otherwise
    // is one the buyer writes in about.
    expect(html).toContain("Paid September 4, 2026");
    expect(html).not.toContain("Not yet paid");
    expect(html).toContain("MADHAVFREE");
    // The subtotal it started from, the discount, and nothing left to pay.
    expect(html).toContain("$19.00");
    expect(html).toContain("$0.00");
    // A tax line even at zero, and the amount paid labelled as such, not blank.
    expect(html).toContain('<tr><td>Tax</td><td class="num">$0.00</td></tr>');
    expect(html).toContain('<td>Total paid</td><td class="num">$0.00</td>');
  });

  it("quotes both the receipt number and the order number, as the PDF does", () => {
    const html = renderReceipt(freeView({ reference: "R-2026-00009", orderNumber: "9" }));
    expect(html).toContain("R-2026-00009 &middot; Order no. 9");

    // No duplicate when the reference already is the order.
    const bare = renderReceipt(freeView({ reference: "#9", orderNumber: "9" }));
    expect(bare).not.toContain("Order no.");
  });

  it("keeps the tax number on the free one too", () => {
    const html = renderReceipt(freeView({
      business: { ...view().business, taxId: "88-1691637" },
    }));

    expect(html).toContain("Tax ID 88-1691637");
  });

  it("renders a one-page PDF for it, with the tax number and the coupon", async () => {
    const pdf = await renderInvoicePdf({
      business: { ...view().business, taxId: "88-1691637" },
      orderId: 9,
      receiptNumber: "R-2026-00009",
      transactionReference: "",
      issuedAt: new Date("2026-09-04T15:50:23.680Z"),
      buyerName: "Madhav Shankaran",
      buyerEmail: "success+buyer@simulator.amazonses.com",
      buyerAddressLines: [],
      // A fully discounted order has no card and no transaction behind it.
      paymentMethod: "No payment due",
      lines: [{ title: "ZZ Test — checkout probe", quantity: 1, amountCents: 1900 }],
      subtotalCents: 1900,
      discountCents: 1900,
      couponCode: "MADHAVFREE",
      taxCents: 0,
      totalCents: 0,
      currency: "usd",
    });

    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(pdf.byteLength).toBeGreaterThan(1000);

    // pdfkit deflates its content streams, so the drawn text has to be inflated
    // back out before it can be read. Worth the few lines: "does the receipt
    // print the tax number" is exactly the question a PDF byte count cannot
    // answer, and the previous fix for it was never verifiable.
    const text = pdfText(pdf);
    expect(text).toContain("88-1691637");
    expect(text).toContain("MADHAVFREE");
    expect(text).toContain("$0.00");
    // Labelled as the HTML labels it, and carrying the receipt number and a tax line.
    expect(text).toContain("Tax ID 88-1691637");
    expect(text).not.toContain("Tax #");
    expect(text).toContain("R-2026-00009");
    expect(text).toMatch(/Tax\$0\.00/);
  });
});
