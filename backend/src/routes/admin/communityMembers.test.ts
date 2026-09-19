import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const mocks = vi.hoisted(() => ({
  clientQuery: vi.fn(),
  release: vi.fn(),
  notify: vi.fn(),
  enqueue: vi.fn(),
  mayEnterCommunity: vi.fn(),
}));

vi.mock("../../db/pool", () => ({
  pool: {
    query: vi.fn(),
    connect: async () => ({ query: mocks.clientQuery, release: mocks.release }),
  },
}));
vi.mock("../../services/liveRoomBus", () => ({ liveRoster: () => [] }));
vi.mock("../../services/communityGroupPricing", () => ({
  GROUP_PRICE_COLUMNS: "g.id",
  saveAccessGroup: vi.fn(),
  deleteAccessGroup: vi.fn(),
}));
vi.mock("../../services/communityNotifications", () => ({
  POINT_ACTIONS: [],
  notify: mocks.notify,
}));
vi.mock("../../jobs/queue", () => ({
  enqueue: mocks.enqueue,
  PRIORITY: { transactional: 10, normal: 0, bulk: -10 },
}));
vi.mock("../../services/adminAudit", () => ({ recordAdminActionStrict: vi.fn() }));
vi.mock("../../services/hostLinks", () => ({
  HOST_LINK_TTL_SECONDS: 120,
  createHostLink: vi.fn(),
}));
vi.mock("../../services/communityEventLocation", () => ({ communityEventLocation: vi.fn() }));
vi.mock("../../services/access", () => ({ mayEnterCommunity: mocks.mayEnterCommunity }));

import { adminCommunityRouter } from "./community";
import { errorHandler } from "../../middleware/errorHandler";

/** The statement a call reached, so an assertion can name it rather than an index. */
function statement(fragment: string): { sql: string; params: unknown[] } | undefined {
  const call = mocks.clientQuery.mock.calls.find(
    (args) => typeof args[0] === "string" && args[0].includes(fragment),
  );
  return call ? { sql: call[0] as string, params: (call[1] ?? []) as unknown[] } : undefined;
}

/**
 * POST /admin/community/:id/members — "Add someone".
 *
 * The list it picks from is every member on the platform, not the ones who are
 * missing from this room, so adding somebody who is already in it is a click
 * anybody can make. What that click must NOT do is rewrite the row underneath
 * them: `services/access.ts` reads `source = 'manual'` as an entitlement in its
 * own right and deliberately does not read `'purchase'`, so promoting a working
 * membership to manual outlives the subscription or the grant paying for it.
 */
describe("adding a member to a community", () => {
  let server: ReturnType<express.Express["listen"]>;
  let base: string;

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use("/community", adminCommunityRouter);
    app.use(errorHandler);
    server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/community`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  /** `conflicted` decides whether the INSERT returns a row or hits the unique index. */
  function wireClient(conflicted: boolean) {
    mocks.clientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM communities")) {
        return { rows: [{ name: "Clinical Leaders", slug: "clinical-leaders" }], rowCount: 1 };
      }
      if (sql.includes("FROM members")) return { rows: [{ id: 5 }], rowCount: 1 };
      if (sql.startsWith("INSERT INTO community_memberships") || sql.includes("INSERT INTO community_memberships")) {
        return conflicted
          ? { rows: [], rowCount: 0 }
          : { rows: [{ id: 91, role: "member", source: "manual" }], rowCount: 1 };
      }
      if (sql.includes("UPDATE community_memberships")) {
        return { rows: [{ id: 91, role: "moderator", source: "plan" }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.notify.mockResolvedValue(1);
    mocks.enqueue.mockResolvedValue("job-1");
    mocks.mayEnterCommunity.mockResolvedValue(false);
  });

  async function add(body: Record<string, unknown>) {
    return fetch(`${base}/7/members`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("leaves a working membership's source alone when it is re-added by hand", async () => {
    wireClient(true);
    mocks.mayEnterCommunity.mockResolvedValue(true);

    expect((await add({ memberId: 5 })).status).toBe(201);
    expect(mocks.mayEnterCommunity).toHaveBeenCalledWith(5, 7);

    const update = statement("UPDATE community_memberships");
    expect(update?.sql).toContain("CASE WHEN $4::bool THEN source ELSE 'manual' END");
    // true → keep whatever source the row already has, so a plan membership
    // still dies with its subscription and a bought one with its grant.
    expect(update?.params[3]).toBe(true);
  });

  it("takes the membership over by hand when the room is shut to them", async () => {
    wireClient(true);
    mocks.mayEnterCommunity.mockResolvedValue(false);

    expect((await add({ memberId: 5 })).status).toBe(201);
    expect(statement("UPDATE community_memberships")?.params[3]).toBe(false);
  });

  it("does not demote a moderator who was added again without a role", async () => {
    wireClient(true);

    expect((await add({ memberId: 5 })).status).toBe(201);
    const update = statement("UPDATE community_memberships");
    expect(update?.sql).toContain("role = COALESCE($3, role)");
    expect(update?.params[2]).toBeNull();
  });

  it("moves the role when one was actually asked for", async () => {
    wireClient(true);

    expect((await add({ memberId: 5, role: "moderator" })).status).toBe(201);
    expect(statement("UPDATE community_memberships")?.params[2]).toBe("moderator");
  });

  it("notifies and queues the welcome only for a membership it created", async () => {
    wireClient(false);

    expect((await add({ memberId: 5 })).status).toBe(201);
    expect(statement("INSERT INTO community_memberships")?.params[2]).toBe("member");
    expect(mocks.notify).toHaveBeenCalledOnce();
    expect(mocks.enqueue).toHaveBeenCalledOnce();
    expect(mocks.enqueue.mock.calls[0][0]).toMatchObject({
      kind: "community.membershipWelcome",
      payload: { membershipId: 91 },
      dedupeKey: "community-membership-welcome:91",
    });
  });

  it("says nothing to somebody who was already in the room", async () => {
    wireClient(true);

    expect((await add({ memberId: 5 })).status).toBe(201);
    expect(mocks.notify).not.toHaveBeenCalled();
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it("refuses a role the community does not have, before opening a transaction", async () => {
    wireClient(false);

    expect((await add({ memberId: 5, role: "owner" })).status).toBe(400);
    expect((await add({ memberId: 0 })).status).toBe(400);
    expect(mocks.clientQuery).not.toHaveBeenCalled();
    expect(mocks.mayEnterCommunity).not.toHaveBeenCalled();
  });

  it("rolls back and releases the connection when the welcome cannot be queued", async () => {
    wireClient(false);
    mocks.enqueue.mockRejectedValue(new Error("test queue failure"));

    expect((await add({ memberId: 5 })).status).toBe(500);
    expect(statement("ROLLBACK")).toBeDefined();
    expect(statement("COMMIT")).toBeUndefined();
    expect(mocks.release).toHaveBeenCalledOnce();
  });
});
