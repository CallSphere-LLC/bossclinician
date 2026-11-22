import type { PoolClient } from "pg";
import { pool } from "../db/pool";
import { env } from "../config/env";
import { grantAccess, revokeAccess } from "./access";
import { issueSetPasswordLink, SET_PASSWORD_TTL_MINUTES } from "./setPasswordLink";
import { sendMail } from "../email/mailer";
import { escapeHtml } from "../email/templates";
import { formatDateRange } from "./retreatQuestionnaires";
import { normaliseSettings, type RetreatRow } from "./retreats";

/**
 * Giving an existing retreat customer her dashboard (Yvette's item 7, 22 Nov
 * 2026). Access is the one access_grants row on the retreat's OWN dashboard
 * product, written through grantAccess with source 'manual' and notify:false.
 *
 * What a grant deliberately does NOT do (tested in
 * retreatAccess.integration.test.ts):
 *   * no order, payment plan, installment or balance is created or changed;
 *   * no email (the access email is a separate, explicit admin action below);
 *   * no in-app purchase notice, no webhook event, no domain event — so no
 *     offer_purchased / tag / contact_created automation, no sales sequence,
 *     no deposit email, no purchase confirmation;
 *   * no alumni enrolment (that sweep reads the booking product and runs only
 *     after the retreat ends);
 *   * no contact is created for a new account (contact_created is an
 *     automation trigger);
 *   * no other product is granted.
 */

type Queryable = Pick<PoolClient, "query"> | typeof pool;

export interface AccountMatch {
  memberId: number;
  email: string;
  name: string;
  status: string;
  hasPassword: boolean;
  googleLinked: boolean;
  holdsBooking: boolean;
  holdsDashboard: boolean;
}

/** The website account for an email address (members.email is CITEXT: case-insensitive). */
export async function findAccount(retreat: RetreatRow, email: string, db: Queryable = pool): Promise<AccountMatch | null> {
  const result = await db.query<{
    id: number;
    email: string;
    name: string | null;
    first_name: string | null;
    last_name: string | null;
    status: string;
    has_password: boolean;
    google_linked: boolean;
    holds_booking: boolean;
    holds_dashboard: boolean;
  }>(
    `SELECT m.id, m.email::text AS email, m.name, m.first_name, m.last_name, m.status,
            (m.password_hash IS NOT NULL) AS has_password,
            (m.google_sub IS NOT NULL) AS google_linked,
            EXISTS (SELECT 1 FROM access_grants g WHERE g.member_id = m.id AND g.product_id = $2 AND g.status = 'active'
                      AND (g.expires_at IS NULL OR g.expires_at > now())) AS holds_booking,
            EXISTS (SELECT 1 FROM access_grants g WHERE g.member_id = m.id AND g.product_id = $3 AND g.status = 'active'
                      AND (g.expires_at IS NULL OR g.expires_at > now())) AS holds_dashboard
       FROM members m WHERE m.email = $1`,
    [email.trim(), retreat.booking_product_id ?? -1, retreat.product_id ?? -1],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    memberId: row.id,
    email: row.email,
    name: (row.name ?? "").trim() || [row.first_name, row.last_name].filter(Boolean).join(" "),
    status: row.status,
    hasPassword: row.has_password,
    googleLinked: row.google_linked,
    holdsBooking: row.holds_booking,
    holdsDashboard: row.holds_dashboard,
  };
}

export async function accountById(retreat: RetreatRow, memberId: number, db: Queryable = pool): Promise<AccountMatch | null> {
  const found = await db.query<{ email: string }>(`SELECT email::text AS email FROM members WHERE id = $1`, [memberId]);
  return found.rows[0] ? findAccount(retreat, found.rows[0].email, db) : null;
}

