import { Request, Response, Router } from "express";
import { pool } from "../../db/pool";
import { asyncHandler } from "../../utils/asyncHandler";
import { HttpError, badRequest, notFound, unauthorized } from "../../utils/httpError";
import { generateToken, hashToken, expiresIn } from "../../auth/tokens";
import { checkPasswordStrength, hashPassword, verifyPassword } from "../../auth/password";
import {
  REFRESH_COOKIE,
  clearRefreshCookie,
  issueRefreshToken,
  revokeAllMemberSessions,
  revokeRefreshToken,
  rotateRefreshToken,
  setRefreshCookie,
  signMemberAccessToken,
} from "../../auth/memberSession";
import { optionalMember } from "../../middleware/memberAuth";
import {
  memberEmailLinkLimiter,
  memberLoginLimiter,
  memberRegisterLimiter,
  memberTokenLimiter,
} from "../../middleware/rateLimit";
import { sendMail } from "../../email/mailer";
import * as emails from "../../email/memberTemplates";
import {
  DEFAULT_TIMEZONE,
  MEMBER_PROFILE_COLUMNS,
  toMemberProfile,
  loadMemberProfile,
  type MemberProfile,
  type MemberProfileRow,
} from "../../services/memberProfile";
import {
  forgotPasswordSchema,
  loginSchema,
  magicLinkConsumeSchema,
  magicLinkRequestSchema,
  registerSchema,
  resendVerificationSchema,
  resetPasswordSchema,
  verifyEmailSchema,
} from "../../validation/memberSchemas";

/**
 * `/api/auth/*` — the unauthenticated half of member identity.
 *
 * The governing constraint on this file is that none of it may become an
 * account-existence oracle. Sign-in, forgotten passwords, verification resends
 * and magic links all answer identically whether or not the address is one of
 * ours: same status, same body, same work done before responding. Registration
 * is the single deliberate exception — the person is claiming that address and
 * needs to be told it is taken — and it is the only place existence leaks.
 */
export const memberAuthRoutes = Router();

const GENERIC_CREDENTIALS = "That email or password isn't right.";
const GENERIC_THROTTLED = "Too many sign-in attempts. Please wait a few minutes and try again.";
const GENERIC_LINK = "That link has expired or has already been used. Please request a new one.";

/** Suspended and deleted accounts are refused everywhere a session can be created. */
const SIGN_IN_BLOCKED = new Set(["suspended", "deleted"]);

const EMAIL_VERIFICATION_TTL_MINUTES = 24 * 60;
const PASSWORD_RESET_TTL_MINUTES = 60;
const MAGIC_LINK_TTL_MINUTES = 15;

/**
 * Durable sign-in throttling, counted in `member_login_attempts` rather than in
 * express-rate-limit's memory: process memory resets on every deploy and is not
 * shared between replicas, and credential stuffing is patient enough to notice.
 */
const LOGIN_WINDOW_MINUTES = 15;
const LOGIN_MAX_FAILURES = 5;

/**
 * The ceiling for one address across ALL source IPs.
 *
 * Deliberately far above the per-IP limit. Its job is to stop a botnet grinding
 * one account, not to let a stranger lock somebody out — at this height a third
 * party would need 40 failures inside 15 minutes, which costs them far more than
 * the per-IP limit already costs, while a real person mistyping their own
 * password never comes close.
 */
const LOGIN_DISTRIBUTED_MAX_FAILURES = 40;

/** A member can ask for this many password-reset emails per window before we stop sending. */
const RESET_WINDOW_MINUTES = 15;
const RESET_MAX_PER_WINDOW = 5;

interface ClientMeta {
  ip: string;
  userAgent: string;
}

function clientMeta(req: Request): ClientMeta {
  return { ip: req.ip ?? "", userAgent: req.get("user-agent") ?? "" };
}

/**
 * The raw refresh token, or null.
 *
 * cookie-parser types `req.cookies` as `any`, so the narrowing happens here once
 * instead of at every call site.
 */
export function readRefreshCookie(req: Request): string | null {
  const jar = req.cookies as Record<string, unknown> | undefined;
  const raw = jar?.[REFRESH_COOKIE];
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}

interface AuthSuccess {
  member: MemberProfile;
  accessToken: string;
}

