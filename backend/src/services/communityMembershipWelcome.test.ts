import { beforeEach, describe, expect, it, vi } from "vitest";

const { query, sendEmail } = vi.hoisted(() => ({ query: vi.fn(), sendEmail: vi.fn() }));
vi.mock("../db/pool", () => ({ pool: { query } }));
vi.mock("../email/provider", () => ({ sendEmail }));
vi.mock("../config/env", () => ({ env: { publicSiteUrl: "https://boss.example.test" } }));
import { sendCommunityMembershipWelcome } from "./communityMembershipWelcome";

const recipient = {
  member_id: 27, email: "member@example.test", contact_id: null,
  community_name: "Clinical Leaders", community_slug: "clinical-leaders",
};

describe("community membership welcome email", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    query.mockResolvedValueOnce({ rows: [recipient], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });
    sendEmail.mockResolvedValue({ outcome: "sent", messageId: 1 });
  });

  it("sends an access notice with a usable community link even without a CRM contact", async () => {
    await expect(sendCommunityMembershipWelcome({ membershipId: 9 })).resolves.toMatchObject({ outcome: "sent" });
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: recipient.email, memberId: 27, contactId: null,
      sourceType: "transactional", sourceId: 9, topic: "community_membership",
      subject: "You've been added to Clinical Leaders",
      text: expect.stringContaining("https://boss.example.test/community/clinical-leaders"),
    }));
  });

  it("skips removed, banned, or inactive memberships", async () => {
    query.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
    await expect(sendCommunityMembershipWelcome({ membershipId: 9 })).resolves.toMatchObject({ outcome: "skipped" });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("does not resend a delivery already recorded before a worker retry", async () => {
    query.mockReset().mockResolvedValueOnce({ rows: [recipient], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1 });
    await expect(sendCommunityMembershipWelcome({ membershipId: 9 })).resolves.toMatchObject({ outcome: "already_sent" });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("propagates a provider outage so the durable worker retries", async () => {
    sendEmail.mockRejectedValue(new Error("provider unavailable"));
    await expect(sendCommunityMembershipWelcome({ membershipId: 9 })).rejects.toThrow("provider unavailable");
  });

  it("rejects malformed persisted job payloads before reading or sending", async () => {
    await expect(sendCommunityMembershipWelcome({ membershipId: "wrong" })).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
