import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import type { Client } from "pg";
import type { AddressInfo } from "net";
import { createTestDatabase, hasTestDatabase, insertMember, insertOffer } from "../../testing/db";

/**
 * Integration tests for the community ADMIN api.
 *
 * Two properties, both of which failed on the live site and neither of which a
 * unit test can see, because both live entirely in SQL.
 *
 * 1. The admin's view of a community is unscoped. An invite-only channel, and
 *    one limited to a tier the admin is not in, must still appear in the list
 *    and in the channel count — a channel its owner cannot see is a channel its
 *    owner cannot rename, moderate, re-open or delete. This is the regression
 *    that will silently come back the first time somebody "fixes" the admin
 *    query by copying the member one, so it is asserted from the outside.
 *
 * 2. Scheduling actually schedules. A post written with `publishAt` is held
 *    invisible, listed on the scheduled screen, and published by the sweeper
 *    when its moment passes.
 *
 * Skipped when TEST_DATABASE_URL is unset, like every other suite here.
 */

const describeDb = hasTestDatabase ? describe : describe.skip;

describeDb("community admin api (integration)", () => {
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let client: Client;
  let publishScheduledPosts: typeof import("../../jobs/communityJobs").publishScheduledPosts;
  let server: ReturnType<express.Express["listen"]>;
  let baseUrl: string;

  beforeAll(async () => {
    db = await createTestDatabase("admincommunity");
    client = db.client;

    // config/env reads process.env at import time, so the environment has to
    // point at the scratch database before the first dynamic import.
    process.env.DATABASE_URL = db.url;
    process.env.JWT_SECRET ??= "integration-test-secret";

    const { adminCommunityRouter } = await import("./community");
    const { errorHandler } = await import("../../middleware/errorHandler");
    publishScheduledPosts = (await import("../../jobs/communityJobs")).publishScheduledPosts;

    // Mounted without the admin session middleware on purpose: who may call
    // these is settled in routes/admin/index.ts, and what they do is what is
    // under test here.
    const app = express();
    app.use(express.json());
    app.use("/admin/community", adminCommunityRouter);
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

  async function call(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ status: number; body: any }> {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  }

  async function newCommunity(): Promise<number> {
    const slug = unique("room");
    const res = await client.query<{ id: number }>(
      `INSERT INTO communities (slug, name, access, published) VALUES ($1, $2, 'free', true)
       RETURNING id`,
      [slug, `Room ${slug}`],
    );
    return res.rows[0].id;
  }

  /* --------------------------------------------------- admin sees it all */

  it("lists every channel in the community, restricted or not", async () => {
    const communityId = await newCommunity();

    const group = await call("POST", `/admin/community/${communityId}/access-groups`, {
      name: unique("Inner Circle"),
      description: "The paid tier",
    });
    expect(group.status).toBe(201);

    const open = await call("POST", `/admin/community/${communityId}/channels`, {
      name: "Wins and Wednesdays",
    });
    const invite = await call("POST", `/admin/community/${communityId}/channels`, {
      name: "ZZ Verify gallery",
      visibility: "private",
      viewModes: ["gallery"],
      defaultViewMode: "gallery",
    });
    const tiered = await call("POST", `/admin/community/${communityId}/channels`, {
      name: "Inner Circle only",
      accessGroupId: group.body.id,
    });
    expect([open.status, invite.status, tiered.status]).toEqual([201, 201, 201]);

    // The restricted channels were stored as restricted, rather than quietly
    // downgraded to public — which is the other way this bug could have read.
    expect(invite.body.visibility).toBe("private");
    expect(invite.body.viewModes).toEqual(["gallery"]);
    expect(tiered.body.accessGroupId).toBe(group.body.id);

    const detail = await call("GET", `/admin/community/${communityId}`);
    expect(detail.status).toBe(200);
    const names = (detail.body.channels as { name: string }[]).map((ch) => ch.name).sort();
    expect(names).toEqual(["Inner Circle only", "Wins and Wednesdays", "ZZ Verify gallery"]);

    // …and the list's own count agrees with the list. An admin told "1" while
    // three channels exist has been given a number that cannot be acted on.
    const list = await call("GET", "/admin/community");
    const card = (list.body as { id: number; channelCount: number }[]).find(
      (row) => row.id === communityId,
    );
    expect(card?.channelCount).toBe(3);
  });

  it("keeps an invite-only channel through a reload, and can re-open it", async () => {
    const communityId = await newCommunity();
    const created = await call("POST", `/admin/community/${communityId}/channels`, {
      name: "ZZ Persist Check",
      visibility: "private",
    });
    expect(created.status).toBe(201);

    // The bug as reported: created, visible, then gone on the next read.
    const reloaded = await call("GET", `/admin/community/${communityId}`);
    expect((reloaded.body.channels as { id: number }[]).map((ch) => ch.id)).toEqual([
      created.body.id,
    ]);

    // The settings screen the channel never had: re-open it, retier it, rename
    // it. A create form without an edit form is a one-way door.
    const saved = await call("PUT", `/admin/community/channels/${created.body.id}`, {
      name: "Persist Check",
      visibility: "public",
      viewModes: ["feed", "gallery"],
      defaultViewMode: "gallery",
    });
    expect(saved.status).toBe(200);
    expect(saved.body.visibility).toBe("public");
    expect(saved.body.defaultViewMode).toBe("gallery");
    // The slug is in every link a member already has, so renaming leaves it.
    expect(saved.body.slug).toBe("zz-persist-check");

    const deleted = await call("DELETE", `/admin/community/channels/${created.body.id}`);
    expect(deleted.status).toBe(204);
    const after = await call("GET", `/admin/community/${communityId}`);
    expect(after.body.channels).toEqual([]);
  });

  it("refuses a tier from another community", async () => {
    const [a, b] = [await newCommunity(), await newCommunity()];
    const group = await call("POST", `/admin/community/${a}/access-groups`, {
      name: unique("Elsewhere"),
    });
    const refused = await call("POST", `/admin/community/${b}/channels`, {
      name: "Wrong tier",
      accessGroupId: group.body.id,
    });
    // A channel scoped to a tier in another room is a channel nobody can ever
    // be in, and no screen would ever explain why.
    expect(refused.status).toBe(400);
  });

  /* ------------------------------------------------------ channel invites */

  it("only invites people who are in the community", async () => {
    const communityId = await newCommunity();
    const channel = await call("POST", `/admin/community/${communityId}/channels`, {
      name: "Invite only",
      visibility: "private",
    });
    const outsider = await insertMember(client, `${unique("outsider")}@test.invalid`);
    const insider = await insertMember(client, `${unique("insider")}@test.invalid`);
    await call("POST", `/admin/community/${communityId}/members`, { memberId: insider });

    const refused = await call(
      "POST",
      `/admin/community/channels/${channel.body.id}/invites`,
      { memberId: outsider },
    );
    expect(refused.status).toBe(400);

    const accepted = await call(
      "POST",
      `/admin/community/channels/${channel.body.id}/invites`,
      { memberId: insider },
    );
    expect(accepted.status).toBe(201);

    const invites = await call("GET", `/admin/community/channels/${channel.body.id}/invites`);
    expect((invites.body as { memberId: number }[]).map((row) => row.memberId)).toEqual([insider]);

    // The count travels with the channel, so the list can say who is in it.
    const detail = await call("GET", `/admin/community/${communityId}`);
    expect((detail.body.channels as { invitedCount: number }[])[0].invitedCount).toBe(1);

    const removed = await call(
      "DELETE",
      `/admin/community/channels/${channel.body.id}/invites/${insider}`,
    );
    expect(removed.status).toBe(204);
    expect((await call("GET", `/admin/community/channels/${channel.body.id}/invites`)).body).toEqual(
      [],
    );
  });

  /* ---------------------------------------------------- scheduled posting */

  it("holds a scheduled post back, then publishes it when it is due", async () => {
    const communityId = await newCommunity();
    const channel = await call("POST", `/admin/community/${communityId}/channels`, {
      name: "Announcements",
    });

    const soon = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const scheduled = await call("POST", `/admin/community/channels/${channel.body.id}/posts`, {
      body: "Doors open on Monday.",
      publishAt: soon,
    });
    expect(scheduled.status).toBe(201);
    expect(scheduled.body.status).toBe("scheduled");

    // It is on the screen the empty state promised it would be on.
    const waiting = await call("GET", `/admin/community/${communityId}/scheduled-posts`);
    expect((waiting.body as { id: number }[]).map((row) => row.id)).toEqual([scheduled.body.id]);

    // The sweeper leaves it alone while it is still in the future.
    expect(await publishScheduledPosts()).toEqual({ published: 0 });

    // A past moment is refused rather than published immediately: publishing it
    // would hide what is almost always a timezone mistake.
    const past = await call("POST", `/admin/community/channels/${channel.body.id}/posts`, {
      body: "Yesterday.",
      publishAt: new Date(Date.now() - 60_000).toISOString(),
    });
    expect(past.status).toBe(400);

    await client.query(
      `UPDATE community_posts SET publish_at = now() - interval '1 minute' WHERE id = $1`,
      [scheduled.body.id],
    );
    expect(await publishScheduledPosts()).toEqual({ published: 1 });

    const published = await client.query<{ status: string; publish_at: Date | null }>(
      `SELECT status, publish_at FROM community_posts WHERE id = $1`,
      [scheduled.body.id],
    );
    expect(published.rows[0].status).toBe("visible");
    expect((await call("GET", `/admin/community/${communityId}/scheduled-posts`)).body).toEqual([]);

    // Posting with no time still posts now, which is the common case.
    const now = await call("POST", `/admin/community/channels/${channel.body.id}/posts`, {
      body: "Right now.",
    });
    expect(now.body.status).toBe("visible");
  });

  /* ------------------------------------------------- offers grant a tier */

  it("lets an offer grant a tier, and says which offers do", async () => {
    const communityId = await newCommunity();
    const group = await call("POST", `/admin/community/${communityId}/access-groups`, {
      name: unique("VIP tier"),
    });

    // An offer that sells this community, which is what makes the tier reachable.
    const product = await client.query<{ id: number }>(
      `INSERT INTO products (slug, title, kind, community_id, status)
       VALUES ($1, $2, 'community', $3, 'published') RETURNING id`,
      [unique("community-product"), "The room", communityId],
    );
    const offerId = await insertOffer(client, unique("offer"), [product.rows[0].id]);

    const saved = await call("PUT", `/admin/community/offers/${offerId}/access-group`, {
      accessGroupId: group.body.id,
    });
    expect(saved.status).toBe(200);
    expect(saved.body.accessGroupId).toBe(group.body.id);

    const read = await call("GET", `/admin/community/offers/${offerId}/access-group`);
    expect(read.body.accessGroupId).toBe(group.body.id);
    expect(read.body.communityId).toBe(communityId);

    const grants = await call(
      "GET",
      `/admin/community/${communityId}/access-groups/${group.body.id}/grants`,
    );
    expect((grants.body.offers as { id: number }[]).map((row) => row.id)).toEqual([offerId]);

    // An offer that sells nothing in this community cannot grant its tiers.
    const unrelated = await insertOffer(client, unique("offer"), []);
    const refused = await call("PUT", `/admin/community/offers/${unrelated}/access-group`, {
      accessGroupId: group.body.id,
    });
    expect(refused.status).toBe(400);

    // And it can be cleared again.
    const cleared = await call("PUT", `/admin/community/offers/${offerId}/access-group`, {
      accessGroupId: null,
    });
    expect(cleared.body.accessGroupId).toBeNull();
  });

  /* --------------------------------------------------- leaderboard, ranks */

  it("does not put everybody who has never posted in first place", async () => {
    const communityId = await newCommunity();
    for (const label of ["one", "two"]) {
      const memberId = await insertMember(client, `${unique(label)}@test.invalid`);
      await call("POST", `/admin/community/${communityId}/members`, { memberId });
    }

    // Two members, both on nothing. RANK() made both of them "1", which is how
    // this read on the live site: a membership list with a trophy on it.
    const empty = await call("GET", `/admin/community/${communityId}/leaderboard`);
    expect(empty.body).toEqual([]);

    await client.query(
      `UPDATE community_memberships SET points = 5 WHERE community_id = $1`,
      [communityId],
    );
    const tied = await call("GET", `/admin/community/${communityId}/leaderboard`);
    // A real tie still shares a rank — that part was right — and now says so.
    expect((tied.body as { rank: number; tied: boolean }[]).map((r) => [r.rank, r.tied])).toEqual([
      [1, true],
      [1, true],
    ]);
  });

  /* ------------------------------------------------- channel settings (C7) */

  it("reorders every channel at once, and refuses an order that isn't this community's", async () => {
    const communityId = await newCommunity();
    const other = await newCommunity();
    const ids: number[] = [];
    for (const name of ["ZZ First", "ZZ Second", "ZZ Third"]) {
      const created = await call("POST", `/admin/community/${communityId}/channels`, { name });
      expect(created.status).toBe(201);
      ids.push(created.body.id);
    }
    const foreign = await call("POST", `/admin/community/${other}/channels`, {
      name: "ZZ Elsewhere",
    });

    const names = async (): Promise<string[]> =>
      ((await call("GET", `/admin/community/${communityId}`)).body.channels as { name: string }[]).map(
        (ch) => ch.name,
      );

    const saved = await call("PUT", `/admin/community/${communityId}/channels/order`, {
      channelIds: [ids[2], ids[0], ids[1]],
    });
    expect(saved.status).toBe(200);
    // Read back, not trusted from the response: the order is what a reload shows.
    expect(await names()).toEqual(["ZZ Third", "ZZ First", "ZZ Second"]);

    // A partial list, a channel from another community, and a duplicate are all
    // refused with a reason, and none of them moves anything.
    for (const channelIds of [
      [ids[0], ids[1]],
      [ids[0], ids[1], foreign.body.id],
      [ids[0], ids[0], ids[1]],
    ]) {
      const refused = await call("PUT", `/admin/community/${communityId}/channels/order`, {
        channelIds,
      });
      expect(refused.status).toBe(400);
      // Told why, not just refused.
      expect(String(refused.body.error ?? "").length).toBeGreaterThan(10);
    }
    expect(await names()).toEqual(["ZZ Third", "ZZ First", "ZZ Second"]);

    const untouched = await client.query<{ sort: number }>(
      `SELECT sort FROM community_channels WHERE id = $1`,
      [foreign.body.id],
    );
    expect(untouched.rows[0].sort).toBe(0);
  });

  it("writes the view mode a channel opens in, through create and the settings save", async () => {
    const communityId = await newCommunity();
    const created = await call("POST", `/admin/community/${communityId}/channels`, {
      name: "ZZ View mode",
      viewMode: "forum",
    });
    expect(created.status).toBe(201);
    expect(created.body.viewMode).toBe("forum");
    expect(created.body.defaultViewMode).toBe("forum");
    expect(created.body.viewModes).toEqual(["forum"]);
    const id = created.body.id as number;

    // viewMode alone: written to view_mode, and the offered set grows to hold
    // it rather than tripping the CHECK and coming back as a 500.
    const gallery = await call("PUT", `/admin/community/channels/${id}`, { viewMode: "gallery" });
    expect(gallery.status).toBe(200);
    expect(gallery.body.viewMode).toBe("gallery");
    expect(gallery.body.defaultViewMode).toBe("gallery");
    expect(gallery.body.viewModes).toEqual(["forum", "gallery"]);

    const stored = await client.query<{ view_mode: string }>(
      `SELECT view_mode FROM community_channels WHERE id = $1`,
      [id],
    );
    expect(stored.rows[0].view_mode).toBe("gallery");

    // The settings form's own save: everything at once, rename included.
    const full = await call("PUT", `/admin/community/channels/${id}`, {
      name: "ZZ View mode renamed",
      visibility: "private",
      viewModes: ["feed", "forum"],
      defaultViewMode: "feed",
      viewMode: "feed",
    });
    expect(full.status).toBe(200);
    expect(full.body).toMatchObject({
      name: "ZZ View mode renamed",
      visibility: "private",
      viewMode: "feed",
      defaultViewMode: "feed",
      viewModes: ["feed", "forum"],
    });

    // Refused with words, never stored.
    const unknown = await call("PUT", `/admin/community/channels/${id}`, { viewMode: "grid" });
    expect(unknown.status).toBe(400);
    expect(JSON.stringify(unknown.body)).toContain("feed, a forum or a gallery");
    const outside = await call("PUT", `/admin/community/channels/${id}`, {
      viewModes: ["feed"],
      viewMode: "gallery",
    });
    expect(outside.status).toBe(400);
    const after = await client.query<{ view_mode: string }>(
      `SELECT view_mode FROM community_channels WHERE id = $1`,
      [id],
    );
    expect(after.rows[0].view_mode).toBe("feed");
  });

  it("deletes a channel with everything in it, and says so when it is already gone", async () => {
    const communityId = await newCommunity();
    const channel = await call("POST", `/admin/community/${communityId}/channels`, {
      name: "ZZ Delete me",
      visibility: "private",
    });
    const id = channel.body.id as number;
    expect(
      (await call("POST", `/admin/community/channels/${id}/posts`, { body: "ZZ post" })).status,
    ).toBe(201);
    const invitee = await insertMember(client, `${unique("zz-invitee")}@test.invalid`);
    await call("POST", `/admin/community/${communityId}/members`, { memberId: invitee });
    expect(
      (await call("POST", `/admin/community/channels/${id}/invites`, { memberId: invitee })).status,
    ).toBe(201);

    expect((await call("DELETE", `/admin/community/channels/${id}`)).status).toBe(204);

    // Gone from the list and from the card's count, after a fresh read.
    expect((await call("GET", `/admin/community/${communityId}`)).body.channels).toEqual([]);
    const card = ((await call("GET", "/admin/community")).body as { id: number; channelCount: number }[])
      .find((row) => row.id === communityId);
    expect(card?.channelCount).toBe(0);

    // Its posts and invitations go with it rather than lingering unreachable.
    const leftovers = await client.query<{ posts: number; invites: number }>(
      `SELECT (SELECT COUNT(*) FROM community_posts WHERE channel_id = $1)::int AS posts,
              (SELECT COUNT(*) FROM community_channel_members WHERE channel_id = $1)::int AS invites`,
      [id],
    );
    expect(leftovers.rows[0]).toEqual({ posts: 0, invites: 0 });

    expect((await call("DELETE", `/admin/community/channels/${id}`)).status).toBe(404);
    expect((await call("PUT", `/admin/community/channels/${id}`, { name: "ZZ ghost" })).status).toBe(
      404,
    );
  });

  it("lists the offers that sell the community, with the tier each grants", async () => {
    const communityId = await newCommunity();
    const group = await call("POST", `/admin/community/${communityId}/access-groups`, {
      name: unique("ZZ Tier"),
    });
    const product = await client.query<{ id: number }>(
      `INSERT INTO products (slug, title, kind, community_id, status)
       VALUES ($1, $2, 'community', $3, 'published') RETURNING id`,
      [unique("zz-community-product"), "ZZ The room", communityId],
    );
    const selling = await insertOffer(client, unique("zz-offer"), [product.rows[0].id]);
    await insertOffer(client, unique("zz-unrelated"), []);

    const listed = await call("GET", `/admin/community/${communityId}/offers`);
    expect(listed.status).toBe(200);
    expect((listed.body as { id: number }[]).map((row) => row.id)).toEqual([selling]);
    expect(listed.body[0].accessGroupId).toBeNull();

    await call("PUT", `/admin/community/offers/${selling}/access-group`, {
      accessGroupId: group.body.id,
    });
    const after = await call("GET", `/admin/community/${communityId}/offers`);
    expect(after.body[0]).toMatchObject({
      id: selling,
      accessGroupId: group.body.id,
      accessGroupName: group.body.name,
    });
  });
  it("creates a priced group with a published checkout and grants only after payment", async () => {
    const communityId = await newCommunity();
    const memberId = await insertMember(client, `${unique("tier-buyer")}@test.invalid`);
    const access = await import("../../services/access");
    const created = await call("POST", `/admin/community/${communityId}/access-groups`, {
      name: "Paid coaching", pricingType: "subscription", amountCents: 4900, currency: "usd", interval: "month",
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({pricingType:"subscription",amountCents:4900,currency:"usd",interval:"month"});
    expect(created.body.checkoutOfferId).toBeTypeOf("number");
    expect(created.body.checkoutSlug).toMatch(/^community-/);
    const catalog = await client.query(`SELECT o.status,p.kind,p.community_id,p.access_group_id FROM offers o JOIN offer_products op ON op.offer_id=o.id JOIN products p ON p.id=op.product_id WHERE o.id=$1`,[created.body.checkoutOfferId]);
    expect(catalog.rows[0]).toEqual({status:"published",kind:"access_group",community_id:communityId,access_group_id:created.body.id});
    // Selling a tier must not close the rest of a previously free community.
    expect(await access.mayEnterCommunity(memberId,communityId)).toBe(true);
    expect(await access.memberAccessGroupIds(memberId)).not.toContain(created.body.id);
    await client.query(`UPDATE communities SET access='paid' WHERE id=$1`,[communityId]);
    expect(await access.mayEnterCommunity(memberId,communityId)).toBe(false);
    await access.grantOfferAccess({memberId,offerId:created.body.checkoutOfferId,source:"purchase"});
    expect(await access.mayEnterCommunity(memberId,communityId)).toBe(true);
    expect(await access.memberAccessGroupIds(memberId)).toContain(created.body.id);
    await access.revokeOfferAccess({memberId,offerId:created.body.checkoutOfferId,reason:"refunded"});
    expect(await access.mayEnterCommunity(memberId,communityId)).toBe(false);
    expect(await access.memberAccessGroupIds(memberId)).not.toContain(created.body.id);
  });

  it("requires a real paid price and rolls failed group creation back", async () => {
    const communityId=await newCommunity();
    for(const amountCents of [undefined,0,49,-1]) {
      const result=await call("POST",`/admin/community/${communityId}/access-groups`,{name:"Invalid paid",pricingType:"one_time",amountCents});
      expect(result.status).toBe(400);
    }
    const groups=await call("GET",`/admin/community/${communityId}/access-groups`);
    expect(groups.body).toEqual([]);
  });

  it("creates an explicit free enrollment checkout and keeps legacy groups unconfigured",async()=>{
    const communityId=await newCommunity();
    const legacy=await call("POST",`/admin/community/${communityId}/access-groups`,{name:"Existing invitation tier"});
    expect(legacy.body.checkoutOfferId).toBeNull();
    expect(legacy.body.pricingType).toBeNull();
    const free=await call("POST",`/admin/community/${communityId}/access-groups`,{name:"Free enrollment",pricingType:"free",amountCents:999});
    expect(free.status).toBe(201);
    expect(free.body).toMatchObject({pricingType:"free",amountCents:0,interval:null});
    expect(free.body.checkoutSlug).toBeTruthy();
  });

  it("reprices future checkout without losing existing members, and archives deleted group checkout",async()=>{
    const communityId=await newCommunity();
    const other=await newCommunity();
    const group=await call("POST",`/admin/community/${communityId}/access-groups`,{name:"Lifetime",pricingType:"one_time",amountCents:12000});
    const memberId=await insertMember(client,`${unique("existing-tier")}@test.invalid`);
    const access=await import("../../services/access");
    await access.grantOfferAccess({memberId,offerId:group.body.checkoutOfferId,source:"purchase"});
    await client.query(`UPDATE offers SET stripe_price_id='price_old' WHERE id=$1`,[group.body.checkoutOfferId]);
    const wrong=await call("PUT",`/admin/community/${other}/access-groups/${group.body.id}`,{name:"Hijack"});
    expect(wrong.status).toBe(404);
    const update=await call("PUT",`/admin/community/${communityId}/access-groups/${group.body.id}`,{name:"Lifetime updated",pricingType:"one_time",amountCents:15000});
    expect(update.body.checkoutOfferId).toBe(group.body.checkoutOfferId);
    expect(update.body.checkoutSlug).toBe(group.body.checkoutSlug);
    expect(await access.memberAccessGroupIds(memberId)).toContain(group.body.id);
    expect((await client.query(`SELECT stripe_price_id FROM offers WHERE id=$1`,[group.body.checkoutOfferId])).rows[0].stripe_price_id).toBeNull();
    const deleted=await call("DELETE",`/admin/community/${communityId}/access-groups/${group.body.id}`);
    expect(deleted.status).toBe(204);
    expect((await client.query(`SELECT status FROM offers WHERE id=$1`,[group.body.checkoutOfferId])).rows[0].status).toBe("archived");
  });

  it("creates native community events without an external URL and enables the live room atomically",async()=>{
    const communityId=await newCommunity();
    await client.query(`UPDATE communities SET live_room_enabled=false WHERE id=$1`,[communityId]);
    const created=await call("POST",`/admin/community/${communityId}/events`,{title:"Native meeting",joinMode:"native",startsAt:new Date(Date.now()+3600000).toISOString()});
    expect(created.status).toBe(201);
    expect(created.body.locationUrl).toBe("");
    expect((await client.query(`SELECT live_room_enabled FROM communities WHERE id=$1`,[communityId])).rows[0].live_room_enabled).toBe(true);
    const invalid=await call("POST",`/admin/community/${communityId}/events`,{title:"Unsafe link",joinMode:"external",locationUrl:"javascript:alert(1)"});
    expect(invalid.status).toBe(400);
    expect((await call("GET",`/admin/community/${communityId}/events`)).body).toHaveLength(1);
  });

  it("switches an external event to the native room and enables that community only",async()=>{
    const communityId=await newCommunity();
    const other=await newCommunity();
    await client.query(`UPDATE communities SET live_room_enabled=false WHERE id=ANY($1::int[])`,[[communityId,other]]);
    const created=await call("POST",`/admin/community/${communityId}/events`,{title:"External meeting",joinMode:"external",locationUrl:"https://meet.example.test/room"});
    expect(created.status).toBe(201);
    expect(created.body.locationUrl).toBe("https://meet.example.test/room");
    expect((await client.query(`SELECT live_room_enabled FROM communities WHERE id=$1`,[communityId])).rows[0].live_room_enabled).toBe(false);
    const updated=await call("PUT",`/admin/community/events/${created.body.id}`,{joinMode:"native"});
    expect(updated.status).toBe(200);
    expect(updated.body.locationUrl).toBe("");
    expect((await client.query(`SELECT live_room_enabled FROM communities WHERE id=$1`,[communityId])).rows[0].live_room_enabled).toBe(true);
    expect((await client.query(`SELECT live_room_enabled FROM communities WHERE id=$1`,[other])).rows[0].live_room_enabled).toBe(false);
  });

});
