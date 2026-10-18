import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Stripe Payment Links (QA row 92). Stripe and Postgres are both mocked: no
 * request here reaches Stripe (the account is live) or a database.
 */

const { query, connect, pricesCreate, linksCreate, linksUpdate, loadPublishedOfferById, selectOfferPricing } =
  vi.hoisted(() => ({
    query: vi.fn(),
    connect: vi.fn(),
    pricesCreate: vi.fn(),
    linksCreate: vi.fn(),
    linksUpdate: vi.fn(),
    loadPublishedOfferById: vi.fn(),
    selectOfferPricing: vi.fn(),
  }));

vi.mock("../db/pool", () => ({ pool: { query, connect } }));
vi.mock("../stripe/client", () => ({
  stripe: () => ({
    prices: { create: pricesCreate },
    paymentLinks: { create: linksCreate, update: linksUpdate },
  }),
}));
vi.mock("./settings", () => ({ readSetting: vi.fn(async () => ({ statementDescriptor: "" })) }));
vi.mock("./paymentRules", () => ({ cleanStatementDescriptor: () => undefined }));
vi.mock("./downloadReadiness", () => ({ assertOfferDeliverable: vi.fn(async () => undefined) }));
vi.mock("../routes/public/offers", () => ({ loadPublishedOfferById, selectOfferPricing }));

import {
  createOfferPaymentLink,
  deactivateOfferPaymentLink,
  paymentLinkSupport,
  recordPaymentLinkOrder,
} from "./paymentLinks";

const OFFER = {
  id: 42,
  title: "Practice Reset Intensive",
  slug: "practice-reset-intensive",
  description: "",
  checkout_headline: "",
  thumbnail_url: "",
  currency: "usd",
  pricing_type: "one_time",
  amount_cents: 350000,
  min_amount_cents: 0,
  interval: null,
  interval_count: 1,
  installment_count: null,
  trial_days: 0,
  collect_tax: false,
  collect_address: false,
  collect_phone: true,
  custom_fields: [],
  terms_url: "",
  require_terms: false,
  allow_gifting: false,
  redirect_url: "",
  thank_you_page_id: null,
  access_expires_after_days: null,
  stripe_price_id: null,
  stripe_product_id: "prod_existing",
  pricing_option_id: null,
};

interface Statement {
  sql: string;
  params: unknown[];
}
let statements: Statement[] = [];
let responder: (sql: string, params: unknown[]) => { rows: unknown[]; rowCount?: number } = () => ({ rows: [] });

function run(sql: string, params: unknown[] = []) {
  statements.push({ sql, params });
  const out = responder(sql, params);
  return Promise.resolve({ rowCount: out.rows.length, ...out });
}

beforeEach(() => {
  statements = [];
  responder = () => ({ rows: [] });
  for (const fn of [pricesCreate, linksCreate, linksUpdate, loadPublishedOfferById, selectOfferPricing]) fn.mockReset();
  query.mockImplementation(run);
  connect.mockImplementation(async () => ({ query: run, release: () => undefined }));
  loadPublishedOfferById.mockResolvedValue(OFFER);
  selectOfferPricing.mockImplementation(async (offer: typeof OFFER, id: number | null) => ({ ...offer, pricing_option_id: id }));
  pricesCreate.mockResolvedValue({ id: "price_link_1", product: "prod_existing" });
  linksCreate.mockResolvedValue({ id: "plink_1", url: "https://buy.stripe.com/test_abc" });
  linksUpdate.mockResolvedValue({ id: "plink_1", active: false });
});

describe("paymentLinkSupport", () => {
  it("allows a one-time price and explains every other kind", () => {
    expect(paymentLinkSupport({ pricing_type: "one_time", amount_cents: 350000 })).toEqual({ supported: true });
    for (const pricing_type of ["payment_plan", "subscription", "free", "pwyw"]) {
      const answer = paymentLinkSupport({ pricing_type, amount_cents: 125000 });
      expect(answer.supported).toBe(false);
      expect((answer as { reason: string }).reason).toMatch(/checkout link/);
    }
    expect(paymentLinkSupport({ pricing_type: "one_time", amount_cents: 10 }).supported).toBe(false);
  });
});