/** Mints the refresh cookie and the access token that go with a freshly proven identity. */
async function startSession(
  res: Response,
  member: MemberProfile,
  meta: ClientMeta
): Promise<AuthSuccess> {
  const raw = await issueRefreshToken({
    memberId: member.id,
    userAgent: meta.userAgent,
    ip: meta.ip,
  });
  setRefreshCookie(res, raw);
  return {
    member,
    accessToken: signMemberAccessToken({ sub: member.id, email: member.email }),
  };
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "23505";
}

async function recordLoginAttempt(email: string, ip: string, successful: boolean): Promise<void> {
  await pool.query(
    `INSERT INTO member_login_attempts (email, ip, successful) VALUES ($1, $2, $3)`,
    [email.slice(0, 320), ip.slice(0, 64), successful]
  );
}

/**
 * Clears an account's failure history.
 *
 * Called after any event that proves the real owner is present — a successful
 * sign-in, or a completed password reset. Without this, a lockout survives the
 * two things a locked-out person will actually try, and the only remedy is to
 * wait out whoever caused it.
 */
export async function clearLoginFailures(email: string): Promise<void> {
  await pool.query(
    `DELETE FROM member_login_attempts WHERE email = $1 AND successful = false`,
    [email]
  );
}

/**
 * Opportunistic retention. The table is only ever read over a 15-minute window,
 * so anything older is dead weight; trimming it on write avoids needing a job
 * runner for a table that would otherwise grow forever.
 */
async function trimLoginAttempts(): Promise<void> {
  await pool.query(
    `DELETE FROM member_login_attempts
      WHERE created_at < now() - make_interval(mins => $1)`,
    [LOGIN_WINDOW_MINUTES * 4]
  );
}

/**
 * Whether this sign-in attempt should be refused before the password is checked.
 *
 * The email-keyed counter is scoped to the SAME IP as the caller, which is the
 * whole point. Counting an address's failures across all IPs turns the throttle
 * into a weapon: five wrong guesses from anywhere would lock the real owner out
 * of their own account, and since the check runs before the password is
 * verified, a correct password would not clear it. An attacker only had to keep
 * one failure inside the window to make the lockout permanent.
 *
 * Credential stuffing from many IPs against one account is still bounded — by
 * the per-IP ceiling, and by the global ceiling below, which trips when one
 * address is under attack from a whole range at once but is set high enough
 * that ordinary forgetfulness cannot reach it.
 */
async function isLoginThrottled(email: string, ip: string): Promise<boolean> {
  const result = await pool.query<{
    ip_failures: string;
    same_ip_email_failures: string;
    email_failures_all_ips: string;
  }>(
    `SELECT count(*) FILTER (WHERE ip = $1)                     AS ip_failures,
            count(*) FILTER (WHERE ip = $1 AND email = $2)      AS same_ip_email_failures,
            count(*) FILTER (WHERE email = $2)                  AS email_failures_all_ips
       FROM member_login_attempts
      WHERE successful = false
        AND created_at > now() - make_interval(mins => $3)`,
    [ip, email, LOGIN_WINDOW_MINUTES]
  );

  const row = result.rows[0];
  if (!row) return false;

  return (
    Number(row.ip_failures) >= LOGIN_MAX_FAILURES ||
    Number(row.same_ip_email_failures) >= LOGIN_MAX_FAILURES ||
    Number(row.email_failures_all_ips) >= LOGIN_DISTRIBUTED_MAX_FAILURES
  );
}

interface LookupRow extends MemberProfileRow {
  password_hash: string | null;
}

async function findByEmail(email: string): Promise<LookupRow | null> {
  const result = await pool.query<LookupRow>(
    `SELECT ${MEMBER_PROFILE_COLUMNS}, password_hash FROM members WHERE email = $1`,
    [email]
  );
  return result.rows[0] ?? null;
}

/**
 * Issues a set-password link for an account that has never had a password.
 *
 * Shares `member_password_resets` with the forgotten-password flow, including
 * its per-account ceiling — without that, an unauthenticated signup form is a
 * button anyone can press to send mail to any customer, as many times as they
 * like, from the site's own domain.
 */
