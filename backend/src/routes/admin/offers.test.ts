import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
vi.mock("../../db/pool", () => ({ pool: { query: (...args: unknown[]) => query(...args) } }));
vi.mock("../../services/adminAudit", () => ({ recordAdminAction: vi.fn() }));
vi.mock("../../services/purchaseDelivery", () => ({ deliverManualGrant: vi.fn() }));
vi.mock("../../services/access", () => ({ grantOfferAccess: vi.fn(), revokeOfferAccess: vi.fn() }));

import { adminOffersRouter } from "./offers";

/** Runs the PUT /:id handler the way Express would, and reports what it did. */
async function put(id: string, body: unknown) {
  const layer = (adminOffersRouter.stack as any[]).find(
    (l) => l.route?.path === "/:id" && l.route.methods.put,
  );
  const handler = layer.route.stack[0].handle;
  return new Promise<{ status?: number; body?: unknown; error?: any }>((resolve) => {
    const res: any = {
      statusCode: 200,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(payload: unknown) {
        resolve({ status: this.statusCode, body: payload });
        return this;
      },
    };
    handler({ params: { id }, body } as any, res, (error: unknown) => resolve({ error }));
  });
}

/** A live payment plan saved before plans were refused a free trial. */
const legacyPlan = {
  id: 7,
  title: "Full Practice Reset — 3 payments",
  internal_title: "",
  slug: "reset-plan",
  status: "published",
  description: "",
  checkout_headline: "",
  thumbnail_url: "",
  currency: "usd",
  pricing_type: "payment_plan",
  amount_cents: 125000,
  min_amount_cents: 0,
  interval: "month",
  interval_count: 1,
  installment_count: 3,
  trial_days: 14,
  collect_tax: false,
  collect_address: false,
  collect_phone: false,
  custom_fields: [],
  terms_url: "",
  require_terms: false,
  redirect_url: "",
  thank_you_page_id: null,
  access_expires_after_days: null,
  send_welcome_email: true,
  allow_gifting: true,
  welcome_next_steps: "",
  stripe_price_id: "price_123",
  stripe_product_id: "prod_123",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

describe("PUT /admin/offers/:id", () => {
  beforeEach(() => query.mockReset());

  it("lets a live offer that predates a pricing rule go back to a draft", async () => {
    query.mockResolvedValueOnce({ rows: [legacyPlan] });
    query.mockResolvedValueOnce({ rows: [{ ...legacyPlan, status: "draft" }] });
    const { error, body } = await put("7", { status: "draft" });
    expect(error).toBeUndefined();
    expect((body as { status: string }).status).toBe("draft");
  });

  it("still refuses an edit to the price that breaks the rule", async () => {
    query.mockResolvedValueOnce({ rows: [legacyPlan] });
    const { error } = await put("7", { trialDays: 7 });
    expect(error?.status).toBe(400);
    expect(error?.message).toMatch(/cannot have a free trial/);
  });

  it("saves the internal title without touching the checkout title", async () => {
    query.mockResolvedValueOnce({ rows: [legacyPlan] });
    query.mockResolvedValueOnce({ rows: [{ ...legacyPlan, internal_title: "Reset — 3-pay (2026)" }] });
    const { error, body } = await put("7", { internalTitle: "  Reset — 3-pay (2026)  " });
    expect(error).toBeUndefined();
    const [sql, params] = query.mock.calls[1] as [string, unknown[]];
    expect(sql).toMatch(/internal_title\s+= \$30/);
    expect(params[29]).toBe("Reset — 3-pay (2026)");
    expect(params[0]).toBe(legacyPlan.title);
    expect((body as { internalTitle: string }).internalTitle).toBe("Reset — 3-pay (2026)");
  });

  it("refuses an internal title longer than Kajabi's 150 characters", async () => {
    const { error } = await put("7", { internalTitle: "x".repeat(151) });
    expect(error?.status).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });
});

/** Runs the GET / handler the way Express would. */
async function list(queryString: Record<string, string> = {}) {
  const layer = (adminOffersRouter.stack as any[]).find(
    (l) => l.route?.path === "/" && l.route.methods.get,
  );
  const handler = layer.route.stack[0].handle;
  return new Promise<{ body?: unknown; error?: any }>((resolve) => {
    const res: any = {
      status() {
        return this;
      },
      json(payload: unknown) {
        resolve({ body: payload });
        return this;
      },
    };
    handler({ query: queryString } as any, res, (error: unknown) => resolve({ error }));
  });
}

describe("GET /admin/offers", () => {
  beforeEach(() => query.mockReset());

  it("counts sales imported from Kajabi alongside paid orders", async () => {
    query.mockResolvedValueOnce({ rows: [{ ...legacyPlan, purchase_count: 21, products: [] }] });
    const { error, body } = await list();
    expect(error).toBeUndefined();
    const sql = String(query.mock.calls[0][0]);
    expect(sql).toMatch(/FROM orders ord\s+WHERE ord\.offer_id = o\.id AND ord\.status = 'paid'/);
    expect(sql).toMatch(/COUNT\(DISTINCT pur\.contact_id\)::int FROM purchases pur\s+WHERE pur\.offer_id = o\.id AND pur\.source = 'kajabi'/);
    expect((body as Array<{ purchaseCount: number }>)[0].purchaseCount).toBe(21);
  });

  it("searches the internal title as well as the checkout title", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const { error } = await list({ q: "3-pay" });
    expect(error).toBeUndefined();
    const sql = String(query.mock.calls[0][0]);
    expect(sql).toMatch(/o\.title ILIKE \$1 OR o\.internal_title ILIKE \$1 OR o\.slug ILIKE \$1/);
    expect(sql).toMatch(/o\.internal_title,/);
  });
});
