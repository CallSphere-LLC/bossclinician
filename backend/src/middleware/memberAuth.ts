import { NextFunction, Request, Response } from "express";
import { pool } from "../db/pool";
import { unauthorized, forbidden } from "../utils/httpError";
import { verifyMemberAccessToken, type MemberJwtPayload } from "../auth/memberSession";

/**
 * Member authentication, the mirror of middleware/auth.ts for the customer side.
 *
 * Deny by default: every /api/member route sits behind requireMember, and any
 * route that reads a member-owned object still has to prove ownership on top —
 * a valid token says who you are, never what you may open.
 */

export interface AuthedMember {
  id: number;
  email: string;
  status: string;
  emailVerifiedAt: string | null;
  impersonatedBy?: number;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      member?: AuthedMember;
    }
  }
}

function bearer(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

async function loadMember(payload: MemberJwtPayload): Promise<AuthedMember | null> {
  // The account is re-read on every request rather than trusted from the token:
  // a member suspended or deleted 30 seconds ago must not keep working until
  // their 15-minute access token happens to expire.
  const res = await pool.query<{
    id: number;
    email: string;
    status: string;
    email_verified_at: string | null;
  }>(`SELECT id, email, status, email_verified_at FROM members WHERE id = $1`, [payload.sub]);

  const row = res.rows[0];
  if (!row) return null;

  return {
    id: row.id,
    email: row.email,
    status: row.status,
    emailVerifiedAt: row.email_verified_at,
    impersonatedBy: payload.impersonatedBy,
  };
}

/** Requires a valid member access token and an account in good standing. */
export async function requireMember(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  const token = bearer(req);
  if (!token) {
    next(unauthorized("Please sign in to continue"));
    return;
  }

  let payload: MemberJwtPayload;
  try {
    payload = verifyMemberAccessToken(token);
  } catch {
    next(unauthorized("Your session has expired. Please sign in again."));
    return;
  }

  try {
    const member = await loadMember(payload);
    if (!member) {
      next(unauthorized("Please sign in to continue"));
      return;
    }
    if (member.status === "suspended") {
      next(forbidden("This account has been suspended. Please contact support."));
      return;
    }
    if (member.status === "deleted") {
      next(unauthorized("Please sign in to continue"));
      return;
    }
    req.member = member;
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Attaches the member when a valid token is present, but never rejects.
 *
 * For routes that render differently for a signed-in person — a sales page that
 * says "you already own this", a free preview lesson — without locking anyone out.
 */
export async function optionalMember(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  const token = bearer(req);
  if (!token) {
    next();
    return;
  }
  try {
    const member = await loadMember(verifyMemberAccessToken(token));
    if (member && member.status !== "suspended" && member.status !== "deleted") {
      req.member = member;
    }
  } catch {
    // An expired or bogus token on an optional route is simply "signed out".
  }
  next();
}

/**
 * Requires a verified email address on top of authentication.
 *
 * Applied to the routes where an unverified address would cause real harm —
 * posting in the community under a stolen identity, receiving a purchase
 * receipt at an address nobody proved — and deliberately NOT to /library, so a
 * paying customer who has not clicked the link can still open what they bought.
 */
export function requireVerifiedEmail(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  if (!req.member) {
    next(unauthorized("Please sign in to continue"));
    return;
  }
  if (!req.member.emailVerifiedAt) {
    next(forbidden("Please confirm your email address first. Check your inbox for the link."));
    return;
  }
  next();
}
