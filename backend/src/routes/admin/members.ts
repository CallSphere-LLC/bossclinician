import { NextFunction, Request, Response, Router } from "express";
import { z } from "zod";
import type { PoolClient } from "pg";
import { pool } from "../../db/pool";
import { rowToCamel, rowsToCamel } from "../../utils/case";
import { asyncHandler } from "../../utils/asyncHandler";
import { badRequest, forbidden, notFound } from "../../utils/httpError";
import { env } from "../../config/env";
import { sendMail } from "../../email/mailer";
import { escapeHtml } from "../../email/templates";
import { generateToken, hashToken, expiresIn } from "../../auth/tokens";
import {
  ACCESS_TOKEN_TTL_SECONDS,
  revokeAllMemberSessions,
  signMemberAccessToken,
  type DeliberateRevocation,
} from "../../auth/memberSession";
import { adminImpersonateLimiter } from "../../middleware/rateLimit";
import { recordAdminAction, recordAdminActionStrict } from "../../services/adminAudit";
import { requirePermission } from "../../services/permissions";
import { upsertContactWithStatus } from "../../services/contacts";
import {
  confirmMemberEmailAsAdmin,
  confirmationForMember,
  sendMemberVerificationEmail,
} from "../../services/emailConfirmation";
import { dispatchEvent } from "../../services/webhooksOut";
import { publishDomainEvent } from "../../services/domainEvents";

/** Members (students), their enrollments, and the account actions an admin can take on them. Mounted at /admin/members. */
export const adminMembersRouter = Router();

/**
 * The mount only asks for `contacts.view`, which is what lets Customer support
 * look a customer up. Everything that changes an account asks for
 * `contacts.manage` as well — without this, a support account could delete a
 * customer outright, and the erasure branch takes their enrollments with it.
 */
const requireManage = requirePermission("contacts.manage");

/**
 * Impersonation is stricter still.
 *
 * It hands back a working key to a customer's account — their library, their
 * community posts, their invoices — so it stays with the two roles that run the
 * business rather than with everyone who can open the contact list. There is no
 * permission for it in the matrix, and inventing one here would put the answer
 * to "who may sign in as a customer" somewhere nobody would look for it.
 */
function requireBusinessAdmin(req: Request, _res: Response, next: NextFunction): void {
  const role = req.user?.role;
  if (role !== "owner" && role !== "admin") {
    next(forbidden("Only the owner or a manager can view the site as a customer."));
    return;
  }
  next();
}

export interface Member {
  id: number;
  email: string;
  name: string;
  firstName: string;
  lastName: string;
  avatarUrl: string;
  timezone: string;
  locale: string;
  status: string;
  emailVerifiedAt: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
  enrollmentCount: number;
}

export interface Enrollment {
  id: number;
  memberId: number;
  courseId: number;
  courseTitle: string;
  progress: number;
  createdAt: string;
}

type MemberRow = {
  id: number;
  email: string;
  name: string;
  first_name: string;
  last_name: string;
  avatar_url: string;
  timezone: string;
  locale: string;
  status: string;
  email_verified_at: string | null;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
};

type MemberListRow = MemberRow & { enrollment_count: number };

/**
 * The column list every read in this file uses, spelled out rather than `m.*`.
 *
 * `members.password_hash` sits on the same row, and nothing here — not the
 * list, not the CSV the browser downloads, not the GDPR export handed to the
 * member — has any business carrying it out of the database.
 */
const MEMBER_COLUMNS = `m.id, m.email, m.name, m.first_name, m.last_name, m.avatar_url,
       m.timezone, m.locale, m.status, m.email_verified_at, m.last_login_at,
       m.created_at, m.updated_at`;

const ENROLLMENT_COUNT = `(SELECT COUNT(*)::int FROM enrollments e WHERE e.member_id = m.id) AS enrollment_count`;

/**
 * `deleted` is missing from the editable set on purpose. It is reachable only
 * through DELETE /:id, which also anonymises the row and revokes its sessions —
 * setting it through a plain status edit would leave a fully readable account
 * wearing an "erased" label.
 */
const EDITABLE_STATUSES = ["active", "invited", "cancelled", "suspended"] as const;
/** Filtering is a read, so the erased rows are findable; the two lists differ only in `deleted`. */
const FILTERABLE_STATUSES = ["active", "invited", "cancelled", "suspended", "deleted"] as const;

/** How many rows the unqualified (array-shaped) list will hold in memory. */
const LEGACY_LIST_CEILING = 1000;

const idSchema = z.coerce.number().int().positive();

function parseId(raw: string, label = "member"): number {
  const parsed = idSchema.safeParse(raw);
  if (!parsed.success) throw badRequest(`Invalid ${label} id`);
  return parsed.data;
}

