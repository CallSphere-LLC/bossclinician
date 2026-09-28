import { describe, expect, it } from "vitest";
import {
  assemblePurchases,
  billingIntervalText,
  customerView,
  findPurchase,
  money,
  paymentsCompleted,
  planPriceText,
  progressText,
  remainingPayments,
  toView,
  transactionLines,
  upcomingText,
  type GrantRow,
  type OrderRow,
  type PaymentLine,
  type PurchaseRecord,
  type PurchaseRow,
  type RawRows,
} from "./purchaseModel";

/*
 * Fixtures are shaped like the five Kajabi payment plans the owner compares
 * against (QA sheet rows 28–31), with invented people: the numbers and dates
 * are the point, not who they belong to.
 */

const EMPTY: RawRows = { purchases: [], orders: [], plans: [], installments: [], grants: [], transactions: [] };

function order(id: number, over: Partial<OrderRow> = {}): OrderRow {
  return {
    id,
    purchase_id: null,
    contact_id: 1,
    member_id: null,
    status: "paid",
    currency: "usd",
    total_cents: 10_000,
    refunded_cents: 0,
    created_at: "2026-08-01T17:00:00Z",
    updated_at: "2026-08-01T17:00:00Z",
    offer_id: null,
    offer_title: null,
    offer_thumbnail_url: null,
    offer_pricing_type: null,
    course_title: "A Course",
    source: "kajabi",
    notes: "",
    custom_field_data: { kajabiType: "One-time" },
    billing_name: "",
    billing_phone: "",
    billing_address: {},
    ...over,
  };
}

function purchase(id: number, over: Partial<PurchaseRow> = {}): PurchaseRow {
  return {
    id,
    contact_id: 1,
    member_id: null,
    offer_id: null,
    offer_title: "Private Room",
    linked_offer_title: null,
    offer_thumbnail_url: null,
    kind: "one_time",
    source: "kajabi",
    external_id: `x:${id}`,
    order_no: null,
    status: "complete",
    purchased_at: "2026-08-13T21:58:00Z",
    ended_at: null,
    quantity: 1,
    price_text: "",
    total_cents: 0,
    currency: "usd",
    setup_fee_cents: 0,
    installment_cents: null,
    installments_total: null,
    installments_paid: null,
    billing_interval: null,
    interval_count: 1,
    trial_days: 0,
    next_payment_at: null,
    next_payment_cents: null,
    paused_by: "",
    access_revoked: false,
    access_revoked_by: "",
    access_starts_on: null,
    access_ends_on: null,
    gift: false,
    customer_details: {},
    meta: {},
    ...over,
  };
}

/** A plan purchase row: $500 setup, n × instalment, 30-day trial — Private/Shared Room terms. */
function plan(id: number, over: Partial<PurchaseRow> = {}): PurchaseRow {
  return purchase(id, {
    kind: "payment_plan",
    status: "active",
    total_cents: 450_000,
    setup_fee_cents: 50_000,
    installment_cents: 40_000,
    installments_total: 10,
    billing_interval: "month",
    trial_days: 30,
    ...over,
  });
}

function planTerms(over: Partial<PurchaseRecord> = {}): PurchaseRecord {
  const [record] = assemblePurchases({ ...EMPTY, purchases: [plan(1)] });
  return { ...record, ...over };
}

function paid(n: number): PaymentLine[] {
  return Array.from({ length: n }, (_, i) => ({
    key: `p${i}`,
    orderId: i + 1,
    kind: "payment" as const,
    status: "paid" as const,
    amountCents: 100,
    currency: "usd",
    at: `2026-0${i + 1}-01T00:00:00.000Z`,
  }));
}

describe("money", () => {
  it("prints Kajabi's money: two decimals, thousands separator, the currency code", () => {
    expect(money(40_000)).toBe("$400.00 USD");
    expect(money(125_000)).toBe("$1,250.00 USD");
    expect(money(0)).toBe("$0.00 USD");
  });
});

describe("plan wording", () => {
  it("words a plan with a setup fee and a trial exactly as Kajabi does", () => {
    expect(planPriceText(planTerms())).toBe(
      "10 monthly payments of $400.00 USD + $500.00 USD setup fee with 30 day trial",
    );
    expect(
      planPriceText(planTerms({ installmentsTotal: 12, installmentCents: 25_000 })),
    ).toBe("12 monthly payments of $250.00 USD + $500.00 USD setup fee with 30 day trial");
  });

  it("leaves out the setup fee and trial when there are none", () => {
    expect(
      planPriceText(planTerms({ installmentsTotal: 3, installmentCents: 125_000, setupFeeCents: 0, trialDays: 0 })),
    ).toBe("3 monthly payments of $1,250.00 USD");
  });

  it("gives the Billing interval line of the detail page", () => {
    expect(billingIntervalText(planTerms())).toBe("Monthly (10 payments of $400.00 USD)");
    expect(billingIntervalText(planTerms({ installmentsTotal: 12, installmentCents: 25_000 }))).toBe(
      "Monthly (12 payments of $250.00 USD)",
    );
  });
});

