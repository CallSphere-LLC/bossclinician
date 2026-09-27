import { describe, expect, it, vi } from "vitest";

// Importing the router module must not open a pool or build a Stripe client;
// nothing here reaches either.
vi.mock("../../db/pool", () => ({ pool: { query: vi.fn(), connect: vi.fn() } }));
vi.mock("../../stripe/client", () => ({ stripe: vi.fn() }));

import { recurringPriceRequest } from "./checkoutOffer";
import type { OfferRow } from "./offers";

/**
 * Stripe answers a key replayed within 24 hours with different parameters by
 * refusing the call, which left the offer unsellable until the key expired.
 * The first mint sends product_data and every later one names the Product it
 * made, so a $99 → $149 → $99 repricing in one day replayed the $99 key.
 */
function offer(overrides: Partial<OfferRow> = {}): OfferRow {
  return {
    id: 7,
    title: "Coaching",
    slug: "coaching",
    currency: "usd",
    amount_cents: 9900,
    interval: "month",
    interval_count: 1,
    stripe_price_id: null,
    stripe_product_id: null,
    ...overrides,
  } as OfferRow;
}

describe("recurringPriceRequest", () => {
  it("keys the first mint apart from a later one that reuses the Product", () => {
    const first = recurringPriceRequest(offer(), undefined);
    const again = recurringPriceRequest(offer({ stripe_product_id: "prod_1" }), undefined);

    expect(first.params).toHaveProperty("product_data");
    expect(again.params).toMatchObject({ product: "prod_1" });
    expect(again.idempotencyKey).not.toBe(first.idempotencyKey);
  });

  it("gives identical requests one key so concurrent first sales share a Price", () => {
    expect(recurringPriceRequest(offer(), "BOSS").idempotencyKey).toBe(
      recurringPriceRequest(offer(), "BOSS").idempotencyKey,
    );
  });

  it("changes the key with anything else the request carries", () => {
    const base = recurringPriceRequest(offer(), undefined).idempotencyKey;
    expect(recurringPriceRequest(offer({ amount_cents: 14900 }), undefined).idempotencyKey).not.toBe(base);
    expect(recurringPriceRequest(offer({ title: "Coaching Plus" }), undefined).idempotencyKey).not.toBe(base);
    expect(recurringPriceRequest(offer(), "BOSS").idempotencyKey).not.toBe(base);
  });
});
