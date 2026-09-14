import { describe, expect, it } from "vitest";
import { signDownload } from "./signedUrls";
import { RECEIPT_LINK_TTL_SECONDS, signReceiptLink, verifyReceiptLink } from "./receiptLinks";

/**
 * The receipt download link is the credential for a signed-out browser
 * navigation, so what it refuses matters as much as what it accepts.
 */
describe("receipt download links", () => {
  const now = new Date("2026-09-12T10:00:00.000Z");

  it("round-trips an order receipt for one member", () => {
    const { url, token, expiresAt } = signReceiptLink({ target: { orderId: 9 }, memberId: 40, now });

    expect(url).toBe(`/api/receipts/${token}`);
    expect(expiresAt.getTime()).toBe(now.getTime() + RECEIPT_LINK_TTL_SECONDS * 1000);
    expect(verifyReceiptLink(token, now)).toEqual({
      target: { orderId: 9 },
      memberId: 40,
      expiresAt: expiresAt.getTime() / 1000,
    });
  });

  it("keeps an invoice receipt distinct from an order receipt with the same id", () => {
    const { token } = signReceiptLink({ target: { invoiceId: 9 }, memberId: 40, now });
    expect(verifyReceiptLink(token, now)?.target).toEqual({ invoiceId: 9 });
  });

  it("is dead once its lifetime is over", () => {
    const { token } = signReceiptLink({ target: { orderId: 9 }, memberId: 40, now });
    const later = new Date(now.getTime() + RECEIPT_LINK_TTL_SECONDS * 1000);
    expect(verifyReceiptLink(token, later)).toBeNull();
  });

  it("refuses a token whose payload was edited to name another order or member", () => {
    const { token } = signReceiptLink({ target: { orderId: 9 }, memberId: 40, now });
    const [body, signature] = token.split(".");
    const forged = Buffer.from(
      Buffer.from(body, "base64url").toString("utf8").replace(".9.40.", ".10.41."),
      "utf8"
    ).toString("base64url");

    expect(verifyReceiptLink(`${forged}.${signature}`, now)).toBeNull();
    expect(verifyReceiptLink(`${body}.${signature.slice(0, -2)}xx`, now)).toBeNull();
    expect(verifyReceiptLink("not-a-token", now)).toBeNull();
    expect(verifyReceiptLink("", now)).toBeNull();
  });

  it("does not accept a protected-file download token", () => {
    const { token } = signDownload({ kind: "product", fileId: 9, memberId: 40, now });
    expect(verifyReceiptLink(token, now)).toBeNull();
  });
});