describe("payments completed", () => {
  // Kajabi's own numbers for the five plans: payments made (incl. setup fee) → remaining.
  const cases: { who: string; setup: number; total: number; payments: number; remaining: number }[] = [
    { who: "Private Room, active (row 28)", setup: 50_000, total: 10, payments: 2, remaining: 9 },
    { who: "Private Room, paused (row 29)", setup: 50_000, total: 10, payments: 1, remaining: 10 },
    { who: "Shared Room, three payments (row 31)", setup: 50_000, total: 12, payments: 3, remaining: 10 },
    { who: "Shared Room, second buyer", setup: 50_000, total: 12, payments: 3, remaining: 10 },
    { who: "Coaching, paid off", setup: 0, total: 3, payments: 3, remaining: 0 },
  ];

  for (const c of cases) {
    it(`does not count the setup fee as an instalment — ${c.who}`, () => {
      const terms = planTerms({ setupFeeCents: c.setup, installmentsTotal: c.total, installmentsPaid: null });
      expect(remainingPayments(terms, paid(c.payments))).toBe(c.remaining);
      expect(paymentsCompleted(terms, paid(c.payments))).toBe(c.total - c.remaining);
    });
  }

  it("says 1/10 for a $500 setup fee and one $400 payment", () => {
    expect(progressText(planTerms({ installmentsPaid: null }), paid(2))).toBe("1/10 payments completed");
  });

  it("prefers the count stored on the purchase over counting payments", () => {
    expect(progressText(planTerms({ installmentsPaid: 4 }), paid(2))).toBe("4/10 payments completed");
  });

  it("never reports more payments than the plan has", () => {
    expect(paymentsCompleted(planTerms({ installmentsTotal: 3, setupFeeCents: 0 }), paid(5))).toBe(3);
  });

  it("has no progress line for a one-time purchase", () => {
    expect(progressText(planTerms({ kind: "one_time" }), paid(1))).toBeNull();
  });
});

describe("upcoming payment", () => {
  it("says Payments paused for a paused plan, whatever is scheduled", () => {
    expect(upcomingText(planTerms({ status: "paused", nextPaymentAt: "2026-10-12T19:00:00.000Z" }))).toBe(
      "Payments paused",
    );
  });

  it("names the amount and the school's calendar day", () => {
    // 2026-10-21 04:00 UTC is still the 20th in Los Angeles.
    expect(
      upcomingText(planTerms({ nextPaymentAt: "2026-10-21T04:00:00.000Z", nextPaymentCents: 25_000 })),
    ).toBe("$250.00 USD on 2026-10-20");
  });

  it("falls back to the instalment amount", () => {
    expect(upcomingText(planTerms({ nextPaymentAt: "2026-10-12T19:00:00.000Z" }))).toBe("$400.00 USD on 2026-10-12");
  });

  it("has nothing to come once a plan is completed", () => {
    expect(upcomingText(planTerms({ status: "completed", nextPaymentAt: null }))).toBe("No upcoming payments");
  });
});

