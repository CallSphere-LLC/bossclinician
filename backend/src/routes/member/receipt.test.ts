import { describe, expect, it } from "vitest";
import { readBusinessDetails, renderReceipt, type ReceiptView } from "./billing";

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
    billedToEmail: "priya@example.com",
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
});
