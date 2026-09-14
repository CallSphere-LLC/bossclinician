import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env";
import { forbidden } from "../utils/httpError";

const REFUSAL = "This request must come from the Boss Clinician site.";

/**
 * Cross-site request refusal for `/api/auth`, the one member surface a browser
 * authenticates to with a cookie.
 *
 * Everything else a member does carries a Bearer token held in page memory,
 * which no other site can make a browser attach. These routes are different:
 * refresh and logout act on the HttpOnly refresh cookie, and sign-in sets it.
 * SameSite=Lax keeps that cookie off a cross-site POST, but a "site" is the
 * registrable domain — callsphere.site — and this host serves other
 * applications under it, every one of them same-site to this one. Sign-in needs
 * no cookie to be abused at all: a form anywhere that posts an attacker's email
 * and password here signs the visitor's browser into the attacker's account.
 *
 * The same standard-headers check as the admin's `adminCsrf`
 * (auth/adminSession.ts), with one difference: a request carrying neither
 * Origin nor Sec-Fetch-Site is let through. Every current browser sends Origin
 * on a cross-origin POST, so such a request is not a browser being steered by
 * another page; it is curl, a test or a server, and it has no ambient cookie to
 * misuse. The admin keeps its stricter rule because every one of its routes is
 * cookie-authenticated.
 */
export function memberAuthCsrf(req: Request, _res: Response, next: NextFunction): void {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();

  const origin = req.get("origin");
  if (origin !== undefined) {
    return originAllowed(origin, req) ? next() : next(forbidden(REFUSAL));
  }

  const fetchSite = req.get("sec-fetch-site");
  if (fetchSite === "cross-site" || fetchSite === "same-site") return next(forbidden(REFUSAL));
  next();
}

/**
 * The page's own origin, whatever name the site is served under — so the
 * bossclinician.com cutover is same-origin exactly as the callsphere.site
 * address is today, with no configuration to remember — or the separately
 * served frontend FRONTEND_ORIGIN names. `Origin: null` (a sandboxed frame, a
 * file) is not a URL and is refused.
 */
function originAllowed(origin: string, req: Request): boolean {
  let host: string;
  try {
    host = new URL(origin).host.toLowerCase();
  } catch {
    return false;
  }
  if (host === (req.get("host") ?? "").toLowerCase()) return true;
  return env.frontendOrigin !== "*" && origin === env.frontendOrigin;
}
