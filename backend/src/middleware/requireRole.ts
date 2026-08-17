import { NextFunction, Request, Response } from "express";
import { forbidden } from "../utils/httpError";

/**
 * Requires the authenticated user's JWT `role` claim to match `role`.
 * Must run after `requireAuth` (needs `req.user` populated).
 */
export function requireRole(role: string) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (req.user?.role !== role) {
      next(forbidden("Insufficient permissions"));
      return;
    }
    next();
  };
}