/**
 * The display name the member screens show: first + last, falling back to the
 * `name` column for rows an admin created before either field existed.
 */
function displayName(row: MemberRow): string {
  return `${row.first_name} ${row.last_name}`.trim() || row.name;
}

function toMemberProfile(row: MemberRow, impersonatedBy?: number) {
  return {
    id: row.id,
    email: row.email,
    firstName: row.first_name,
    lastName: row.last_name,
    name: displayName(row),
    avatarUrl: row.avatar_url,
    timezone: row.timezone,
    locale: row.locale,
    status: row.status,
    emailVerifiedAt: row.email_verified_at,
    createdAt: row.created_at,
    ...(impersonatedBy === undefined ? {} : { impersonatedBy }),
  };
}

async function loadMember(id: number): Promise<MemberRow> {
  const result = await pool.query<MemberRow>(
    `SELECT ${MEMBER_COLUMNS} FROM members m WHERE m.id = $1`,
    [id],
  );
  const row = result.rows[0];
  if (!row) throw notFound("Member not found");
  return row;
}

/**
 * An anonymised row is a financial stub, not an account: it has no name, no
 * password and no inbox behind it. Every write path refuses to touch one rather
 * than quietly producing a half-resurrected member.
 */
function assertNotDeleted(row: MemberRow): void {
  if (row.status === "deleted") {
    throw badRequest("This member's account has been deleted");
  }
}

/**
 * Escapes the characters LIKE reads as syntax, so searching for "100%" finds
 * the literal string instead of matching every row. The wildcards that make it
 * a search are added here, in the *value* — the pattern reaches Postgres as a
 * bind parameter and never as part of the query text.
 */
function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

interface MemberFilters {
  q?: string;
  status?: string;
  courseId?: number;
}

