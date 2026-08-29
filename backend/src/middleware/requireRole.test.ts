import { describe, expect, it } from "vitest";
import type { NextFunction, Request, Response } from "express";
import { requireRole } from "./requireRole";

/**
 * Regression guard for a role gate that outlived the role it names.
 *
 * `requireRole('admin')` guarded the delete route of every generic CRUD router
 * (routes/admin/crudFactory.ts — blog posts, courses, testimonials, resources,
 * growth items). Migration 016 renamed the top role from 'admin' to 'owner' and
 * promoted the existing account to it, so the literal comparison turned the
 * business owner into the one person who could not delete a blog post, while
 * the Manager under her could. That call site now gates on the permission
 * matrix; these assertions keep the helper itself from re-setting the trap.
 */

function run(role: string | undefined, required: string): unknown {
  const req = { user: role === undefined ? undefined : { sub: 1, email: "a@b.c", role } };
  let captured: unknown = "not-called";
  const next: NextFunction = (err?: unknown) => {
    captured = err;
  };
  requireRole(required)(req as Request, {} as Response, next);
  return captured;
}

describe("requireRole", () => {
  it("admits the exact role it names", () => {
    expect(run("admin", "admin")).toBeUndefined();
  });

  it("admits the owner through a gate named for another role", () => {
    expect(run("owner", "admin")).toBeUndefined();
  });

  it("refuses every other role", () => {
    for (const role of ["marketing", "support", "coach"]) {
      expect(run(role, "admin")).toMatchObject({ status: 403 });
    }
  });

  it("refuses a request with no authenticated user", () => {
    expect(run(undefined, "admin")).toMatchObject({ status: 403 });
  });
});