async function sendSetPasswordEmail(member: {
  id: number;
  email: string;
  first_name: string;
}): Promise<void> {
  const recent = await pool.query<{ count: string }>(
    `SELECT count(*) AS count
       FROM member_password_resets
      WHERE member_id = $1
        AND created_at > now() - make_interval(mins => $2)`,
    [member.id, RESET_WINDOW_MINUTES]
  );
  if (Number(recent.rows[0]?.count ?? 0) >= RESET_MAX_PER_WINDOW) return;

  // Outstanding links for this account are burned first. Otherwise every
  // request leaves another live token behind, so a day of them accumulates into
  // a day's worth of working keys to the same door.
  await pool.query(
    `UPDATE member_password_resets SET used_at = now()
      WHERE member_id = $1 AND used_at IS NULL`,
    [member.id]
  );

  const raw = generateToken();
  await pool.query(
    `INSERT INTO member_password_resets (member_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
    [member.id, hashToken(raw), expiresIn(PASSWORD_RESET_TTL_MINUTES * 60)]
  );

  void sendMail({
    to: member.email,
    ...emails.setPassword({
      firstName: member.first_name,
      token: raw,
      expiresInMinutes: PASSWORD_RESET_TTL_MINUTES,
    }),
  });
}

async function sendVerificationEmail(member: {
  id: number;
  email: string;
  first_name: string;
}): Promise<void> {
  // The same durable per-account ceiling forgot-password uses. Without it,
  // resend-verification is an unauthenticated button that sends mail from this
  // domain to any unverified address, as often as the caller likes — the
  // IP+email rate limiter alone is defeated by changing IP.
  const recent = await pool.query<{ count: string }>(
    `SELECT count(*) AS count
       FROM member_email_verifications
      WHERE member_id = $1
        AND created_at > now() - make_interval(mins => $2)`,
    [member.id, RESET_WINDOW_MINUTES]
  );
  if (Number(recent.rows[0]?.count ?? 0) >= RESET_MAX_PER_WINDOW) return;

  // Supersede outstanding links rather than adding to them: each one lives 24
  // hours, so a day of resends would otherwise leave a day's worth of
  // simultaneously-valid tokens for the same address.
  await pool.query(
    `UPDATE member_email_verifications SET used_at = now()
      WHERE member_id = $1 AND used_at IS NULL`,
    [member.id]
  );

  const raw = generateToken();
  await pool.query(
    `INSERT INTO member_email_verifications (member_id, email, token_hash, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [member.id, member.email, hashToken(raw), expiresIn(EMAIL_VERIFICATION_TTL_MINUTES * 60)]
  );
  // Fire and forget, here and everywhere below: a slow SMTP handshake must not
  // decide how long a member waits for their signup to come back.
  void sendMail({
    to: member.email,
    ...emails.verifyEmail({
      firstName: member.first_name,
      token: raw,
      expiresInMinutes: EMAIL_VERIFICATION_TTL_MINUTES,
    }),
  });
}

/**
 * POST /api/auth/register
 *
 * A brand-new address inserts a member and signs them straight in. An address
 * that already exists gets a mail instead, and the response says only "check
 * your email".
 *
 * The asymmetry is deliberate and load-bearing. Password-less member rows are
 * the norm here, not the exception — every guest checkout, every admin-added
 * member, every CSV import row, every lead captured by an automation, and every
 * magic-link-only member has one. Letting this endpoint set a password on such a
 * row and hand back a session would mean anyone who knows a customer's email
 * address owns their account, their purchases and their library, having proved
 * nothing. The token in the mail is the proof; the request never can be.
 *
 * Signing a genuinely NEW address in immediately is safe for the same reason it
 * is not safe for an existing one: a row created a millisecond ago has no
 * purchases, no access grants and no history attached to it, so there is nothing
 * there to take.
 *
 * Both existing-account branches return byte-identical responses, so this cannot
 * be used to tell a claimable account from one that already has a password. It
 * does still reveal whether an address is registered at all — an unavoidable
 * property of any signup form that refuses duplicates, and a far smaller problem
 * than the takeover it replaces. Which of the two mails arrives is visible only
 * to whoever actually reads that inbox, which is exactly the right audience.
 */
const REGISTRATION_PENDING = {
  status: "check_email" as const,
  message: "Check your email — we've sent you a link to finish setting up your account.",
};

memberAuthRoutes.post(
  "/register",
  memberRegisterLimiter,
  asyncHandler(async (req, res) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      throw badRequest("Please check the details and try again.", parsed.error.flatten());
    }
    const { email, password, firstName } = parsed.data;
    const lastName = parsed.data.lastName ?? "";

    const strength = checkPasswordStrength(password);
    if (!strength.ok) throw badRequest(strength.reason ?? "Please choose a stronger password.");

    const existing = await findByEmail(email);
    if (existing) {
      // The member row is not touched here — not the password, not the name,
      // not the status. Nothing about an existing account changes on the word
      // of an unauthenticated request.
      if (!existing.password_hash && !SIGN_IN_BLOCKED.has(existing.status)) {
        await sendSetPasswordEmail(existing);
      } else if (!SIGN_IN_BLOCKED.has(existing.status)) {
        void sendMail({
          to: existing.email,
          ...emails.registrationAttempted({ firstName: existing.first_name }),
        });
      }
      res.status(200).json(REGISTRATION_PENDING);
      return;
    }

    const passwordHash = await hashPassword(password);
    const displayName = `${firstName} ${lastName}`.trim();

    let row: MemberProfileRow;
    try {
      const created = await pool.query<MemberProfileRow>(
        `INSERT INTO members (email, name, first_name, last_name, password_hash, timezone, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'active')
         RETURNING ${MEMBER_PROFILE_COLUMNS}`,
        [
          email,
          displayName,
          firstName,
          lastName,
          passwordHash,
          parsed.data.timezone ?? DEFAULT_TIMEZONE,
        ]
      );
      row = created.rows[0];
    } catch (err) {
      // Two signups for the same address in the same instant. The unique index
      // is the arbiter, and the loser gets the answer it would have got a
      // moment earlier — which is now the neutral one, so the race cannot be
      // used to distinguish an existing account either.
      if (isUniqueViolation(err)) {
        res.status(200).json(REGISTRATION_PENDING);
        return;
      }
      throw err;
    }

    await sendVerificationEmail(row);

    const session = await startSession(res, toMemberProfile(row), clientMeta(req));
    res.status(201).json(session);
  })
);

