import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
vi.mock("../../db/pool", () => ({ pool: { query: (...args: unknown[]) => query(...args) } }));
vi.mock("../../services/adminAudit", () => ({ recordAdminAction: vi.fn() }));

import { adminProductsRouter } from "./products";

function remove(id: string) {
  const layer = (adminProductsRouter.stack as any[]).find(
    (l) => l.route?.path === "/:id" && l.route.methods.delete,
  );
  const stack = layer.route.stack;
  const handler = stack[stack.length - 1].handle;
  return new Promise<{ status?: number; error?: any }>((resolve) => {
    const res: any = {
      statusCode: 200,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      end() {
        resolve({ status: this.statusCode });
        return this;
      },
    };
    handler({ params: { id } } as any, res, (error: unknown) => resolve({ error }));
  });
}

const product = { id: 4, title: "Practice Protection Pack", kind: "download" };

function usage(counts: Partial<Record<"offers" | "members" | "bundles" | "plans" | "bumps", number>>) {
  return { rows: [{ offers: 0, members: 0, bundles: 0, plans: 0, bumps: 0, ...counts }] };
}

describe("DELETE /admin/products/:id", () => {
  beforeEach(() => query.mockReset());

  // plan_products and offer_bumps both cascade off products, so deleting one
  // used to strip it silently from the plan or the offer that sells it.
  it("refuses a product a plan unlocks", async () => {
    query.mockResolvedValueOnce({ rows: [product] }).mockResolvedValueOnce(usage({ plans: 1 }));
    const { error } = await remove("4");
    expect(error?.status).toBe(400);
    expect(error?.message).toMatch(/unlocked by 1 plan/);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("refuses a product an offer sells as an order bump", async () => {
    query.mockResolvedValueOnce({ rows: [product] }).mockResolvedValueOnce(usage({ bumps: 2 }));
    const { error } = await remove("4");
    expect(error?.status).toBe(400);
    expect(error?.message).toMatch(/order bump on 2 offers/);
  });

  it("deletes a product nothing uses", async () => {
    query
      .mockResolvedValueOnce({ rows: [product] })
      .mockResolvedValueOnce(usage({}))
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });
    const { status, error } = await remove("4");
    expect(error).toBeUndefined();
    expect(status).toBe(204);
  });
});
