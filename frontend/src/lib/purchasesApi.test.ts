import { describe, expect, it } from "vitest";
import { accessDateText, groupPurchaseCards, transactionTone, type Purchase } from "@/lib/purchasesApi";
import { formatSiteDate } from "@/pages/admin/ui/siteTime";

function purchase(key: string, over: Partial<Purchase> = {}): Purchase {
  return {
    key,
    kind: "one_time",
    status: "complete",
    source: "kajabi",
    offerId: null,
    offerTitle: "An Offer",
    offerThumbnailUrl: null,
    purchasedAt: "2026-09-26T19:00:00.000Z",
    dateLabel: "Paid on",
    totalText: "$127.00 USD",
    priceText: "$127.00 USD",
    pricePill: null,
    quantity: 1,
    currency: "usd",
    totalCents: 12_700,
    paidCents: 12_700,
    refundedCents: 0,
    billing: null,
    access: { revoked: false, revokedBy: null, startsOn: "2026-09-26", endsOn: null },
    plan: null,
    orderNo: null,
    gift: false,
    note: "",
    ...over,
  };
}

describe("groupPurchaseCards", () => {
  it("gives every purchase its own card when none share an order", () => {
    const cards = groupPurchaseCards([purchase("1"), purchase("2"), purchase("order-9", { source: "checkout" })]);
    expect(cards.map((card) => card.map((p) => p.key))).toEqual([["1"], ["2"], ["order-9"]]);
  });

  it("draws the items of one Kajabi order as one card, where the first of them sits", () => {
    const cards = groupPurchaseCards([
      purchase("5", { orderNo: "1016" }),
      purchase("4"),
      purchase("6", { orderNo: "1016" }),
    ]);
    expect(cards.map((card) => card.map((p) => p.key))).toEqual([["5", "6"], ["4"]]);
  });

  it("keeps a payment plan on its own card even though Kajabi gave it an order number", () => {
    const cards = groupPurchaseCards([
      purchase("1", { kind: "payment_plan", orderNo: "1005" }),
      purchase("2", { orderNo: "1005" }),
    ]);
    expect(cards).toHaveLength(2);
  });
});

describe("accessDateText", () => {
  it("prints Kajabi's range when access ended, on the calendar day stored", () => {
    expect(
      accessDateText({ revoked: true, revokedBy: null, startsOn: "2026-08-10", endsOn: "2026-08-24" }, (d) =>
        formatSiteDate(d),
      ),
    ).toBe("Aug 10, 2026 - Aug 24, 2026");
  });

  it("prints just the start while access is open-ended", () => {
    expect(
      accessDateText({ revoked: false, revokedBy: null, startsOn: "2026-08-13", endsOn: null }, (d) => formatSiteDate(d)),
    ).toBe("Aug 13, 2026");
  });
});

describe("transactionTone", () => {
  it("colours paid green, upcoming blue and refunded grey", () => {
    expect(transactionTone("paid")).toBe("green");
    expect(transactionTone("upcoming")).toBe("blue");
    expect(transactionTone("refunded")).toBe("slate");
    expect(transactionTone("failed")).toBe("red");
  });
});

describe("site dates on a card", () => {
  it("dates Norma-style late-evening payments on the Los Angeles day, as Kajabi does", () => {
    // 05:18 UTC on the 22nd is 10:18 PM on the 21st in Los Angeles.
    expect(formatSiteDate("2026-07-22T05:18:00.000Z", "America/Los_Angeles")).toBe("Jul 21, 2026");
  });
});