/** POST /api/auth/login */
memberAuthRoutes.post(
  "/login",
  memberLoginLimiter,
  asyncHandler(async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      throw badRequest("Please enter your email address and password.", parsed.error.flatten());
    }
    const { email, password } = parsed.data;
    const meta = clientMeta(req);

    // No attempt is recorded here. Counting a request that was refused without
    // ever checking a password lets the window extend itself: one call every
    // fourteen minutes would hold the counter above the limit indefinitely, and
    // the account would never unlock. Only a real credential check counts.
    if (await isLoginThrottled(email, meta.ip)) {
      throw new HttpError(429, GENERIC_THROTTLED);
    }

    const member = await findByEmail(email);
    // Unconditional: returning early for an unknown address would make "no such
    // member" measurably faster than "wrong password", which is the enumeration
    // signal the identical error messages exist to hide.
    const correct = await verifyPassword(password, member?.password_hash ?? null);

    if (!member || !correct || SIGN_IN_BLOCKED.has(member.status)) {
      await recordLoginAttempt(email, meta.ip, false);
      throw unauthorized(GENERIC_CREDENTIALS);
    }

    // Proof the real owner is here, so the failure history goes: whatever
    // produced it is no longer relevant, and leaving it would let a stale run of
    // wrong guesses lock them out again on their next visit.
    await clearLoginFailures(email);
    await recordLoginAttempt(email, meta.ip, true);
    void trimLoginAttempts();
    await pool.query(`UPDATE members SET last_login_at = now() WHERE id = $1`, [member.id]);

    const session = await startSession(res, toMemberProfile(member), meta);
    res.json(session);
  })
);

/** POST /api/auth/logout — revokes this device's session only. */
memberAuthRoutes.post(
  "/logout",
  asyncHandler(async (req, res) => {
    const raw = readRefreshCookie(req);
    if (raw) await revokeRefreshToken(raw);
    clearRefreshCookie(res);
    res.status(204).end();
  })
);

