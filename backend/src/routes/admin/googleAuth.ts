import { Request, Response, Router } from "express";
import { env } from "../../config/env";
import { pool } from "../../db/pool";
import { asyncHandler } from "../../utils/asyncHandler";
import { notFound } from "../../utils/httpError";
import { generateToken, safeEqual } from "../../auth/tokens";
import { issueAdminCookieSession, setAdminCookies } from "../../auth/adminSession";
import {
  ADMIN_DEFAULT_NEXT,
  ADMIN_STATE_FLOW,
  GOOGLE_ADMIN_STATE_COOKIE,
  GOOGLE_ADMIN_STATE_COOKIE_PATH,
  GOOGLE_STATE_TTL_SECONDS,
  buildAuthoriseUrl,
  decodeIdToken,
  googleAdminConfig,
  googleAdminSignInEnabled,
  pkceChallenge,
  safeAdminNext,
  signState,
  validateIdToken,
  verifyState,
  type AdminGoogleFailure,
  type GoogleIdentity,
} from "../../auth/googleOAuth";
import { exchangeCode } from "../../auth/googleTokenExchange";
import { loginIpLimiter } from "../../middleware/rateLimit";

/**
 * `/api/admin/google/*` — "Sign in with Google" for the admin.
 *
 * The same round trip as routes/auth/googleAuth.ts — two top-level GET
 * navigations, a signed state cookie in between, PKCE, the code swapped
 * server-side — and it ends the way POST /api/admin/login ends: with the admin
 * session cookies set and nothing in a URL. Both being GETs is why `adminCsrf`
 * passes them, and the signed state cookie is what stands in for its Origin
 * check: Google's redirect back is cross-site by nature, and a callback is only
 * honoured in the browser that started it.
 *
 * Where it parts from the member flow is who it will let in, and the answer is
 * nobody new:
 *
 *  - NO account is ever created here. A member signing up with Google gets an
 *    empty library; an admin signing up with Google would get the business.
 *    Google can only open an account an owner has already invited and the
 *    invitee has already accepted.
 *  - Two-step sign-in is never skipped. An admin with it switched on is sent
 *    back to the password form, where the code is asked for.
 *  - The callback lives on the admin host, because the session cookies are
 *    host-scoped and that host proxies nothing but `/api/admin/`.
 *
 * The decisions live in auth/googleOAuth.ts and in `decideAdminSignIn` below.
 * The rest of this file is the I/O around them.
 */
export const adminGoogleAuthRouter = Router();

function stateCookieOptions() {
  return {
    httpOnly: true,
    // Dropped in dev so localhost still works over http.
    secure: env.nodeEnv === "production",
    // Lax, not Strict: the cookie has to come back on Google's redirect, which
    // is a cross-site top-level navigation. Lax sends it on exactly that and on
    // nothing a third-party page can trigger in the background.
    sameSite: "lax" as const,
    path: GOOGLE_ADMIN_STATE_COOKIE_PATH,
  };
}

function readStateCookie(req: Request): string | null {
  const jar = req.cookies as Record<string, unknown> | undefined;
  const raw = jar?.[GOOGLE_ADMIN_STATE_COOKIE];
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}

/**
 * Every unhappy ending is this: back to the admin sign-in page with a code from
 * a fixed list, and the actual reason in the server log only.
 *
 * The log line carries no address, no name and no Google subject. `next` rides
 * along under the name the sign-in page already reads (`RETURN_PARAM` in
 * pages/admin/adminReturnTo.ts), so signing in with a password after a refusal
 * still lands where the admin was going.
 */
function fail(res: Response, failure: AdminGoogleFailure, reason: string, next?: string): void {
  console.warn(`[admin-google-auth] ${failure}: ${reason}`);
  const query = new URLSearchParams({ error: failure });
  if (next && next !== ADMIN_DEFAULT_NEXT) query.set("next", next);
  res.redirect(302, `${env.adminOrigin}/admin/login?${query.toString()}`);
}

/**
 * GET /api/admin/signin-options
 *
 * Whether to draw the button. The public site reads this out of /api/settings,
 * which the admin host does not proxy, so the admin sign-in page asks here. It
 * says a button exists and nothing about how it is keyed.
 */
