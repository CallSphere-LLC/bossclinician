import { describe, expect, it } from "vitest";
import { purchaseSourceOf } from "./engineV2";

/**
 * QA row 230: only a purchase ties a sequence run to that purchase, so only a
 * purchase's refund or failed renewal can end it.
 */
describe("purchaseSourceOf", () => {
  it("stamps the offer and order an 'offer purchased' run started from", () => {
    expect(
      purchaseSourceOf({ trigger: "offer_purchased", subjectId: 40, facts: { offerId: 40, orderId: 201 } })
    ).toEqual({ offerId: 40, orderId: 201 });
  });

  it("stamps the offer alone for a manual grant, which has no order", () => {
    expect(
      purchaseSourceOf({ trigger: "offer_purchased", subjectId: 44, facts: { source: "manual_grant", offerId: 44 } })
    ).toEqual({ offerId: 44, orderId: null });
  });

  it("falls back to the offer in the facts when the subject is missing", () => {
    expect(
      purchaseSourceOf({ trigger: "offer_purchased", subjectId: null, facts: { offerId: 39, orderId: 0 } })
    ).toEqual({ offerId: 39, orderId: null });
  });

  it("ties nothing for any other trigger", () => {
    for (const trigger of ["form_submitted", "tag_added", "payment_plan_completed", "abandoned_checkout"] as const) {
      expect(purchaseSourceOf({ trigger, subjectId: 40, facts: { offerId: 40, orderId: 5 } })).toBeUndefined();
    }
  });

  it("ties nothing when no offer can be read", () => {
    expect(purchaseSourceOf({ trigger: "offer_purchased", subjectId: null, facts: {} })).toBeUndefined();
    expect(purchaseSourceOf({ trigger: "offer_purchased", subjectId: -1, facts: {} })).toBeUndefined();
  });
});
