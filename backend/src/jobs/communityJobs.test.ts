import { beforeEach, describe, expect, it, vi } from "vitest";

const { query, automationIdentity, publishDomainEvent } = vi.hoisted(() => ({
  query: vi.fn(),
  automationIdentity: vi.fn(),
  publishDomainEvent: vi.fn(),
}));

vi.mock("../db/pool", () => ({ pool: { query } }));
vi.mock("../services/domainEvents", () => ({ automationIdentity, publishDomainEvent }));
vi.mock("./worker", () => ({ registerHandler: vi.fn() }));
vi.mock("../services/communityMembershipWelcome", () => ({
  sendCommunityMembershipWelcome: vi.fn(),
}));

import { publishScheduledPosts } from "./communityJobs";

function due(id: number, memberId: number | null) {
  return {
    id,
    channel_id: 10,
    member_id: memberId,
    author_name: "Host",
    community_id: 3,
    community_slug: "clinical-leaders",
  };
}

/**
 * The sweeper flips the posts to visible in one committed statement and only
 * then raises their events. A throw in that loop used to fail the whole job —
 * and the retry's UPDATE finds nothing still scheduled, so every post after the
 * failing one lost its automation trigger permanently.
 */
describe("publishScheduledPosts", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    automationIdentity.mockResolvedValue({ contactId: 7, email: "a@example.test", name: "Ada" });
    publishDomainEvent.mockResolvedValue(undefined);
  });

  it("still raises the rest of the batch's events when one post's fails", async () => {
    query.mockResolvedValue({ rows: [due(1, 42), due(2, null), due(3, 43)], rowCount: 3 });
    publishDomainEvent.mockRejectedValueOnce(new Error("domain event insert failed"));

    await expect(publishScheduledPosts()).resolves.toEqual({ published: 3, eventsFailed: 1 });
    expect(publishDomainEvent).toHaveBeenCalledTimes(3);
    expect(publishDomainEvent.mock.calls.map((call) => call[1].eventKey)).toEqual([
      "community-post:1",
      "community-post:2",
      "community-post:3",
    ]);
  });

  it("survives a post whose author cannot be resolved", async () => {
    query.mockResolvedValue({ rows: [due(1, 42), due(2, 43)], rowCount: 2 });
    automationIdentity.mockRejectedValueOnce(new Error("no such member"));

    await expect(publishScheduledPosts()).resolves.toEqual({ published: 2, eventsFailed: 1 });
    expect(publishDomainEvent).toHaveBeenCalledTimes(1);
    expect(publishDomainEvent.mock.calls[0][1].eventKey).toBe("community-post:2");
  });

  it("reports a clean sweep when every event goes out", async () => {
    query.mockResolvedValue({ rows: [due(1, null)], rowCount: 1 });

    await expect(publishScheduledPosts()).resolves.toEqual({ published: 1, eventsFailed: 0 });
    // A post with no member author never looks one up.
    expect(automationIdentity).not.toHaveBeenCalled();
  });
});
