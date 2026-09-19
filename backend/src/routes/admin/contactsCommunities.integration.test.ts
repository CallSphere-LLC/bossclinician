import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "net";
import { createTestDatabase, hasTestDatabase, insertMember } from "../../testing/db";

const describeDb = hasTestDatabase ? describe : describe.skip;

describeDb("contact community visibility and filters", () => {
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let server: ReturnType<express.Express["listen"]>;
  let base: string;
  let contactId: number;
  let bannedId: number;
  let legacyId: number;

  beforeAll(async () => {
    db = await createTestDatabase("contactcommunity");
    process.env.DATABASE_URL = db.url;
    process.env.JWT_SECRET ??= "integration-test-secret";
    const { adminContactsRouter } = await import("./contacts");
    const { errorHandler } = await import("../../middleware/errorHandler");
    const app = express();
    app.use(express.json(), (req, _res, next) => {
      (req as any).admin = { id: 1, role: "owner" };
      next();
    });
    app.use("/contacts", adminContactsRouter);
    app.use(errorHandler);
    server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/contacts`;
    const createContact = async (email: string, name: string) => (await db.client.query(
      "INSERT INTO contacts(email, name) VALUES ($1, $2) RETURNING id", [email, name],
    )).rows[0].id as number;
    contactId = await createContact("person@example.invalid", "Two communities");
    bannedId = await createContact("banned@example.invalid", "Banned membership");
    legacyId = await createContact("legacy@example.invalid", "Legacy account");
    await createContact("none@example.invalid", "No membership");
    const memberId = await insertMember(db.client, "changed@example.invalid");
    const bannedMemberId = await insertMember(db.client, "banned@example.invalid");
    const legacyMemberId = await insertMember(db.client, "legacy@example.invalid");
    await db.client.query("UPDATE members SET contact_id=$1 WHERE id=$2", [contactId, memberId]);
    const rooms = (await db.client.query("INSERT INTO communities(slug,name) VALUES ('first','First community'),('second','Second community') RETURNING id")).rows;
    await db.client.query("INSERT INTO community_memberships(community_id,member_id) VALUES ($1,$3),($2,$3),($1,$4),($2,$5)", [rooms[0].id, rooms[1].id, memberId, bannedMemberId, legacyMemberId]);
    await db.client.query("UPDATE community_memberships SET banned_at=now() WHERE member_id=$1", [bannedMemberId]);
  }, 60_000);

  afterAll(async () => {
    await new Promise((resolve) => server?.close(resolve));
    const { pool } = await import("../../db/pool");
    await pool.end();
    await db?.drop();
  });

  it("returns all memberships on list and detail without multiplying contacts", async () => {
    const list: any = await (await fetch(base)).json();
    expect(list.total).toBe(4);
    expect(list.items.find((item: any) => item.id === contactId).communities.map((c: any) => c.name)).toEqual(["First community", "Second community"]);
    const detail: any = await (await fetch(`${base}/${contactId}`)).json();
    expect(detail.communities).toHaveLength(2);
    expect(detail.communities.every((c: any) => c.memberActive && !c.banned)).toBe(true);
    expect(list.items.find((item: any) => item.id === bannedId).communities[0].banned).toBe(true);
  });

  it("filters active community members, supports legacy links, and combines search", async () => {
    const list: any = await (await fetch(`${base}?community=true`)).json();
    expect(list.total).toBe(2);
    expect(list.items.map((item: any) => item.id).sort()).toEqual([contactId, legacyId].sort());
    const filtered: any = await (await fetch(`${base}?community=true&q=Two`)).json();
    expect(filtered.total).toBe(1);
    expect(filtered.items[0].id).toBe(contactId);
    expect((await fetch(`${base}?community=invalid`)).status).toBe(400);
  });
});
