import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const mocks = vi.hoisted(() => ({ query: vi.fn(), audit: vi.fn() }));

vi.mock("../../db/pool", () => ({
  pool: { query: mocks.query, connect: vi.fn() },
}));
vi.mock("../../services/adminAudit", () => ({ recordAdminAction: mocks.audit }));

import { adminMarketingStudioRouter, saveStudioSchema, MAX_BODY_LIMIT } from "./marketingStudio";
import { errorHandler } from "../../middleware/errorHandler";

const STATE = { settings: { brand: "Boss" }, posts: [{ id: "p1" }], savedIdeas: [], hookEdits: { a: 1 } };
const UPDATED = new Date("2026-11-06T18:00:00Z");

describe("saveStudioSchema", () => {
  it("accepts the studio document and keeps keys it does not check", () => {
    const parsed = saveStudioSchema.parse({ state: { ...STATE, legacy: [1] }, version: 0 });
    expect(parsed.state).toMatchObject({ hookEdits: { a: 1 }, legacy: [1] });
    expect(parsed.recovery).toBeUndefined();
  });

  it("refuses a document missing posts, savedIdeas or settings", () => {
    expect(saveStudioSchema.safeParse({ state: { settings: {}, posts: [] }, version: 0 }).success).toBe(false);
    expect(saveStudioSchema.safeParse({ state: { posts: [], savedIdeas: [] }, version: 0 }).success).toBe(false);
    expect(saveStudioSchema.safeParse({ state: { settings: [], posts: [], savedIdeas: [] }, version: 0 }).success).toBe(false);
    expect(saveStudioSchema.safeParse({ state: { settings: {}, posts: {}, savedIdeas: [] }, version: 0 }).success).toBe(false);
    expect(saveStudioSchema.safeParse({ state: [], version: 0 }).success).toBe(false);
  });

  it("refuses a missing, negative or fractional version", () => {
    expect(saveStudioSchema.safeParse({ state: STATE }).success).toBe(false);
    expect(saveStudioSchema.safeParse({ state: STATE, version: -1 }).success).toBe(false);
    expect(saveStudioSchema.safeParse({ state: STATE, version: 1.5 }).success).toBe(false);
  });

  it("takes recovery as an object or null, not anything else", () => {
    expect(saveStudioSchema.safeParse({ state: STATE, version: 0, recovery: null }).success).toBe(true);
    expect(saveStudioSchema.safeParse({ state: STATE, version: 0, recovery: { at: 1 } }).success).toBe(true);
    expect(saveStudioSchema.safeParse({ state: STATE, version: 0, recovery: "x" }).success).toBe(false);
  });
});

describe("marketing studio router", () => {
  let server: ReturnType<express.Express["listen"]>;
  let base: string;

  beforeAll(async () => {
    const app = express();
    app.use(express.json({ limit: MAX_BODY_LIMIT }));
    app.use((req, _res, next) => {
      (req as any).user = { sub: 7, email: "owner@example.invalid", role: "owner" };
      next();
    });
    app.use("/studio", adminMarketingStudioRouter);
    app.use(errorHandler);
    server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/studio`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  beforeEach(() => {
    mocks.query.mockReset();
    mocks.audit.mockReset();
  });

  const put = (body: unknown) =>
    fetch(base, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  it("answers an empty studio with null state and version 0", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const res = await fetch(base);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ state: null, recovery: null, version: 0, updatedAt: null });
  });

  it("returns the stored row", async () => {
    mocks.query.mockResolvedValueOnce({
      rows: [{ state: STATE, recovery: { r: 1 }, version: 4, updated_at: UPDATED }],
      rowCount: 1,
    });
    const body = await (await fetch(base)).json();
    expect(body).toEqual({ state: STATE, recovery: { r: 1 }, version: 4, updatedAt: UPDATED.toISOString() });
  });

  it("creates the row on the first save from version 0", async () => {
    mocks.query
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{ version: 1, updated_at: UPDATED }], rowCount: 1 });

    const res = await put({ state: STATE, version: 0 });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ version: 1, updatedAt: UPDATED.toISOString() });
    expect(mocks.query.mock.calls[1][0]).toMatch(/INSERT INTO marketing_studio_state/);
    expect(mocks.query.mock.calls[1][1][2]).toBe("owner@example.invalid");
    expect(mocks.audit).toHaveBeenCalledTimes(1);
    const audit = mocks.audit.mock.calls[0][0];
    expect(audit).toMatchObject({ action: "marketing_studio.save", entityType: "marketing_studio_state", entityId: 1 });
    expect(JSON.stringify(audit.after)).not.toContain("p1");
  });

  it("updates in place when the version matches, leaving recovery alone when omitted", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [{ version: 3, updated_at: UPDATED }], rowCount: 1 });

    const res = await put({ state: STATE, version: 2 });

    expect(res.status).toBe(200);
    expect(((await res.json()) as any).version).toBe(3);
    expect(mocks.query).toHaveBeenCalledTimes(1);
    const [sql, params] = mocks.query.mock.calls[0];
    expect(sql).toMatch(/WHERE id = 1 AND version = \$5/);
    expect(params[1]).toBe(false);
    expect(params[4]).toBe(2);
  });

  it("sets recovery when it is sent, including clearing it with null", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [{ version: 3, updated_at: UPDATED }], rowCount: 1 });
    await put({ state: STATE, version: 2, recovery: { snap: true } });
    expect(mocks.query.mock.calls[0][1].slice(1, 3)).toEqual([true, JSON.stringify({ snap: true })]);

    mocks.query.mockReset();
    mocks.query.mockResolvedValueOnce({ rows: [{ version: 4, updated_at: UPDATED }], rowCount: 1 });
    await put({ state: STATE, version: 3, recovery: null });
    expect(mocks.query.mock.calls[0][1].slice(1, 3)).toEqual([true, null]);
  });

  it("refuses a stale save with 409 and the server's copy", async () => {
    const server = { settings: {}, posts: [{ id: "newer" }], savedIdeas: [] };
    mocks.query
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{ state: server, recovery: null, version: 5, updated_at: UPDATED }], rowCount: 1 });

    const res = await put({ state: STATE, version: 4 });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "conflict", code: "version_conflict", state: server, version: 5 });
    expect(mocks.query).toHaveBeenCalledTimes(2);
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("refuses a version-0 save when someone else already created the row", async () => {
    mocks.query
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{ state: STATE, recovery: null, version: 1, updated_at: UPDATED }], rowCount: 1 });

    const res = await put({ state: STATE, version: 0 });

    expect(res.status).toBe(409);
    expect(((await res.json()) as any).version).toBe(1);
  });

  it("answers 400 for an invalid body without touching the database", async () => {
    const res = await put({ state: { posts: [] }, version: 0 });
    expect(res.status).toBe(400);
    expect(mocks.query).not.toHaveBeenCalled();
  });
});