function buildMemberFilters(filters: MemberFilters): { where: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (filters.q) {
    params.push(likePattern(filters.q));
    clauses.push(
      `(m.email ILIKE $${params.length}
         OR m.name ILIKE $${params.length}
         OR TRIM(m.first_name || ' ' || m.last_name) ILIKE $${params.length})`,
    );
  }

  if (filters.status) {
    params.push(filters.status);
    clauses.push(`m.status = $${params.length}`);
  }

  if (filters.courseId !== undefined) {
    params.push(filters.courseId);
    clauses.push(
      `EXISTS (SELECT 1 FROM enrollments en
                WHERE en.member_id = m.id AND en.course_id = $${params.length})`,
    );
  }

  return { where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", params };
}

const listQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  status: z.enum(FILTERABLE_STATUSES).optional(),
  courseId: z.coerce.number().int().positive().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

/**
 * GET /admin/members
 *
 * Two response shapes, deliberately.
 *
 * The members screen has always called this with no query string and rendered
 * the bare array it got back, so an unqualified request still returns every
 * member as an array — adding search and paging must not break the page that
 * already exists. Passing any query parameter at all opts into the
 * `{items, total, page, pageSize}` envelope; a caller that sends filters is by
 * definition a new caller and can read the new shape.
 */
adminMembersRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) throw badRequest("Invalid query", parsed.error.flatten());
    const { q, status, courseId, page, limit } = parsed.data;

    const { where, params } = buildMemberFilters({ q, status, courseId });
    const listSql = `SELECT ${MEMBER_COLUMNS}, ${ENROLLMENT_COUNT}
       FROM members m
       ${where}
      ORDER BY m.created_at DESC`;

    if (Object.keys(req.query).length === 0) {
      // Bounded even on the legacy path. The API process runs in a 1GB
      // container that also renders the marketing pages, and an unqualified
      // SELECT over the whole members table is the one read here that grows
      // without limit. Anything past the ceiling is reached through the paged
      // shape below, which is what the query string opts into.
      const all = await pool.query<MemberListRow>(`${listSql} LIMIT ${LEGACY_LIST_CEILING}`, params);
      res.json(rowsToCamel<Member>(all.rows));
      return;
    }

    const [items, total] = await Promise.all([
      pool.query<MemberListRow>(
        `${listSql} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, (page - 1) * limit],
      ),
      pool.query<{ count: number }>(`SELECT COUNT(*)::int AS count FROM members m ${where}`, params),
    ]);

    res.json({
      items: rowsToCamel<Member>(items.rows),
      total: total.rows[0]?.count ?? 0,
      page,
      pageSize: limit,
    });
  }),
);

export const createSchema = z.object({
  email: z.string().trim().email().max(320),
  name: z.string().trim().max(200).optional(),
  firstName: z.string().trim().max(120).optional(),
  lastName: z.string().trim().max(120).optional(),
  status: z.enum(EDITABLE_STATUSES).optional(),
});

adminMembersRouter.post(
  "/",
  requireManage,
  asyncHandler(async (req, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Invalid payload", parsed.error.flatten());
    const { email, firstName = "", lastName = "", status } = parsed.data;
    const name = parsed.data.name ?? `${firstName} ${lastName}`.trim();

    // The address is stored as typed: the unique index is on a citext column,
    // so case folding buys no extra protection against duplicates and only
    // costs the member a correctly-capitalised email in their inbox.
    //
    // Re-adding an existing member updates them rather than erroring, which is
    // the behaviour the members screen has always relied on — but a field the
    // form left empty must not blank one that already has a value.
    const result = await pool.query<MemberListRow & { was_created: boolean }>(
      `INSERT INTO members AS m (email, name, first_name, last_name, status)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (email) DO UPDATE
          SET name       = CASE WHEN EXCLUDED.name <> '' THEN EXCLUDED.name ELSE m.name END,
              first_name = CASE WHEN EXCLUDED.first_name <> '' THEN EXCLUDED.first_name ELSE m.first_name END,
              last_name  = CASE WHEN EXCLUDED.last_name <> '' THEN EXCLUDED.last_name ELSE m.last_name END,
              updated_at = now()
       RETURNING ${MEMBER_COLUMNS}, ${ENROLLMENT_COUNT}, (xmax = 0) AS was_created`,
      [email, name, firstName, lastName, status ?? "active"],
    );

    const saved = result.rows[0];
    if (!saved) throw badRequest("Member could not be saved");
    const { was_created: wasCreated, ...member } = saved;

    const contact = await upsertContactWithStatus({
      email,
      name,
      firstName,
      lastName,
      source: "admin",
    });
    const contactId = contact.id;
    await pool.query(
      `UPDATE members SET contact_id = COALESCE(contact_id, $2), updated_at = now() WHERE id = $1`,
      [member.id, contactId],
    );
    if (contact.created) {
      await publishDomainEvent("contact_created", {
        eventKey: `contact-created:${contactId}`,
        contactId,
        email,
        name,
        source: "admin",
      });
    }
    if (wasCreated) {
      await dispatchEvent("member.created", {
        id: `member:${member.id}`,
        memberId: member.id,
        contactId,
        email,
        source: "admin",
      });
    }

    await recordAdminAction({
      req,
      action: "member.create",
      entityType: "member",
      entityId: member.id,
      after: toMemberProfile(member),
    });

    res.status(201).json(rowToCamel<Member>(member));
  }),
);

export const updateSchema = z.object({
  name: z.string().trim().max(200).optional(),
  firstName: z.string().trim().max(120).optional(),
  lastName: z.string().trim().max(120).optional(),
  timezone: z.string().trim().max(80).optional(),
  status: z.enum(EDITABLE_STATUSES).optional(),
});

adminMembersRouter.put(
  "/:id",
  requireManage,
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Invalid payload", parsed.error.flatten());

    const before = await loadMember(id);
    assertNotDeleted(before);

    const { name, firstName, lastName, timezone, status } = parsed.data;
    const result = await pool.query<MemberRow>(
      `UPDATE members AS m
          SET name       = COALESCE($1::text, m.name),
              first_name = COALESCE($2::text, m.first_name),
              last_name  = COALESCE($3::text, m.last_name),
              timezone   = COALESCE($4::text, m.timezone),
              status     = COALESCE($5::text, m.status),
              updated_at = now()
        WHERE m.id = $6
       RETURNING ${MEMBER_COLUMNS}`,
      [name ?? null, firstName ?? null, lastName ?? null, timezone ?? null, status ?? null, id],
    );

    const after = result.rows[0];
    if (!after) throw notFound("Member not found");

    await recordAdminAction({
      req,
      action: "member.update",
      entityType: "member",
      entityId: id,
      before: toMemberProfile(before),
      after: toMemberProfile(after),
    });

    res.json(rowToCamel<Member>(after));
  }),
);

/**
 * Typed against the session module's union rather than spelled inline, so the
 * reason recorded here stays one the rotation path recognises as deliberate.
 */
const ERASURE_REVOCATION: DeliberateRevocation = "admin";

/**
 * Removes everything that could bring an erased member back.
 *
 * The three token tables each hold links that stay live for up to 24 hours and
 * each of them writes to the member row: a verification link restores the real
 * address and marks it verified, a reset link sets a password, a magic link
 * opens a session. Leaving them outstanding means the erased person can undo
 * the erasure from their inbox — putting the address back into the CSV export
 * while the audit row still says it was removed.
 *
 * Takes the caller's client so it lands in the same transaction as the erasure
 * itself; `revokeAllMemberSessions` runs on its own connection and would commit
 * separately, leaving a window in which the row is marked deleted and a token
 * that reverses it is still redeemable.
 */
async function purgeMemberCredentials(client: PoolClient, id: number): Promise<void> {
  await client.query(`DELETE FROM member_email_verifications WHERE member_id = $1`, [id]);
  await client.query(`DELETE FROM member_password_resets WHERE member_id = $1`, [id]);
  await client.query(`DELETE FROM member_magic_links WHERE member_id = $1`, [id]);
  await client.query(
    `UPDATE member_sessions
        SET revoked_at = now(), revoked_reason = $2
      WHERE member_id = $1 AND revoked_at IS NULL`,
    [id, ERASURE_REVOCATION],
  );
}

/**
 * DELETE /admin/members/:id — a deletion request, not a DELETE statement.
 *
 * A member who has paid for something cannot simply vanish: `orders` is the
 * financial record behind real money that moved, and tax law outlives any
 * erasure request. So the two cases are handled differently — a member with
 * orders is anonymised in place (the row survives to anchor the payments, the
 * person behind it does not), and a member who never bought anything is removed
 * outright, cascading to sessions, enrollments and community rows.
 *
 * Both branches answer 204, which is what the members screen already expects.
 */
adminMembersRouter.delete(
  "/:id",
  requireManage,
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const member = await loadMember(id);

    // Deleting an already-anonymised member would be actively harmful rather
    // than merely redundant: the row no longer carries the address its orders
    // were placed under, so the orders check below would find nothing and take
    // the hard-delete branch, cascading away the enrollments and subscriptions
    // that stand behind those payments. The erasure already happened; say so.
    if (member.status === "deleted") {
      res.status(204).end();
      return;
    }

    // One transaction covers the whole erasure: the row and every credential
    // that could reach it have to stop existing together, or there is an
    // interval in which one of them has been dealt with and the other has not.
    const client = await pool.connect();
    let hasOrders = false;
    try {
      await client.query("BEGIN");

      // orders are keyed by the email that paid, and that column is plain TEXT
      // while members.email is CITEXT. Without the casts Postgres resolves this
      // to case-sensitive text equality, and a member who checked out as
      // "Y@x.com" would look like they had never bought anything.
      const orders = await client.query<{ count: number }>(
        `SELECT COUNT(*)::int AS count FROM orders o WHERE o.email::citext = $1::citext`,
        [member.email],
      );
      hasOrders = (orders.rows[0]?.count ?? 0) > 0;

      // Runs on both branches. ON DELETE CASCADE would carry these away on the
      // second one, but an erasure guarantee that holds only on the branch that
      // happens to have been taken is one that will eventually be wrong.
      await purgeMemberCredentials(client, id);

      if (hasOrders) {
        // .invalid is reserved by RFC 2606 and can never be delivered to or
        // registered by anyone, so the placeholder address cannot collide with a
        // future real member or leak mail to a stranger.
        await client.query(
          `UPDATE members
              SET email = $2, name = '', first_name = '', last_name = '', avatar_url = '',
                  password_hash = NULL, email_verified_at = NULL, status = 'deleted',
                  updated_at = now()
            WHERE id = $1`,
          [id, `deleted-${id}@removed.invalid`],
        );
      } else {
        await client.query(`DELETE FROM members WHERE id = $1`, [id]);
      }

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }

    // Only the shape of the record is logged, never the name or address that
    // was just erased: an audit row quoting the deleted member's details would
    // reinstate, in another table, exactly the data the request asked us to
    // remove.
    await recordAdminAction({
      req,
      action: hasOrders ? "member.anonymise" : "member.delete",
      entityType: "member",
      entityId: id,
      before: { status: member.status, hadOrders: hasOrders },
    });

    res.status(204).end();
  }),
);

/**
 * POST /admin/members/:id/impersonate — "view the site as this member".
 *
 * Hands back an access token and nothing else. No refresh token is issued and
 * no `member_sessions` row is created, and that absence *is* the security model
 * here: the token dies after 15 minutes with nothing in existence that could
 * renew it, so the window closes by itself whether the admin remembers to leave
 * or not, and a token copied out of the browser is worthless within the quarter
 * hour. A refresh cookie would quietly convert a fifteen-minute look into a
 * thirty-day standing key to a customer's account.
 *
 * It also means impersonation cannot be laundered into an ordinary session:
 * /api/auth/refresh has no row to rotate, so there is no path by which the
 * `impersonatedBy` claim gets dropped and the session comes back as the member
 * themselves.
 *
 * What the token can do is bounded on the other side: `denyImpersonation` sits
 * on every member route that writes, so this is a way to see a customer's
 * account and not a way to act in it. That matters here because a write made
 * with this token is recorded as the customer's own, and the log below is the
 * last thing said about the session.
 *
 * The audit row is written first and is allowed to fail the request — see
 * recordAdminActionStrict for why this endpoint inverts the usual rule.
 */
adminMembersRouter.post(
  "/:id/impersonate",
  requireBusinessAdmin,
  adminImpersonateLimiter,
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const adminId = req.user?.sub;
    if (adminId === undefined) throw forbidden("Admin identity missing");

    const member = await loadMember(id);
    assertNotDeleted(member);

    await recordAdminActionStrict({
      req,
      action: "member.impersonate",
      entityType: "member",
      entityId: id,
      after: { memberEmail: member.email, expiresInSeconds: ACCESS_TOKEN_TTL_SECONDS },
    });

    const accessToken = signMemberAccessToken({
      sub: member.id,
      email: member.email,
      impersonatedBy: adminId,
    });

    res.json({ accessToken, member: toMemberProfile(member, adminId) });
  }),
);

/**
 * Admin-issued links outlive the member-initiated forgot-password flow: they
 * usually go to somebody who was imported or invited and is not sitting at
 * their inbox waiting for one.
 */
const ADMIN_RESET_TTL_SECONDS = 24 * 60 * 60;

/**
 * POST /admin/members/:id/reset-password
 *
 * The raw token goes into the member's inbox and nowhere else — in particular
 * not into this response. An admin who could read the token back could set a
 * customer's password and sign in as them without the impersonation audit trail
 * ever recording it, which is precisely the hole impersonation is designed to
 * close. Keeping the token in the email leaves the member's mailbox as the
 * second factor.
 */
adminMembersRouter.post(
  "/:id/reset-password",
  requireManage,
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const member = await loadMember(id);
    assertNotDeleted(member);

    const raw = generateToken();

    // One live link at a time: issuing a new one retires any earlier unused
    // link, so a forwarded or intercepted older email stops working the moment
    // the admin sends a fresh one.
    await pool.query(
      `UPDATE member_password_resets SET used_at = now()
        WHERE member_id = $1 AND used_at IS NULL`,
      [id],
    );
    await pool.query(
      `INSERT INTO member_password_resets (member_id, token_hash, expires_at)
       VALUES ($1, $2, $3)`,
      [id, hashToken(raw), expiresIn(ADMIN_RESET_TTL_SECONDS)],
    );

    // The token is the last path segment, not a query parameter: the page on the
    // other end is routed as `/reset-password/:token` and reads it with
    // `useParams` (frontend/src/App.tsx). A `?token=` link arrives at a route
    // that does not exist, so the member Yvette just sent a password link to
    // lands on the not-found page. Every other builder in the platform — the
    // member-initiated reset in email/memberTemplates.ts and the post-purchase
    // link in services/setPasswordLink.ts — already spells it this way.
    const link = `${env.publicSiteUrl}/reset-password/${encodeURIComponent(raw)}`;
    const greeting = member.first_name || displayName(member) || "there";

    await sendMail({
      to: member.email,
      subject: "Set your Boss Clinician password",
      text: [
        `Hi ${greeting},`,
        ``,
        `A password link was created for your Boss Clinician account. Choose a new password here:`,
        ``,
        link,
        ``,
        `The link works once and expires in 24 hours. If you weren't expecting it you can ignore this email — your current password keeps working until the link is used.`,
        ``,
        `— Boss Clinician`,
      ].join("\n"),
      html: [
        `<p>Hi ${escapeHtml(greeting)},</p>`,
        `<p>A password link was created for your Boss Clinician account. Choose a new password here:</p>`,
        `<p><a href="${escapeHtml(link)}">Set your password</a></p>`,
        `<p>The link works once and expires in 24 hours. If you weren't expecting it you can ignore this email — your current password keeps working until the link is used.</p>`,
        `<p>— Boss Clinician</p>`,
      ].join("\n"),
    });

    await recordAdminAction({
      req,
      action: "member.reset_password",
      entityType: "member",
      entityId: id,
    });

    res.json({ ok: true });
  }),
);