describe("createOfferPaymentLink", () => {
  it("mints a one-time Price on the offer's Product and a link labelled with the offer", async () => {
    responder = (sql) => {
      if (sql.includes("INSERT INTO offer_payment_links")) {
        return { rows: [{ id: 1, offer_id: 42, pricing_option_id: null, stripe_payment_link_id: "plink_1", url: "https://buy.stripe.com/test_abc", active: true }] };
      }
      if (sql.includes("COUNT(*)::int AS n")) return { rows: [{ n: 0 }] };
      return { rows: [] };
    };

    const row = await createOfferPaymentLink({ offerId: 42, pricingOptionId: null, createdBy: "owner@example.test" });
    expect(row.url).toBe("https://buy.stripe.com/test_abc");

    const [priceParams, priceOpts] = pricesCreate.mock.calls[0];
    expect(priceParams).toMatchObject({ currency: "usd", unit_amount: 350000, product: "prod_existing" });
    expect(priceParams.recurring).toBeUndefined();
    expect(priceOpts.idempotencyKey).toMatch(/^offer-plink-price-42-/);

    const [linkParams, linkOpts] = linksCreate.mock.calls[0];
    expect(linkParams.line_items).toEqual([{ price: "price_link_1", quantity: 1 }]);
    expect(linkParams.metadata).toMatchObject({ source: "payment_link", offerId: "42", pricingOptionId: "" });
    // The PaymentIntent must not carry offer/order ids: the session owns the order.
    expect(linkParams.payment_intent_data.metadata.offerId).toBeUndefined();
    expect(linkParams.payment_intent_data.metadata.orderId).toBeUndefined();
    expect(linkParams.phone_number_collection).toEqual({ enabled: true });
    expect(linkOpts.idempotencyKey).toBe("offer-plink-42-0-price_link_1-0");

    const insert = statements.find((s) => s.sql.includes("INSERT INTO offer_payment_links"));
    expect(insert?.params.slice(0, 8)).toEqual([42, null, "plink_1", "price_link_1", "https://buy.stripe.com/test_abc", "one_time", 350000, "usd"]);
  });

  it("refuses a payment plan without calling Stripe", async () => {
    selectOfferPricing.mockResolvedValue({ ...OFFER, pricing_type: "payment_plan", amount_cents: 125000, installment_count: 3, pricing_option_id: 12 });
    await expect(createOfferPaymentLink({ offerId: 42, pricingOptionId: 12, createdBy: "" })).rejects.toThrow(/set number of payments/);
    expect(pricesCreate).not.toHaveBeenCalled();
    expect(linksCreate).not.toHaveBeenCalled();
  });

  it("refuses a second live link for the same price without calling Stripe", async () => {
    responder = (sql) => (sql.includes("AND active") ? { rows: [{ "?column?": 1 }] } : { rows: [] });
    await expect(createOfferPaymentLink({ offerId: 42, pricingOptionId: null, createdBy: "" })).rejects.toThrow(/already has a live payment link/);
    expect(pricesCreate).not.toHaveBeenCalled();
  });

  it("refuses an offer that is not published", async () => {
    loadPublishedOfferById.mockResolvedValue(null);
    responder = (sql) => (sql.includes("SELECT 1 FROM offers") ? { rows: [{ "?column?": 1 }] } : { rows: [] });
    await expect(createOfferPaymentLink({ offerId: 42, pricingOptionId: null, createdBy: "" })).rejects.toThrow(/Publish this offer first/);
    expect(pricesCreate).not.toHaveBeenCalled();
  });
});

describe("deactivateOfferPaymentLink", () => {
  it("switches the link off in Stripe before marking it inactive here", async () => {
    responder = (sql) => {
      if (sql.startsWith("SELECT")) return { rows: [{ id: 1, offer_id: 42, stripe_payment_link_id: "plink_1", active: true }] };
      if (sql.startsWith("UPDATE offer_payment_links")) return { rows: [{ id: 1, active: false }] };
      return { rows: [] };
    };
    const row = await deactivateOfferPaymentLink(42, 1);
    expect(linksUpdate).toHaveBeenCalledWith("plink_1", { active: false });
    expect(row.active).toBe(false);
  });

  it("does not touch the database when Stripe refuses", async () => {
    responder = (sql) => (sql.startsWith("SELECT") ? { rows: [{ id: 1, offer_id: 42, stripe_payment_link_id: "plink_1", active: true }] } : { rows: [] });
    linksUpdate.mockRejectedValue(new Error("stripe down"));
    await expect(deactivateOfferPaymentLink(42, 1)).rejects.toThrow("stripe down");
    expect(statements.some((s) => s.sql.startsWith("UPDATE offer_payment_links"))).toBe(false);
  });
});

