import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * QA row 230: "Is there a way to end the email sequence if a customer purchases
 * the club, lounge or boardroom but cancels or card is declined?"
 *
 * The decision is pinned as a pure function; the send path is then driven
 * against a scripted database so the two things that matter are proven end to
 * end: an ended purchase sends nothing and exits with its reason, and a failing
 * renewal holds the same email for later instead of dropping it.
 */

const state = vi.hoisted(() => ({
  queries: [] as Array<{ sql: string; params: unknown[] }>,
  standing: {
    has_live_access: true,
    order_refunded: false,
    ended_reason: "",
    payment_failing: false,
  },
  sourceOfferId: 40 as number | null,
  sendEmail: vi.fn(),
  publishDomainEvent: vi.fn(),
}));

function answer(sql: string, params: unknown[]) {
  state.queries.push({ sql, params });
  const text = sql.replace(/\s+/g, " ");
  if (/^(BEGIN|COMMIT|ROLLBACK)/.test(text.trim())) return { rows: [], rowCount: 0 };
  if (text.includes("FROM sequence_subscriptions WHERE id = $1 FOR UPDATE")) {
    return {
      rows: [
        {
          id: "77",
          sequence_id: 485,
          contact_id: 9,
          status: "active",
          position: 2,
          next_send_at: new Date("2026-11-01T00:00:00Z"),
          source_offer_id: state.sourceOfferId,
        },
      ],
      rowCount: 1,
    };
  }
  if (text.includes("FROM email_sequences WHERE id = $1")) {
    return {
      rows: [
        {
          id: 485,
          name: "The Lounge-Purchase",
          status: "active",
          topic: "marketing",
          skip_weekends: false,
          send_window_start_minute: null,
          send_window_end_minute: null,
          use_contact_timezone: false,
          timezone: "America/Los_Angeles",
          exit_on_purchase: false,
          exit_tag_id: null,
          completion_tag_id: null,
          allow_reentry: false,
          requires_offer_id: null,
        },
      ],
      rowCount: 1,
    };
  }
  if (text.includes("FROM contacts WHERE id = $1")) {
    return {
      rows: [
        {
          email: "buyer@example.com",
          name: "Buyer",
          first_name: "Buy",
          last_name: "Er",
          timezone: "",
          email_marketing_status: "subscribed",
          custom_fields: {},
        },
      ],
      rowCount: 1,
    };
  }
  if (text.includes("AS has_live_access")) {
    return { rows: [{ id: "77", sequence_id: 485, contact_id: 9, ...state.standing }], rowCount: 1 };
  }
  if (text.includes("FROM sequence_emails")) {
    // Reaching the email lookup means the guard let the send through; an empty
    // answer ends the step there without needing the whole send path mocked.
    return { rows: [], rowCount: 0 };
  }
  return { rows: [], rowCount: 1 };
}

vi.mock("../db/pool", () => ({
  pool: {
    query: vi.fn(async (sql: string, params: unknown[] = []) => answer(sql, params)),
    connect: vi.fn(async () => ({
      query: vi.fn(async (sql: string, params: unknown[] = []) => answer(sql, params)),
      release: vi.fn(),
    })),
  },
}));
vi.mock("../email/provider", () => ({
  mergeLinks: (s: string) => s,
  renderMarkdown: (s: string) => s,
  renderTokens: (s: string) => s,
  sendEmail: state.sendEmail,
}));
vi.mock("../email/mergeValues", () => ({ buildMergeValues: () => ({}) }));
vi.mock("../jobs/queue", () => ({ PRIORITY: { normal: 5, bulk: 1 }, enqueueMany: vi.fn(async () => 0) }));
vi.mock("./drip", () => ({ zonedWallClockToUtc: vi.fn() }));
vi.mock("./contacts", () => ({ applyTags: vi.fn(), recordActivity: vi.fn() }));
vi.mock("./domainEvents", () => ({ publishDomainEvent: state.publishDomainEvent }));

import {
  PAYMENT_HOLD_MINUTES,
  PAYMENT_PAUSE_REVOKE_REASON,
  purchaseStanding,
  sendDueEmail,
} from "./sequences";
import { FAILED_PAYMENT_REVOKE_REASON } from "./dunning";