/**
 * POST /api/auth/refresh
 *
 * The cookie is rotated on every call. A token presented after it was already
 * rotated can only be a copy, so `rotateRefreshToken` has by then revoked the
 * whole chain and all this has to do is stop pretending the caller is signed in.
 */
memberAuthRoutes.post(
  "/refresh",
  asyncHandler(async (req, res) => {
    const raw = readRefreshCookie(req);
    if (!raw) throw unauthorized("Please sign in to continue");

    const outcome = await rotateRefreshToken(raw, clientMeta(req));
    if (outcome.status !== "ok") {
      clearRefreshCookie(res);
      throw unauthorized("Please sign in to continue");
    }

    const profile = await loadMemberProfile(outcome.memberId);
    if (!profile || SIGN_IN_BLOCKED.has(profile.status)) {
      // Suspended mid-session: kill the successor this rotation just minted
      // along with everything else, rather than leaving a live token nobody holds.
      await revokeAllMemberSessions(outcome.memberId);
      clearRefreshCookie(res);
      throw unauthorized("Please sign in to continue");
    }

    setRefreshCookie(res, outcome.refreshToken);
    res.json({
      member: profile,
      accessToken: signMemberAccessToken({ sub: profile.id, email: profile.email }),
    });
  })
);

/**
 * POST /api/auth/forgot-password
 *
 * Always 200. The work behind it is conditional, the answer never is.
 */
memberAuthRoutes.post(
  "/forgot-password",
  memberEmailLinkLimiter,
  asyncHandler(async (req, res) => {
    const parsed = forgotPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      throw badRequest("Please enter a valid email address.", parsed.error.flatten());
    }
    const { email } = parsed.data;

    const member = await findByEmail(email);
    if (member && member.status === "active") {
      // A second durable cap on top of the IP+email limiter: an attacker who
      // rotates IPs still cannot use the reset endpoint to bury a real member's
      // inbox, because the ceiling is counted per account.
      const recent = await pool.query<{ count: string }>(
        `SELECT count(*) AS count
           FROM member_password_resets
          WHERE member_id = $1
            AND created_at > now() - make_interval(mins => $2)`,
        [member.id, RESET_WINDOW_MINUTES]
      );
      if (Number(recent.rows[0]?.count ?? 0) < RESET_MAX_PER_WINDOW) {
        const raw = generateToken();
        await pool.query(
          `INSERT INTO member_password_resets (member_id, token_hash, expires_at)
           VALUES ($1, $2, $3)`,
          [member.id, hashToken(raw), expiresIn(PASSWORD_RESET_TTL_MINUTES * 60)]
        );
        void sendMail({
          to: member.email,
          ...emails.passwordReset({
            firstName: member.first_name,
            token: raw,
            expiresInMinutes: PASSWORD_RESET_TTL_MINUTES,
          }),
        });
      }
    }

    res.json({ ok: true });
  })
);

/**
 * POST /api/auth/reset-password
 *
 * Every session dies here, including the one the member is holding. Whoever
 * needed this link may have needed it because somebody else was already signed
 * in as them, and a reset that leaves the intruder's session alive fixes nothing.
 */