describe("assemblePurchases", () => {
  it("shows a payment plan as ONE purchase however many instalments it has taken (row 31)", () => {
    const rows: RawRows = {
      ...EMPTY,
      purchases: [plan(7, { installments_total: 12, installment_cents: 25_000, total_cents: 350_000, installments_paid: 2 })],
      orders: [
        order(42, { purchase_id: 7, total_cents: 50_000, created_at: "2026-07-22T05:18:00Z" }),
        order(36, { purchase_id: 7, total_cents: 25_000, created_at: "2026-08-21T06:19:00Z" }),
        order(28, { purchase_id: 7, total_cents: 25_000, created_at: "2026-09-21T06:20:00Z" }),
      ],
    };
    const records = assemblePurchases(rows);
    expect(records).toHaveLength(1);
    expect(records[0].payments.map((p) => p.amountCents)).toEqual([50_000, 25_000, 25_000]);
    const view = toView(records[0]);
    expect(view.billing?.progressText).toBe("2/12 payments completed");
    expect(view.plan?.remainingPayments).toBe(10);
    expect(view.paidCents).toBe(100_000);
    expect(view.dateLabel).toBe("Paid on");
    expect(view.totalText).toBe("12 monthly payments of $250.00 USD + $500.00 USD setup fee with 30 day trial");
  });

  it("lists a grant as its own card, newest first, the way Kajabi lists them (row 28)", () => {
    const rows: RawRows = {
      ...EMPTY,
      purchases: [
        plan(1, { installments_paid: 1 }),
        purchase(2, { kind: "grant", status: "granted", purchased_at: "2026-08-17T19:00:00Z" }),
      ],
      orders: [
        order(40, { purchase_id: 1, total_cents: 50_000, created_at: "2026-08-13T21:58:00Z" }),
        order(33, { purchase_id: 1, total_cents: 40_000, created_at: "2026-09-12T22:58:00Z" }),
      ],
    };
    const views = assemblePurchases(rows).map(toView);
    expect(views.map((v) => v.kind)).toEqual(["grant", "payment_plan"]);
    const [grant, planView] = views;
    expect(grant.dateLabel).toBe("Granted on");
    expect(grant.totalText).toBe("Granted");
    expect(grant.pricePill).toBe("Granted");
    expect(grant.priceText).toBe("$0.00");
    expect(grant.billing).toBeNull();
    expect(planView.billing).toMatchObject({ label: "Active", tone: "green", progressText: "1/10 payments completed" });
  });

  it("uses Kajabi's own total words for a grant, and draws a Billing row only where Kajabi did", () => {
    const views = assemblePurchases({
      ...EMPTY,
      purchases: [
        purchase(1, {
          kind: "grant",
          status: "granted",
          purchased_at: "2026-05-20T19:00:00Z",
          meta: { kajabiType: "GRANT", kajabiTotalText: "Granted by automation" },
        }),
        purchase(2, {
          kind: "subscription",
          status: "refunded",
          price_text: "$19.00 USD every month",
          total_cents: 1_900,
          purchased_at: "2026-03-10T00:14:00Z",
          access_revoked: true,
          access_revoked_by: "An Admin (admin@example.com)",
          meta: { kajabiType: "SUBSCRIPTION", kajabiTotalText: "$19.00 USD every month", kajabiBillingStatus: null },
        }),
        plan(3, { meta: { kajabiType: "MULTI-PAY", kajabiBillingStatus: "Active" }, installments_paid: 1 }),
      ],
    }).map(toView);
    const [plan3, grant, sub] = views;
    expect(grant.totalText).toBe("Granted by automation");
    expect(sub).toMatchObject({ totalText: "$19.00 USD every month", priceText: "$19.00 USD every month", billing: null });
    expect(sub.access).toMatchObject({ revoked: true, revokedBy: "An Admin (admin@example.com)" });
    expect(plan3.billing).toMatchObject({ label: "Active", progressText: "1/10 payments completed" });
  });

  it("names who paused a plan and who revoked access (row 29)", () => {
    const rows: RawRows = {
      ...EMPTY,
      purchases: [
        plan(3, {
          status: "paused",
          installments_paid: 0,
          paused_by: "An Admin (admin@example.com)",
          access_revoked: true,
          access_revoked_by: "An Admin (admin@example.com)",
          access_starts_on: "2026-08-10",
          access_ends_on: "2026-08-24",
        }),
      ],
      orders: [order(41, { purchase_id: 3, total_cents: 50_000 })],
    };
    const view = toView(assemblePurchases(rows)[0]);
    expect(view.billing).toMatchObject({ label: "Paused", tone: "gold", pausedBy: "An Admin (admin@example.com)" });
    expect(view.access).toEqual({
      revoked: true,
      revokedBy: "An Admin (admin@example.com)",
      startsOn: "2026-08-10",
      endsOn: "2026-08-24",
    });
    expect(view.plan?.upcomingText).toBe("Payments paused");
    expect(view.plan?.remainingPayments).toBe(10);
  });

  it("treats an order with no purchase row as a purchase of its own", () => {
    const records = assemblePurchases({
      ...EMPTY,
      orders: [order(9, { source: "checkout", custom_field_data: {}, offer_id: 5, offer_title: "A Toolkit", total_cents: 6_700 })],
    });
    expect(records).toHaveLength(1);
    expect(records[0].key).toBe("order-9");
    expect(toView(records[0])).toMatchObject({
      kind: "one_time",
      offerTitle: "A Toolkit",
      totalText: "$67.00 USD",
      priceText: "$67.00 USD",
      billing: null,
    });
  });

  it("leaves unfinished checkouts out, as Kajabi does", () => {
    const records = assemblePurchases({
      ...EMPTY,
      orders: [order(1, { status: "pending" }), order(2, { status: "failed" }), order(3, { status: "expired" })],
    });
    expect(records).toEqual([]);
  });

  it("does not invent a billing interval for a subscription known only from its payment", () => {
    const [record] = assemblePurchases({
      ...EMPTY,
      orders: [order(52, { total_cents: 1_900, custom_field_data: { kajabiType: "Subscription" } })],
    });
    expect(toView(record)).toMatchObject({ kind: "subscription", priceText: "$19.00 USD", totalText: "$19.00 USD" });
  });

  it("keeps a manual purchase's note", () => {
    const [record] = assemblePurchases({
      ...EMPTY,
      orders: [order(4, { source: "manual", notes: "Paid by bank transfer", custom_field_data: {} })],
    });
    expect(record.source).toBe("manual");
    expect(record.note).toBe("Paid by bank transfer");
  });

  it("marks a refunded order refunded and lists the refund after the payment", () => {
    const [record] = assemblePurchases({
      ...EMPTY,
      orders: [order(5, { status: "refunded", refunded_cents: 10_000, updated_at: "2026-08-03T17:00:00Z" })],
      transactions: [
        {
          order_id: 5,
          kind: "refund",
          status: "succeeded",
          amount_cents: 10_000,
          currency: "usd",
          occurred_at: "2026-08-02T17:00:00Z",
          payment_method_brand: "",
          payment_method_last4: "",
        },
      ],
    });
    expect(record.status).toBe("refunded");
    expect(toView(record).billing).toMatchObject({ label: "Refunded" });
    expect(transactionLines(record).map((l) => [l.statusText, l.amountText])).toEqual([
      ["Paid", "$100.00 USD"],
      ["Refunded", "$100.00 USD"],
    ]);
  });

  it("groups Kajabi instalments the backfill has not linked yet into one card per offer", () => {
    const planOrder = (id: number, at: string, cents: number) =>
      order(id, { course_title: "Shared Room", total_cents: cents, created_at: at, custom_field_data: { kajabiType: "Payment Plan" } });
    const records = assemblePurchases({
      ...EMPTY,
      orders: [
        planOrder(28, "2026-09-21T06:20:00Z", 25_000),
        planOrder(42, "2026-07-22T05:18:00Z", 50_000),
        planOrder(36, "2026-08-21T06:19:00Z", 25_000),
        order(50, { course_title: "Something Else" }),
      ],
    });
    expect(records).toHaveLength(2);
    const grouped = records.find((r) => r.kind === "payment_plan") as PurchaseRecord;
    expect(grouped.key).toBe("order-42");
    expect(grouped.orderIds).toEqual([28, 36, 42]);
    expect(findPurchase(records, "order-36")).toBe(grouped);
    const view = toView(grouped);
    expect(view.totalText).toBe("$1,000.00 USD paid so far");
    // Nothing is known about its length or state until the backfill runs.
    expect(view.billing).toBeNull();
    expect(view.plan).toMatchObject({ remainingPayments: null, paymentsCompleted: null, upcomingText: null });
  });

  it("reads a native payment plan through payment_plans, not one order per instalment", () => {
    const records = assemblePurchases({
      ...EMPTY,
      orders: [order(60, { source: "checkout", custom_field_data: {}, offer_title: "Script", total_cents: 2_400 })],
      plans: [
        {
          id: 3,
          order_id: 60,
          installment_cents: 2_400,
          installment_count: 2,
          installments_paid: 1,
          currency: "usd",
          interval: "week",
          interval_count: 1,
          status: "active",
          next_charge_at: "2026-09-08T17:00:00Z",
          completed_at: null,
          canceled_at: null,
        },
      ],
      installments: [
        { payment_plan_id: 3, sequence: 1, amount_cents: 2_400, due_at: "2026-09-01T17:00:00Z", paid_at: "2026-09-01T17:00:00Z", status: "paid" },
        { payment_plan_id: 3, sequence: 2, amount_cents: 2_400, due_at: "2026-09-08T17:00:00Z", paid_at: null, status: "scheduled" },
      ],
    });
    expect(records).toHaveLength(1);
    const view = toView(records[0]);
    expect(view.kind).toBe("payment_plan");
    expect(view.priceText).toBe("2 weekly payments of $24.00 USD");
    expect(view.billing?.progressText).toBe("1/2 payments completed");
    expect(transactionLines(records[0]).map((l) => l.statusText)).toEqual(["Paid", "Upcoming"]);
  });

  it("folds one offer's product grants into one Granted card", () => {
    const grant = (id: number, over: Partial<GrantRow> = {}): GrantRow => ({
      id,
      member_id: 4,
      offer_id: 18,
      offer_title: "A Toolkit",
      offer_thumbnail_url: null,
      granted_at: "2026-09-18T17:00:00Z",
      status: "active",
      revoked_at: null,
      expires_at: null,
      ...over,
    });
    const records = assemblePurchases({ ...EMPTY, grants: [grant(12), grant(11), grant(20, { offer_id: 19, offer_title: "Other" })] });
    expect(records).toHaveLength(2);
    const toolkit = records.find((r) => r.offerId === 18) as PurchaseRecord;
    expect(toolkit.key).toBe("grant-11");
    expect(findPurchase(records, "grant-12")).toBe(toolkit);
    expect(toView(toolkit)).toMatchObject({ dateLabel: "Granted on", totalText: "Granted", access: { startsOn: "2026-09-18" } });
  });

  it("does not show a native grant twice when a purchase row already records it", () => {
    const records = assemblePurchases({
      ...EMPTY,
      purchases: [purchase(1, { kind: "grant", status: "granted", offer_id: 18 })],
      grants: [
        {
          id: 3,
          member_id: 4,
          offer_id: 18,
          offer_title: "A Toolkit",
          offer_thumbnail_url: null,
          granted_at: "2026-09-18T17:00:00Z",
          status: "active",
          revoked_at: null,
          expires_at: null,
        },
      ],
    });
    expect(records).toHaveLength(1);
  });
});

