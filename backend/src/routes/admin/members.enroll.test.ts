import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
vi.mock("../../db/pool", () => ({ pool: { query: (...args: unknown[]) => query(...args), connect: vi.fn() } }));
vi.mock("../../email/mailer", () => ({ sendMail: vi.fn() }));
vi.mock("../../services/adminAudit", () => ({ recordAdminAction: vi.fn(), recordAdminActionStrict: vi.fn() }));

import { adminMembersRouter } from "./members";

function enroll(id: string, body: unknown) {
  const layer = (adminMembersRouter.stack as any[]).find(
    (l) => l.route?.path === "/:id/enrollments" && l.route.methods.post,
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
      json() {
        resolve({ status: this.statusCode });
        return this;
      },
    };
    handler({ params: { id }, body } as any, res, (error: unknown) => resolve({ error }));
  });
}

describe("POST /admin/members/:id/enrollments", () => {
  beforeEach(() => query.mockReset());

  // An anonymised row is a financial stub; enrolling it would hand a course to
  // an account nobody can sign in to, the same half-resurrection the other
  // write paths refuse.
  it("refuses a deleted member without writing an enrollment", async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 7, status: "deleted" }] });
    const { error } = await enroll("7", { courseId: 3 });
    expect(error?.status).toBe(400);
    expect(error?.message).toMatch(/has been deleted/);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("enrolls a live member", async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: 7, status: "active" }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 1, member_id: 7, course_id: 3 }] });
    const { status, error } = await enroll("7", { courseId: 3 });
    expect(error).toBeUndefined();
    expect(status).toBe(201);
  });
});
