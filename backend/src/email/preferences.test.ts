import { describe, expect, it, vi, beforeEach } from "vitest";
import { marketingBlockReason } from "./provider";

/**
 * The bug these pin: there are two preference stores.
 *
 * The email-link preference centre writes `contact_email_preferences`, keyed by
 * contact and by this file's topic names. The member portal at /account writes
 * `member_email_preferences`, keyed by member and by its own names. Only the
 * community digest job ever read the second one, so a member who turned
 * "course and product updates" off in their account went on receiving every
 * campaign — nothing on the sending path had looked.
 */

const query = vi.fn();
vi.mock("../db/pool", () => ({ pool: { query: (...args: unknown[]) => query(...args) } }));
vi.mock("../config/env", () => ({
  env: {
    smtp: { host: "smtp.example.com", port: 587, user: "u", pass: "p", from: "a@b.c" },
    ses: { transactionalConfigSet: "", marketingConfigSet: "", snsTopicArn: "" },
    publicSiteUrl: "https://example.test",
  },
}));

/** Routes each query to a canned answer by matching the SQL. */
function respond(plan: {
  suppressed?: boolean;
  status?: string;
  contactTopicOff?: boolean;
  memberTopicOff?: boolean;
}) {
  query.mockImplementation((sql: string) => {
    const text = String(sql).replace(/\s+/g, " ");
    if (text.includes("email_suppressions")) {
      return Promise.resolve({
        rows: plan.suppressed ? [{ reason: "bounce" }] : [],
        rowCount: plan.suppressed ? 1 : 0,
      });
    }
    if (text.includes("email_marketing_status")) {
      return Promise.resolve({
        rows: [{ email_marketing_status: plan.status ?? "subscribed" }],
        rowCount: 1,
      });
    }
    if (text.includes("contact_email_preferences")) {
      return Promise.resolve({
        rows: plan.contactTopicOff ? [{ subscribed: false }] : [],
        rowCount: plan.contactTopicOff ? 1 : 0,
      });
    }
    if (text.includes("member_email_preferences")) {
      return Promise.resolve({
        rows: plan.memberTopicOff ? [{ n: 1 }] : [],
        rowCount: plan.memberTopicOff ? 1 : 0,
      });
    }
    return Promise.resolve({ rows: [], rowCount: 0 });
  });
}

beforeEach(() => query.mockReset());

describe("marketing eligibility", () => {
  it("lets a subscribed contact through", async () => {
    respond({});
    expect(await marketingBlockReason("a@b.c", 5, "marketing")).toBeNull();
  });

  it("honours a switch turned off in the email preference centre", async () => {
    respond({ contactTopicOff: true });
    expect(await marketingBlockReason("a@b.c", 5, "marketing")).toBe(
      "unsubscribed from marketing",
    );
  });

  it("honours a switch turned off in the MEMBER portal", async () => {
    // The regression. Before this, the member's own choice was invisible here.
    respond({ memberTopicOff: true });
    expect(await marketingBlockReason("a@b.c", 5, "marketing")).toBe(
      "unsubscribed from marketing in their account",
    );
  });

  it("maps each sending topic to the member portal's own name", async () => {
    respond({ memberTopicOff: true });
    // product -> course_updates, community -> community_digest
    expect(await marketingBlockReason("a@b.c", 5, "product")).toContain("in their account");
    expect(await marketingBlockReason("a@b.c", 5, "community")).toContain("in their account");
  });

  it("does not map 'events' to an approximation", async () => {
    // Mapping it to product news would let somebody who muted course updates
    // stop getting reminders for a webinar they registered for.
    respond({ memberTopicOff: true });
    expect(await marketingBlockReason("a@b.c", 5, "events")).toBeNull();
  });

  it("stops at the suppression list before asking anything else", async () => {
    respond({ suppressed: true });
    expect(await marketingBlockReason("a@b.c", 5, "marketing")).toBe("suppressed (bounce)");
  });

  it("refuses an unsubscribed contact whatever the topic says", async () => {
    respond({ status: "unsubscribed" });
    expect(await marketingBlockReason("a@b.c", 5, "marketing")).toBe("contact is unsubscribed");
  });

  it("has nothing to check without a contact", async () => {
    respond({});
    expect(await marketingBlockReason("a@b.c", null, "marketing")).toBeNull();
  });
});