/**
 * Suspension has to bite immediately, and revoking the refresh tokens is what
 * makes that true: leave them alive and the member's browser quietly refreshes
 * itself back into a working session for the next thirty days.
 */
adminMembersRouter.post(
  "/:id/suspend",
  requireManage,
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const before = await loadMember(id);
    assertNotDeleted(before);

    const result = await pool.query<MemberRow>(
      `UPDATE members AS m SET status = 'suspended', updated_at = now()
        WHERE m.id = $1 RETURNING ${MEMBER_COLUMNS}`,
      [id],
    );
    await revokeAllMemberSessions(id);

    const after = result.rows[0];
    if (!after) throw notFound("Member not found");

    await recordAdminAction({
      req,
      action: "member.suspend",
      entityType: "member",
      entityId: id,
      before: { status: before.status },
      after: { status: after.status },
    });

    res.json(rowToCamel<Member>(after));
  }),
);

adminMembersRouter.post(
  "/:id/reactivate",
  requireManage,
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const before = await loadMember(id);
    assertNotDeleted(before);

    const result = await pool.query<MemberRow>(
      `UPDATE members AS m SET status = 'active', updated_at = now()
        WHERE m.id = $1 RETURNING ${MEMBER_COLUMNS}`,
      [id],
    );

    const after = result.rows[0];
    if (!after) throw notFound("Member not found");

    await recordAdminAction({
      req,
      action: "member.reactivate",
      entityType: "member",
      entityId: id,
      before: { status: before.status },
      after: { status: after.status },
    });

    res.json(rowToCamel<Member>(after));
  }),
);

