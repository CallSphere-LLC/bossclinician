import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { pool } from "../db/pool";
import { audienceSize, resolveAudience } from "./broadcasts";

vi.mock("../db/pool", () => ({ pool: { query: vi.fn() } }));

describe("campaign tag targeting and exclusions", () => {
  beforeEach(() => {
    (pool.query as unknown as Mock).mockReset();
  });

  it("removes excluded tags from an included tag audience", async () => {
    (pool.query as unknown as Mock)
      .mockResolvedValueOnce({
        rows: [
          { id: 1, email: "one@example.com", name: "One", first_name: "One" },
          { id: 2, email: "two@example.com", name: "Two", first_name: "Two" },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ contact_id: 2 }] });

    const recipients = await resolveAudience({
      audience: "all_subscribers",
      segment_id: null,
      include_tag_ids: [4],
      exclude_tag_ids: [9],
      exclude_segment_ids: [],
    });

    expect(recipients.map((recipient) => recipient.contactId)).toEqual([1]);
    expect((pool.query as unknown as Mock).mock.calls[0][0]).toContain("contact_tags");
  });

  it("uses the exact resolved list for the displayed count", async () => {
    (pool.query as unknown as Mock).mockResolvedValueOnce({
      rows: [{ id: 1, email: "one@example.com", name: "One", first_name: "One" }],
    });

    await expect(
      audienceSize({ audience: "all_subscribers", segment_id: null }),
    ).resolves.toBe(1);
  });
});
