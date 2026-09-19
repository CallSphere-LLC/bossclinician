import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import type { Client } from "pg";
import type { AddressInfo } from "net";
import { createTestDatabase, hasTestDatabase, insertMember, insertOffer } from "../../testing/db";

/**
 * Integration tests for the community door.
 *
 * The property under test is that entitlement is asked on every entry rather
 * than once at the door. It is invisible to a unit test because the whole bug
 * lives in the gap between two rows: `community_memberships` is kept when a
 * refund revokes `access_grants`, and a gate that reads the first of those has
 * no way to notice the second has changed. So the room is opened, refunded and
 * knocked on again over real HTTP against a real database.
 *
 * Skipped when TEST_DATABASE_URL is unset, like every other suite here.
 */

const describeDb = hasTestDatabase ? describe : describe.skip;

describeDb("community entitlement (integration)", () => {
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let client: Client;
  let access: typeof import("../../services/access");
  let signMemberAccessToken: typeof import("../../auth/memberSession").signMemberAccessToken;
  let server: ReturnType<express.Express["listen"]>;
  let baseUrl: string;

  beforeAll(async () => {
    db = await createTestDatabase("communityaccess");
    client = db.client;

    // config/env reads process.env at import time, so the environment has to
    // point at the scratch database before the first dynamic import.
    process.env.DATABASE_URL = db.url;
    process.env.JWT_SECRET ??= "integration-test-secret";

    const { requireMember } = await import("../../middleware/memberAuth");
    const { memberCommunityRouter } = await import("./community");
    const { errorHandler } = await import("../../middleware/errorHandler");
    access = await import("../../services/access");
    signMemberAccessToken = (await import("../../auth/memberSession")).signMemberAccessToken;

    const app = express();
    app.use(express.json());
    app.use("/api/member/community", requireMember, memberCommunityRouter);
    app.use(errorHandler);

    server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }, 60_000);

  afterAll(async () => {
    await new Promise((resolve) => server?.close(resolve));
    const { pool } = await import("../../db/pool");
    await pool.end().catch(() => undefined);
    await db?.drop();
  });

  /* ------------------------------------------------------------- fixtures */

  let seq = 0;
  const unique = (prefix: string): string => `${prefix}-${(seq += 1)}`;

  async function newMember(): Promise<{ id: number; token: string }> {
    const email = `${unique("member")}@test.invalid`;
    const id = await insertMember(client, email);
    return { id, token: signMemberAccessToken({ sub: id, email }) };
  }

  function impersonationToken(member: { id: number }): string {
    return signMemberAccessToken({
      sub: member.id,
      email: `${unique("admin")}@test.invalid`,
      impersonatedBy: 1,
    });
  }

  /** A channel in a room, with whatever restriction the test is about. */
  async function newChannel(
    communityId: number,
    input: { slug: string; visibility?: string; accessGroupId?: number | null }
  ): Promise<number> {
    const res = await client.query<{ id: number }>(
      `INSERT INTO community_channels (community_id, slug, name, visibility, access_group_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [
        communityId,
        input.slug,
        input.slug,
        input.visibility ?? "public",
        input.accessGroupId ?? null,
      ]
    );
    return res.rows[0].id;
  }

  async function newAccessGroup(communityId: number): Promise<number> {
    const res = await client.query<{ id: number }>(
      `INSERT INTO community_access_groups (community_id, name) VALUES ($1, $2) RETURNING id`,
      [communityId, unique("Tier")]
    );
    return res.rows[0].id;
  }

  async function listedChannels(slug: string, token: string): Promise<string[]> {
    const overview = await get(`/api/member/community/${slug}`, token);
    return ((overview.body.channels ?? []) as { slug: string }[]).map((ch) => ch.slug);
  }

  async function newCommunity(access_: "free" | "paid"): Promise<{ id: number; slug: string }> {
    const slug = unique("room");
    const res = await client.query<{ id: number }>(
      `INSERT INTO communities (slug, name, access, published) VALUES ($1, $2, $3, true)
       RETURNING id`,
      [slug, `Room ${slug}`, access_]
    );
    const id = res.rows[0].id;
    await client.query(
      `INSERT INTO community_channels (community_id, slug, name) VALUES ($1, 'general', 'General')`,
      [id]
    );
    return { id, slug };
  }

  /** A community sold as a product, the way a paid room is meant to be set up. */
  async function sellCommunity(communityId: number): Promise<{ productId: number; offerId: number }> {
    const slug = unique("community-product");
    const product = await client.query<{ id: number }>(
      `INSERT INTO products (slug, title, kind, community_id, status)
       VALUES ($1, $2, 'community', $3, 'published') RETURNING id`,
      [slug, `Product ${slug}`, communityId]
    );
    const productId = product.rows[0].id;
    return { productId, offerId: await insertOffer(client, unique("offer"), [productId]) };
  }

  async function get(path: string, token: string) {
    const res = await fetch(`${baseUrl}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  }

  async function listedSlugs(token: string): Promise<string[]> {
    const listing = await get("/api/member/community", token);
    const communities = (listing.body.communities ?? []) as { slug: string }[];
    return communities.map((row) => row.slug);
  }

  async function membershipCount(communityId: number, memberId: number): Promise<number> {
    const res = await client.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM community_memberships
        WHERE community_id = $1 AND member_id = $2`,
      [communityId, memberId]
    );
    return res.rows[0].n;
  }

  /* ---------------------------------------------------------------- tests */

  it("shuts the room when the grant behind it is revoked", async () => {
    const member = await newMember();
    const room = await newCommunity("paid");
    const { productId, offerId } = await sellCommunity(room.id);
    await access.grantOfferAccess({ memberId: member.id, offerId });

    expect((await get(`/api/member/community/${room.slug}`, member.token)).status).toBe(200);
    expect(await listedSlugs(member.token)).toContain(room.slug);

    await access.revokeAccess({ memberId: member.id, productId, reason: "refunded" });

    // Every way into the room, not only the one the auto-join runs on.
    expect((await get(`/api/member/community/${room.slug}`, member.token)).status).toBe(404);
    expect(
      (await get(`/api/member/community/${room.slug}/channels/general/posts`, member.token)).status
    ).toBe(404);
    expect((await get(`/api/member/community/${room.slug}/members`, member.token)).status).toBe(404);
    expect(await listedSlugs(member.token)).not.toContain(room.slug);
  });

  it("keeps the member's standing when the room shuts", async () => {
    // The membership row is why entitlement cannot be read from it: points,
    // badges and role are a record of what somebody did, and deleting that on a
    // refund would be a worse bug than the one it fixes.
    const member = await newMember();
    const room = await newCommunity("paid");
    const { productId, offerId } = await sellCommunity(room.id);
    await access.grantOfferAccess({ memberId: member.id, offerId });
    await get(`/api/member/community/${room.slug}`, member.token);

    await client.query(
      `UPDATE community_memberships SET points = 42, role = 'moderator'
        WHERE community_id = $1 AND member_id = $2`,
      [room.id, member.id]
    );
    await access.revokeAccess({ memberId: member.id, productId, reason: "refunded" });

    const row = await client.query<{ points: number; role: string }>(
      `SELECT points, role FROM community_memberships WHERE community_id = $1 AND member_id = $2`,
      [room.id, member.id]
    );
    expect(row.rows[0]).toEqual({ points: 42, role: "moderator" });

    // And re-granting puts them straight back in with it.
    await access.grantOfferAccess({ memberId: member.id, offerId });
    const reopened = await get(`/api/member/community/${room.slug}`, member.token);
    expect(reopened.status).toBe(200);
    expect((reopened.body.membership as { points: number }).points).toBe(42);
  });

  it("shuts the room the moment a time-limited grant lapses", async () => {
    const member = await newMember();
    const room = await newCommunity("paid");
    const { productId } = await sellCommunity(room.id);
    await client.query(
      `INSERT INTO access_grants (member_id, product_id, status, granted_at, expires_at)
       VALUES ($1, $2, 'active', now() - interval '40 days', now() + interval '1 hour')`,
      [member.id, productId]
    );

    expect((await get(`/api/member/community/${room.slug}`, member.token)).status).toBe(200);

    // No sweeper run in between: access has to lapse on the clock, not on a job.
    await client.query(
      `UPDATE access_grants SET expires_at = now() - interval '1 minute'
        WHERE member_id = $1 AND product_id = $2`,
      [member.id, productId]
    );

    expect((await get(`/api/member/community/${room.slug}`, member.token)).status).toBe(404);
    expect(await listedSlugs(member.token)).not.toContain(room.slug);
  });

  it("never opens a sold room to somebody who never bought it", async () => {
    const stranger = await newMember();
    const room = await newCommunity("paid");
    await sellCommunity(room.id);

    expect((await get(`/api/member/community/${room.slug}`, stranger.token)).status).toBe(404);
    expect(await listedSlugs(stranger.token)).not.toContain(room.slug);
    expect(await membershipCount(room.id, stranger.id)).toBe(0);
  });

  it("keeps a room shut when the only thing selling it is a plan", async () => {
    // A plan that unlocks a community is a door as much as a product is. Reading
    // "no product points at this" as "this room is free" would open it to the
    // whole membership.
    const stranger = await newMember();
    const room = await newCommunity("free");
    await client.query(
      `INSERT INTO plans (slug, name, price_cents, community_id) VALUES ($1, $2, 4900, $3)`,
      [unique("plan"), "Inner Circle", room.id]
    );

    expect((await get(`/api/member/community/${room.slug}`, stranger.token)).status).toBe(404);
    expect(await listedSlugs(stranger.token)).not.toContain(room.slug);
  });

  it("keeps a room shut when its product has been archived", async () => {
    const stranger = await newMember();
    const buyer = await newMember();
    const room = await newCommunity("paid");
    const { productId, offerId } = await sellCommunity(room.id);
    await access.grantOfferAccess({ memberId: buyer.id, offerId });

    await client.query(`UPDATE products SET status = 'archived' WHERE id = $1`, [productId]);

    expect((await get(`/api/member/community/${room.slug}`, stranger.token)).status).toBe(404);
    // Withdrawing a product from the shop must not evict the people who bought it.
    expect((await get(`/api/member/community/${room.slug}`, buyer.token)).status).toBe(200);
  });

  it("lets anybody signed in walk into a community nobody sells", async () => {
    const member = await newMember();
    const room = await newCommunity("free");

    const opened = await get(`/api/member/community/${room.slug}`, member.token);
    expect(opened.status).toBe(200);
    expect(await membershipCount(room.id, member.id)).toBe(1);
    expect(await listedSlugs(member.token)).toContain(room.slug);
    expect(
      (await get(`/api/member/community/${room.slug}/channels/general/posts`, member.token)).status
    ).toBe(200);
  });

  /* -------------------------------------------- channel-level restrictions */

  it("shows an invite-only channel to the people invited to it, and nobody else", async () => {
    /*
     * The bug this locks down: "Invited members only" was offered in the admin
     * with nowhere to record an invitation, so the member queries could only
     * fall back to "moderators and admins" — a channel created private was
     * invisible to every member of the community, permanently, and there was no
     * way to let anybody in. The setting was a dead end rather than a
     * restriction.
     */
    const member = await newMember();
    const stranger = await newMember();
    const room = await newCommunity("free");
    const channelId = await newChannel(room.id, { slug: "inner", visibility: "private" });

    // Both are in the room; neither is invited to the channel.
    await get(`/api/member/community/${room.slug}`, member.token);
    await get(`/api/member/community/${room.slug}`, stranger.token);

    expect(await listedChannels(room.slug, member.token)).not.toContain("inner");
    // And hiding is not access control: the URL must not reach it either.
    expect(
      (await get(`/api/member/community/${room.slug}/channels/inner/posts`, member.token)).status
    ).toBe(404);

    await client.query(
      `INSERT INTO community_channel_members (channel_id, member_id) VALUES ($1, $2)`,
      [channelId, member.id]
    );

    expect(await listedChannels(room.slug, member.token)).toContain("inner");
    expect(
      (await get(`/api/member/community/${room.slug}/channels/inner/posts`, member.token)).status
    ).toBe(200);

    // The invitation is one person's, not everybody's.
    expect(await listedChannels(room.slug, stranger.token)).not.toContain("inner");
    expect(
      (await get(`/api/member/community/${room.slug}/channels/inner/posts`, stranger.token)).status
    ).toBe(404);
  });

  it("shows every channel to somebody who helps run the room", async () => {
    const moderator = await newMember();
    const room = await newCommunity("free");
    await newChannel(room.id, { slug: "inner", visibility: "private" });
    const groupId = await newAccessGroup(room.id);
    await newChannel(room.id, { slug: "tiered", accessGroupId: groupId });

    await get(`/api/member/community/${room.slug}`, moderator.token);
    await client.query(
      `UPDATE community_memberships SET role = 'moderator'
        WHERE community_id = $1 AND member_id = $2`,
      [room.id, moderator.id]
    );

    // Running the room is a different question from being invited to a channel:
    // a moderator who cannot see a channel cannot moderate it.
    const listed = await listedChannels(room.slug, moderator.token);
    expect(listed).toContain("inner");
    expect(listed).toContain("tiered");
  });

  it("keeps a tiered channel to its tier, however the tier was granted", async () => {
    const member = await newMember();
    const room = await newCommunity("paid");
    const { offerId } = await sellCommunity(room.id);
    await access.grantOfferAccess({ memberId: member.id, offerId });
    const groupId = await newAccessGroup(room.id);
    // `newCommunity` already made the open "general" channel.
    await newChannel(room.id, { slug: "vip", accessGroupId: groupId });

    expect(await listedChannels(room.slug, member.token)).toEqual(["general"]);

    // The offer grants the tier, read live off the grant rather than copied
    // into a row — so the tier lapses exactly when the access does.
    await client.query(`UPDATE offers SET access_group_id = $1 WHERE id = $2`, [groupId, offerId]);
    expect(await listedChannels(room.slug, member.token)).toContain("vip");

    await access.revokeAccess({
      memberId: member.id,
      productId: (
        await client.query<{ product_id: number }>(
          `SELECT product_id FROM access_grants WHERE member_id = $1 AND offer_id = $2`,
          [member.id, offerId]
        )
      ).rows[0].product_id,
      reason: "refunded",
    });
    // The room shuts, and with it the tier: no orphan row keeps the door open.
    expect((await get(`/api/member/community/${room.slug}`, member.token)).status).toBe(404);
  });

  /* --------------------------------------------------- one member count */

  it("counts the members the same way on every surface", async () => {
    /*
     * The header said "2 MEMBERS" over a directory listing one person, because
     * the two counted different things: the header took every membership row
     * that was not banned, the directory only rows whose member account was
     * still active. Same question, two answers, and a member reading both.
     */
    const member = await newMember();
    const closed = await newMember();
    const banned = await newMember();
    const room = await newCommunity("free");
    for (const who of [member, closed, banned]) {
      await get(`/api/member/community/${room.slug}`, who.token);
    }
    await client.query(`UPDATE members SET status = 'cancelled' WHERE id = $1`, [closed.id]);
    await client.query(
      `UPDATE community_memberships SET banned_at = now()
        WHERE community_id = $1 AND member_id = $2`,
      [room.id, banned.id]
    );

    const overview = await get(`/api/member/community/${room.slug}`, member.token);
    const directory = await get(`/api/member/community/${room.slug}/members`, member.token);
    const listing = await get("/api/member/community", member.token);
    const card = ((listing.body.communities ?? []) as { slug: string; memberCount: number }[]).find(
      (row) => row.slug === room.slug
    );

    expect((overview.body.community as { memberCount: number }).memberCount).toBe(1);
    expect(directory.body.total).toBe(1);
    expect(card?.memberCount).toBe(1);
  });

  /* ----------------------------------------------------- leaderboard rank */

  it("does not rank two members who have never posted as joint first", async () => {
    const member = await newMember();
    const other = await newMember();
    const room = await newCommunity("free");
    await get(`/api/member/community/${room.slug}`, member.token);
    await get(`/api/member/community/${room.slug}`, other.token);

    const empty = await get(`/api/member/community/${room.slug}/leaderboard`, member.token);
    expect(empty.body.leaderboard).toEqual([]);

    await client.query(
      `UPDATE community_memberships SET points = 7 WHERE community_id = $1`,
      [room.id]
    );
    const tied = await get(`/api/member/community/${room.slug}/leaderboard`, member.token);
    // A real tie shares its rank, and now says that it is shared.
    expect(
      (tied.body.leaderboard as { rank: number; tied: boolean }[]).map((r) => [r.rank, r.tied])
    ).toEqual([
      [1, true],
      [1, true],
    ]);
  });

  it("enrols nobody while an admin is viewing as a member", async () => {
    const member = await newMember();
    const room = await newCommunity("free");

    const viewed = await get(`/api/member/community/${room.slug}`, impersonationToken(member));
    expect(viewed.status).toBe(200);
    expect(await membershipCount(room.id, member.id)).toBe(0);

    // The member's own visit still joins them.
    await get(`/api/member/community/${room.slug}`, member.token);
    expect(await membershipCount(room.id, member.id)).toBe(1);
  });
  it("lists purchasable group metadata without exposing its private channels, then shows entitled group labels", async () => {
    const member=await newMember();
    const room=await newCommunity("free");
    const { saveAccessGroup }=await import("../../services/communityGroupPricing");
    const group=await saveAccessGroup(room.id,null,{name:"Premium circle",pricingType:"one_time",amountCents:9900});
    await newChannel(room.id,{slug:"private-tier-content",accessGroupId:group.id});
    const before=await get(`/api/member/community/${room.slug}`,member.token);
    expect(before.status).toBe(200);
    expect(before.body.accessGroups).toEqual([]);
    expect(before.body.availableAccessGroups).toEqual(expect.arrayContaining([expect.objectContaining({id:group.id,checkoutSlug:group.checkout_slug,amountCents:9900})]));
    expect(before.body.channels).not.toEqual(expect.arrayContaining([expect.objectContaining({slug:"private-tier-content"})]));
    expect((await get(`/api/member/community/${room.slug}/channels/private-tier-content/posts`,member.token)).status).toBe(404);
    await access.grantOfferAccess({memberId:member.id,offerId:group.checkout_offer_id,source:"purchase"});
    const after=await get(`/api/member/community/${room.slug}`,member.token);
    expect(after.body.availableAccessGroups).toEqual([]);
    expect(after.body.accessGroups).toEqual(expect.arrayContaining([expect.objectContaining({id:group.id,name:"Premium circle"})]));
    expect(after.body.channels).toEqual(expect.arrayContaining([expect.objectContaining({slug:"private-tier-content",accessGroupId:group.id,accessGroupName:"Premium circle"})]));
    expect((await get(`/api/member/community/${room.slug}/channels/private-tier-content/posts`,member.token)).status).toBe(200);
    await access.revokeOfferAccess({memberId:member.id,offerId:group.checkout_offer_id,reason:"refunded"});
    expect((await get(`/api/member/community/${room.slug}/channels/private-tier-content/posts`,member.token)).status).toBe(404);
  });

});