/* ---------------------------------------------------- email confirmation */

/**
 * POST /admin/members/:id/confirm-email
 *
 * The override the product cannot run without.
 *
 * `requireVerifiedEmail` gates posting, commenting and every point a member can
 * earn, and the only key was a link in an email. While mail is not arriving —
 * a sending domain that is not verified yet, a provider account under review, a
 * hospital mail filter — every member is locked out of the social half of the
 * product with no way through and no way for anybody to help them.
 *
 * Attributable on purpose: this lets an account post under a name whose owner
 * has not proved they hold the inbox, so the audit row records who decided that.
 * Both confirmation stores are written together — see
 * services/emailConfirmation.ts for why there are two.
 */
adminMembersRouter.post(
  "/:id/confirm-email",
  requireManage,
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const member = await loadMember(id);
    assertNotDeleted(member);

    const result = await confirmMemberEmailAsAdmin(id);

    await recordAdminAction({
      req,
      action: "member.confirm_email",
      entityType: "member",
      entityId: id,
      before: {
        emailVerifiedAt: result.before.accountConfirmedAt,
        contactStatus: result.before.contactStatus,
      },
      after: {
        emailVerifiedAt: result.after.accountConfirmedAt,
        contactStatus: result.after.contactStatus,
        email: member.email,
      },
    });

    res.json({ changed: result.changed, confirmation: result.after });
  }),
);