adminGoogleAuthRouter.get("/signin-options", (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({ googleEnabled: googleAdminSignInEnabled() });
});

/**
 * GET /api/admin/google/start?next=/admin/path
 *
 * `loginIpLimiter` rather than something tighter: behind the proxy `req.ip` is
 * the same address for everybody, so this budget is shared with the password
 * form by the whole team. A redirect is a success as far as the limiter is
 * concerned (it only keeps 4xx and 5xx), so a round trip through Google costs
 * that budget nothing — while an address that has already spent it on wrong
 * passwords is refused here as well.
 */
adminGoogleAuthRouter.get("/google/start", loginIpLimiter, (req, res, next) => {
  const config = googleAdminConfig();
  // The button is only drawn when /signin-options says this is on, so a request
  // arriving here with it off is a stale tab or a guess. There is no such route
  // as far as either is concerned.
  if (!config) return next(notFound());

  const state = generateToken();
  // 43 base64url characters — the minimum length RFC 7636 allows, and 256 bits.
  const verifier = generateToken();
  res.cookie(
    GOOGLE_ADMIN_STATE_COOKIE,
    signState({ state, verifier, next: safeAdminNext(req.query.next) }, Date.now(), ADMIN_STATE_FLOW),
    { ...stateCookieOptions(), maxAge: GOOGLE_STATE_TTL_SECONDS * 1000 }
  );
  // Never cached: the response is one visitor's state cookie plus the URL that
  // matches it.
  res.set("Cache-Control", "no-store");
  res.redirect(
    302,
    buildAuthoriseUrl({
      clientId: config.clientId,
      redirectUri: config.redirectUri,
      state,
      codeChallenge: pkceChallenge(verifier),
    })
  );
});

export interface AdminGoogleLookupRow {
  id: number;
  email: string;
  name: string;
  role: string;
  status: string;
  mfa_enabled: boolean;
  google_sub: string | null;
}

export type AdminSignInDecision =
  | { ok: true; row: AdminGoogleLookupRow }
  | { ok: false; failure: AdminGoogleFailure; reason: string };

/**
 * Whether this Google identity may sign in as `row` — the admin found for it,
 * or undefined when there is none. Pure, so every refusal has a test.
 *
 * In order:
 *
 *  1. No admin, or one who is not `active`. ONE answer for both. "Invited" has
 *     not accepted and has no business here yet; "suspended" has been shown the
 *     door; and telling either apart from a stranger is information somebody
 *     probing with a Google account can use — the password form answers all
 *     three with "Invalid email or password" for the same reason.
 *  2. The takeover guard. This admin is already joined to a Google account and
 *     it is not the one in front of us — a reissued mailbox, or a Workspace
 *     domain that changed hands. Google vouching for the address today does not
 *     make this the person who was invited.
 *  3. Two-step sign-in. Google is a first factor. An admin who turned on a
 *     second one is owed it every time, so they are sent to the form that asks.
 */
export function decideAdminSignIn(
  row: AdminGoogleLookupRow | undefined,
  identity: Pick<GoogleIdentity, "sub">
): AdminSignInDecision {
  if (!row) return { ok: false, failure: "google_no_account", reason: "no admin for this Google identity" };
  if (row.status !== "active") {
    return { ok: false, failure: "google_no_account", reason: `admin ${row.id} is ${row.status}` };
  }
  if (row.google_sub !== null && row.google_sub !== identity.sub) {
    return { ok: false, failure: "google_mismatch", reason: `admin ${row.id} is linked to another subject` };
  }
  if (row.mfa_enabled) {
    return { ok: false, failure: "google_mfa", reason: `admin ${row.id} has two-step sign-in on` };
  }
  return { ok: true, row };
}

/**
 * The admin this Google identity belongs to. Never creates one.
 *
 * Matched on Google's subject first and on the address second, as for members:
 * the subject is the stable half. The address is compared case-insensitively on
 * both sides because invitations store what the owner typed, and the identity's
 * address arrives already lower-cased by `validateIdToken`.
 */
