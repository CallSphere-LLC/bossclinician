import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Client } from "pg";
import { createTestDatabase, hasTestDatabase, insertMember } from "../testing/db";

/**
 * Integration tests for the community member profile lookup.
 *
 * The defect: `/community/:slug/members/:memberId` resolved a profile through
 * `community_memberships` alone, while entering a community, posting in it and
 * messaging inside it all resolve through `mayEnterCommunity`. A free room — or
 * one unlocked by a plan — admits members who hold no membership row, so the
 * page every "Message" button hangs off answered "We couldn't find that member"
 * for exactly the people a member was entitled to message, and direct messages
 * had no reachable entry point at all.
 *
 * The other half of the contract matters just as much: a profile is not public
 * because a room is free. Somebody with neither a membership nor an entitlement
 * is still nobody.
 *
 * Skipped when TEST_DATABASE_URL is unset, like every other suite here.
 */

const describeDb = hasTestDatabase ? describe : describe.skip;

describeDb("community member profiles (integration)", () => {
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let client: Client;
  let profiles: typeof import("./memberProfile");

  async function insertCommunity(slug: string, access: "free" | "paid"): Promise<number> {
    const res = await client.query<{ id: number }>(
      `INSERT INTO communities (slug, name, access, published)
       VALUES ($1, $2, $3, true) RETURNING id`,
      [slug, `Room ${slug}`, access]
    );
    return res.rows[0].id;
  }

  async function join(
    communityId: number,
    memberId: number,
    overrides: { role?: string; points?: number; headline?: string; banned?: boolean } = {}
  ): Promise<void> {
    await client.query(
      `INSERT INTO community_memberships (community_id, member_id, role, points, headline, banned_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        communityId,
        memberId,
        overrides.role ?? "member",
        overrides.points ?? 0,
        overrides.headline ?? "",
        overrides.banned ? new Date() : null,
      ]
    );
  }

  /** A community sold as a product, which is what makes a room gated. */
  async function sell(communityId: number, slug: string): Promise<number> {
    const res = await client.query<{ id: number }>(
      `INSERT INTO products (slug, title, kind, community_id, status)
       VALUES ($1, $2, 'community', $3, 'published') RETURNING id`,
      [slug, `Product ${slug}`, communityId]
    );
    return res.rows[0].id;
  }

  beforeAll(async () => {
    db = await createTestDatabase("memberprofile");
    client = db.client;
    process.env.DATABASE_URL = db.url;
    process.env.JWT_SECRET ??= "integration-test-secret";
    profiles = await import("./memberProfile");
  }, 60_000);

  afterAll(async () => {
    const { pool } = await import("../db/pool");
    await pool.end().catch(() => undefined);
    await db?.drop();
  });

  it("loads a member who has joined, with the standing the room gave them", async () => {
    const communityId = await insertCommunity("joined-room", "free");
    const memberId = await insertMember(client, "joined@test.invalid", { name: "ZZ Joined" });
    await join(communityId, memberId, { role: "moderator", points: 120, headline: "Front desk" });

    const profile = await profiles.loadCommunityMemberProfile(communityId, memberId);

    expect(profile).not.toBeNull();
    expect(profile).toMatchObject({
      memberId,
      name: "ZZ Joined",
      role: "moderator",
      points: 120,
      headline: "Front desk",
      joined: true,
    });
    expect(profile?.joinedAt).not.toBeNull();
  });

  it("loads a member of a free room who never joined it — the DM dead end", async () => {
    const communityId = await insertCommunity("free-room", "free");
    const memberId = await insertMember(client, "not-joined@test.invalid", { name: "ZZ Turn" });

    const profile = await profiles.loadCommunityMemberProfile(communityId, memberId);

    // This is the case that 404'd. They can enter the room, post in it and be
    // messaged in it; their profile has to exist too.
    expect(profile).not.toBeNull();
    expect(profile).toMatchObject({
      memberId,
      name: "ZZ Turn",
      role: "member",
      points: 0,
      joined: false,
      joinedAt: null,
      postCount: 0,
      commentCount: 0,
    });
  });

  it("refuses somebody banned from the room", async () => {
    const communityId = await insertCommunity("banned-room", "free");
    const memberId = await insertMember(client, "banned@test.invalid");
    await join(communityId, memberId, { banned: true });

    expect(await profiles.loadCommunityMemberProfile(communityId, memberId)).toBeNull();
  });

  it("refuses a suspended account", async () => {
    const communityId = await insertCommunity("suspended-room", "free");
    const memberId = await insertMember(client, "suspended@test.invalid", {
      status: "suspended",
    });
    await join(communityId, memberId);

    expect(await profiles.loadCommunityMemberProfile(communityId, memberId)).toBeNull();
  });

  it("refuses a stranger to a paid room, and shows the member who paid for it", async () => {
    const communityId = await insertCommunity("paid-room", "paid");
    const productId = await sell(communityId, "paid-room-product");

    const stranger = await insertMember(client, "paid-stranger@test.invalid");
    const buyer = await insertMember(client, "paid-buyer@test.invalid");
    await client.query(
      `INSERT INTO access_grants (member_id, product_id, status, source)
       VALUES ($1, $2, 'active', 'purchase')`,
      [buyer, productId]
    );

    // A room being visible to its members does not make everybody on the site a
    // member of it.
    expect(await profiles.loadCommunityMemberProfile(communityId, stranger)).toBeNull();
    expect(await profiles.loadCommunityMemberProfile(communityId, buyer)).not.toBeNull();
  });

  it("answers nothing for a member id that does not exist", async () => {
    const communityId = await insertCommunity("empty-room", "free");

    expect(await profiles.loadCommunityMemberProfile(communityId, 999_999)).toBeNull();
  });
});