export class RetreatAccessError extends Error {
  constructor(
    message: string,
    public readonly code: "no_product" | "account_closed" | "email_mismatch" | "no_account" | "not_found",
    public readonly detail: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export interface GrantInput {
  retreat: RetreatRow;
  adminId: number | null;
  /** Grant to this existing account... */
  memberId?: number;
  /** ...or to the account with this email, creating one (no password, no contact) if there is none. */
  email?: string;
  name?: string;
  /** The email on her booking, when it is known. A different account email must be accepted explicitly. */
  bookingEmail?: string;
  acceptEmailMismatch?: boolean;
  roomType?: "private" | "shared" | null;
}

/**
 * Grants the dashboard. Matches an existing account first (never a duplicate),
 * and refuses to link an account whose email differs from the booking email
 * until the organizer confirms that it is the same person.
 */
export async function grantRetreatAccess(input: GrantInput): Promise<{ memberId: number; created: boolean; alreadyHadAccess: boolean }> {
  const { retreat } = input;
  if (!retreat.product_id) throw new RetreatAccessError("This retreat has no dashboard product to give.", "no_product");

  let account: AccountMatch | null = null;
  if (input.memberId !== undefined) {
    account = await accountById(retreat, input.memberId);
    if (!account) throw new RetreatAccessError("We couldn't find that account.", "not_found");
  } else if (input.email) {
    account = await findAccount(retreat, input.email);
  } else {
    throw new RetreatAccessError("Enter the guest's email address.", "no_account");
  }
  if (account && (account.status === "deleted" || account.status === "suspended")) {
    throw new RetreatAccessError("That account is closed or suspended. Check with the owner before giving access.", "account_closed");
  }

  const bookingEmail = (input.bookingEmail ?? "").trim();
  const accountEmail = account?.email ?? (input.email ?? "").trim();
  if (bookingEmail && bookingEmail.toLowerCase() !== accountEmail.toLowerCase() && !input.acceptEmailMismatch) {
    const bookingAccount = await findAccount(retreat, bookingEmail);
    throw new RetreatAccessError("The booking email and the account email are different.", "email_mismatch", {
      bookingEmail,
      accountEmail,
      bookingEmailAccount: bookingAccount ? { memberId: bookingAccount.memberId, email: bookingAccount.email, name: bookingAccount.name } : null,
    });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let memberId: number;
    let created = false;
    if (account) {
      memberId = account.memberId;
    } else {
      // The site's normal "added by the owner" account: active, no password.
      // She claims it with the set-password link in the access email.
      const name = (input.name ?? "").trim().slice(0, 200);
      const [first, ...rest] = name.split(/\s+/).filter(Boolean);
      const inserted = await client.query<{ id: number; was_created: boolean }>(
        `INSERT INTO members AS m (email, name, first_name, last_name, status)
         VALUES ($1, $2, $3, $4, 'active')
         ON CONFLICT (email) DO UPDATE SET updated_at = m.updated_at
         RETURNING id, (xmax = 0) AS was_created`,
        [accountEmail, name, first ?? "", rest.join(" ")],
      );
      memberId = inserted.rows[0].id;
      created = inserted.rows[0].was_created;
    }

    const before = await client.query<{ status: string }>(
      `SELECT status FROM access_grants WHERE member_id = $1 AND product_id = $2`,
      [memberId, retreat.product_id],
    );
    const alreadyHadAccess = before.rows[0]?.status === "active";
    await grantAccess({ memberId, productId: retreat.product_id, source: "manual", notify: false, client });

    await client.query(
      `INSERT INTO retreat_guests (retreat_id, member_id, room_type, booking_email, email_mismatch_accepted,
                                  access_granted_at, access_granted_by, access_removed_at, access_removed_by)
       VALUES ($1, $2, $3, $4, $5, now(), $6, NULL, NULL)
       ON CONFLICT (retreat_id, member_id) DO UPDATE SET
         room_type = COALESCE(EXCLUDED.room_type, retreat_guests.room_type),
         booking_email = CASE WHEN EXCLUDED.booking_email <> '' THEN EXCLUDED.booking_email ELSE retreat_guests.booking_email END,
         email_mismatch_accepted = retreat_guests.email_mismatch_accepted OR EXCLUDED.email_mismatch_accepted,
         access_granted_at = CASE WHEN retreat_guests.access_removed_at IS NULL AND retreat_guests.access_granted_at IS NOT NULL
                                  THEN retreat_guests.access_granted_at ELSE now() END,
         access_granted_by = CASE WHEN retreat_guests.access_removed_at IS NULL AND retreat_guests.access_granted_at IS NOT NULL
                                  THEN retreat_guests.access_granted_by ELSE EXCLUDED.access_granted_by END,
         access_removed_at = NULL,
         access_removed_by = NULL,
         updated_at = now()`,
      [
        retreat.id,
        memberId,
        input.roomType ?? null,
        bookingEmail,
        Boolean(input.acceptEmailMismatch && bookingEmail && bookingEmail.toLowerCase() !== accountEmail.toLowerCase()),
        input.adminId,
      ],
    );
    await client.query("COMMIT");
    return { memberId, created, alreadyHadAccess };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Removes the dashboard. Revokes only the dashboard grant (never the booking
 * product, never anything else) and deletes none of her answers, agreement or
 * payment records, so access can be given back without loss.
 */
export async function removeRetreatAccess(retreat: RetreatRow, memberId: number, adminId: number | null): Promise<boolean> {
  if (!retreat.product_id) return false;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const revoked = await revokeAccess({
      memberId,
      productId: retreat.product_id,
      reason: "Retreat dashboard access removed by an organizer",
      client,
    });
    await client.query(
      `INSERT INTO retreat_guests (retreat_id, member_id, access_removed_at, access_removed_by)
       VALUES ($1, $2, now(), $3)
       ON CONFLICT (retreat_id, member_id) DO UPDATE SET access_removed_at = now(), access_removed_by = EXCLUDED.access_removed_by, updated_at = now()`,
      [retreat.id, memberId, adminId],
    );
    await client.query("COMMIT");
    return revoked;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function setGuestRoomType(retreatId: number, memberId: number, roomType: "private" | "shared" | null): Promise<void> {
  await pool.query(
    `INSERT INTO retreat_guests (retreat_id, member_id, room_type) VALUES ($1, $2, $3)
     ON CONFLICT (retreat_id, member_id) DO UPDATE SET room_type = EXCLUDED.room_type, updated_at = now()`,
    [retreatId, memberId, roomType],
  );
}

export interface GuestAccessRecord {
  roomType: "private" | "shared" | null;
  bookingEmail: string;
  emailMismatchAccepted: boolean;
  accessGrantedAt: string | null;
  accessRemovedAt: string | null;
  welcomeSentAt: string | null;
  welcomeSendCount: number;
}

export async function loadGuestAccessRecords(retreatId: number): Promise<Map<number, GuestAccessRecord>> {
  const result = await pool.query<{
    member_id: number;
    room_type: "private" | "shared" | null;
    booking_email: string;
    email_mismatch_accepted: boolean;
    access_granted_at: Date | null;
    access_removed_at: Date | null;
    welcome_sent_at: Date | null;
    welcome_send_count: number;
  }>(`SELECT * FROM retreat_guests WHERE retreat_id = $1`, [retreatId]);
  const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);
  return new Map(
    result.rows.map((row) => [
      row.member_id,
      {
        roomType: row.room_type,
        bookingEmail: row.booking_email,
        emailMismatchAccepted: row.email_mismatch_accepted,
        accessGrantedAt: iso(row.access_granted_at),
        accessRemovedAt: iso(row.access_removed_at),
        welcomeSentAt: iso(row.welcome_sent_at),
        welcomeSendCount: row.welcome_send_count,
      },
    ]),
  );
}

/* ─────────────────────────────── access email ─────────────────────────── */

export interface AccessEmailInput {
  firstName: string;
  email: string;
  retreatTitle: string;
  dates: string;
  dashboardUrl: string;
  loginUrl: string;
  forgotPasswordUrl: string;
  /** Present when the account has no password yet. */
  setPasswordUrl: string | null;
  supportEmail: string;
}

export interface AccessEmail {
  subject: string;
  text: string;
  html: string;
}

/** Thrown before sending: an unresolved placeholder or an empty field must never reach a guest. */
export function assertSendable(email: AccessEmail): void {
  const all = `${email.subject}\n${email.text}\n${email.html}`;
  if (/\{\{|\}\}/.test(all)) throw new Error("The access email still contains a placeholder.");
}

/**
 * The dashboard access email. Owner supplied no copy, so this says only what
 * item 7 asks for: the direct dashboard link, how to sign in, the set-password
 * link when she has none, and that this is access for her existing
 * reservation with no new purchase required.
 */
export function buildAccessEmail(input: AccessEmailInput): AccessEmail {
  const name = input.firstName.trim() || "there";
  const hours = Math.round(SET_PASSWORD_TTL_MINUTES / 60);
  const subject = `Your ${input.retreatTitle} retreat dashboard`;
  const text = [
    `Hi ${name},`,
    ``,
    `Your private retreat dashboard for ${input.retreatTitle}, ${input.dates}, is ready.`,
    ``,
    `This is access for your existing reservation. No new purchase is required.`,
    ``,
    `Open your dashboard: ${input.dashboardUrl}`,
    ``,
    `How to sign in:`,
    ...(input.setPasswordUrl
      ? [
          `1. Set your password here (this link works for ${hours} hours): ${input.setPasswordUrl}`,
          `2. Then sign in at ${input.loginUrl} with this email address: ${input.email}`,
          `If the link has expired, request a new one at ${input.forgotPasswordUrl}`,
        ]
      : [
          `Sign in at ${input.loginUrl} with this email address: ${input.email}`,
          `If you don't remember your password, reset it at ${input.forgotPasswordUrl}`,
        ]),
    ``,
    `Questions? Email ${input.supportEmail}.`,
  ].join("\n");

  const a = (href: string, label: string) => `<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>`;
  const html = [
    `<p>Hi ${escapeHtml(name)},</p>`,
    `<p>Your private retreat dashboard for ${escapeHtml(input.retreatTitle)}, ${escapeHtml(input.dates)}, is ready.</p>`,
    `<p>This is access for your existing reservation. No new purchase is required.</p>`,
    `<p>${a(input.dashboardUrl, "Open your dashboard")}</p>`,
    `<p><strong>How to sign in:</strong></p>`,
    input.setPasswordUrl
      ? [
          `<ol>`,
          `<li>${a(input.setPasswordUrl, "Set your password here")} (this link works for ${hours} hours).</li>`,
          `<li>Then sign in at ${a(input.loginUrl, input.loginUrl.split("?")[0])} with this email address: ${escapeHtml(input.email)}</li>`,
          `</ol>`,
          `<p>If the link has expired, ${a(input.forgotPasswordUrl, "request a new one")}.</p>`,
        ].join("\n")
      : [
          `<p>Sign in at ${a(input.loginUrl, input.loginUrl.split("?")[0])} with this email address: ${escapeHtml(input.email)}</p>`,
          `<p>If you don't remember your password, ${a(input.forgotPasswordUrl, "reset it here")}.</p>`,
        ].join("\n"),
    `<p>Questions? Email ${a(`mailto:${input.supportEmail}`, input.supportEmail)}.</p>`,
  ].join("\n");
  return { subject, text, html };
}

/** Marked sample shown in the admin preview instead of a real, live set-password link. */
export const PREVIEW_SET_PASSWORD_URL = "https://www.bossclinician.com/reset-password/SAMPLE-LINK-CREATED-WHEN-SENT";

function siteUrl(): string {
  return (env.publicSiteUrl || "https://www.bossclinician.com").replace(/\/+$/, "");
}

export function dashboardPath(retreat: RetreatRow): string {
  return `/retreats/dashboard/${retreat.slug}`;
}

async function emailInputs(retreat: RetreatRow, memberId: number, setPasswordUrl: string | null) {
  const member = await pool.query<{ email: string; first_name: string | null; name: string | null; has_password: boolean; status: string }>(
    `SELECT email::text AS email, first_name, name, (password_hash IS NOT NULL) AS has_password, status FROM members WHERE id = $1`,
    [memberId],
  );
  const row = member.rows[0];
  if (!row) return null;
  const settings = normaliseSettings(retreat.settings);
  const next = encodeURIComponent(dashboardPath(retreat));
  const firstName = (row.first_name ?? "").trim() || (row.name ?? "").trim().split(/\s+/)[0] || "";
  return {
    hasPassword: row.has_password,
    status: row.status,
    input: {
      firstName,
      email: row.email,
      retreatTitle: retreat.title,
      dates: formatDateRange(retreat.start_date, retreat.end_date),
      dashboardUrl: `${siteUrl()}${dashboardPath(retreat)}`,
      loginUrl: `${siteUrl()}/login?next=${next}`,
      forgotPasswordUrl: `${siteUrl()}/forgot-password?next=${next}`,
      setPasswordUrl,
      supportEmail: settings.supportEmail,
    } satisfies AccessEmailInput,
  };
}

/** Why the access email can't be sent yet (empty = it can). */
export async function accessEmailBlockers(retreat: RetreatRow, memberId: number): Promise<string[]> {
  const blockers: string[] = [];
  if (!retreat.published) blockers.push("Publish the retreat dashboard first, or the link will not open for her.");
  const grant = await pool.query(
    `SELECT 1 FROM access_grants WHERE member_id = $1 AND product_id = $2 AND status = 'active'
       AND (expires_at IS NULL OR expires_at > now())`,
    [memberId, retreat.product_id ?? -1],
  );
  if (grant.rows.length === 0) blockers.push("Give her dashboard access first.");
  const member = await pool.query<{ status: string; email: string }>(`SELECT status, email::text AS email FROM members WHERE id = $1`, [memberId]);
  if (!member.rows[0]?.email) blockers.push("Her account has no email address.");
  else if (member.rows[0].status !== "active") blockers.push("Her account is not active.");
  return blockers;
}

/** The email as it would go out, with a marked sample in place of a live set-password link. Mints nothing. */
export async function previewAccessEmail(retreat: RetreatRow, memberId: number) {
  const base = await emailInputs(retreat, memberId, null);
  if (!base) return null;
  const email = buildAccessEmail({ ...base.input, setPasswordUrl: base.hasPassword ? null : PREVIEW_SET_PASSWORD_URL });
  return {
    to: base.input.email,
    replyTo: base.input.supportEmail,
    includesPasswordSetup: !base.hasPassword,
    blockers: await accessEmailBlockers(retreat, memberId),
    ...email,
  };
}

/**
 * Sends the access email to one guest — only on an organizer's explicit
 * action, never automatically. A set-password link is minted only here (never
 * by the preview), because minting burns her earlier links.
 */
export async function sendAccessEmail(
  retreat: RetreatRow,
  memberId: number,
  adminId: number | null,
): Promise<{ sent: boolean; error?: string; includesPasswordSetup: boolean }> {
  const blockers = await accessEmailBlockers(retreat, memberId);
  if (blockers.length) return { sent: false, error: blockers.join(" "), includesPasswordSetup: false };
  const probe = await emailInputs(retreat, memberId, null);
  if (!probe) return { sent: false, error: "We couldn't find that account.", includesPasswordSetup: false };
  let setPasswordUrl: string | null = null;
  if (!probe.hasPassword) {
    const issued = await issueSetPasswordLink(memberId);
    if (!issued) {
      return {
        sent: false,
        error: "Too many set-password links were sent to her recently. Wait 15 minutes and try again.",
        includesPasswordSetup: true,
      };
    }
    setPasswordUrl = `${issued.url}?next=${encodeURIComponent(dashboardPath(retreat))}`;
  }
  const email = buildAccessEmail({ ...probe.input, setPasswordUrl });
  assertSendable(email);
  const outcome = await sendMail({
    to: probe.input.email,
    ...email,
    replyTo: probe.input.supportEmail,
    topic: "retreat_dashboard_access",
    memberId,
  });
  if (outcome.sent) {
    await pool.query(
      `INSERT INTO retreat_guests (retreat_id, member_id, welcome_sent_at, welcome_sent_by, welcome_send_count)
       VALUES ($1, $2, now(), $3, 1)
       ON CONFLICT (retreat_id, member_id) DO UPDATE SET welcome_sent_at = now(), welcome_sent_by = EXCLUDED.welcome_sent_by,
         welcome_send_count = retreat_guests.welcome_send_count + 1, updated_at = now()`,
      [retreat.id, memberId, adminId],
    );
  }
  return { sent: outcome.sent, error: outcome.sent ? undefined : outcome.error || "The email could not be sent.", includesPasswordSetup: setPasswordUrl !== null };
}
