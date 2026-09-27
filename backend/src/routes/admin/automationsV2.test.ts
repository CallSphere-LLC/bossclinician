import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const mocks = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock("../../db/pool", () => ({ pool: { query: mocks.query } }));

import { adminAutomationsV2Router } from "./automationsV2";
import { errorHandler } from "../../middleware/errorHandler";

/**
 * POST /admin/automations — the turn-it-on gate on create.
 *
 * PATCH refuses to switch an unfinished automation on. Create accepted
 * `status: "active"` straight into the row, and a new row has no steps, so
 * anything that created one active (the voice assistant is handed this schema)
 * went live doing nothing and reported every run as a success.
 */
describe("creating an automation", () => {
  let server: ReturnType<express.Express["listen"]>;
  let base: string;

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use("/automations", adminAutomationsV2Router);
    app.use(errorHandler);
    server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/automations`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  beforeEach(() => {
    mocks.query.mockReset();
    mocks.query.mockResolvedValue({ rowCount: 1, rows: [{ id: 9, name: "Welcome", status: "paused" }] });
  });

  const create = (body: Record<string, unknown>) =>
    fetch(base, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  it("refuses to create one already switched on, because it has no steps yet", async () => {
    const res = await create({ name: "Welcome", triggerType: "form_submitted", status: "active" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/no steps yet/);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("still creates a paused one, which is how the builder asks", async () => {
    const res = await create({ name: "Welcome", triggerType: "form_submitted" });
    expect(res.status).toBe(201);
    const insert = mocks.query.mock.calls.find((call) => String(call[0]).includes("INSERT INTO automations"));
    expect(insert?.[1]?.[5]).toBe("paused");
  });
});
