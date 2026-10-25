import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { OrderSummary } from "./OrderSummary";
import type { PublicOffer, Quote } from "@/lib/commerceApi";

describe("OrderSummary", () => {
  it("identifies the item beside the total in the collapsed mobile summary", () => {
    const quote = {
      lines: [],
      subtotalCents: 12700,
      discountCents: 0,
      taxableCents: 0,
      taxCents: 0,
      totalCents: 12700,
      currency: "usd",
      formatted: { subtotal: "$127.00", discount: "$0.00", tax: "$0.00", total: "$127.00" },
    } satisfies Quote;
    const html = renderToStaticMarkup(
      <OrderSummary
        offer={{ title: "Credential With Confidence Kit", thumbnailUrl: "" } as PublicOffer}
        state={{ quote, coupon: null, couponError: null, pending: false, error: null }}
        wording={{ badge: "One payment", totalLabel: "Total", nothingDueToday: false, commitment: "", detail: "" }}
      />,
    );

    const mobileHandle = html.match(/<button[^>]*aria-controls="order-summary-detail"[^>]*>(.*?)<\/button>/)?.[1];
    expect(mobileHandle).toContain("Credential With Confidence Kit");
    expect(mobileHandle).toContain("$127.00");
  });
});
