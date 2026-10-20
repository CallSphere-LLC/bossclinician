import { beforeEach, describe, expect, it, vi } from "vitest";

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("../../db/pool", () => ({ pool: { query, connect: vi.fn() } }));
vi.mock("../../stripe/client", () => ({ stripe: vi.fn() }));

import { buildOfferView, optionDuplicatingBasePrice, type OfferPricingOptionRow, type OfferRow } from "./offers";

/** Offer 121's shape: its own price is $77, and two options sit beside it. */
function offer(overrides: Partial<OfferRow> = {}): OfferRow {
  return {
    id: 121,
    title: "Audit-Proof Your Practice",
    slug: "audit-proof-your-practice-on-demand-free",
    description: "",
    checkout_headline: "",
    thumbnail_url: "",
    currency: "usd",
    pricing_type: "one_time",
    amount_cents: 7700,
    min_amount_cents: 0,
    interval: null,
    interval_count: 1,
    installment_count: null,
    trial_days: 0,
    collect_tax: false,
    collect_address: false,
    collect_phone: false,
    custom_fields: [],
    terms_url: "",
    require_terms: false,
    allow_gifting: true,
    redirect_url: "",
    thank_you_page_id: null,
    access_expires_after_days: null,
    stripe_price_id: null,
    stripe_product_id: null,
    ...overrides,
  };
}

function option(overrides: Partial<OfferPricingOptionRow>): OfferPricingOptionRow {
  return {
    id: 1,
    offer_id: 121,
    label: "",
    pricing_type: "one_time",
    amount_cents: 7700,
    min_amount_cents: 0,
    currency: "usd",
    interval: null,
    interval_count: 1,
    installment_count: null,
    trial_days: 0,
    recommended: false,
    active: true,
    stripe_price_id: null,
    stripe_product_id: null,
    sort: 0,
    ...overrides,
  };
}

const CE = option({ id: 501, label: "Training + CE Credit", amount_cents: 7700, recommended: true, sort: 0 });
const EDU = option({ id: 502, label: "Educational Access | No CE Credit", amount_cents: 5700, sort: 1 });

/** Every query answers empty except the pricing options. */
function withOptions(options: OfferPricingOptionRow[]) {
  query.mockImplementation(async (sql: string) =>
    /FROM offer_pricing_options/.test(sql) ? { rows: options } : { rows: [] },
  );
}

beforeEach(() => query.mockReset());

describe("optionDuplicatingBasePrice", () => {
  it("finds the option that charges exactly the offer's own price", () => {
    expect(optionDuplicatingBasePrice(offer(), [EDU, CE])?.id).toBe(501);
  });

  it("ignores options that differ in amount, kind, currency or cadence", () => {
    expect(optionDuplicatingBasePrice(offer(), [EDU])).toBeUndefined();
    expect(optionDuplicatingBasePrice(offer(), [option({ currency: "cad" })])).toBeUndefined();
    expect(
      optionDuplicatingBasePrice(offer(), [option({ pricing_type: "payment_plan", interval: "month", installment_count: 3 })]),
    ).toBeUndefined();
    const plan = offer({ pricing_type: "payment_plan", interval: "month", installment_count: 3, amount_cents: 2600 });
    expect(
      optionDuplicatingBasePrice(plan, [option({ pricing_type: "payment_plan", interval: "month", installment_count: 4, amount_cents: 2600 })]),
    ).toBeUndefined();
    expect(
      optionDuplicatingBasePrice(plan, [option({ id: 9, pricing_type: "payment_plan", interval: "month", installment_count: 3, amount_cents: 2600 })])?.id,
    ).toBe(9);
  });

  it("matches currency case-insensitively", () => {
    expect(optionDuplicatingBasePrice(offer({ currency: "USD" }), [CE])?.id).toBe(501);
  });
});

describe("buildOfferView pricing choices", () => {
  it("leaves out the offer's own price when an option repeats it", async () => {
    withOptions([CE, EDU]);
    const view = await buildOfferView(offer(), null);
    const choices = view.pricingOptions as { id: number | null; label: string; recommended: boolean; amountCents: number }[];
    expect(choices.map((c) => [c.id, c.label, c.amountCents, c.recommended])).toEqual([
      [501, "Training + CE Credit", 7700, true],
      [502, "Educational Access | No CE Credit", 5700, false],
    ]);
    expect(view.selectedPricingOptionId).toBe(501);
  });

  it("selects the stand-in when nothing is recommended or ?option=0 is asked for", async () => {
    const plainCe = { ...CE, recommended: false };
    withOptions([plainCe, EDU]);
    expect((await buildOfferView(offer(), null)).selectedPricingOptionId).toBe(501);
    expect((await buildOfferView(offer(), null, null)).selectedPricingOptionId).toBe(501);
    expect((await buildOfferView(offer(), null, 502)).selectedPricingOptionId).toBe(502);
  });

  it("keeps the offer's own price as a choice when no option repeats it", async () => {
    withOptions([EDU]);
    const view = await buildOfferView(offer(), null);
    const choices = view.pricingOptions as { id: number | null; label: string; recommended: boolean }[];
    expect(choices.map((c) => [c.id, c.label, c.recommended])).toEqual([
      [null, "Pay in full", true],
      [502, "Educational Access | No CE Credit", false],
    ]);
    expect(view.selectedPricingOptionId).toBeNull();
  });
});