describe("transactionLines", () => {
  it("lists payments oldest first, then the one scheduled payment (row 30)", () => {
    const [record] = assemblePurchases({
      ...EMPTY,
      purchases: [
        plan(7, {
          installments_total: 12,
          installment_cents: 25_000,
          installments_paid: 2,
          next_payment_at: "2026-10-20T19:00:00Z",
          next_payment_cents: 25_000,
        }),
      ],
      orders: [
        order(28, { purchase_id: 7, total_cents: 25_000, created_at: "2026-09-21T06:20:00Z" }),
        order(42, { purchase_id: 7, total_cents: 50_000, created_at: "2026-07-22T05:18:00Z" }),
        order(36, { purchase_id: 7, total_cents: 25_000, created_at: "2026-08-21T06:19:00Z" }),
      ],
    });
    expect(transactionLines(record).map((l) => `${l.amountText} ${l.statusText}`)).toEqual([
      "$500.00 USD Paid",
      "$250.00 USD Paid",
      "$250.00 USD Paid",
      "$250.00 USD Upcoming",
    ]);
  });

  it("schedules nothing for a paused plan", () => {
    const [record] = assemblePurchases({
      ...EMPTY,
      purchases: [plan(3, { status: "paused", next_payment_at: "2026-10-10T19:00:00Z" })],
    });
    expect(transactionLines(record)).toEqual([]);
  });
});

