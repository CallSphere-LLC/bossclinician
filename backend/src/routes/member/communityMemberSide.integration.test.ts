import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import type { Client } from "pg";
import type { AddressInfo } from "net";
import { createTestDatabase, hasTestDatabase, insertMember } from "../../testing/db";

/**
 * Integration tests for the member side of the community (Lane C-member).
 *
 *  - C3  another member's profile is reachable from the directory, answers for
 *        members of the same room only, carries no email, and starts a DM.
 *  - C4  a host can schedule a post, a plain member cannot, and the
 *        `community.publishScheduled` sweeper actually publishes it.
 *  - C6  the member header, the /community card, the directory and the admin's
 *        "N people" are the same number, on every load.
 *  - C7  the leaderboard uses competition ranking on real points — only
 *        genuinely tied members share a rank, nobody on zero is ranked — for
 *        week, month and all time; and a channel's `view_mode` reaches members.
 *
 * Real HTTP against a real database, with the routers mounted in the same order
 * `routes/member/index.ts` mounts them. Skipped when TEST_DATABASE_URL is unset.
 */

const describeDb = hasTestDatabase ? describe : describe.skip;

describeDb("community, member side (integration)", () => {
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let client: Client;
  let signMemberAccessToken: typeof import("../../auth/memberSession").signMemberAccessToken;
  let publishScheduledPosts: typeof import("../../jobs/communityJobs").publishScheduledPosts;
  let server: ReturnType<express.Express["listen"]>;
  let baseUrl: string;

  beforeAll(async () => {
    db = await createTestDatabase("communitymemberside");
    client = db.client;
    process.env.DATABASE_URL = db.url;
    process.env.JWT_SECRET ??= "integration-test-secret";

    const { requireMember } = await import("../../middleware/memberAuth");
    const { memberCommunityRouter } = await import("./community");
    const { memberCommunityDmRouter } = await import("./communityDm");
    const { memberCommunityProfileRouter } = await import("./communityMemberProfile");
    const { errorHandler } = await import("../../middleware/errorHandler");
    signMemberAccessToken = (await import("../../auth/memberSession")).signMemberAccessToken;
    publishScheduledPosts = (await import("../../jobs/communityJobs")).publishScheduledPosts;

    const app = express();
    app.use(express.json());
    app.use("/api/member/community", requireMember, memberCommunityDmRouter);
    app.use("/api/member/community", requireMember, memberCommunityProfileRouter);
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

  interface TestMember {
    id: number;
    email: string;
    token: string;
  }

  async function newMember(name: string, status = "active"): Promise<TestMember> {
    const email = `${unique("zz-member")}@test.invalid`;
    const id = await insertMember(client, email, { name, status });
    // Posting and messaging require a confirmed address.
    await client.query(`UPDATE members SET email_verified_at = now() WHERE id = $1`, [id]);
    return { id, email, token: signMemberAccessToken({ sub: id, email }) };
  }

  async function newCommunity(access: "free" | "paid" = "free"): Promise<{ id: number; slug: string }> {
    const slug = unique("room");
    const res = await client.query<{ id: number }>(
      `INSERT INTO communities (slug, name, access, published) VALUES ($1, $2, $3, true)
       RETURNING id`,
      [slug, `Room ${slug}`, access]
    );
    return { id: res.rows[0].id, slug };
  }

  async function join(
    communityId: number,
    memberId: number,
    opts: { role?: string; points?: number; banned?: boolean } = {}
  ): Promise<void> {
    await client.query(
      `INSERT INTO community_memberships (community_id, member_id, role, points, banned_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [communityId, memberId, opts.role ?? "member", opts.points ?? 0, opts.banned ? new Date() : null]
    );
  }

  async function newChannel(communityId: number, viewMode?: string): Promise<string> {
    const slug = unique("channel");
    await client.query(
      `INSERT INTO community_channels (community_id, slug, name, visibility${viewMode ? ", view_mode" : ""})
       VALUES ($1, $2, $3, 'public'${viewMode ? ", $4" : ""})`,
      viewMode ? [communityId, slug, slug, viewMode] : [communityId, slug, slug]
    );
    return slug;
  }

  async function call(
    method: string,
    path: string,
    token: string,
    body?: unknown
  ): Promise<{ status: number; body: any; text: string }> {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let parsed: any = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }
    return { status: res.status, body: parsed, text };
  }

  const get = (path: string, token: string) => call("GET", path, token);

  /* ------------------------------------------------------------------ C3 */

  describe("C3 — reaching another member and messaging them", () => {
    it("links every directory card, including other people's, and never sends an email", async () => {
      const room = await newCommunity();
      const me = await newMember("ZZ Reader");
      const other = await newMember("ZZ Other");
      await join(room.id, me.id);
      await join(room.id, other.id, { points: 5 });

      const dir = await get(`/api/member/community/${room.slug}/members`, me.token);
      expect(dir.status).toBe(200);
      const rows = dir.body.members as { memberId: number; href: string; mine: boolean }[];
      const theirs = rows.find((r) => r.memberId === other.id);
      expect(theirs).toBeDefined();
      expect(theirs?.mine).toBe(false);
      expect(theirs?.href).toBe(`/community/${room.slug}/members/${other.id}`);
      expect(dir.text).not.toContain("@test.invalid");
    });

    it("opens another member's profile — not just your own — with no email on it", async () => {
      const room = await newCommunity();
      const me = await newMember("ZZ Reader");
      const other = await newMember("ZZ Other");
      await join(room.id, me.id);
      await join(room.id, other.id);

      const own = await get(`/api/member/community/${room.slug}/members/${me.id}`, me.token);
      expect(own.status).toBe(200);
      expect(own.body.mine).toBe(true);

      const theirs = await get(`/api/member/community/${room.slug}/members/${other.id}`, me.token);
      expect(theirs.status).toBe(200);
      expect(theirs.body).toMatchObject({ memberId: other.id, name: "ZZ Other", mine: false });
      expect(theirs.body.email).toBeUndefined();
      expect(theirs.text).not.toContain("@test.invalid");
    });

    it("opens the profile of somebody entitled to a free room who has not opened it yet", async () => {
      const room = await newCommunity("free");
      const me = await newMember("ZZ Reader");
      const newcomer = await newMember("ZZ Newcomer");
      await join(room.id, me.id);

      const res = await get(`/api/member/community/${room.slug}/members/${newcomer.id}`, me.token);
      expect(res.status).toBe(200);
      expect(res.body.memberId).toBe(newcomer.id);
    });

    it("hides members of a paid room from a stranger, and strangers from its members", async () => {
      const paid = await newCommunity("paid");
      await client.query(
        `INSERT INTO products (slug, title, kind, community_id, status)
         VALUES ($1, $2, 'community', $3, 'published')`,
        [unique("paid-product"), "ZZ Paid room", paid.id]
      );
      const insider = await newMember("ZZ Insider");
      const stranger = await newMember("ZZ Stranger");
      const productId = (
        await client.query<{ id: number }>(`SELECT id FROM products WHERE community_id = $1`, [paid.id])
      ).rows[0].id;
      await client.query(
        `INSERT INTO access_grants (member_id, product_id, status, source)
         VALUES ($1, $2, 'active', 'purchase')`,
        [insider.id, productId]
      );
      await join(paid.id, insider.id);

      // A stranger cannot read a paid room's people…
      const out = await get(`/api/member/community/${paid.slug}/members/${insider.id}`, stranger.token);
      expect(out.status).toBe(404);
      // …and a member of it cannot look up somebody who is not in it.
      const inn = await get(`/api/member/community/${paid.slug}/members/${stranger.id}`, insider.token);
      expect(inn.status).toBe(404);
    });

    it("hides a banned member and a suspended account", async () => {
      const room = await newCommunity();
      const me = await newMember("ZZ Reader");
      const banned = await newMember("ZZ Banned");
      const suspended = await newMember("ZZ Suspended", "suspended");
      await join(room.id, me.id);
      await join(room.id, banned.id, { banned: true });
      await join(room.id, suspended.id);

      expect((await get(`/api/member/community/${room.slug}/members/${banned.id}`, me.token)).status).toBe(404);
      expect((await get(`/api/member/community/${room.slug}/members/${suspended.id}`, me.token)).status).toBe(404);
    });

    it("counts a member's posts only in channels the reader may open", async () => {
      const room = await newCommunity();
      const reader = await newMember("ZZ Reader");
      const host = await newMember("ZZ Host");
      const author = await newMember("ZZ Author");
      await join(room.id, reader.id);
      await join(room.id, host.id, { role: "moderator" });
      await join(room.id, author.id);

      const open = await newChannel(room.id);
      const hiddenSlug = unique("invite-only");
      const hidden = await client.query<{ id: number }>(
        `INSERT INTO community_channels (community_id, slug, name, visibility)
         VALUES ($1, $2, $2, 'private') RETURNING id`,
        [room.id, hiddenSlug]
      );
      await client.query(`INSERT INTO community_channel_members (channel_id, member_id) VALUES ($1, $2)`, [
        hidden.rows[0].id,
        author.id,
      ]);
      await client.query(
        `INSERT INTO community_posts (channel_id, member_id, author_name, body, status)
         SELECT id, $2, 'ZZ Author', 'ZZ post', 'visible' FROM community_channels
          WHERE community_id = $1 AND slug IN ($3, $4)`,
        [room.id, author.id, open, hiddenSlug]
      );

      const asReader = await get(`/api/member/community/${room.slug}/members/${author.id}`, reader.token);
      expect(asReader.status).toBe(200);
      expect(asReader.body.postCount).toBe(1);

      const asHost = await get(`/api/member/community/${room.slug}/members/${author.id}`, host.token);
      expect(asHost.body.postCount).toBe(2);
    });

    it("starts a direct message from the profile's Message target", async () => {
      const room = await newCommunity();
      const me = await newMember("ZZ Reader");
      const other = await newMember("ZZ Other");
      await join(room.id, me.id);
      await join(room.id, other.id);

      const thread = await get(`/api/member/community/${room.slug}/dm/${other.id}`, me.token);
      expect(thread.status).toBe(200);
      expect(thread.body.other.memberId).toBe(other.id);

      const sent = await call("POST", `/api/member/community/${room.slug}/dm/${other.id}`, me.token, {
        body: "ZZ hello",
      });
      expect(sent.status).toBeLessThan(300);

      const inbox = await get(`/api/member/community/${room.slug}/dm`, other.token);
      expect(inbox.status).toBe(200);
      expect(inbox.body.threads.map((t: { otherMemberId: number }) => t.otherMemberId)).toContain(me.id);
    });

    it("clears the bell for a conversation once the recipient opens it, and nothing else", async () => {
      const room = await newCommunity();
      const elsewhere = await newCommunity();
      const sender = await newMember("ZZ Sender");
      const reader = await newMember("ZZ Recipient");
      const third = await newMember("ZZ Third");
      await join(room.id, sender.id);
      await join(room.id, reader.id);
      await join(room.id, third.id);
      await join(elsewhere.id, sender.id);
      await join(elsewhere.id, reader.id);

      const dm = (slug: string, from: TestMember, to: TestMember, body: string) =>
        call("POST", `/api/member/community/${slug}/dm/${to.id}`, from.token, { body });

      expect((await dm(room.slug, sender, reader, "ZZ one")).status).toBe(201);
      expect((await dm(room.slug, sender, reader, "ZZ two")).status).toBe(201);
      expect((await dm(room.slug, third, reader, "ZZ from third")).status).toBe(201);
      expect((await dm(elsewhere.slug, sender, reader, "ZZ other room")).status).toBe(201);

      const unreadBell = async () =>
        (
          await client.query<{ actor_id: number; link: string }>(
            `SELECT actor_id, link FROM member_notifications
              WHERE member_id = $1 AND read_at IS NULL ORDER BY id`,
            [reader.id]
          )
        ).rows;

      expect(await unreadBell()).toHaveLength(4);
      const before = await get(`/api/member/community/${room.slug}/dm`, reader.token);
      const fromSender = before.body.threads.find(
        (t: { otherMemberId: number }) => t.otherMemberId === sender.id
      );
      expect(fromSender.unread).toBe(2);

      const opened = await get(`/api/member/community/${room.slug}/dm/${sender.id}`, reader.token);
      expect(opened.status).toBe(200);
      expect(opened.body.messages.map((m: { body: string }) => m.body)).toEqual(["ZZ one", "ZZ two"]);

      // The thread badge and the bell now agree for this conversation…
      const after = await get(`/api/member/community/${room.slug}/dm`, reader.token);
      expect(
        after.body.threads.find((t: { otherMemberId: number }) => t.otherMemberId === sender.id).unread
      ).toBe(0);
      // …while a different sender in the same room, and the same sender in
      // another room, are still unread.
      expect(await unreadBell()).toEqual([
        { actor_id: third.id, link: `/community/${room.slug}/messages/${third.id}` },
        { actor_id: sender.id, link: `/community/${elsewhere.slug}/messages/${sender.id}` },
      ]);

      // Opening it is only reading it for the person it was sent to: the
      // sender re-reading their own thread clears nothing of the reader's.
      await get(`/api/member/community/${elsewhere.slug}/dm/${reader.id}`, sender.token);
      expect(await unreadBell()).toHaveLength(2);
    });

    it("keeps an opened-but-empty conversation out of both lists, and tracks unread through open, no reply, then a reply", async () => {
      const room = await newCommunity();
      const tester = await newMember("ZZ DM Tester");
      const partner = await newMember("ZZ DM Partner");
      await join(room.id, tester.id);
      await join(room.id, partner.id);

      const list = (who: TestMember) => get(`/api/member/community/${room.slug}/dm`, who.token);
      const open = (who: TestMember, other: TestMember) =>
        get(`/api/member/community/${room.slug}/dm/${other.id}`, who.token);
      const send = (from: TestMember, to: TestMember, body: string) =>
        call("POST", `/api/member/community/${room.slug}/dm/${to.id}`, from.token, { body });
      const rowWith = (res: { body: any }, other: TestMember) =>
        (res.body.threads as { otherMemberId: number; unread: number; preview: string }[]).find(
          (t) => t.otherMemberId === other.id
        );
      const bell = async (who: TestMember) =>
        (
          await client.query<{ n: number }>(
            `SELECT COUNT(*)::int AS n FROM member_notifications WHERE member_id = $1 AND read_at IS NULL`,
            [who.id]
          )
        ).rows[0].n;

      // Opening the Message target creates the thread before anybody writes.
      const empty = await open(tester, partner);
      expect(empty.status).toBe(200);
      expect(empty.body.messages).toEqual([]);
      const row = await client.query(
        `SELECT last_message_at FROM community_dm_threads WHERE id = $1`,
        [empty.body.threadId]
      );
      expect(row.rows[0].last_message_at).toBeNull();

      // Deliberately unlisted by the server: the partner must not learn that the
      // tester looked, and a glance at a profile is not a conversation. The page
      // lists the open one for its opener (frontend/src/lib/dmConversations.ts).
      expect((await list(tester)).body.threads).toEqual([]);
      expect((await list(partner)).body.threads).toEqual([]);

      // The first message makes it a conversation on both sides.
      expect((await send(tester, partner, "ZZ first")).status).toBe(201);
      const senderSide = await list(tester);
      expect(rowWith(senderSide, partner)).toMatchObject({ unread: 0, preview: "ZZ first" });
      expect(senderSide.body.threads).toHaveLength(1);
      expect(senderSide.body.unreadTotal).toBe(0);
      expect(await bell(tester)).toBe(0);

      const recipientSide = await list(partner);
      expect(rowWith(recipientSide, tester)?.unread).toBe(1);
      expect(recipientSide.body.unreadTotal).toBe(1);
      expect(await bell(partner)).toBe(1);

      // The partner opens it and does not reply: read, and it stays read on
      // every later load.
      const read = await open(partner, tester);
      expect(read.body.messages).toEqual([expect.objectContaining({ body: "ZZ first", mine: false })]);
      for (let load = 0; load < 2; load += 1) {
        const again = await list(partner);
        expect(rowWith(again, tester)?.unread).toBe(0);
        expect(again.body.unreadTotal).toBe(0);
        expect(await bell(partner)).toBe(0);
      }
      // The sender re-reading their own thread changes nothing for either side.
      await open(tester, partner);
      expect(rowWith(await list(tester), partner)?.unread).toBe(0);
      expect(rowWith(await list(partner), tester)?.unread).toBe(0);

      // A reply makes it unread again, for the other side only.
      expect((await send(partner, tester, "ZZ reply")).status).toBe(201);
      expect(rowWith(await list(tester), partner)).toMatchObject({ unread: 1, preview: "ZZ reply" });
      expect(await bell(tester)).toBe(1);
      expect(rowWith(await list(partner), tester)?.unread).toBe(0);
      expect(await bell(partner)).toBe(0);

      await open(tester, partner);
      expect(rowWith(await list(tester), partner)?.unread).toBe(0);
      expect(await bell(tester)).toBe(0);
    });
  });

  /* ------------------------------------------------------------------ C6 */

  describe("C6 — one member count everywhere", () => {
    it("agrees across the header, the card, the directory and the admin definition, every load", async () => {
      const room = await newCommunity();
      const me = await newMember("ZZ Reader");
      const host = await newMember("ZZ Host");
      const plain = await newMember("ZZ Plain");
      const banned = await newMember("ZZ Banned");
      const closed = await newMember("ZZ Closed", "cancelled");
      await join(room.id, me.id);
      await join(room.id, host.id, { role: "admin" }); // admins are people too
      await join(room.id, plain.id);
      await join(room.id, banned.id, { banned: true });
      await join(room.id, closed.id);

      // The admin's "N people" (routes/admin/community.ts): active, not banned.
      const admin = await client.query<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM community_memberships m
           JOIN members mm ON mm.id = m.member_id
          WHERE m.community_id = $1 AND m.banned_at IS NULL AND mm.status = 'active'`,
        [room.id]
      );
      expect(admin.rows[0].n).toBe(3);

      for (let load = 0; load < 3; load += 1) {
        const header = await get(`/api/member/community/${room.slug}`, me.token);
        expect(header.status).toBe(200);
        expect(header.body.community.memberCount).toBe(3);
      }

      const list = await get(`/api/member/community`, me.token);
      const card = (list.body.communities as { slug: string; memberCount: number }[]).find(
        (c) => c.slug === room.slug
      );
      expect(card?.memberCount).toBe(3);

      const dir = await get(`/api/member/community/${room.slug}/members`, me.token);
      expect(dir.body.total).toBe(3);
    });
  });

  /* ------------------------------------------------------------------ C4 */

  describe("C4 — scheduled posts", () => {
    it("lets a host schedule, refuses a member and a past time, and the sweeper publishes it", async () => {
      const room = await newCommunity();
      const host = await newMember("ZZ Host");
      const plain = await newMember("ZZ Plain");
      await join(room.id, host.id, { role: "moderator" });
      await join(room.id, plain.id);
      const channel = await newChannel(room.id);
      const postsPath = `/api/member/community/${room.slug}/channels/${channel}/posts`;
      const inAnHour = new Date(Date.now() + 60 * 60_000).toISOString();

      const refused = await call("POST", postsPath, plain.token, {
        kind: "text",
        body: "ZZ not mine to schedule",
        publishAt: inAnHour,
      });
      expect(refused.status).toBe(403);

      const past = await call("POST", postsPath, host.token, {
        kind: "text",
        body: "ZZ in the past",
        publishAt: new Date(Date.now() - 60_000).toISOString(),
      });
      expect(past.status).toBe(400);
      expect(past.body.error).toMatch(/future/);

      const scheduled = await call("POST", postsPath, host.token, {
        kind: "text",
        body: "ZZ scheduled for later",
        publishAt: inAnHour,
      });
      expect(scheduled.status).toBe(201);
      expect(scheduled.body).toMatchObject({ scheduled: true, publishAt: inAnHour });

      // Invisible until its moment.
      const before = await get(postsPath, plain.token);
      expect(before.body.posts.map((p: { id: number }) => p.id)).not.toContain(scheduled.body.id);
      expect((await publishScheduledPosts()).published).toBe(0);

      // Its moment arrives; the sweeper the job schedule runs every two minutes
      // publishes it.
      await client.query(`UPDATE community_posts SET publish_at = now() - interval '1 second' WHERE id = $1`, [
        scheduled.body.id,
      ]);
      expect((await publishScheduledPosts()).published).toBe(1);

      const after = await get(postsPath, plain.token);
      expect(after.body.posts.map((p: { id: number }) => p.id)).toContain(scheduled.body.id);

      // And the recurring job the worker runs is actually on the schedule.
      const job = await client.query(
        `SELECT every_minutes, enabled FROM job_schedules WHERE kind = 'community.publishScheduled'`
      );
      expect(job.rows[0]).toMatchObject({ every_minutes: 2, enabled: true });
    });
  });

  /* ------------------------------------------------------------------ C7 */

  describe("C7 — leaderboard ranking and periods", () => {
    async function board(slug: string, token: string, period: string) {
      const res = await get(`/api/member/community/${slug}/leaderboard?period=${period}`, token);
      expect(res.status).toBe(200);
      return res.body as {
        period: string;
        leaderboard: { memberId: number; rank: number; tied: boolean; points: number }[];
        me: { rank: number } | null;
      };
    }

    it("gives two different point totals two different ranks — never both 1", async () => {
      const room = await newCommunity();
      const a = await newMember("ZZ A");
      const b = await newMember("ZZ B");
      await join(room.id, a.id, { points: 40 });
      await join(room.id, b.id, { points: 20 });

      const all = await board(room.slug, a.token, "all");
      expect(all.leaderboard.map((r) => [r.memberId, r.rank, r.tied])).toEqual([
        [a.id, 1, false],
        [b.id, 2, false],
      ]);
    });

    it("uses competition ranking: only tied members share a rank, the next one skips", async () => {
      const room = await newCommunity();
      const a = await newMember("ZZ A");
      const b = await newMember("ZZ B");
      const c = await newMember("ZZ C");
      const zero = await newMember("ZZ Zero");
      await join(room.id, a.id, { points: 50 });
      await join(room.id, b.id, { points: 50 });
      await join(room.id, c.id, { points: 30 });
      await join(room.id, zero.id, { points: 0 });

      const all = await board(room.slug, zero.token, "all");
      const byId = new Map(all.leaderboard.map((r) => [r.memberId, r]));
      expect(byId.get(a.id)).toMatchObject({ rank: 1, tied: true });
      expect(byId.get(b.id)).toMatchObject({ rank: 1, tied: true });
      expect(byId.get(c.id)).toMatchObject({ rank: 3, tied: false });
      // Nobody on zero is ranked, so two brand-new members are not both "1st".
      expect(byId.has(zero.id)).toBe(false);
      expect(all.me).toBeNull();
    });

    it("ranks week and month from points earned in that window", async () => {
      const room = await newCommunity();
      const a = await newMember("ZZ A");
      const b = await newMember("ZZ B");
      const c = await newMember("ZZ C");
      await join(room.id, a.id, { points: 10 });
      await join(room.id, b.id, { points: 110 });
      await join(room.id, c.id, { points: 5 });
      await client.query(
        `INSERT INTO community_point_events (community_id, member_id, action, points, created_at) VALUES
           ($1, $2, 'post', 10, now() - interval '1 day'),
           ($1, $3, 'post', 10, now() - interval '2 days'),
           ($1, $3, 'post', 100, now() - interval '20 days'),
           ($1, $4, 'post', 5, now() - interval '3 days')`,
        [room.id, a.id, b.id, c.id]
      );

      const week = await board(room.slug, a.token, "week");
      expect(week.period).toBe("week");
      expect(week.leaderboard.map((r) => [r.memberId, r.points, r.rank, r.tied])).toEqual(
        expect.arrayContaining([
          [a.id, 10, 1, true],
          [b.id, 10, 1, true],
          [c.id, 5, 3, false],
        ])
      );

      const month = await board(room.slug, a.token, "month");
      expect(month.leaderboard.map((r) => [r.memberId, r.points, r.rank, r.tied])).toEqual([
        [b.id, 110, 1, false],
        [a.id, 10, 2, false],
        [c.id, 5, 3, false],
      ]);
    });
  });

  describe("C7 — channel view mode reaches members", () => {
    it("carries view_mode on the overview and the channel feed, defaulting to feed", async () => {
      const room = await newCommunity();
      const me = await newMember("ZZ Reader");
      await join(room.id, me.id);
      const gallery = await newChannel(room.id, "gallery");
      const plain = await newChannel(room.id);

      const overview = await get(`/api/member/community/${room.slug}`, me.token);
      const modes = Object.fromEntries(
        (overview.body.channels as { slug: string; viewMode: string }[]).map((ch) => [ch.slug, ch.viewMode])
      );
      expect(modes[gallery]).toBe("gallery");
      expect(modes[plain]).toBe("feed");

      const feed = await get(`/api/member/community/${room.slug}/channels/${gallery}/posts`, me.token);
      expect(feed.body.channel.viewMode).toBe("gallery");
    });

    it("refuses a view mode that is not one of the three", async () => {
      const room = await newCommunity();
      await expect(newChannel(room.id, "carousel")).rejects.toThrow(/view_mode/);
    });
  });
});