describe("purchaseStanding", () => {
  const live = { hasLiveAccess: true, orderRefunded: false, endedReason: "", paymentFailing: false };

  it("keeps sending while the buyer has their access", () => {
    expect(purchaseStanding(live)).toEqual({ action: "continue" });
  });

  it("stops on a full refund", () => {
    expect(
      purchaseStanding({ ...live, hasLiveAccess: false, orderRefunded: true, endedReason: "refunded" })
    ).toEqual({ action: "exit", reason: "purchase refunded" });
  });

  it("stops when access was taken away, quoting why", () => {
    expect(
      purchaseStanding({ ...live, hasLiveAccess: false, endedReason: "payment plan defaulted" })
    ).toEqual({ action: "exit", reason: "purchase ended: payment plan defaulted" });
    expect(
      purchaseStanding({ ...live, hasLiveAccess: false, endedReason: "access removed" })
    ).toEqual({ action: "exit", reason: "purchase ended: access removed" });
  });

  it("keeps going when the same offer is still held through another purchase", () => {
    // Refunded the first order, bought again: the second grant is live.
    expect(
      purchaseStanding({ ...live, orderRefunded: true, endedReason: "refunded" })
    ).toEqual({ action: "continue" });
  });

  it("holds, rather than ends, while a renewal or installment is failing", () => {
    expect(purchaseStanding({ ...live, paymentFailing: true })).toEqual({
      action: "hold",
      reason: "payment failing",
    });
    // Access paused by "stop access on the first failed payment": no live
    // grant, but the pause is not an ending — invoice.paid gives it back.
    expect(purchaseStanding({ ...live, hasLiveAccess: false, paymentFailing: true })).toEqual({
      action: "hold",
      reason: "payment failing",
    });
  });

  it("ends a run whose failing plan has since defaulted", () => {
    expect(
      purchaseStanding({
        hasLiveAccess: false,
        orderRefunded: false,
        endedReason: "payment plan defaulted",
        paymentFailing: true,
      })
    ).toEqual({ action: "exit", reason: "purchase ended: payment plan defaulted" });
  });

  it("never ends a run on the mere absence of access", () => {
    // Access that ran its course, or an offer that grants nothing tied to it:
    // no evidence of a cancellation, so the run carries on as it always did.
    expect(
      purchaseStanding({ hasLiveAccess: false, orderRefunded: false, endedReason: "", paymentFailing: false })
    ).toEqual({ action: "continue" });
  });

  it("uses the same pause reason the dunning code writes and restores from", () => {
    expect(PAYMENT_PAUSE_REVOKE_REASON).toBe(FAILED_PAYMENT_REVOKE_REASON);
  });
});

describe("sendDueEmail for a run a purchase started", () => {
  beforeEach(() => {
    state.queries = [];
    state.sendEmail.mockReset();
    state.publishDomainEvent.mockReset();
    state.publishDomainEvent.mockResolvedValue({ id: "1", created: true });
    state.sourceOfferId = 40;
    state.standing = { has_live_access: true, order_refunded: false, ended_reason: "", payment_failing: false };
  });

  const now = new Date("2026-11-16T12:00:00Z");
  const updates = () =>
    state.queries.filter((q) => /UPDATE sequence_subscriptions/.test(q.sql));

  it("exits a refunded purchase's run and sends nothing", async () => {
    state.standing = { has_live_access: false, order_refunded: true, ended_reason: "refunded", payment_failing: false };

    const result = await sendDueEmail(77, now);

    expect(result.outcome).toBe("exited");
    expect(result.detail).toBe("purchase refunded");
    expect(state.sendEmail).not.toHaveBeenCalled();
    const exit = updates().find((q) => /status = 'exited'/.test(q.sql));
    expect(exit?.params).toEqual(["77", "purchase refunded"]);
    // Leaving early is the "sequence_unsubscribed" trigger, as every other exit is.
    expect(state.publishDomainEvent).toHaveBeenCalledWith(
      "sequence_unsubscribed",
      expect.objectContaining({ contactId: 9, subjectId: 485 })
    );
  });

  it("exits when the plan defaulted or a subscription's access ended", async () => {
    state.standing = {
      has_live_access: false,
      order_refunded: false,
      ended_reason: "payment plan defaulted",
      payment_failing: false,
    };

    const result = await sendDueEmail(77, now);

    expect(result).toMatchObject({ outcome: "exited", detail: "purchase ended: payment plan defaulted" });
    expect(state.sendEmail).not.toHaveBeenCalled();
  });

  it("holds the same email for a day while the renewal is failing", async () => {
    state.standing = { has_live_access: true, order_refunded: false, ended_reason: "", payment_failing: true };

    const result = await sendDueEmail(77, now);

    expect(result).toMatchObject({ outcome: "skipped", detail: "on hold — payment failing" });
    expect(state.sendEmail).not.toHaveBeenCalled();
    const hold = updates().find((q) => /SET next_send_at = \$2/.test(q.sql));
    expect(hold?.params).toEqual(["77", new Date(now.getTime() + PAYMENT_HOLD_MINUTES * 60_000)]);
    // Not an exit: status and position are untouched.
    expect(updates().some((q) => /status = 'exited'/.test(q.sql))).toBe(false);
    expect(state.publishDomainEvent).not.toHaveBeenCalled();
  });

  it("carries on to the email while the purchase stands", async () => {
    const result = await sendDueEmail(77, now);

    expect(result.outcome).not.toBe("exited");
    expect(state.queries.some((q) => /FROM sequence_emails/.test(q.sql))).toBe(true);
    expect(updates().some((q) => /status = 'exited'/.test(q.sql))).toBe(false);
  });

  it("does not look at purchases for a run no purchase started", async () => {
    state.sourceOfferId = null;
    state.standing = { has_live_access: false, order_refunded: true, ended_reason: "refunded", payment_failing: false };

    await sendDueEmail(77, now);

    expect(state.queries.some((q) => /AS has_live_access/.test(q.sql))).toBe(false);
    expect(updates().some((q) => /status = 'exited'/.test(q.sql))).toBe(false);
  });
});