describe("customerView", () => {
  const contact = {
    id: 1,
    name: "Pat Example",
    email: "pat@example.com",
    phone: "555 0100",
    customFields: { Address: "1 Main St", City: "Springfield", State: "OR", "Zip Code": "97000", Country: "US" },
  };

  it("falls back to the contact card for an imported purchase with no billing details", () => {
    const [record] = assemblePurchases({ ...EMPTY, purchases: [plan(1)], orders: [order(2, { purchase_id: 1 })] });
    expect(customerView(contact, record, [order(2, { purchase_id: 1 })], [])).toEqual({
      name: "Pat Example",
      email: "pat@example.com",
      address: ["1 Main St", "Springfield, OR 97000", "US"],
      phone: "555 0100",
      paymentMethod: null,
    });
  });

  it("prefers what checkout captured, and names the card", () => {
    const paidOrder = order(2, {
      source: "checkout",
      billing_phone: "555 0199",
      billing_address: { line1: "9 Elm Rd", city: "Portland", state: "OR", postalCode: "97201", country: "US" },
    });
    const [record] = assemblePurchases({ ...EMPTY, orders: [paidOrder] });
    const view = customerView(contact, record, [paidOrder], [
      {
        order_id: 2,
        kind: "payment",
        status: "succeeded",
        amount_cents: 10_000,
        currency: "usd",
        occurred_at: "2026-08-01T17:00:00Z",
        payment_method_brand: "visa",
        payment_method_last4: "4242",
      },
    ]);
    expect(view.address).toEqual(["9 Elm Rd", "Portland, OR 97201", "US"]);
    expect(view.phone).toBe("555 0199");
    expect(view.paymentMethod).toBe("Visa •••• 4242");
  });
});