/**
 * POST /admin/members/:id/resend-confirmation
 *
 * Waits for the transport rather than firing and forgetting: whoever pressed
 * this is trying to find out whether mail works, and "Sent." from a send that
 * was refused is the answer that made this bug take a week to find.
 */
adminMembersRouter.post(
  "/:id/resend-confirmation",
  requireManage,
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const member = await loadMember(id);
    assertNotDeleted(member);

    const state = await confirmationForMember(id);
    if (state.accountConfirmedAt !== null) {
      throw badRequest("They've already confirmed this address — nothing needs sending.");
    }

    const result = await sendMemberVerificationEmail(
      { id, email: member.email, first_name: member.first_name },
      { awaitDelivery: true },
    );

    await recordAdminAction({
      req,
      action: "member.resend_confirmation",
      entityType: "member",
      entityId: id,
      after: { to: member.email, state: result.state },
    });

    res.json({
      state: result.state,
      to: member.email,
      error: result.state === "failed" ? result.error : "",
      confirmation: state,
    });
  }),
);

/**
 * Escapes one CSV field, against two separate problems.
 *
 * The first is CSV syntax: quote every field and double any quote inside it, so
 * commas, quotes and newlines in a name cannot shift the remaining columns.
 *
 * The second is that Excel and Sheets treat a leading =, +, - or @ as the start
 * of a formula, so a member whose "name" is `=HYPERLINK("http://evil","hi")` is
 * shipping code that runs when this file is opened. Prefixing with an apostrophe
 * forces the cell to be read as text; the apostrophe is display-only and is not
 * part of the value. Tab and carriage return lead the same way in some locales,
 * so they are covered too.
 */
function csvCell(value: unknown): string {
  const raw = value === null || value === undefined ? "" : String(value);
  const guarded = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return `"${guarded.replace(/"/g, '""')}"`;
}

const CSV_HEADERS = [
  "ID",
  "Email",
  "First name",
  "Last name",
  "Display name",
  "Status",
  "Email verified",
  "Last login",
  "Enrollments",
  "Joined",
];

const exportQuerySchema = listQuerySchema.pick({ q: true, status: true, courseId: true });

/**
 * GET /admin/members/export.csv
 *
 * Registered ahead of the /:id routes and distinct from them by shape, so
 * "export.csv" is never read as a member id.
 */
