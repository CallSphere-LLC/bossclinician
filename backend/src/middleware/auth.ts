import { NextFunction, Request, Response } from "express";
import { verifyToken } from "../utils/jwt";
import { unauthorized } from "../utils/httpError";

/** Requires a valid `Authorization: Bearer <token>` header. Attaches req.user. */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    next(unauthorized("Missing bearer token"));
    return;
  }
  const token = header.slice("Bearer ".length).trim();
  try {
    req.user = verifyToken(token);
    next();
  } catch {
    next(unauthorized("Invalid or expired token"));
  }
}
