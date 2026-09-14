import { beforeEach, describe, expect, it, vi } from "vitest";

const { query, readSetting, invoicesRetrieve, invoicesPay, subscriptionsCancel } = vi.hoisted(() => ({
  query: vi.fn(),
  readSetting: vi.fn(),
  invoicesRetrieve: vi.fn(),
  invoicesPay: vi.fn(),
  subscriptionsCancel: vi.fn(),
}));

vi.mock("../db/pool", () => ({ pool: { query } }));
vi.mock("./settings", () => ({ readSetting }));
vi.mock("../config/env", () => ({ stripeEnabled: () => true }));
// Stripe is never reached: every call below is a mock, so nothing here can touch
// the account the key in .env belongs to.
vi.mock("../stripe/client", () => ({
  stripe: () => ({
    invoices: { retrieve: invoicesRetrieve, pay: invoicesPay },
    subscriptions: { cancel: subscriptionsCancel },
  }),
}));

import {
  FAILED_PAYMENT_REVOKE_REASON,
  PAYMENT_FAILED_CANCEL_REASON,
  nextRetryDate,
  pauseAccessForFailedPayment,
  restoreAccessAfterPayment,
  scheduleRetryAfterFailure,
  sweepDunning,
} from "./dunning";

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-09-11T12:00:00Z");

type Responder = (sql: string, params: unknown[]) => { rows: unknown[]; rowCount?: number } | undefined;

let responders: Responder[] = [];
function onQuery(match: string, rows: unknown[], rowCount?: number): void {
  responders.push((sql) => (sql.includes(match) ? { rows, rowCount: rowCount ?? rows.length } : undefined));
}

function settings(failed: Record<string, unknown>, customer: Record<string, unknown> = {}): void {
  readSetting.mockImplementation(async (key: string) =>
    key === "failed_payments" ? failed : key === "customer_payments" ? customer : {}
  );
}

const SCHEDULE = { retryMode: "schedule", retryDays: "3, 5, 7", finalAction: "cancel" };

const dueRow = (retries: number) => ({
  id: 11,
  stripe_invoice_id: "in_zz_1",
  retries_made: retries,
  subscription_id: 21,
  payment_plan_id: null,
  stripe_subscription_id: "sub_zz_1",
  subscription_status: "past_due",
});

function callsMatching(match: string): unknown[][] {
  return query.mock.calls.filter(([sql]) => String(sql).includes(match)).map(([, params]) => params as unknown[]);
}

beforeEach(() => {
  responders = [];
  query.mockReset();
  query.mockImplementation(async (sql: string, params: unknown[]) => {
    for (const respond of responders) {
      const hit = respond(sql, params);
      if (hit) return hit;
    }
    return { rows: [], rowCount: 0 };
  });
  readSetting.mockReset();
  invoicesRetrieve.mockReset();
  invoicesPay.mockReset();
  subscriptionsCancel.mockReset();
});

describe("retry dates", () => {
  const policy = { mode: "schedule" as const, retryDays: [3, 5, 7], finalAction: "cancel" as const };

  it("counts each gap from the failure that just happened", () => {
    expect(nextRetryDate(policy, 0, NOW)?.getTime()).toBe(NOW.getTime() + 3 * DAY);
    expect(nextRetryDate(policy, 2, NOW)?.getTime()).toBe(NOW.getTime() + 7 * DAY);
  });

  it("has no next date once the schedule is used up, or when Stripe retries", () => {
    expect(nextRetryDate(policy, 3, NOW)).toBeNull();
    expect(nextRetryDate({ ...policy, mode: "stripe" }, 0, NOW)).toBeNull();
  });
});

describe("booking a retry from the payment-failed webhook", () => {
  it("leaves Stripe's own retries alone by default", async () => {
    settings({ retryMode: "stripe" });
    await expect(scheduleRetryAfterFailure({ stripeInvoiceId: "in_zz_1", failedAt: NOW })).resolves.toEqual({
      managed: false,
      nextAttemptAt: null,
    });
    expect(query).not.toHaveBeenCalled();
  });

  it("books the first gap on the owner's schedule", async () => {
    settings(SCHEDULE);
    onQuery("SELECT id, retries_made", [
      { id: 11, retries_made: 0, next_retry_at: null, dunning_ended_at: null, status: "failed" },
    ]);
    const booked = await scheduleRetryAfterFailure({ stripeInvoiceId: "in_zz_1", failedAt: NOW });
    expect(booked.managed).toBe(true);
    expect(booked.nextAttemptAt?.getTime()).toBe(NOW.getTime() + 3 * DAY);
    const [params] = callsMatching("UPDATE invoices SET next_retry_at");
    expect(params).toEqual([11, new Date(NOW.getTime() + 3 * DAY)]);
  });

  it("keeps a retry the sweep has already booked", async () => {
    settings(SCHEDULE);
    const booked = new Date(NOW.getTime() + 5 * DAY);
    onQuery("SELECT id, retries_made", [
      { id: 11, retries_made: 1, next_retry_at: booked, dunning_ended_at: null, status: "failed" },
    ]);
    await expect(scheduleRetryAfterFailure({ stripeInvoiceId: "in_zz_1", failedAt: NOW })).resolves.toEqual({
      managed: true,
      nextAttemptAt: booked,
    });
    expect(callsMatching("UPDATE invoices SET next_retry_at")).toHaveLength(0);
  });
});