adminMembersRouter.get(
  "/export.csv",
  asyncHandler(async (req, res) => {
    const parsed = exportQuerySchema.safeParse(req.query);
    if (!parsed.success) throw badRequest("Invalid query", parsed.error.flatten());

    const { where, params } = buildMemberFilters(parsed.data);
    const result = await pool.query<MemberListRow>(
      `SELECT ${MEMBER_COLUMNS}, ${ENROLLMENT_COUNT}
         FROM members m
         ${where}
        ORDER BY m.created_at DESC`,
      params,
    );

    const lines = [CSV_HEADERS.map(csvCell).join(",")];
    for (const row of result.rows) {
      lines.push(
        [
          row.id,
          row.email,
          row.first_name,
          row.last_name,
          displayName(row),
          row.status,
          row.email_verified_at ?? "",
          row.last_login_at ?? "",
          row.enrollment_count,
          row.created_at,
        ]
          .map(csvCell)
          .join(","),
      );
    }

    await recordAdminAction({
      req,
      action: "member.export_csv",
      entityType: "member",
      entityId: "",
      after: { rows: result.rows.length },
    });

    const filename = `members-${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    // The BOM is for Excel, which otherwise reads the file in the local ANSI
    // codepage and turns every accented name into mojibake. CRLF is what
    // RFC 4180 asks for and what Excel is happiest with.
    res.send(`\uFEFF${lines.join("\r\n")}\r\n`);
  }),
);

const importRowSchema = z.object({
  email: z.string().trim().email().max(320),
  firstName: z.string().trim().max(120).optional(),
  lastName: z.string().trim().max(120).optional(),
  name: z.string().trim().max(200).optional(),
  status: z.enum(EDITABLE_STATUSES).optional(),
});

// Rows are validated one at a time rather than as a typed array, because the
// point of the response is to say *which* rows were rejected and why. A schema
// over the whole array would fail the entire spreadsheet on one bad address.
const importSchema = z.object({
  rows: z.array(z.unknown()).max(5000),
});

function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "Invalid row";
  const path = issue.path.join(".");
  return path ? `${path}: ${issue.message}` : issue.message;
}

/**
 * POST /admin/members/import
 *
 * Deliberately not wrapped in a transaction. A spreadsheet exported from Kajabi
 * will have a handful of malformed addresses in it, and throwing away 4,900 good
 * rows because of them helps nobody — every row that can be applied is applied,
 * and the rest come back itemised so they can be fixed and re-sent. Re-sending
 * the whole file is safe: the upsert makes an already-imported row an update.
 */
adminMembersRouter.post(
  "/import",
  requireManage,
  asyncHandler(async (req, res) => {
    const parsed = importSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Invalid payload", parsed.error.flatten());

    let created = 0;
    let updated = 0;
    let skipped = 0;
    const errors: { row: number; reason: string }[] = [];
    const seen = new Set<string>();

    for (const [index, raw] of parsed.data.rows.entries()) {
      const rowNumber = index + 1;
      const row = importRowSchema.safeParse(raw);
      if (!row.success) {
        skipped += 1;
        errors.push({ row: rowNumber, reason: firstIssue(row.error) });
        continue;
      }

      // Two rows for the same person would otherwise be reported as one created
      // and one updated, which reads as the file having imported cleanly.
      const key = row.data.email.toLowerCase();
      if (seen.has(key)) {
        skipped += 1;
        errors.push({ row: rowNumber, reason: "Duplicate of an earlier row in this file" });
        continue;
      }
      seen.add(key);

      const firstName = row.data.firstName ?? "";
      const lastName = row.data.lastName ?? "";
      const name = row.data.name ?? `${firstName} ${lastName}`.trim();

      try {
        // `xmax = 0` is true only for a tuple this statement inserted, which is
        // the one way to tell a create from an update inside a single upsert.
        // The DO UPDATE guard keeps an import from resurrecting an account that
        // was erased on request; those rows come back as skipped.
        const result = await pool.query<{ inserted: boolean }>(
          `INSERT INTO members (email, name, first_name, last_name, status)
           VALUES ($1, $2, $3, $4, COALESCE($5::text, 'active'))
           ON CONFLICT (email) DO UPDATE
              SET name       = CASE WHEN EXCLUDED.name <> '' THEN EXCLUDED.name ELSE members.name END,
                  first_name = CASE WHEN EXCLUDED.first_name <> '' THEN EXCLUDED.first_name ELSE members.first_name END,
                  last_name  = CASE WHEN EXCLUDED.last_name <> '' THEN EXCLUDED.last_name ELSE members.last_name END,
                  status     = COALESCE($5::text, members.status),
                  updated_at = now()
            WHERE members.status <> 'deleted'
           RETURNING (xmax = 0) AS inserted`,
          [row.data.email, name, firstName, lastName, row.data.status ?? null],
        );

        if (result.rowCount === 0) {
          skipped += 1;
          errors.push({ row: rowNumber, reason: "This account was deleted at the member's request" });
        } else if (result.rows[0]?.inserted) {
          created += 1;
        } else {
          updated += 1;
        }
      } catch (err) {
        // The database's own message can name constraints and columns; the
        // import screen gets a plain sentence and the detail goes to the log.
        // eslint-disable-next-line no-console
        console.error(`[members:import] row ${rowNumber} failed:`, err);
        skipped += 1;
        errors.push({ row: rowNumber, reason: "Could not be saved" });
      }
    }

    await recordAdminAction({
      req,
      action: "member.import",
      entityType: "member",
      entityId: "",
      after: { created, updated, skipped, submitted: parsed.data.rows.length },
    });

    res.json({ created, updated, skipped, errors });
  }),
);

/**
 * GET /admin/members/:id/export — everything held about one member, for a
 * data-portability request.
 *
 * Session rows are included as metadata only. `token_hash` is a credential the
 * member holds rather than information held about them, and a portability
 * request is not a reason to print it into a file that will be emailed around.
 */
adminMembersRouter.get(
  "/:id/export",
  requireManage,
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const member = await loadMember(id);

    const [sessions, enrollments, orders, communities] = await Promise.all([
      pool.query(
        `SELECT s.id, s.user_agent, s.ip, s.created_at, s.last_used_at, s.expires_at, s.revoked_at
           FROM member_sessions s WHERE s.member_id = $1 ORDER BY s.created_at DESC`,
        [id],
      ),
      pool.query(
        `SELECT e.id, e.course_id, c.title AS course_title, e.progress, e.created_at
           FROM enrollments e JOIN courses c ON c.id = e.course_id
          WHERE e.member_id = $1 ORDER BY e.created_at DESC`,
        [id],
      ),
      pool.query(
        `SELECT o.id, o.course_slug, o.course_title, o.amount_cents, o.currency, o.status,
                o.created_at
           FROM orders o WHERE o.email::citext = $1::citext ORDER BY o.created_at DESC`,
        [member.email],
      ),
      pool.query(
        `SELECT cm.id, cm.community_id, c.name AS community_name, cm.role, cm.points, cm.joined_at
           FROM community_memberships cm JOIN communities c ON c.id = cm.community_id
          WHERE cm.member_id = $1 ORDER BY cm.joined_at DESC`,
        [id],
      ),
    ]);

    await recordAdminAction({
      req,
      action: "member.export",
      entityType: "member",
      entityId: id,
    });

    res.json({
      exportedAt: new Date().toISOString(),
      profile: toMemberProfile(member),
      sessions: rowsToCamel(sessions.rows),
      enrollments: rowsToCamel(enrollments.rows),
      orders: rowsToCamel(orders.rows),
      communityMemberships: rowsToCamel(communities.rows),
    });
  }),
);

adminMembersRouter.get(
  "/:id/enrollments",
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const result = await pool.query(
      `SELECT e.*, c.title AS course_title
         FROM enrollments e
         JOIN courses c ON c.id = e.course_id
        WHERE e.member_id = $1
        ORDER BY e.created_at DESC`,
      [id],
    );
    res.json(rowsToCamel<Enrollment>(result.rows));
  }),
);

const enrollSchema = z.object({
  courseId: z.coerce.number().int().positive(),
});

adminMembersRouter.post(
  "/:id/enrollments",
  requireManage,
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const parsed = enrollSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Invalid payload", parsed.error.flatten());
    const { courseId } = parsed.data;

    // Checked up front so a bad id answers 404 rather than surfacing a foreign
    // key violation as a 500.
    await loadMember(id);

    const result = await pool.query(
      `INSERT INTO enrollments (member_id, course_id) VALUES ($1, $2)
       ON CONFLICT (member_id, course_id) DO NOTHING
       RETURNING *`,
      [id, courseId],
    );

    // Already enrolled — treat as success so the UI stays idempotent.
    if (result.rowCount === 0) {
      res.status(200).json({ ok: true, alreadyEnrolled: true });
      return;
    }

    await recordAdminAction({
      req,
      action: "member.enroll",
      entityType: "member",
      entityId: id,
      after: { courseId },
    });

    res.status(201).json(rowToCamel<Enrollment>(result.rows[0]));
  }),
);

adminMembersRouter.delete(
  "/:id/enrollments/:courseId",
  requireManage,
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const courseId = parseId(req.params.courseId, "course");

    const result = await pool.query(
      `DELETE FROM enrollments WHERE member_id = $1 AND course_id = $2`,
      [id, courseId],
    );
    if (result.rowCount === 0) throw notFound("Enrollment not found");

    await recordAdminAction({
      req,
      action: "member.unenroll",
      entityType: "member",
      entityId: id,
      before: { courseId },
    });

    res.status(204).end();
  }),
);
