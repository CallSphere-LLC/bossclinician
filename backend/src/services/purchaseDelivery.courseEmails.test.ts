import { beforeEach, describe, expect, it, vi } from "vitest";
import { automationIdentity, publishDomainEvent } from "./domainEvents";
import { upsertContactWithStatus } from "./contacts";
import { deliverManualGrant, deliverPurchase } from "./purchaseDelivery";

/** QA row 211: who a sale or an admin grant starts an offer's emails for. */

const { query } = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock("../db/pool", () => ({ pool: { query } }));
vi.mock("../config/env", () => ({
  env: { publicSiteUrl: "https://example.test", notifyEmail: "" },
  stripeTestMode: vi.fn(() => true),
}));
vi.mock("../email/mailer", () => ({ sendMail: vi.fn(async () => ({ sent: true })) }));
vi.mock("./domainEvents", () => ({ automationIdentity: vi.fn(), publishDomainEvent: vi.fn() }));
vi.mock("./contacts", () => ({ upsertContactWithStatus: vi.fn() }));
vi.mock("./receiptDocument", () => ({
  ensureOrderReceipt: vi.fn(),
  loadReceiptDocument: vi.fn().mockResolvedValue(null),
  renderReceiptPdf: vi.fn(),
}));
vi.mock("./setPasswordLink", () => ({ issueSetPasswordLink: vi.fn(), sendSetPasswordLink: vi.fn() }));
vi.mock("./sequences", () => ({ exitContactOnPurchase: vi.fn(async () => 0) }));
vi.mock("./settings", () => ({ readSetting: vi.fn(async () => ({})) }));
vi.mock("./ownerSaleNotification", () => ({ sendOwnerSaleNotification: vi.fn() }));
vi.mock("./directoryAuditIntake", () => ({ sendDirectoryAuditIntake: vi.fn() }));
vi.mock("../email/templateStore", () => ({
  withStoredTemplate: vi.fn(async (_topic: string, _tokens: unknown, fallback: unknown) => fallback),
}));

const ORDER = {
  id: 9,
  offer_id: 12,
  contact_id: 77,
  member_id: 34,
  email: "buyer@example.test",
  billing_name: "A Buyer",
  currency: "usd",
  total_cents: 0,
  coupon_code: "FREE",
  gift_recipient_email: "",
  gift_member_id: null,
  offer_title: "Course",
  offer_slug: "course",
};

function answer(sql: string, order: object, otherOffers: object[] = [], imported = 0) {
  if (sql.includes("JOIN offers f ON f.id = i.offer_id")) return { rows: otherOffers, rowCount: otherOffers.length };
  if (sql.includes("source = 'import'")) return { rows: [], rowCount: imported };
  if (sql.includes("FROM orders")) return { rows: [order], rowCount: 1 };
  if (sql.includes("FROM offers")) return { rows: [{ title: "Course", slug: "course" }], rowCount: 1 };
  return { rows: [], rowCount: 0 };
}

const published = () => vi.mocked(publishDomainEvent).mock.calls;

beforeEach(() => {
  vi.mocked(publishDomainEvent).mockReset();
  vi.mocked(automationIdentity).mockReset();
  vi.mocked(upsertContactWithStatus).mockReset();
  query.mockReset();
});

describe("purchases", () => {
  it("raises one event per offer on the order, the order's own under its original key", async () => {
    query.mockImplementation(async (sql: string) =>
      answer(sql, ORDER, [{ offer_id: 13, title: "Upsell", slug: "upsell" }]),
    );

    await deliverPurchase({ orderId: 9, memberId: 34, createdMember: false });

    expect(published().map(([, event]) => [event.eventKey, event.subjectId, event.facts?.additionalOffer])).toEqual([
      ["offer-purchased:order:9", 12, false],
      ["offer-purchased:order:9:offer:13", 13, true],
    ]);
  });

  it("starts a gift's emails for the person who received it, not the payer", async () => {
    query.mockImplementation(async (sql: string) =>
      answer(sql, { ...ORDER, gift_recipient_email: "friend@example.test", gift_member_id: 50 }),
    );
    vi.mocked(automationIdentity).mockResolvedValue({ contactId: 88, email: "friend@example.test", name: "Friend" });

    await deliverPurchase({ orderId: 9, memberId: 34, createdMember: false });

    expect(automationIdentity).toHaveBeenCalledWith(50, "friend@example.test");
    expect(published()[0][1]).toMatchObject({ contactId: 88, email: "friend@example.test" });
  });
});

describe("single admin grants", () => {
  const grant = { memberId: 34, offerId: 12, createdMember: false, productIds: [5] };

  beforeEach(() => {
    vi.mocked(automationIdentity).mockResolvedValue({ contactId: 77, email: "m@example.test", name: "M" });
  });

  it("starts nothing when the box is unticked or the caller never asked", async () => {
    query.mockImplementation(async (sql: string) => answer(sql, ORDER));

    await deliverManualGrant({ ...grant, sendCourseEmails: false, activatedProductIds: [5] });
    await deliverManualGrant({ ...grant, activatedProductIds: [5] });

    expect(publishDomainEvent).not.toHaveBeenCalled();
  });

  it("raises one keyed event per person and offer, marked as a grant", async () => {
    query.mockImplementation(async (sql: string) => answer(sql, ORDER));

    await deliverManualGrant({ ...grant, sendCourseEmails: true, activatedProductIds: [5] });

    expect(published()[0][0]).toBe("offer_purchased");
    expect(published()[0][1]).toMatchObject({
      eventKey: "offer-granted:member:34:offer:12",
      contactId: 77,
      subjectId: 12,
      source: "manual_grant",
      facts: { source: "manual_grant" },
    });
  });

  it("never emails somebody who already holds it through an import", async () => {
    query.mockImplementation(async (sql: string) => answer(sql, ORDER, [], 1));

    await deliverManualGrant({ ...grant, sendCourseEmails: true, activatedProductIds: [] });

    expect(publishDomainEvent).not.toHaveBeenCalled();
  });

  it("gives an account made by the grant a contact before enrolling it", async () => {
    query.mockImplementation(async (sql: string) => answer(sql, ORDER));
    vi.mocked(automationIdentity).mockResolvedValue({ contactId: null, email: "new@example.test", name: "" });
    vi.mocked(upsertContactWithStatus).mockResolvedValue({ id: 99, created: false });

    await deliverManualGrant({ ...grant, sendCourseEmails: true, activatedProductIds: [5] });

    expect(query.mock.calls.some(([sql]) => String(sql).includes("UPDATE members SET contact_id"))).toBe(true);
    expect(published()[0][1]).toMatchObject({ contactId: 99 });
  });
});
