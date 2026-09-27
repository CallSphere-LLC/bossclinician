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
});
