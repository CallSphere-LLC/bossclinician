import { beforeEach, describe, expect, it, vi } from "vitest";

const { query, sendEmail } = vi.hoisted(() => ({ query: vi.fn(), sendEmail: vi.fn() }));

vi.mock("../db/pool", () => ({ pool: { query } }));
vi.mock("../email/provider", () => ({ sendEmail, renderMarkdown: (text: string) => text }));
vi.mock("../config/env", () => ({ env: { publicSiteUrl: "https://boss.example.test" } }));
vi.mock("./worker", () => ({ registerHandler: vi.fn() }));
vi.mock("../services/checkoutRecovery", () => ({ checkoutRecoveryEmail: vi.fn() }));
vi.mock("../automations/engineV2", () => ({ runAutomation: vi.fn() }));
vi.mock("../services/broadcasts", () => ({
  sendBroadcastOne: vi.fn(),
  sweepAbDecisions: vi.fn(),
  tickBroadcasts: vi.fn(),
  tickRegistrationCampaigns: vi.fn(),
}));
vi.mock("../services/sequences", () => ({ sendDueEmail: vi.fn(), tickDueSubscriptions: vi.fn() }));
vi.mock("../services/domainEvents", () => ({ publishDomainEvent: vi.fn() }));

import { communityDigest } from "./emailJobs";

const COMMUNITY = { id: 3, name: "Clinical Leaders", slug: "clinical-leaders" };
const POST = { title: "Welcome", author_name: "Yvette", channel: "General" };

function wire(recipients: unknown[]) {
  query.mockImplementation(async (sql: string) => {
    if (sql.includes("FROM communities")) return { rows: [COMMUNITY], rowCount: 1 };
    if (sql.includes("FROM community_posts")) return { rows: [POST], rowCount: 1 };
    if (sql.includes("FROM community_memberships")) return { rows: recipients, rowCount: recipients.length };
    return { rows: [], rowCount: 0 };
  });
}

/** The recipients statement, so an assertion can name it rather than an index. */
function recipientsQuery(): { sql: string; params: unknown[] } {
  const call = query.mock.calls.find(
    (args) => typeof args[0] === "string" && args[0].includes("FROM community_memberships"),
  );
  return { sql: call?.[0] as string, params: (call?.[1] ?? []) as unknown[] };
}

/**
 * `community.digest` runs on a daily schedule and has no send record of its
 * own. Its schedule dedupe key only collapses jobs that are still queued, and
 * the queue retries a failure five times — so a failure partway down the list,
 * or a deploy killing the worker mid-run and another reclaiming the lapsed
 * lease, put a second copy of the same summary in the inbox of everybody
 * already mailed. The delivery log is the record that stops it.
 */
describe("community digest", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    sendEmail.mockResolvedValue({ outcome: "sent", messageId: 1 });
  });

  it("asks the database to skip members this window's digest already reached", async () => {
    wire([]);
    await communityDigest();

    const { sql, params } = recipientsQuery();
    expect(sql).toContain("FROM email_messages em");
    expect(sql).toContain("em.source_type = 'digest'");
    expect(sql).toContain("em.source_id = $1");
    expect(sql).toContain("em.created_at > now() - make_interval(hours => $2)");
    expect(params).toEqual([COMMUNITY.id, 20]);
  });

  it("guards over a window shorter than the daily cadence that drives it", async () => {
    wire([]);
    await communityDigest();

    // A guard of exactly 24 hours would read yesterday's send as "already
    // sent" whenever yesterday's run started a second later than today's, and
    // cost a day's digest rather than a duplicate.
    const hours = recipientsQuery().params[1] as number;
    expect(hours).toBeLessThan(24);
    // And comfortably beyond the queue's whole retry curve.
    expect(hours).toBeGreaterThan(2);
  });

  it("still sends to everyone the guard leaves in", async () => {
    wire([
      { contact_id: 11, member_id: 21, email: "a@example.test", name: "Ada Byron" },
      { contact_id: 12, member_id: 22, email: "b@example.test", name: "Bo Li" },
    ]);

    await expect(communityDigest()).resolves.toEqual({ sent: 2 });
    expect(sendEmail).toHaveBeenCalledTimes(2);
    expect(sendEmail.mock.calls[0][0]).toMatchObject({
      to: "a@example.test",
      memberId: 21,
      sourceType: "digest",
      sourceId: COMMUNITY.id,
      topic: "community",
    });
  });

  it("keeps one refused address from costing the rest of the room its digest", async () => {
    wire([
      { contact_id: 11, member_id: 21, email: "a@example.test", name: "Ada" },
      { contact_id: 12, member_id: 22, email: "b@example.test", name: "Bo" },
    ]);
    sendEmail.mockRejectedValueOnce(new Error("mailbox unavailable"));

    await expect(communityDigest()).resolves.toEqual({ sent: 1 });
    expect(sendEmail).toHaveBeenCalledTimes(2);
  });
});
