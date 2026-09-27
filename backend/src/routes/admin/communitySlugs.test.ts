import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const mocks = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock("../../db/pool", () => ({
  pool: { query: mocks.query, connect: vi.fn() },
}));
vi.mock("../../services/liveRoomBus", () => ({ liveRoster: () => [] }));
vi.mock("../../services/communityGroupPricing", () => ({
  GROUP_PRICE_COLUMNS: "g.id",
  saveAccessGroup: vi.fn(),
  deleteAccessGroup: vi.fn(),
}));
vi.mock("../../services/communityNotifications", () => ({ POINT_ACTIONS: [], notify: vi.fn() }));
vi.mock("../../jobs/queue", () => ({ enqueue: vi.fn(), PRIORITY: { transactional: 10 } }));
vi.mock("../../services/adminAudit", () => ({ recordAdminActionStrict: vi.fn() }));
vi.mock("../../services/hostLinks", () => ({ HOST_LINK_TTL_SECONDS: 120, createHostLink: vi.fn() }));
vi.mock("../../services/communityEventLocation", () => ({ communityEventLocation: vi.fn() }));
vi.mock("../../services/access", () => ({ mayEnterCommunity: vi.fn() }));

import { adminCommunityRouter } from "./community";
import { errorHandler } from "../../middleware/errorHandler";

const uniqueViolation = Object.assign(new Error("duplicate key value"), { code: "23505" });

/**
 * Slugs are unique — per community for channels, globally for communities —
 * and a clash used to reach the error handler as a raw Postgres error: a 500,
 * which the admin reads as "something went wrong on our end".
 */
describe("slug clashes on create", () => {
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

  beforeEach(() => {
    mocks.query.mockReset();
  });

  const post = (path: string, body: unknown) =>
    fetch(`${base}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  it("gives a new channel the next free slug when a renamed one still holds it", async () => {
    mocks.query
      .mockRejectedValueOnce(uniqueViolation)
      .mockResolvedValueOnce({ rows: [{ id: 9, slug: "general-2", name: "General" }], rowCount: 1 });

    const res = await post("/4/channels", { name: "General" });

    expect(res.status).toBe(201);
    expect(mocks.query).toHaveBeenCalledTimes(2);
    expect(mocks.query.mock.calls[0][1][1]).toBe("general");
    expect(mocks.query.mock.calls[1][1][1]).toBe("general-2");
  });

  it("names a channel with no latin letters rather than storing an empty slug", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [{ id: 3 }], rowCount: 1 });

    const res = await post("/4/channels", { name: "🎉" });

    expect(res.status).toBe(201);
    expect(mocks.query.mock.calls[0][1][1]).toBe("channel");
  });

  it("does not retry an error that is not a clash", async () => {
    mocks.query.mockRejectedValueOnce(Object.assign(new Error("boom"), { code: "23503" }));

    const res = await post("/4/channels", { name: "General" });

    expect(res.status).toBe(500);
    expect(mocks.query).toHaveBeenCalledTimes(1);
  });

  it("answers a community name that is already taken with 409, not 500", async () => {
    mocks.query.mockRejectedValueOnce(uniqueViolation);

    const res = await post("/", { name: "The Collective" });

    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toMatch(/already have a community/i);
  });
});
