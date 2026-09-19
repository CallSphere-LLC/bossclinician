import { beforeEach, describe, expect, it, vi } from "vitest";
import { stripeTestMode } from "../config/env";
import { sendMail } from "../email/mailer";
import { publishDomainEvent } from "./domainEvents";
import { ensureOrderReceipt } from "./receiptDocument";
import { exitContactOnPurchase } from "./sequences";
import { issueSetPasswordLink } from "./setPasswordLink";
import { deliverPurchase, notifyOwnerOfSale } from "./purchaseDelivery";

/**
 * What a sandbox purchase still owes the buyer.
 *
 * The site runs on a Stripe test key, so `stripeTestMode()` is true in
 * production and every guard that reads it is live. Suppressing the emails is
 * deliberate — a leaked installment-completion message reached a real address
 * during testing — but suppressing everything downstream of them was not: the
 * set-password link a guest account is unusable without is minted on the same
 * code path, as are the sequence exit and the `domain_events` row the sale is
 * recorded in.
 */

const { query } = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock("../db/pool", () => ({ pool: { query } }));
vi.mock("../config/env", () => ({
  env: { publicSiteUrl: "https://example.test", notifyEmail: "" },
  stripeTestMode: vi.fn(),
}));
vi.mock("../email/mailer", () => ({ sendMail: vi.fn() }));
vi.mock("./domainEvents", () => ({ publishDomainEvent: vi.fn() }));
vi.mock("./receiptDocument", () => ({
  ensureOrderReceipt: vi.fn(),
  loadReceiptDocument: vi.fn().mockResolvedValue(null),
  renderReceiptPdf: vi.fn(),
}));
vi.mock("./setPasswordLink", () => ({
  issueSetPasswordLink: vi.fn(),
  sendSetPasswordLink: vi.fn(),
}));
vi.mock("./sequences", () => ({ exitContactOnPurchase: vi.fn() }));
vi.mock("./settings", () => ({ readSetting: vi.fn() }));
vi.mock("./notificationRecipients", () => ({ notificationRecipients: vi.fn() }));
vi.mock("../email/templateStore", () => ({
  withStoredTemplate: vi.fn(async (_topic: string, _tokens: unknown, fallback: unknown) => fallback),
}));

const ORDER = {
  id: 4242,
  offer_id: 12,
  contact_id: 77,
  member_id: 34,
  email: "buyer@example.test",
  billing_name: "A Buyer",
  billing_address: {},
  currency: "usd",
  subtotal_cents: 4700,
  discount_cents: 0,
  coupon_code: "",
  tax_cents: 0,
  total_cents: 4700,
  created_at: new Date("2026-09-19T00:00:00Z"),
  gift_recipient_email: "",
  gift_message: "",
  gift_member_id: null,
  gift_created_member: false,
  offer_title: "Credential with Confidence",
  offer_slug: "credential-with-confidence",
  welcome_next_steps: "",
  send_welcome_email: true,
  course_title: "",
};

describe("purchase delivery in Stripe sandbox mode", () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    query.mockImplementation((sql: string) =>
      Promise.resolve({ rows: sql.includes("order_items") ? [] : [ORDER], rowCount: 1 })
    );
    vi.mocked(issueSetPasswordLink).mockResolvedValue({ url: "https://example.test/set-password?t=abc" } as never);
    vi.mocked(exitContactOnPurchase).mockResolvedValue(2);
    vi.mocked(publishDomainEvent).mockResolvedValue({ id: "evt", created: true });
    vi.mocked(sendMail).mockResolvedValue({ messageId: 1, sent: true, providerMessageId: "p", error: "" });
    const { readSetting } = await import("./settings");
    vi.mocked(readSetting).mockResolvedValue({} as never);
  });

  it("sends nothing, but still mints the link, exits the sequence and records the sale", async () => {
    vi.mocked(stripeTestMode).mockReturnValue(true);

    const outcome = await deliverPurchase({ orderId: ORDER.id, memberId: 34, createdMember: true });

    // The envelope, and only the envelope, is held back.
    expect(sendMail).not.toHaveBeenCalled();
    expect(outcome.receiptSent).toBe(false);
    expect(outcome.welcomeSent).toBe(false);

    // A guest checkout's account is unusable without this, and it is minted
    // rather than sent: the buyer reaches it through the link's own record.
    expect(issueSetPasswordLink).toHaveBeenCalledWith(34);

    // The in-app receipt, the sequence exit and the business record all run.
    expect(ensureOrderReceipt).toHaveBeenCalledWith(ORDER.id);
    expect(exitContactOnPurchase).toHaveBeenCalledWith(ORDER.contact_id, expect.any(String), ORDER.offer_id);
    expect(outcome.sequencesExited).toBe(2);
    expect(publishDomainEvent).toHaveBeenCalledWith("offer_purchased", expect.objectContaining({
      eventKey: `offer-purchased:order:${ORDER.id}`,
      subjectId: ORDER.offer_id,
    }));
  });

  it("still delivers everything, mail included, on a live key", async () => {
    vi.mocked(stripeTestMode).mockReturnValue(false);

    const outcome = await deliverPurchase({ orderId: ORDER.id, memberId: 34, createdMember: true });

    // Receipt and welcome, as before.
    expect(vi.mocked(sendMail).mock.calls.map((call) => call[0].topic)).toEqual([
      "purchase_receipt",
      "purchase_access",
    ]);
    expect(outcome.welcomeSent).toBe(true);
    expect(outcome.setPasswordLinkIncluded).toBe(true);
    expect(publishDomainEvent).toHaveBeenCalled();
  });

  it("keeps the owner's sale alert suppressed: it is only ever an email", async () => {
    vi.mocked(stripeTestMode).mockReturnValue(true);
    const { notificationRecipients } = await import("./notificationRecipients");

    notifyOwnerOfSale({ description: "Anything", email: "buyer@example.test", amountCents: 4700, currency: "usd" });
    await Promise.resolve();

    expect(notificationRecipients).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
  });
});
