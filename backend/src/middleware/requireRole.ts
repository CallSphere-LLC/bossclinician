import { NextFunction, Request, Response } from "express";
import { forbidden } from "../utils/httpError";

/**
 * Requires the authenticated user's role to match `role`.
 * Must run after `requireAuth` (which puts the row's role on the request).
 *
 * `owner` satisfies every gate, and that is not a convenience. Migration 016
 * renamed the top role from 'admin' to 'owner' and promoted the existing
 * account to it, which turned the literal `requireRole('admin')` that used to
 * guard every generic CRUD delete (routes/admin/crudFactory.ts) into a gate
 * that refused the one account holding every permission while admitting the
 * Manager below it. That call site now uses the permission matrix instead, so
 * nothing reaches here today — but a name-based gate that can exclude the owner
 * is a trap worth disarming rather than leaving set for the next caller.
 * services/permissions.ts states the rule this keeps: a permission the owner
 * lacks is a permission nobody has.
 */
export function requireRole(role: string) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const actual = req.user?.role;
    if (actual !== role && actual !== "owner") {
      next(forbidden("Insufficient permissions"));
      return;
    }
    next();
  };
}
