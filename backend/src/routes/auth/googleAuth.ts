import { Request, Response, Router } from "express";
import { env } from "../../config/env";
import { pool } from "../../db/pool";
import { asyncHandler } from "../../utils/asyncHandler";
import { notFound } from "../../utils/httpError";
import { generateToken, safeEqual } from "../../auth/tokens";
import { revokeAllMemberSessions } from "../../auth/memberSession";
import {
  DEFAULT_NEXT,
  GOOGLE_STATE_COOKIE,
  GOOGLE_STATE_COOKIE_PATH,
  GOOGLE_STATE_TTL_SECONDS,
  buildAuthoriseUrl,
  decodeIdToken,
  googleConfig,
  pkceChallenge,
  safeNext,
  signState,
  validateIdToken,
  verifyState,
  type GoogleFailure,
  type GoogleIdentity,
} from "../../auth/googleOAuth";
import { exchangeCode } from "../../auth/googleTokenExchange";
import { memberLoginLimiter } from "../../middleware/rateLimit";
import { sendMail } from "../../email/mailer";
import * as emails from "../../email/memberTemplates";
import { reflectConfirmationOnContact } from "../../services/emailConfirmation";
import {
  DEFAULT_TIMEZONE,
  MEMBER_PROFILE_COLUMNS,
  toMemberProfile,
  type MemberProfileRow,
} from "../../services/memberProfile";
import {
  SIGN_IN_BLOCKED,
  clientMeta,
  isUniqueViolation,
  onboardNewMember,
  startSession,
} from "./memberAuth";

/**
 * `/api/auth/google/*` — "Continue with Google" for members.
 *
 * Two top-level GET navigations and nothing else: the visitor's browser goes
 * to /start, on to Google, and comes back to /callback, which leaves it on the
 * site holding exactly what a password sign-in would have left — the HttpOnly
 * refresh cookie. No token is ever put in a URL; the page picks up its access
 * token the way it does on any other load, through the silent refresh in
 * hooks/useMember.
 *
 * Both being GETs is also why `memberAuthCsrf` has nothing to say here (it
 * passes safe methods), and that is right rather than convenient: Google's
 * redirect back is cross-site by nature, and what stands in for the Origin
 * check is the signed state cookie — a callback is only honoured in the browser
 * that started it.
 *
 * The decisions live in auth/googleOAuth.ts. This file is the I/O around them.
 */
export const googleAuthRoutes = Router();

function stateCookieOptions() {
  return {
    httpOnly: true,
    // Dropped in dev so localhost still works over http — same as the refresh cookie.
    secure: env.nodeEnv === "production",
    // Lax, not Strict: the cookie has to come back on Google's redirect, which
    // is a cross-site top-level navigation. Lax sends it on exactly that and on
    // nothing a third-party page can trigger in the background.
    sameSite: "lax" as const,
    path: GOOGLE_STATE_COOKIE_PATH,
  };
}

function readStateCookie(req: Request): string | null {
  const jar = req.cookies as Record<string, unknown> | undefined;
  const raw = jar?.[GOOGLE_STATE_COOKIE];
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}

/**
 * Every unhappy ending is this: back to the sign-in page with a code from a
 * fixed list, and the actual reason in the server log only.
 *
 * The log line carries no address, no name and no Google subject — it is there
 * to tell "Google is down" from "the secret is wrong" from "somebody pressed
 * Cancel", and none of those need to know who.
 */
function fail(res: Response, failure: GoogleFailure, reason: string, next?: string): void {
  console.warn(`[google-auth] ${failure}: ${reason}`);
  const query = new URLSearchParams({ error: failure });
  if (next && next !== DEFAULT_NEXT) query.set("next", next);
  res.redirect(302, `${env.publicSiteUrl}/login?${query.toString()}`);
}

/** GET /api/auth/google/start?next=/path */
googleAuthRoutes.get(
  "/google/start",
  memberLoginLimiter,
  (req, res, next) => {
    const config = googleConfig();
    // The button is only drawn when the public settings say this is on, so a
    // request arriving here with it off is a stale tab or a guess. There is no
    // such route as far as either is concerned.
    if (!config) return next(notFound());

    const state = generateToken();
    // 43 base64url characters — the minimum length RFC 7636 allows, and 256 bits.
    const verifier = generateToken();
    res.cookie(
      GOOGLE_STATE_COOKIE,
      signState({ state, verifier, next: safeNext(req.query.next) }),
      { ...stateCookieOptions(), maxAge: GOOGLE_STATE_TTL_SECONDS * 1000 }
    );
    // Never cached: the response is one visitor's state cookie plus the URL
    // that matches it.
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
  }
);

interface GoogleLookupRow extends MemberProfileRow {
  google_sub: string | null;
  password_hash: string | null;
}

type SignInOutcome =
  | { ok: true; row: MemberProfileRow }
  | { ok: false; failure: GoogleFailure; reason: string };

/**
 * The member this Google identity belongs to, creating one if there is none.
 *
 * Matched on Google's subject first and on the address second. The subject is
 * the stable half: people change the address on their Boss Clinician account,
 * and change the primary address on their Google account, and either would
 * otherwise turn a returning member into a stranger with an empty library.
 */