describe("recordPaymentLinkOrder", () => {
  const session = {
    id: "cs_live_plink_1",
    object: "checkout.session",
    mode: "payment",
    payment_link: "plink_1",
    payment_status: "paid",
    amount_subtotal: 350000,
    amount_total: 350000,
    currency: "usd",
    customer: "cus_123",
    customer_details: {
      email: "Client@Example.test",
      name: "Pat Client",
      phone: "+15555550100",
      address: { line1: "1 Main St", line2: null, city: "Austin", state: "TX", postal_code: "78701", country: "US" },
    },
    total_details: { amount_discount: 0, amount_tax: 0, amount_shipping: 0 },
    metadata: { source: "payment_link", offerId: "42" },
  } as any;

  it("ignores a session that no payment link opened", async () => {
    expect(await recordPaymentLinkOrder({ ...session, payment_link: null })).toBe(false);
    expect(statements).toHaveLength(0);
  });

  it("ignores a link this app did not make", async () => {
    expect(await recordPaymentLinkOrder(session)).toBe(false);
    expect(statements.some((s) => s.sql.includes("INSERT INTO orders"))).toBe(false);
  });

  it("writes a pending order for the link's offer, keyed by the session", async () => {
    responder = (sql) => {
      if (sql.includes("FROM offer_payment_links l")) {
        return { rows: [{ offer_id: 42, pricing_option_id: null, offer_title: "Practice Reset Intensive", option_label: null }] };
      }
      if (sql.includes("INSERT INTO orders")) return { rows: [{ id: 9001 }] };
      return { rows: [] };
    };
    expect(await recordPaymentLinkOrder(session)).toBe(true);

    const order = statements.find((s) => s.sql.includes("INSERT INTO orders"))!;
    expect(order.sql).toContain("'payment_link'");
    expect(order.sql).toContain("ON CONFLICT (stripe_session_id)");
    // offer, option, email (lower-cased), total, currency, subtotal, discount, tax, name, phone, address, session, customer
    expect(order.params[0]).toBe(42);
    expect(order.params[1]).toBeNull();
    expect(order.params[2]).toBe("client@example.test");
    expect(order.params[3]).toBe(350000);
    expect(order.params[8]).toBe("Pat Client");
    expect(JSON.parse(order.params[10] as string)).toMatchObject({ city: "Austin", postalCode: "78701", country: "US" });
    expect(order.params[11]).toBe("cs_live_plink_1");
    expect(order.params[12]).toBe("cus_123");

    const line = statements.find((s) => s.sql.includes("INSERT INTO order_items"))!;
    expect(line.params).toEqual([9001, 42, "Practice Reset Intensive", 350000]);
    expect(statements.some((s) => s.sql === "COMMIT")).toBe(true);
  });

  it("adds nothing on a redelivery that finds the order already written", async () => {
    responder = (sql) =>
      sql.includes("FROM offer_payment_links l")
        ? { rows: [{ offer_id: 42, pricing_option_id: null, offer_title: "Practice Reset Intensive", option_label: null }] }
        : { rows: [] };
    expect(await recordPaymentLinkOrder(session)).toBe(true);
    expect(statements.some((s) => s.sql.includes("INSERT INTO order_items"))).toBe(false);
  });

  it("leaves a subscription-mode session alone", async () => {
    responder = (sql) =>
      sql.includes("FROM offer_payment_links l")
        ? { rows: [{ offer_id: 42, pricing_option_id: null, offer_title: "x", option_label: null }] }
        : { rows: [] };
    expect(await recordPaymentLinkOrder({ ...session, mode: "subscription" })).toBe(false);
    expect(statements.some((s) => s.sql.includes("INSERT INTO orders"))).toBe(false);
  });
});