memberAuthRoutes.post(
  "/reset-password",
  memberEmailLinkLimiter,
  asyncHandler(async (req, res) => {
    const parsed = resetPasswordSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest(GENERIC_LINK, parsed.error.flatten());
    const { token, password } = parsed.data;

    const strength = checkPasswordStrength(password);
    if (!strength.ok) throw badRequest(strength.reason ?? "Please choose a stronger password.");

    const passwordHash = await hashPassword(password);

    const client = await pool.connect();
    let member: { id: number; email: string; first_name: string };
    try {
      await client.query("BEGIN");

      // The UPDATE is the claim, not the SELECT: two tabs submitting the same
      // link at once must not both succeed, and `used_at IS NULL` in the WHERE
      // makes the row itself the lock.
      const claimed = await client.query<{ member_id: number }>(
        `UPDATE member_password_resets
            SET used_at = now()
          WHERE token_hash = $1
            AND used_at IS NULL
            AND expires_at > now()
          RETURNING member_id`,
        [hashToken(token)]
      );
      const reset = claimed.rows[0];
      if (!reset) throw badRequest(GENERIC_LINK);

      const updated = await client.query<{ id: number; email: string; first_name: string }>(
        `UPDATE members
            SET password_hash    = $2,
                -- Clicking a link that only arrived at that address proves the
                -- address, so an unverified account is verified on the way past.
                email_verified_at = COALESCE(email_verified_at, now()),
                -- An invited or guest-checkout row becomes a real account here.
                -- This is the ONLY path that sets a first password, because it
                -- is the only one that proves who owns the inbox.
                status            = CASE WHEN status = 'invited' THEN 'active' ELSE status END,
                updated_at        = now()
          WHERE id = $1
            -- An erased account stays erased. Reset tokens outlive the
            -- anonymisation that voided them, and one clicked afterwards would
            -- otherwise put a password back on a row that no longer represents
            -- anybody.
            AND status <> 'deleted'
          RETURNING id, email, first_name`,
        [reset.member_id, passwordHash]
      );
      member = updated.rows[0];
      if (!member) throw badRequest(GENERIC_LINK);

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }

    await revokeAllMemberSessions(member.id, "password_change");
    clearRefreshCookie(res);

    // Resetting the password is the other thing a locked-out person will try,
    // and it proves they hold the inbox. Leaving the failure history in place
    // would mean the reset appeared to work and sign-in still refused them.
    await clearLoginFailures(member.email);

    void sendMail({
      to: member.email,
      ...emails.passwordChanged({ firstName: member.first_name }),
    });

    res.json({ ok: true });
  })
);

/**
 * POST /api/auth/verify-email
 *
 * Doubles as the email-change flow: the token carries the address it was sent
 * to, so consuming it moves `members.email` to that address. The unique index
 * is what stops a second account being reached this way.
 */
memberAuthRoutes.post(
  "/verify-email",
  memberTokenLimiter,
  asyncHandler(async (req, res) => {
    const parsed = verifyEmailSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest(GENERIC_LINK, parsed.error.flatten());

    const client = await pool.connect();
    let member: { email: string; first_name: string; firstVerification: boolean };
    try {
      await client.query("BEGIN");

      const claimed = await client.query<{ member_id: number; email: string }>(
        `UPDATE member_email_verifications
            SET used_at = now()
          WHERE token_hash = $1
            AND used_at IS NULL
            AND expires_at > now()
          RETURNING member_id, email`,
        [hashToken(parsed.data.token)]
      );
      const verification = claimed.rows[0];
      if (!verification) throw badRequest(GENERIC_LINK);

      // Read before writing: after the UPDATE every row looks verified, and the
      // welcome email is only owed to someone confirming for the first time
      // rather than to someone re-verifying a changed address.
      const before = await client.query<{ email_verified_at: Date | null }>(
        `SELECT email_verified_at FROM members WHERE id = $1 FOR UPDATE`,
        [verification.member_id]
      );

      const updated = await client.query<{ email: string; first_name: string }>(
        `UPDATE members
            SET email             = $2,
                email_verified_at = COALESCE(email_verified_at, now()),
                updated_at        = now()
          WHERE id = $1
            -- An erased account stays erased. This statement writes an email
            -- address back onto the row, and a verification link outlives the
            -- anonymisation by up to 24 hours — so without this guard, a member
            -- who asked to be forgotten and then clicked a link still sitting in
            -- their inbox would restore the address the deletion removed, while
            -- the audit log went on asserting it was gone.
            AND status <> 'deleted'
          RETURNING email, first_name`,
        [verification.member_id, verification.email]
      );
      if (!updated.rows[0]) throw badRequest(GENERIC_LINK);
      member = {
        ...updated.rows[0],
        firstVerification: before.rows[0]?.email_verified_at == null,
      };

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      if (isUniqueViolation(err)) {
        throw badRequest("That email address is already in use on another account.");
      }
      throw err;
    } finally {
      client.release();
    }

    if (member.firstVerification) {
      void sendMail({
        to: member.email,
        ...emails.welcome({ firstName: member.first_name }),
      });
    }

    res.json({ ok: true });
  })
);

/**
 * POST /api/auth/resend-verification
 *
 * Takes an address, or none at all when the caller is already signed in —
 * hence `optionalMember`. Always 200, for the same reason forgot-password is.
 */