async function findOrCreateMember(identity: GoogleIdentity, ip: string, retried = false): Promise<SignInOutcome> {
  const found = await pool.query<GoogleLookupRow>(
    `SELECT ${MEMBER_PROFILE_COLUMNS}, google_sub, password_hash
       FROM members
      WHERE google_sub = $1 OR email = $2
      ORDER BY (google_sub = $1) DESC NULLS LAST
      LIMIT 1`,
    [identity.sub, identity.email]
  );
  const existing = found.rows[0];

  if (!existing) return createMember(identity, ip, retried);

  if (SIGN_IN_BLOCKED.has(existing.status)) {
    return { ok: false, failure: "google_blocked", reason: `member ${existing.id} is ${existing.status}` };
  }

  // The takeover guard. This address is already joined to a Google account and
  // it is not the one in front of us — which happens when a Workspace domain
  // changes hands or an address is reissued to somebody new. Google vouching
  // for the address today does not make this the person who owns the library.
  if (existing.google_sub !== null && existing.google_sub !== identity.sub) {
    return { ok: false, failure: "google_mismatch", reason: `member ${existing.id} is linked to another subject` };
  }

  const firstConfirmation = existing.email_verified_at == null;

  // An account nobody ever confirmed may not have been opened by its owner:
  // registering somebody else's address with a password of your own choosing,
  // then waiting for them to arrive through Google, is a known way to end up
  // sharing their account. So the first proof of ownership takes the unproven
  // password away, along with any session opened on the strength of it. The
  // real owner loses nothing they cannot get back from "Forgot your password?".
  const dropPassword = firstConfirmation && existing.password_hash !== null;

  const updated = await pool.query<MemberProfileRow>(
    `UPDATE members
        SET google_sub        = COALESCE(google_sub, $2),
            email_verified_at = COALESCE(email_verified_at, now()),
            password_hash     = CASE WHEN $3::boolean THEN NULL ELSE password_hash END,
            first_name        = CASE WHEN first_name = '' THEN $4 ELSE first_name END,
            last_name         = CASE WHEN last_name = '' THEN $5 ELSE last_name END,
            last_login_at     = now(),
            updated_at        = now()
      WHERE id = $1
        AND status NOT IN ('suspended', 'deleted')
      RETURNING ${MEMBER_PROFILE_COLUMNS}`,
    [existing.id, identity.sub, dropPassword, identity.firstName, identity.lastName]
  );
  const row = updated.rows[0];
  // Suspended or erased between the read and the write.
  if (!row) return { ok: false, failure: "google_blocked", reason: `member ${existing.id} became blocked` };

  if (dropPassword) await revokeAllMemberSessions(row.id, "password_change");

  // Google has confirmed the address, which is the same fact a clicked
  // verification link establishes — so the same two things follow from it as in
  // POST /verify-email: the mailing-list consent row is told, and somebody
  // confirming for the first time gets their welcome.
  await reflectConfirmationOnContact(row.id);
  if (firstConfirmation) sendWelcome(row);

  return { ok: true, row };
}

async function createMember(identity: GoogleIdentity, ip: string, retried: boolean): Promise<SignInOutcome> {
  // Google accounts without a name exist (some Workspace set-ups). The part of
  // the address before the @ is what the account screens would otherwise greet
  // them with anyway, and they can change it there.
  const firstName = identity.firstName || (identity.email.split("@")[0] ?? "").slice(0, 100);
  const displayName = `${firstName} ${identity.lastName}`.trim();

  let row: MemberProfileRow;
  try {
    // No password: this member signs in with Google, and can add a password
    // later through "Forgot your password?" exactly as a magic-link member can.
    // No avatar either — Google's picture lives on a Google host, and the
    // site's img-src would refuse to draw it.
    const created = await pool.query<MemberProfileRow>(
      `INSERT INTO members
         (email, name, first_name, last_name, password_hash, timezone, status, email_verified_at, google_sub, last_login_at)
       VALUES ($1, $2, $3, $4, NULL, $5, 'active', now(), $6, now())
       RETURNING ${MEMBER_PROFILE_COLUMNS}`,
      [identity.email, displayName, firstName, identity.lastName, DEFAULT_TIMEZONE, identity.sub]
    );
    row = created.rows[0];
  } catch (err) {
    // Two callbacks for the same person in the same instant (a double click on
    // the account chooser). The unique indexes pick the winner; the loser looks
    // again and finds the row the winner made. Once only, so a genuine
    // constraint problem surfaces instead of looping.
    if (isUniqueViolation(err) && !retried) return findOrCreateMember(identity, ip, true);
    throw err;
  }

  await onboardNewMember(row, { ip, source: "google" });
  // Born confirmed, so the verification email a password signup gets is
  // skipped and what follows a confirmation happens now instead.
  await reflectConfirmationOnContact(row.id);
  sendWelcome(row);

  return { ok: true, row };
}

function sendWelcome(row: MemberProfileRow): void {
  void sendMail({
    topic: "member_welcome",
    memberId: row.id,
    to: row.email,
    ...emails.welcome({ firstName: row.first_name }),
  });
}

/** GET /api/auth/google/callback?code=…&state=… */
googleAuthRoutes.get(
  "/google/callback",
  memberLoginLimiter,
  asyncHandler(async (req, res) => {
    res.set("Cache-Control", "no-store");

    // Read once and cleared whatever happens next: a state is good for one
    // callback, including a failed one.
    const parked = verifyState(readStateCookie(req));
    res.clearCookie(GOOGLE_STATE_COOKIE, stateCookieOptions());
    const next = parked?.next;

    const config = googleConfig();
    if (!config) return fail(res, "google_disabled", "callback reached with Google sign-in switched off");

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

      const meta = clientMeta(req);
      const outcome = await findOrCreateMember(verdict.identity, meta.ip);
      if (!outcome.ok) return fail(res, outcome.failure, outcome.reason, next);

      await startSession(res, toMemberProfile(outcome.row), meta);
      res.redirect(302, `${env.publicSiteUrl}${parked.next}`);
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
