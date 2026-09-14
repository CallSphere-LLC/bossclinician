import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import type { Client } from "pg";
import type { AddressInfo } from "net";
import { createTestDatabase, hasTestDatabase, insertMember } from "../../testing/db";

/**
 * A post id is a URL too (lane C-admin, C5).
 *
 * The channel list and the channel page both honour an invite-only channel and
 * a channel limited to an access group. The per-post routes (`/posts/:id/...`)
 * went through `loadPost`, which checked neither the tier nor the invitation:
 * anybody in the room could read a tiered channel's post by its id, and a
 * member who *was* invited to an invite-only channel got a 404 on every post in
 * it. Both are asserted here over real HTTP.
 *
 * Skipped when TEST_DATABASE_URL is unset, like every other suite here.
 */

const describeDb = hasTestDatabase ? describe : describe.skip;

describeDb("community per-post gate (integration)", () => {
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let client: Client;
  let signMemberAccessToken: typeof import("../../auth/memberSession").signMemberAccessToken;
  let server: ReturnType<express.Express["listen"]>;
  let baseUrl: string;

  beforeAll(async () => {
    db = await createTestDatabase("communitypostgate");
    client = db.client;
    process.env.DATABASE_URL = db.url;
    process.env.JWT_SECRET ??= "integration-test-secret";

    const { requireMember } = await import("../../middleware/memberAuth");
    const { memberCommunityRouter } = await import("./community");
    const { errorHandler } = await import("../../middleware/errorHandler");
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

  let seq = 0;
  const unique = (prefix: string): string => `${prefix}-${(seq += 1)}`;

  async function newMember(): Promise<{ id: number; token: string }> {
    const email = `${unique("zz-member")}@test.invalid`;
    const id = await insertMember(client, email);
    return { id, token: signMemberAccessToken({ sub: id, email }) };
  }

  async function status(path: string, token: string): Promise<number> {
    const res = await fetch(`${baseUrl}${path}`, { headers: { Authorization: `Bearer ${token}` } });
    await res.text();
    return res.status;
  }

  /** A free room both members walk into, with one channel and one post in it. */
  async function roomWithPost(channel: {
    visibility?: string;
    accessGroup?: boolean;
  }): Promise<{ slug: string; communityId: number; channelId: number; postId: number; groupId: number | null }> {
    const slug = unique("zz-room");
    const community = await client.query<{ id: number }>(
      `INSERT INTO communities (slug, name, access, published) VALUES ($1, $2, 'free', true)
       RETURNING id`,
      [slug, `ZZ ${slug}`],
    );
    const communityId = community.rows[0].id;
    let groupId: number | null = null;
    if (channel.accessGroup) {
      const group = await client.query<{ id: number }>(
        `INSERT INTO community_access_groups (community_id, name) VALUES ($1, $2) RETURNING id`,
        [communityId, unique("ZZ Tier")],
      );
      groupId = group.rows[0].id;
    }
    const created = await client.query<{ id: number }>(
      `INSERT INTO community_channels (community_id, slug, name, visibility, access_group_id)
       VALUES ($1, 'zz-inner', 'ZZ Inner', $2, $3) RETURNING id`,
      [communityId, channel.visibility ?? "public", groupId],
    );
    const channelId = created.rows[0].id;
    const post = await client.query<{ id: number }>(
      `INSERT INTO community_posts (channel_id, body) VALUES ($1, 'ZZ post') RETURNING id`,
      [channelId],
    );
    return { slug, communityId, channelId, postId: post.rows[0].id, groupId };
  }

  it("keeps a tiered channel's posts to the tier, by post id as well as by channel", async () => {
    const room = await roomWithPost({ accessGroup: true });
    const inTier = await newMember();
    const outsider = await newMember();
    // Walking in enrols them in a free room.
    for (const m of [inTier, outsider]) {
      expect(await status(`/api/member/community/${room.slug}`, m.token)).toBe(200);
    }
    await client.query(
      `INSERT INTO community_access_group_members (group_id, member_id, source)
       VALUES ($1, $2, 'manual')`,
      [room.groupId, inTier.id],
    );

    const comments = `/api/member/community/posts/${room.postId}/comments`;
    expect(await status(comments, inTier.token)).toBe(200);
    // The bug: the channel was hidden from them, but its post was one URL away.
    expect(await status(comments, outsider.token)).toBe(404);
  });

  it("lets an invited member read posts in an invite-only channel, and nobody else", async () => {
    const room = await roomWithPost({ visibility: "private" });
    const invited = await newMember();
    const stranger = await newMember();
    for (const m of [invited, stranger]) {
      expect(await status(`/api/member/community/${room.slug}`, m.token)).toBe(200);
    }
    await client.query(
      `INSERT INTO community_channel_members (channel_id, member_id) VALUES ($1, $2)`,
      [room.channelId, invited.id],
    );

    const comments = `/api/member/community/posts/${room.postId}/comments`;
    // The bug: invited to the channel, yet every post in it was a 404.
    expect(await status(comments, invited.token)).toBe(200);
    expect(await status(comments, stranger.token)).toBe(404);
  });
});