describe("the dunning sweep", () => {
  it("does nothing while Stripe is the one retrying", async () => {
    settings({ retryMode: "stripe" });
    await sweepDunning(NOW);
    expect(invoicesPay).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  it("pays a due invoice and gives paused access back", async () => {
    settings(SCHEDULE);
    onQuery("FROM invoices i", [dueRow(0)]);
    onQuery("SET retries_made = retries_made + 1", [{ retries_made: 1 }]);
    invoicesRetrieve.mockResolvedValue({ status: "open" });
    invoicesPay.mockResolvedValue({ status: "paid" });

    const result = await sweepDunning(NOW);

    expect(result).toMatchObject({ retried: 1, recovered: 1, declined: 0 });
    expect(invoicesPay).toHaveBeenCalledWith("in_zz_1", {}, { idempotencyKey: "dunning-retry-in_zz_1-1" });
    expect(callsMatching("SET status = 'active', revoked_at = NULL")).toEqual([[21, FAILED_PAYMENT_REVOKE_REASON]]);
  });

  it("does not charge an invoice the customer has already paid", async () => {
    settings(SCHEDULE);
    onQuery("FROM invoices i", [dueRow(1)]);
    onQuery("SET retries_made = retries_made + 1", [{ retries_made: 2 }]);
    invoicesRetrieve.mockResolvedValue({ status: "paid" });

    const result = await sweepDunning(NOW);

    expect(invoicesPay).not.toHaveBeenCalled();
    expect(result.recovered).toBe(1);
  });

  it("books the next gap when a retry is declined", async () => {
    settings(SCHEDULE);
    onQuery("FROM invoices i", [dueRow(0)]);
    onQuery("SET retries_made = retries_made + 1", [{ retries_made: 1 }]);
    invoicesRetrieve.mockResolvedValue({ status: "open" });
    invoicesPay.mockRejectedValue(Object.assign(new Error("Your card was declined."), { type: "StripeCardError" }));

    const result = await sweepDunning(NOW);

    expect(result).toMatchObject({ retried: 1, declined: 1, canceled: 0 });
    expect(callsMatching("SET last_retry_error")).toEqual([
      [11, "Your card was declined.", new Date(NOW.getTime() + 5 * DAY)],
    ]);
    expect(subscriptionsCancel).not.toHaveBeenCalled();
  });

  it("cancels the membership when the last retry is declined, if the owner chose that", async () => {
    settings(SCHEDULE);
    onQuery("FROM invoices i", [dueRow(2)]);
    onQuery("SET retries_made = retries_made + 1", [{ retries_made: 3 }]);
    invoicesRetrieve.mockResolvedValue({ status: "open" });
    invoicesPay.mockRejectedValue(new Error("Your card was declined."));

    const result = await sweepDunning(NOW);

    expect(result).toMatchObject({ declined: 1, canceled: 1 });
    expect(subscriptionsCancel).toHaveBeenCalledWith(
      "sub_zz_1",
      expect.objectContaining({ cancellation_details: expect.any(Object) }),
      { idempotencyKey: "dunning-cancel-in_zz_1" }
    );
    expect(callsMatching("SET status = 'canceled'")[0]).toEqual([21, PAYMENT_FAILED_CANCEL_REASON]);
  });

  it("stops without cancelling when the owner chose to leave it overdue", async () => {
    settings({ ...SCHEDULE, finalAction: "leave" });
    onQuery("FROM invoices i", [dueRow(3)]);

    const result = await sweepDunning(NOW);

    expect(result).toMatchObject({ exhausted: 1, canceled: 0 });
    expect(subscriptionsCancel).not.toHaveBeenCalled();
    expect(invoicesPay).not.toHaveBeenCalled();
  });
});

describe("pausing access on the first failed payment", () => {
  it("does nothing unless the owner turned it on", async () => {
    settings(SCHEDULE, { revokeOnFirstFailedPayment: false });
    await expect(pauseAccessForFailedPayment(21)).resolves.toBe(0);
    expect(query).not.toHaveBeenCalled();
  });

  it("pauses the subscription's grants under a reason the restore can find", async () => {
    settings(SCHEDULE, { revokeOnFirstFailedPayment: true });
    onQuery("WHERE subscription_id = $1 AND status = 'active'", [], 2);
    await expect(pauseAccessForFailedPayment(21)).resolves.toBe(2);
    expect(callsMatching("SET status = 'revoked'")[0]).toEqual([21, FAILED_PAYMENT_REVOKE_REASON]);
  });

  it("restores only what the pause took", async () => {
    onQuery("SET status = 'active', revoked_at = NULL", [], 1);
    await expect(restoreAccessAfterPayment(21)).resolves.toBe(1);
    expect(callsMatching("g.revoke_reason = $2")[0]).toEqual([21, FAILED_PAYMENT_REVOKE_REASON]);
  });
});
