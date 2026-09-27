import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
vi.mock("../../db/pool", () => ({ pool: { query: (...args: unknown[]) => query(...args) } }));
vi.mock("../../services/adminAudit", () => ({ recordAdminAction: vi.fn() }));

import { adminRedirectsRouter } from "./redirects";

/** Runs the PUT /:id handler the way Express would, and reports what it did. */
async function put(id: string, body: unknown) {
  const layer = (adminRedirectsRouter.stack as any[]).find(
    (l) => l.route?.path === "/:id" && l.route.methods.put
  );
  const handler = layer.route.stack[0].handle;
  return new Promise<{ status?: number; body?: unknown; error?: any }>((resolve) => {
    const res: any = {
      statusCode: 200,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(payload: unknown) {
        resolve({ status: this.statusCode, body: payload });
        return this;
      },
    };
    handler({ params: { id }, body } as any, res, (error: unknown) => resolve({ error }));
  });
}

describe("PUT /admin/redirects/:id", () => {
  beforeEach(() => query.mockReset());

  it("answers a moved address that another redirect already covers with a 400, not a 500", async () => {
    query.mockRejectedValueOnce(Object.assign(new Error("duplicate key"), { code: "23505" }));
    const { error } = await put("7", { fromPath: "/Taken" });
    expect(error?.status).toBe(400);
    expect(error?.message).toMatch(/already a redirect/);
  });

  it("clears the new address from the 404 report, as create does", async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 7, from_path: "/old-page", to_path: "/new" }] });
    query.mockResolvedValueOnce({ rows: [] });
    const { body } = await put("7", { fromPath: "/Old-Page/" });
    expect(body).toEqual({ id: 7, fromPath: "/old-page", toPath: "/new" });
    expect(query).toHaveBeenLastCalledWith(expect.stringContaining("not_found_log"), ["/old-page"]);
  });

  it("leaves the 404 report alone when only the destination changed", async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 7, from_path: "/a", to_path: "/b" }] });
    await put("7", { toPath: "/b" });
    expect(query).toHaveBeenCalledTimes(1);
  });
});
