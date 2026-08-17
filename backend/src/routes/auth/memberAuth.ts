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
 * Both keys are checked — the IP catches one host working through a list of
 * addresses, the email catches a botnet working through one account.
 */
const LOGIN_WINDOW_MINUTES = 15;
const LOGIN_MAX_FAILURES = 5;

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

async function isLoginThrottled(email: string, ip: string): Promise<boolean> {
  const result = await pool.query<{ ip_failures: string; email_failures: string }>(
    `SELECT count(*) FILTER (WHERE ip = $1)    AS ip_failures,
            count(*) FILTER (WHERE email = $2) AS email_failures
       FROM member_login_attempts
      WHERE successful = false
        AND created_at > now() - make_interval(mins => $3)`,
    [ip, email, LOGIN_WINDOW_MINUTES]
  );
  const row = result.rows[0];
  if (!row) return false;
  return (
    Number(row.ip_failures) >= LOGIN_MAX_FAILURES ||
    Number(row.email_failures) >= LOGIN_MAX_FAILURES
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

async function sendVerificationEmail(member: {
  id: number;
  email: string;
  first_name: string;
}): Promise<void> {
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
 * Two paths into the same response. A brand-new address inserts a member; an
 * address that already exists *without* a password hash — someone Yvette
 * invited by hand, or a guest checkout that never chose credentials — has its
 * password set instead of being refused. That claim path is what stops a paying
 * customer from being told their own email is taken by a ghost of themselves.
 */
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
    if (existing && (existing.password_hash || SIGN_IN_BLOCKED.has(existing.status))) {
      throw new HttpError(409, "That email is already registered. Try signing in instead.");
    }

    const passwordHash = await hashPassword(password);
    const displayName = `${firstName} ${lastName}`.trim();

    let row: MemberProfileRow;
    if (existing) {
      const claimed = await pool.query<MemberProfileRow>(
        `UPDATE members
            SET password_hash = $2,
                first_name    = $3,
                last_name     = $4,
                name          = COALESCE(NULLIF($5, ''), name),
                timezone      = COALESCE($6, timezone),
                status        = CASE WHEN status = 'invited' THEN 'active' ELSE status END,
                updated_at    = now()
          WHERE id = $1
          RETURNING ${MEMBER_PROFILE_COLUMNS}`,
        [
          existing.id,
          passwordHash,
          firstName,
          lastName,
          displayName,
          parsed.data.timezone ?? null,
        ]
      );
      row = claimed.rows[0];
    } else {
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
        // Two signups for the same address in the same instant: the unique index
        // is the arbiter, and the loser gets the answer it would have got a
        // moment earlier.
        if (isUniqueViolation(err)) {
          throw new HttpError(409, "That email is already registered. Try signing in instead.");
        }
        throw err;
      }
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

    if (await isLoginThrottled(email, meta.ip)) {
      await recordLoginAttempt(email, meta.ip, false);
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

    await recordLoginAttempt(email, meta.ip, true);
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
                updated_at        = now()
          WHERE id = $1
          RETURNING id, email, first_name`,
        [reset.member_id, passwordHash]
      );
      member = updated.rows[0];

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }

    await revokeAllMemberSessions(member.id);
    clearRefreshCookie(res);

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
          RETURNING email, first_name`,
        [verification.member_id, verification.email]
      );
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