async function findAdmin(identity: GoogleIdentity): Promise<AdminSignInDecision> {
  const found = await pool.query<AdminGoogleLookupRow>(
    `SELECT id, email, name, role, status, mfa_enabled, google_sub
       FROM admin_users
      WHERE google_sub = $1 OR lower(email) = lower($2)
      ORDER BY (google_sub = $1) DESC NULLS LAST
      LIMIT 1`,
    [identity.sub, identity.email]
  );
  const decision = decideAdminSignIn(found.rows[0], identity);
  if (!decision.ok) return decision;

  // Every condition above is repeated in the WHERE, so an admin suspended,
  // re-linked or given a second factor between the read and the write is
  // refused rather than signed in on stale news.
  const updated = await pool.query<AdminGoogleLookupRow>(
    `UPDATE admin_users
        SET google_sub    = COALESCE(google_sub, $2),
            last_login_at = now()
      WHERE id = $1
        AND status = 'active'
        AND mfa_enabled IS NOT TRUE
        AND (google_sub IS NULL OR google_sub = $2)
      RETURNING id, email, name, role, status, mfa_enabled, google_sub`,
    [decision.row.id, identity.sub]
  );
  const row = updated.rows[0];
  if (!row) {
    return { ok: false, failure: "google_no_account", reason: `admin ${decision.row.id} changed during sign-in` };
  }
  return { ok: true, row };
}

/** GET /api/admin/google/callback?code=…&state=… */
adminGoogleAuthRouter.get(
  "/google/callback",
  loginIpLimiter,
  asyncHandler(async (req, res) => {
    res.set("Cache-Control", "no-store");

    // Read once and cleared whatever happens next: a state is good for one
    // callback, including a failed one.
    const parked = verifyState(readStateCookie(req), Date.now(), ADMIN_STATE_FLOW);
    res.clearCookie(GOOGLE_ADMIN_STATE_COOKIE, stateCookieOptions());
    const next = parked?.next;

    const config = googleAdminConfig();
    if (!config) return fail(res, "google_disabled", "callback reached with admin Google sign-in switched off");

    try {
      if (!parked) return fail(res, "google_failed", "state cookie missing, expired or not ours");

      const returnedState = typeof req.query.state === "string" ? req.query.state : "";
      if (!safeEqual(parked.state, returnedState)) {
        return fail(res, "google_failed", "state does not match the cookie", next);
      }

      // Checked after the state, so only the browser that started this flow can
      // make the sign-in page say anything at all.
      if (typeof req.query.error === "string") {
        return req.query.error === "access_denied"
          ? fail(res, "google_cancelled", "visitor declined at Google", next)
          : fail(res, "google_failed", "Google returned an error to the callback", next);
      }

      const code = typeof req.query.code === "string" ? req.query.code : "";
      if (!code) return fail(res, "google_failed", "callback without a code", next);

      const idToken = await exchangeCode(config, code, parked.verifier);
      const verdict = validateIdToken(decodeIdToken(idToken), config.clientId);
      if (!verdict.ok) return fail(res, verdict.failure, verdict.reason, next);

      const outcome = await findAdmin(verdict.identity);
      if (!outcome.ok) return fail(res, outcome.failure, outcome.reason, next);

      // Exactly what POST /login does once the password is right: the token is
      // minted alongside the admin_sessions row that makes it revocable, and
      // both cookies are set. No audit row, because the password form writes
      // none either — admin_sessions is the record of who signed in, and when.
      const session = await issueAdminCookieSession({
        adminUserId: outcome.row.id,
        email: outcome.row.email,
        role: outcome.row.role,
        userAgent: String(req.headers["user-agent"] ?? ""),
        ip: req.ip ?? "",
      });
      setAdminCookies(res, session);
      res.redirect(302, `${env.adminOrigin}${parked.next}`);
    } catch (err) {
      // Anything unplanned still ends on the sign-in page rather than on a JSON
      // error in a bare browser tab, which is where a thrown error would leave
      // somebody who arrived by navigation. Name and message only: a pg or
      // fetch error carries no personal data in either.
      const reason = err instanceof Error ? `${err.name}: ${err.message}` : "unknown error";
      fail(res, "google_failed", reason, next);
    }
  })
);