memberAuthRoutes.post(
  "/resend-verification",
  memberEmailLinkLimiter,
  optionalMember,
  asyncHandler(async (req, res) => {
    const parsed = resendVerificationSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw badRequest("Please enter a valid email address.", parsed.error.flatten());
    }

    const address = req.member?.email ?? parsed.data.email;
    if (address) {
      const member = await findByEmail(address);
      if (member && !member.email_verified_at && !SIGN_IN_BLOCKED.has(member.status)) {
        await sendVerificationEmail(member);
      }
    }

    res.json({ ok: true });
  })
);

async function requireMagicLinkEnabled(): Promise<void> {
  const result = await pool.query<{ value: unknown }>(
    `SELECT value FROM settings WHERE key = 'member_signin'`
  );
  const value = result.rows[0]?.value;
  const setting = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};

  // Both spellings are accepted: the settings screen round-trips camelCase JSON,
  // while the migration documents the key in snake_case. Off is the default —
  // a feature that emails a bearer sign-in link should not switch itself on.
  const enabled = setting.magicLinkEnabled === true || setting.magic_link_enabled === true;

  // 404 rather than 403: a disabled feature should look like a route that was
  // never built, which is also exactly what the client is written to expect.
  if (!enabled) throw notFound();
}

/** POST /api/auth/magic-link */
memberAuthRoutes.post(
  "/magic-link",
  memberEmailLinkLimiter,
  asyncHandler(async (req, res) => {
    await requireMagicLinkEnabled();

    const parsed = magicLinkRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      throw badRequest("Please enter a valid email address.", parsed.error.flatten());
    }

    const member = await findByEmail(parsed.data.email);
    if (member && member.status === "active") {
      // Ceiling first. This endpoint mails a bearer sign-in link, so flooding it
      // is worse than ordinary inbox noise: it trains the recipient to expect
      // unprompted "click here to sign in" mail from us, which is precisely the
      // habit a phishing campaign against this audience would rely on.
      const recent = await pool.query<{ count: string }>(
        `SELECT count(*) AS count
           FROM member_magic_links
          WHERE member_id = $1
            AND created_at > now() - make_interval(mins => $2)`,
        [member.id, RESET_WINDOW_MINUTES]
      );
      if (Number(recent.rows[0]?.count ?? 0) >= RESET_MAX_PER_WINDOW) {
        res.json({ ok: true });
        return;
      }

      await pool.query(
        `UPDATE member_magic_links SET used_at = now()
          WHERE member_id = $1 AND used_at IS NULL`,
        [member.id]
      );

      const raw = generateToken();
      await pool.query(
        `INSERT INTO member_magic_links (member_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
        [member.id, hashToken(raw), expiresIn(MAGIC_LINK_TTL_MINUTES * 60)]
      );
      void sendMail({
        to: member.email,
        ...emails.magicLink({
          firstName: member.first_name,
          token: raw,
          expiresInMinutes: MAGIC_LINK_TTL_MINUTES,
        }),
      });
    }

    res.json({ ok: true });
  })
);

/** POST /api/auth/magic-link/consume — the link itself is the credential. */
memberAuthRoutes.post(
  "/magic-link/consume",
  memberTokenLimiter,
  asyncHandler(async (req, res) => {
    await requireMagicLinkEnabled();

    const parsed = magicLinkConsumeSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest(GENERIC_LINK, parsed.error.flatten());

    const claimed = await pool.query<{ member_id: number }>(
      `UPDATE member_magic_links
          SET used_at = now()
        WHERE token_hash = $1
          AND used_at IS NULL
          AND expires_at > now()
        RETURNING member_id`,
      [hashToken(parsed.data.token)]
    );
    const link = claimed.rows[0];
    if (!link) throw badRequest(GENERIC_LINK);

    const updated = await pool.query<MemberProfileRow>(
      `UPDATE members
          SET email_verified_at = COALESCE(email_verified_at, now()),
              last_login_at     = now(),
              updated_at        = now()
        WHERE id = $1
        RETURNING ${MEMBER_PROFILE_COLUMNS}`,
      [link.member_id]
    );
    const row = updated.rows[0];
    if (!row || SIGN_IN_BLOCKED.has(row.status)) throw unauthorized(GENERIC_CREDENTIALS);

    const session = await startSession(res, toMemberProfile(row), clientMeta(req));
    res.json(session);
  })
);
