import crypto from "crypto";
import path from "path";
import { Request, Router } from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import type { PoolClient } from "pg";
import { z } from "zod";
import { pool } from "../../db/pool";
import { env } from "../../config/env";
import { asyncHandler } from "../../utils/asyncHandler";
import { badRequest, notFound, unauthorized } from "../../utils/httpError";
import { denyImpersonation, type AuthedMember } from "../../middleware/memberAuth";
import { sendMail } from "../../email/mailer";
import { escapeHtml } from "../../email/templates";
import { listMemberProducts } from "../../services/access";
import {
  computeSlots,
  describeInstant,
  isSlotBookable,
  isValidTimeZone,
  type BookedSession,
  type CoachingPolicy,
  type Slot,
} from "../../services/availability";
import {
  loadAvailabilityOverrides,
  loadAvailabilityRules,
  loadBusySessions,
  loadCoachingPolicy,
} from "../../services/coachingCalendar";
import { isProtectedRef, signedFileUrl } from "../../services/signedUrls";
import type { EntitledMedia } from "./downloads";

/**
 * `/api/member/coaching` — booking, rescheduling and cancelling sessions.
 *
 * `requireMember` is applied once by routes/member/index.ts, which answers "who
 * are you". Every handler below then proves entitlement separately: a coaching
 * package is only bookable against a live access grant (via access.ts) and a
 * `coaching_credits` row with sessions left, and a session is only readable by
 * the member whose id is on it. Somebody else's session is a 404, not a 403 —
 * an appointment is a fact about a named person and confirming one exists is
 * already more than a stranger should learn.
 *
 * `private_notes` is selected by no query in this file. It is the coach's own
 * record of a therapist's supervision session; leaving it out of the SELECT is
 * the only way to be sure it never reaches a response.
 */
export const memberCoachingRouter = Router();

const MAX_INT4 = 2_147_483_647;
const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/** The furthest ahead any single request will compute, however wide it asks. */
const MAX_WINDOW_DAYS = 62;

const SESSION_NOT_FOUND = "We couldn't find that session.";
const SESSION_FILE_NOT_FOUND = "We couldn't find that file.";
const OFFER_NOT_FOUND = "We couldn't find that coaching package.";

/**
 * One coach, one calendar, one lock.
 *
 * Booking has to serialise on something, and the row that would normally be
 * locked is the one about to be inserted. An advisory lock held for the length
 * of the transaction is the thing two simultaneous bookings of the same 10am
 * both have to queue behind, so the second one re-reads the calendar *after*
 * the first has committed and finds the slot gone.
 *
 * The same class is reused for the per-member credit lock below, keyed on the
 * member id. Key 0 is the calendar, and no member has id 0, so the two never
 * collide.
 */
const CALENDAR_LOCK_CLASS = 8241;
const CALENDAR_LOCK_KEY = 0;

const TOO_MANY = { error: "Too many requests. Please try again in a few minutes." };

const byMember = (req: Request): string =>
  req.member ? `member:${req.member.id}` : ipKeyGenerator(req.ip ?? "");

/** A month of slots is a real computation; a person picking a time does it a few times. */
const slotsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: TOO_MANY,
  keyGenerator: byMember,
});

/** Booking sends mail and moves a credit, so it is capped far below reading. */
const writeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: TOO_MANY,
  keyGenerator: byMember,
});

function currentMember(req: Request): AuthedMember {
  if (!req.member) throw unauthorized("Please sign in to continue");
  return req.member;
}

function readTimezone(value: unknown, fallback: string): string {
  return typeof value === "string" && isValidTimeZone(value.trim()) ? value.trim() : fallback;
}

const slugSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/i);

const idParamSchema = z.object({ id: z.coerce.number().int().positive().max(MAX_INT4) });

/** A booking is an exact instant, so the offset has to be in the string. */
const instantSchema = z.string().datetime({ offset: true });

/** Browsing is looser: "2026-03-01" is a reasonable thing to ask a calendar for. */
const dateOrInstantSchema = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .refine((value) => !Number.isNaN(Date.parse(value)), { message: "Not a date" });

const bookSchema = z.object({
  offerSlug: slugSchema,
  startsAt: instantSchema,
  agenda: z.string().trim().max(2000).optional(),
  timezone: z.string().trim().max(64).optional(),
});

const rescheduleSchema = z.object({
  startsAt: instantSchema,
  timezone: z.string().trim().max(64).optional(),
});

const cancelSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

const windowSchema = z.object({
  from: dateOrInstantSchema.optional(),
  to: dateOrInstantSchema.optional(),
  timezone: z.string().trim().max(64).optional(),
});

/** "24 hours" / "an hour" — for policy sentences a member has to act on. */
function hoursPhrase(minutes: number): string {
  const hours = Math.round(minutes / 60);
  if (hours <= 0) return "any time";
  if (hours === 1) return "an hour";
  if (hours % 24 === 0 && hours >= 48) return `${hours / 24} days`;
  return `${hours} hours`;
}

/**
 * Overrides are loaded a day either side of what is being asked about.
 *
 * A block sitting just outside the window can still split an availability
 * window that straddles the boundary, and a split moves where slot starts fall.
 * Loading narrowly would let the list a member picked from and the re-check at
 * booking time disagree about the grid — which surfaces as "that time isn't
 * available" for a time the app itself just offered.
 */
function paddedWindow(from: Date, to: Date): { from: Date; to: Date } {
  return { from: new Date(from.getTime() - DAY_MS), to: new Date(to.getTime() + DAY_MS) };
}

/**
 * Why a requested time was refused.
 *
 * The slot check itself only answers yes or no, and "that time isn't available"
 * is the kind of message that makes somebody try the same thing three more
 * times. Somebody who left it too late needs to hear something different from
 * somebody who was beaten to a slot by ten seconds.
 */
function refusalReason(input: {
  startsAt: Date;
  durationMinutes: number;
  now: Date;
  policy: CoachingPolicy;
  existingSessions: BookedSession[];
}): string {
  const start = input.startsAt.getTime();
  if (start < input.now.getTime() + input.policy.minimumNoticeMinutes * MINUTE_MS) {
    return `Sessions need to be booked at least ${hoursPhrase(
      input.policy.minimumNoticeMinutes
    )} ahead. Please pick a later time.`;
  }

  const end = start + input.durationMinutes * MINUTE_MS;
  const taken = input.existingSessions.some(
    (session) =>
      start < session.startsAt.getTime() + session.durationMinutes * MINUTE_MS &&
      session.startsAt.getTime() < end
  );
  if (taken) {
    return "That time has just been taken. Pick another and it'll be yours in a moment.";
  }

  return "That isn't one of the times on offer. Please pick one from the list.";
}

/* ------------------------------------------------------------------- credits */

interface CreditRow {
  id: number;
  coaching_offer_id: number | null;
  product_id: number | null;
  sessions_total: number;
  sessions_used: number;
  expires_at: Date | null;
  offer_slug: string | null;
  offer_title: string | null;
  offer_format: string | null;
  duration_minutes: number | null;
  sessions_booked: number;
}

/**
 * Creates the credit rows a member's purchases entitle them to.
 *
 * Access grants are the record of what may be opened; `coaching_credits` is the
 * ledger of what is left to spend. Nothing writes the ledger at checkout yet, so
 * it is derived here — the live grant from access.ts is what makes a package
 * bookable at all, and the paid orders behind it are what say how many packages
 * were bought.
 *
 * One row per paid order, which is the whole point: somebody who works through
 * all six sessions and buys the package again has bought six more, and keying
 * the ledger on (member, product) would hand them a re-activated grant, no
 * sessions and a message telling them they have used everything. Keying on the
 * order also makes this idempotent against a redelivered webhook — the same
 * order can only ever produce the row it already produced.
 *
 * A grant with no order behind it at all — a manual grant from the admin, an
 * automation, an import — is one package, once. The advisory lock is what makes
 * "insert if absent" safe without a unique constraint to lean on: two tabs
 * opening /coaching at the same moment would otherwise both see no row and both
 * insert one.
 *
 * An admin looking through "view as member" writes nothing here: the ledger is
 * the member's, and a row created under that window is indistinguishable from
 * one the member's own visit created.
 */
async function ensureCoachingCredits(member: AuthedMember): Promise<void> {
  if (member.impersonatedBy !== undefined) return;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SELECT pg_advisory_xact_lock($1, $2)`, [CALENDAR_LOCK_CLASS, member.id]);
    await client.query(
      `WITH live AS (
         SELECT p.id AS product_id, p.coaching_offer_id,
                GREATEST(o.session_count, 0) AS sessions_total, g.expires_at
           FROM access_grants g
           JOIN products p        ON p.id = g.product_id
           JOIN coaching_offers o ON o.id = p.coaching_offer_id
          WHERE g.member_id = $1
            AND g.status = 'active'
            AND (g.expires_at IS NULL OR g.expires_at > now())
       ),
       -- Bundles are expanded one level, matching what grantOfferAccess hands
       -- out: a package bought inside a bundle is a package bought.
       delivered AS (
         SELECT ord.id AS order_id, ord.status, op.product_id
           FROM orders ord
           JOIN offer_products op ON op.offer_id = ord.offer_id
          WHERE ord.member_id = $1
          UNION
         SELECT ord.id, ord.status, bi.product_id
           FROM orders ord
           JOIN offer_products op       ON op.offer_id = ord.offer_id
           JOIN product_bundle_items bi ON bi.bundle_product_id = op.product_id
          WHERE ord.member_id = $1
       ),
       owed AS (
         SELECT l.product_id, l.coaching_offer_id, l.sessions_total, l.expires_at, d.order_id
           FROM live l
           JOIN delivered d ON d.product_id = l.product_id AND d.status = 'paid'
          UNION ALL
         -- Entitlement with nothing bought behind it has no order to key on, so
         -- it is worth one package and only ever the first one: an admin
         -- restoring access after a refund is putting somebody back where they
         -- were, not handing them six more sessions. A later purchase still adds
         -- its own row above.
         SELECT l.product_id, l.coaching_offer_id, l.sessions_total, l.expires_at, NULL::int
           FROM live l
          WHERE NOT EXISTS (
                  SELECT 1 FROM delivered d
                   WHERE d.product_id = l.product_id AND d.status = 'paid'
                )
            AND NOT EXISTS (
                  SELECT 1 FROM coaching_credits c
                   WHERE c.member_id = $1 AND c.product_id = l.product_id
                )
       )
       INSERT INTO coaching_credits
         (member_id, coaching_offer_id, product_id, order_id, sessions_total, expires_at)
       SELECT $1, w.coaching_offer_id, w.product_id, w.order_id, w.sessions_total, w.expires_at
         FROM owed w
        WHERE NOT EXISTS (
          SELECT 1 FROM coaching_credits c
           WHERE c.member_id = $1 AND c.product_id = w.product_id
             AND c.order_id IS NOT DISTINCT FROM w.order_id
        )`,
      [member.id]
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

const CREDIT_SELECT = `
  SELECT c.id, c.coaching_offer_id, c.product_id, c.sessions_total, c.sessions_used,
         c.expires_at,
         o.slug AS offer_slug, o.title AS offer_title, o.format AS offer_format,
         o.duration_minutes,
         (SELECT count(*) FROM coaching_sessions s
           WHERE s.credit_id = c.id AND s.status <> 'cancelled')::int AS sessions_booked
    FROM coaching_credits c
    LEFT JOIN coaching_offers o ON o.id = c.coaching_offer_id`;

interface PackageJson {
  creditId: number;
  offerSlug: string | null;
  offerTitle: string;
  format: string;
  durationMinutes: number;
  unlimited: boolean;
  sessionsTotal: number | null;
  sessionsUsed: number;
  sessionsRemaining: number | null;
  /** "3 of 6 sessions used" — the sentence the dashboard prints verbatim. */
  summary: string;
  expiresAt: string | null;
  canBook: boolean;
}

function toPackageJson(row: CreditRow, now: Date): PackageJson {
  // A package with no session count is open-ended, so its ledger never moves
  // and the honest number to show is how many have actually been booked.
  const unlimited = row.sessions_total <= 0;
  const used = unlimited ? row.sessions_booked : row.sessions_used;
  const remaining = unlimited ? null : Math.max(0, row.sessions_total - row.sessions_used);
  const expired = row.expires_at !== null && row.expires_at.getTime() <= now.getTime();

  const summary = unlimited
    ? `${used} ${used === 1 ? "session" : "sessions"} booked`
    : `${used} of ${row.sessions_total} sessions used`;

  return {
    creditId: row.id,
    offerSlug: row.offer_slug,
    offerTitle: row.offer_title ?? "Coaching",
    format: row.offer_format ?? "individual",
    durationMinutes: row.duration_minutes ?? 60,
    unlimited,
    sessionsTotal: unlimited ? null : row.sessions_total,
    sessionsUsed: used,
    sessionsRemaining: remaining,
    summary,
    expiresAt: row.expires_at?.toISOString() ?? null,
    canBook: !expired && row.offer_slug !== null && (unlimited || (remaining ?? 0) > 0),
  };
}

/* ------------------------------------------------------------------ sessions */

/** Every column a member may see. `private_notes` is absent by design. */
const SESSION_SELECT = `
  SELECT s.id, s.offer_id, s.credit_id, s.scheduled_at, s.duration_minutes, s.status,
         s.meeting_url, s.agenda, s.shared_notes, s.recording_url, s.timezone,
         s.cancelled_at, s.cancel_reason, s.booked_at, s.created_at,
         s.updated_at,
         o.slug AS offer_slug, o.title AS offer_title
    FROM coaching_sessions s
    LEFT JOIN coaching_offers o ON o.id = s.offer_id`;

interface SessionRow {
  id: number;
  offer_id: number | null;
  credit_id: number | null;
  scheduled_at: Date | null;
  duration_minutes: number;
  status: string;
  meeting_url: string;
  agenda: string;
  shared_notes: string;
  recording_url: string;
  timezone: string;
  cancelled_at: Date | null;
  cancel_reason: string;
  booked_at: Date | null;
  created_at: Date;
  updated_at: Date;
  offer_slug: string | null;
  offer_title: string | null;
}

interface SessionFileJson {
  id: number;
  title: string;
  url: string;
}

interface SessionJson {
  id: number;
  offerSlug: string | null;
  offerTitle: string;
  status: string;
  startsAt: string | null;
  endsAt: string | null;
  durationMinutes: number;
  timezone: string;
  day: string;
  dayLabel: string;
  timeLabel: string;
  label: string;
  agenda: string;
  sharedNotes: string;
  recordingUrl: string;
  meetingUrl: string;
  /** The last moment this can be moved or cancelled without losing the credit. */
  changeDeadline: string | null;
  canReschedule: boolean;
  canCancel: boolean;
  /** False once inside the policy window: cancelling then still spends a session. */
  cancelRefundsCredit: boolean;
  cancelReason: string;
  icsUrl: string;
  files: SessionFileJson[];
}

function sessionTimezone(row: SessionRow, fallback: string): string {
  return isValidTimeZone(row.timezone) ? row.timezone : fallback;
}

function toSessionJson(
  row: SessionRow,
  policy: CoachingPolicy,
  now: Date,
  options: { timezone?: string; files?: SessionFileJson[] } = {}
): SessionJson {
  const zone = options.timezone ?? sessionTimezone(row, policy.timezone);
  const startsAt = row.scheduled_at;
  const endsAt = startsAt
    ? new Date(startsAt.getTime() + row.duration_minutes * MINUTE_MS)
    : null;

  const labels = startsAt
    ? describeInstant(startsAt, zone)
    : { day: "", dayLabel: "", timeLabel: "", label: "Not yet scheduled" };

  const deadline = startsAt
    ? new Date(startsAt.getTime() - policy.cancellationWindowMinutes * MINUTE_MS)
    : null;
  const outsideWindow = deadline !== null && now.getTime() < deadline.getTime();
  const changeable = row.status === "scheduled" && startsAt !== null && startsAt.getTime() > now.getTime();

  return {
    id: row.id,
    offerSlug: row.offer_slug,
    offerTitle: row.offer_title ?? "Coaching session",
    status: row.status,
    startsAt: startsAt?.toISOString() ?? null,
    endsAt: endsAt?.toISOString() ?? null,
    durationMinutes: row.duration_minutes,
    timezone: zone,
    ...labels,
    agenda: row.agenda,
    sharedNotes: row.shared_notes,
    recordingUrl: row.recording_url,
    // A cancelled session's room is not a room any more, and a stale link in a
    // member's history is a way to walk into somebody else's appointment.
    meetingUrl: row.status === "cancelled" ? "" : row.meeting_url,
    changeDeadline: deadline?.toISOString() ?? null,
    canReschedule: changeable && outsideWindow,
    canCancel: changeable,
    cancelRefundsCredit: changeable && outsideWindow,
    cancelReason: row.cancel_reason,
    icsUrl: `/api/member/coaching/sessions/${row.id}/ics`,
    files: options.files ?? [],
  };
}

/**
 * The handouts and recordings attached to one session.
 *
 * A file the coach uploaded for a supervision session is as private as the
 * session itself, so it lives in the protected directory and is handed over as a
 * link bound to this member rather than as a path anyone could open. A `url`
 * pointing somewhere else — a Zoom recording, a Google Doc — is passed through
 * as it stands, because it is not ours to sign.
 */
async function loadSessionFiles(memberId: number, sessionId: number): Promise<SessionFileJson[]> {
  const res = await pool.query<{ id: number; title: string; url: string }>(
    `SELECT id, title, url FROM coaching_session_files WHERE session_id = $1 ORDER BY id`,
    [sessionId]
  );
  return res.rows.map((row) => ({
    id: row.id,
    title: row.title,
    url: isProtectedRef(row.url)
      ? signedFileUrl({ kind: "coaching-file", fileId: row.id, memberId }).url
      : row.url,
  }));
}

/**
 * The file behind a signed coaching link, if it is still this member's to open.
 *
 * Two questions, and the second is the one that costs a query. Whose session is
 * it — answered in the WHERE clause, so somebody else's handout is not read at
 * all. And are they still entitled to the package it belongs to — answered by
 * access.ts, on every redemption, because that is what services/signedUrls.ts
 * promises about a link of any kind and a session row alone cannot keep the
 * promise: it survives the refund that took the grant away, so keying on it
 * would let a refunded customer go on minting working links for as long as the
 * row exists.
 *
 * A session booked against no offer — a call the admin arranged by hand, an
 * import — has no package to check, and the member it was booked for is the
 * whole of the answer there.
 */
export async function loadOwnedSessionFile(
  memberId: number,
  fileId: number
): Promise<EntitledMedia> {
  const res = await pool.query<{ title: string; url: string; offer_id: number | null }>(
    `SELECT f.title, f.url, s.offer_id
       FROM coaching_session_files f
       JOIN coaching_sessions s ON s.id = f.session_id
      WHERE f.id = $1 AND s.member_id = $2`,
    [fileId, memberId]
  );
  const row = res.rows[0];
  if (!row || !isProtectedRef(row.url)) throw notFound(SESSION_FILE_NOT_FOUND);
  if (row.offer_id !== null && !(await ownsOffer(memberId, row.offer_id))) {
    throw notFound(SESSION_FILE_NOT_FOUND);
  }

  return { storagePath: row.url, filename: sessionFileName(row.title, row.url), mime: "" };
}

/**
 * The name the file lands under on the member's own disk.
 *
 * The coach's title is the name that means something a year later ("Session 3
 * homework"), but it is typed free-hand and rarely carries an extension, and a
 * PDF saved without one opens in nothing. The stored key supplies that.
 */
function sessionFileName(title: string, reference: string): string {
  const extension = path.extname(reference);
  const base = title.trim();
  if (base === "") return path.basename(reference);
  return base.toLowerCase().endsWith(extension.toLowerCase()) ? base : `${base}${extension}`;
}

/** Ownership is in the WHERE clause, so another member's session simply is not found. */
async function loadOwnedSession(
  memberId: number,
  sessionId: number,
  client?: PoolClient,
  forUpdate = false
): Promise<SessionRow | null> {
  const db = client ?? pool;
  const res = await db.query<SessionRow>(
    `${SESSION_SELECT} WHERE s.id = $1 AND s.member_id = $2${forUpdate ? " FOR UPDATE OF s" : ""}`,
    [sessionId, memberId]
  );
  return res.rows[0] ?? null;
}

/* -------------------------------------------------------------------- offers */

interface OfferRow {
  id: number;
  slug: string;
  title: string;
  description: string;
  format: string;
  duration_minutes: number;
  session_count: number;
}

async function loadOffer(slug: string, client?: PoolClient): Promise<OfferRow | null> {
  const db = client ?? pool;
  const res = await db.query<OfferRow>(
    `SELECT id, slug, title, description, format, duration_minutes, session_count
       FROM coaching_offers
      WHERE slug = $1 AND published = true`,
    [slug]
  );
  return res.rows[0] ?? null;
}

/**
 * Whether this member holds a live grant for a product that sells this offer.
 *
 * Routed through access.ts rather than through `orders` or `coaching_credits`:
 * a credit row is a consequence of entitlement, never evidence of it.
 */
async function ownsOffer(memberId: number, offerId: number): Promise<boolean> {
  const owned = await listMemberProducts(memberId);
  return owned.some((product) => product.coachingOfferId === offerId);
}

/* ---------------------------------------------------------------------- ics */

/** RFC 5545 wants a backslash before these, and literal newlines folded away. */
function icsEscape(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** Content lines are limited to 75 octets; continuations begin with a space. */
function foldLine(line: string): string {
  if (line.length <= 74) return line;
  const parts: string[] = [line.slice(0, 74)];
  for (let i = 74; i < line.length; i += 73) parts.push(` ${line.slice(i, i + 73)}`);
  return parts.join("\r\n");
}

function icsStamp(date: Date): string {
  return `${date.toISOString().replace(/[-:]/g, "").split(".")[0]}Z`;
}

export interface CalendarEventInput {
  session: SessionRow;
  memberEmail: string;
  organiserEmail: string;
}

/**
 * The session as a calendar file.
 *
 * `UID` is derived from the session id and stays the same for the life of the
 * booking, and `SEQUENCE` counts up from the row's own timestamps. Together
 * they are what makes a reschedule *move* the existing entry in Apple Calendar
 * or Outlook rather than adding a second one beside it, and what makes a
 * cancellation remove it.
 */
export function buildSessionIcs(input: CalendarEventInput): string {
  const { session } = input;
  const start = session.scheduled_at ?? session.created_at;
  const end = new Date(start.getTime() + session.duration_minutes * MINUTE_MS);
  const host = env.publicSiteUrl.replace(/^https?:\/\//, "") || "bossclinician";
  const cancelled = session.status === "cancelled";

  const sequence = Math.max(
    0,
    Math.floor((session.updated_at.getTime() - session.created_at.getTime()) / 1000)
  );

  const description = [
    session.agenda ? `What we're covering: ${session.agenda}` : "",
    session.meeting_url && !cancelled ? `Join here: ${session.meeting_url}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Boss Clinician//Coaching//EN",
    "CALSCALE:GREGORIAN",
    cancelled ? "METHOD:CANCEL" : "METHOD:REQUEST",
    "BEGIN:VEVENT",
    `UID:coaching-session-${session.id}@${host}`,
    `DTSTAMP:${icsStamp(new Date())}`,
    `DTSTART:${icsStamp(start)}`,
    `DTEND:${icsStamp(end)}`,
    `SEQUENCE:${sequence}`,
    `STATUS:${cancelled ? "CANCELLED" : "CONFIRMED"}`,
    `SUMMARY:${icsEscape(session.offer_title ?? "Coaching session")}`,
    description ? `DESCRIPTION:${icsEscape(description)}` : "",
    session.meeting_url && !cancelled ? `LOCATION:${icsEscape(session.meeting_url)}` : "",
    session.meeting_url && !cancelled ? `URL:${icsEscape(session.meeting_url)}` : "",
    `ORGANIZER:mailto:${input.organiserEmail}`,
    `ATTENDEE;CN=${icsEscape(input.memberEmail)};RSVP=FALSE:mailto:${input.memberEmail}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean);

  return `${lines.map(foldLine).join("\r\n")}\r\n`;
}

function icsFilename(session: SessionRow): string {
  return `coaching-session-${session.id}.ics`;
}

/* -------------------------------------------------------------------- email */

function organiserEmail(): string {
  const match = /<([^>]+)>/.exec(env.smtp.from);
  return (match ? match[1] : env.smtp.from).trim() || "no-reply@bossclinician.com";
}

interface BookingMailInput {
  to: string;
  session: SessionRow;
  timezone: string;
  heading: string;
  intro: string;
  closing: string;
}

/**
 * The one email every booking change sends.
 *
 * Confirmation, reschedule and cancellation differ only in their wording, and
 * all three must carry the calendar file — the reschedule notice most of all,
 * since without it the member keeps the old time in their diary and turns up an
 * hour early to a room nobody is in.
 */
async function sendBookingMail(input: BookingMailInput): Promise<void> {
  const { session } = input;
  const when = session.scheduled_at
    ? describeInstant(session.scheduled_at, input.timezone).label
    : "a time to be confirmed";
  const sessionUrl = `${env.publicSiteUrl}/coaching/sessions/${session.id}`;

  const detailLines = [
    `${session.offer_title ?? "Coaching session"} — ${when}`,
    `${session.duration_minutes} minutes`,
    session.status === "cancelled" ? "" : session.meeting_url ? `Join: ${session.meeting_url}` : "",
  ].filter(Boolean);

  const text = [input.intro, "", ...detailLines, "", input.closing, sessionUrl].join("\n");

  const html = [
    `<p>${escapeHtml(input.intro)}</p>`,
    `<p><strong>${escapeHtml(session.offer_title ?? "Coaching session")}</strong><br>`,
    `${escapeHtml(when)}<br>${session.duration_minutes} minutes</p>`,
    session.status !== "cancelled" && session.meeting_url
      ? `<p><a href="${escapeHtml(session.meeting_url)}">Join the session</a></p>`
      : "",
    `<p>${escapeHtml(input.closing)} <a href="${escapeHtml(sessionUrl)}">View your booking</a>.</p>`,
  ]
    .filter(Boolean)
    .join("");

  await sendMail({
    to: input.to,
    subject: input.heading,
    text,
    html,
    attachments: [
      {
        filename: icsFilename(session),
        content: buildSessionIcs({
          session,
          memberEmail: input.to,
          organiserEmail: organiserEmail(),
        }),
        contentType: "text/calendar; charset=utf-8",
      },
    ],
  });
}

/* ------------------------------------------------------------- meeting rooms */

/**
 * A fresh room for every booking.
 *
 * The room id is the credential — anybody holding the link can walk in — so it
 * is 72 bits of randomness rather than the session id, and it is minted per
 * session so a cancelled member's old link opens nothing.
 */
function mintMeetingUrl(policy: CoachingPolicy): string {
  const base = policy.meetingUrlBase || `${env.publicSiteUrl}/coaching/room`;
  return `${base}/${crypto.randomBytes(9).toString("base64url")}`;
}

/* ------------------------------------------------------------------- windows */

interface ResolvedWindow {
  from: Date;
  to: Date;
}

/** Clamps a requested range to something that is worth computing. */
function resolveWindow(
  raw: { from?: string; to?: string },
  policy: CoachingPolicy,
  now: Date
): ResolvedWindow {
  const requestedFrom = raw.from ? new Date(raw.from) : now;
  const from = new Date(Math.max(requestedFrom.getTime(), now.getTime()));

  const horizon = new Date(now.getTime() + policy.bookingHorizonDays * DAY_MS);
  const requestedTo = raw.to ? new Date(raw.to) : new Date(from.getTime() + 14 * DAY_MS);
  const capped = Math.min(
    requestedTo.getTime(),
    horizon.getTime(),
    from.getTime() + MAX_WINDOW_DAYS * DAY_MS
  );

  return { from, to: new Date(Math.max(capped, from.getTime())) };
}

function slotJson(slot: Slot) {
  return {
    startsAt: slot.startsAt.toISOString(),
    endsAt: slot.endsAt.toISOString(),
    day: slot.day,
    dayLabel: slot.dayLabel,
    timeLabel: slot.timeLabel,
    label: slot.label,
  };
}

/* ---------------------------------------------------------------- GET / */

/**
 * GET /api/member/coaching
 *
 * The dashboard: what the member has left, what is coming up, what has been.
 */
memberCoachingRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const member = currentMember(req);
    const now = new Date();

    await ensureCoachingCredits(member);

    const policy = await loadCoachingPolicy();
    const zone = readTimezone(req.query.timezone, policy.timezone);

    const [credits, sessions] = await Promise.all([
      pool.query<CreditRow>(`${CREDIT_SELECT} WHERE c.member_id = $1 ORDER BY c.id`, [member.id]),
      pool.query<SessionRow>(`${SESSION_SELECT} WHERE s.member_id = $1 ORDER BY s.scheduled_at`, [
        member.id,
      ]),
    ]);

    const upcoming: SessionJson[] = [];
    const past: SessionJson[] = [];
    for (const row of sessions.rows) {
      const json = toSessionJson(row, policy, now, { timezone: zone });
      const isAhead =
        row.status === "scheduled" &&
        row.scheduled_at !== null &&
        row.scheduled_at.getTime() > now.getTime();
      if (isAhead) upcoming.push(json);
      else past.push(json);
    }
    past.reverse();

    res.json({
      timezone: zone,
      packages: credits.rows.map((row) => toPackageJson(row, now)),
      upcoming,
      past,
      policy: {
        minimumNoticeHours: policy.minimumNoticeMinutes / 60,
        cancellationWindowHours: policy.cancellationWindowMinutes / 60,
        bookingHorizonDays: policy.bookingHorizonDays,
      },
    });
  })
);

/* ------------------------------------------------- GET /offers/:slug/slots */

/**
 * GET /api/member/coaching/offers/:slug/slots
 *
 * Slots are UTC instants plus a label already rendered in the member's zone, so
 * no browser has to redo the timezone arithmetic and get a different answer
 * from the one the booking endpoint will apply.
 */
memberCoachingRouter.get(
  "/offers/:slug/slots",
  slotsLimiter,
  asyncHandler(async (req, res) => {
    const member = currentMember(req);

    const slug = slugSchema.safeParse(req.params.slug);
    if (!slug.success) throw notFound(OFFER_NOT_FOUND);

    const query = windowSchema.safeParse(req.query);
    if (!query.success) throw badRequest("Invalid date range", query.error.flatten());

    const offer = await loadOffer(slug.data);
    if (!offer) throw notFound(OFFER_NOT_FOUND);
    if (!(await ownsOffer(member.id, offer.id))) throw notFound(OFFER_NOT_FOUND);

    const policy = await loadCoachingPolicy();
    const zone = readTimezone(query.data.timezone, policy.timezone);
    const now = new Date();
    const window = resolveWindow(query.data, policy, now);

    const padded = paddedWindow(window.from, window.to);
    const [rules, overrides, existingSessions] = await Promise.all([
      loadAvailabilityRules(),
      loadAvailabilityOverrides(padded.from, padded.to),
      loadBusySessions(window.from, window.to),
    ]);

    const slots = computeSlots({
      rules,
      overrides,
      existingSessions,
      durationMinutes: offer.duration_minutes,
      slotIntervalMinutes: policy.slotIntervalMinutes,
      from: window.from,
      to: window.to,
      memberTimezone: zone,
      now,
      minimumNoticeMinutes: policy.minimumNoticeMinutes,
    });

    res.json({
      offer: {
        slug: offer.slug,
        title: offer.title,
        format: offer.format,
        durationMinutes: offer.duration_minutes,
      },
      timezone: zone,
      from: window.from.toISOString(),
      to: window.to.toISOString(),
      minimumNoticeHours: policy.minimumNoticeMinutes / 60,
      slots: slots.map(slotJson),
    });
  })
);

/* --------------------------------------------------------------- POST /book */

interface BookableCredit {
  id: number;
  sessions_total: number;
  sessions_used: number;
  expires_at: Date | null;
}

/**
 * POST /api/member/coaching/book
 *
 * The whole booking is one transaction behind one advisory lock. The slot the
 * member saw was free when the page rendered; between then and now somebody
 * else may have taken it, and the only way to know is to look again after
 * everyone else's insert has either committed or rolled back.
 */
memberCoachingRouter.post(
  "/book",
  denyImpersonation,
  writeLimiter,
  asyncHandler(async (req, res) => {
    const member = currentMember(req);

    const parsed = bookSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("We couldn't book that", parsed.error.flatten());

    const startsAt = new Date(parsed.data.startsAt);
    if (Number.isNaN(startsAt.getTime())) throw badRequest("That start time isn't valid.");

    const offer = await loadOffer(parsed.data.offerSlug);
    if (!offer) throw notFound(OFFER_NOT_FOUND);
    if (!(await ownsOffer(member.id, offer.id))) throw notFound(OFFER_NOT_FOUND);

    // Someone who lands straight on a booking link has never loaded the
    // dashboard, so their ledger row may not exist yet.
    await ensureCoachingCredits(member);

    const policy = await loadCoachingPolicy();
    const zone = readTimezone(parsed.data.timezone, policy.timezone);
    const now = new Date();

    const client = await pool.connect();
    let booked: SessionRow;
    try {
      await client.query("BEGIN");
      await client.query(`SELECT pg_advisory_xact_lock($1, $2)`, [
        CALENDAR_LOCK_CLASS,
        CALENDAR_LOCK_KEY,
      ]);

      // Every credit for this offer is locked and then filtered here rather than
      // in the WHERE clause, so "you have none left" and "yours ran out of time"
      // can be told apart — they are different problems with different answers.
      // Soonest to expire is spent first, which is the order that wastes least.
      const credit = await client.query<BookableCredit>(
        `SELECT c.id, c.sessions_total, c.sessions_used, c.expires_at
           FROM coaching_credits c
          WHERE c.member_id = $1 AND c.coaching_offer_id = $2
          ORDER BY (c.expires_at IS NULL), c.expires_at, c.id
          FOR UPDATE OF c`,
        [member.id, offer.id]
      );

      const live = credit.rows.filter(
        (row) => row.expires_at === null || row.expires_at.getTime() > now.getTime()
      );
      const held = live.find((row) => row.sessions_total <= 0 || row.sessions_used < row.sessions_total);

      if (!held) {
        await client.query("ROLLBACK");
        throw badRequest(
          credit.rows.length > 0 && live.length === 0
            ? "Your coaching package has expired. Get in touch and we'll sort it out."
            : "You've used every session in this package. Get in touch if you'd like to add more."
        );
      }

      const windowEnd = new Date(startsAt.getTime() + offer.duration_minutes * MINUTE_MS);
      const padded = paddedWindow(startsAt, windowEnd);
      // Sequential, not Promise.all: one client is one connection, and pg
      // serialises overlapping queries on it anyway.
      const rules = await loadAvailabilityRules(client);
      const overrides = await loadAvailabilityOverrides(padded.from, padded.to, client);
      const existingSessions = await loadBusySessions(startsAt, windowEnd, { db: client });

      const stillFree = isSlotBookable(
        {
          rules,
          overrides,
          existingSessions,
          durationMinutes: offer.duration_minutes,
          slotIntervalMinutes: policy.slotIntervalMinutes,
          memberTimezone: zone,
          now,
          minimumNoticeMinutes: policy.minimumNoticeMinutes,
        },
        startsAt
      );

      if (!stillFree) {
        await client.query("ROLLBACK");
        throw badRequest(
          refusalReason({
            startsAt,
            durationMinutes: offer.duration_minutes,
            now,
            policy,
            existingSessions,
          })
        );
      }

      const inserted = await client.query<{ id: number }>(
        `INSERT INTO coaching_sessions
           (offer_id, member_id, credit_id, scheduled_at, duration_minutes, status,
            meeting_url, agenda, timezone, booked_at)
         VALUES ($1, $2, $3, $4, $5, 'scheduled', $6, $7, $8, now())
         RETURNING id`,
        [
          offer.id,
          member.id,
          held.id,
          startsAt,
          offer.duration_minutes,
          mintMeetingUrl(policy),
          parsed.data.agenda ?? "",
          zone,
        ]
      );

      // Open-ended packages have nothing to decrement; the CHECK constraint on
      // the table would reject the attempt anyway.
      if (held.sessions_total > 0) {
        await client.query(
          `UPDATE coaching_credits
              SET sessions_used = sessions_used + 1, updated_at = now()
            WHERE id = $1`,
          [held.id]
        );
      }

      const stored = await client.query<SessionRow>(`${SESSION_SELECT} WHERE s.id = $1`, [
        inserted.rows[0].id,
      ]);
      booked = stored.rows[0];

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }

    // Outside the transaction: a mailer timeout must not undo a booking the
    // member has already been told about on screen.
    await sendBookingMail({
      to: member.email,
      session: booked,
      timezone: zone,
      heading: `You're booked: ${booked.offer_title ?? "coaching session"}`,
      intro: "Your coaching session is confirmed. The calendar invitation is attached.",
      closing: "Need to move it?",
    });

    const credits = await pool.query<CreditRow>(`${CREDIT_SELECT} WHERE c.member_id = $1`, [
      member.id,
    ]);

    res.status(201).json({
      session: toSessionJson(booked, policy, new Date(), { timezone: zone }),
      packages: credits.rows.map((row) => toPackageJson(row, new Date())),
      message: "Your session is booked. We've emailed you a calendar invitation.",
    });
  })
);

/* ------------------------------------------------------- GET /sessions/:id */

memberCoachingRouter.get(
  "/sessions/:id",
  asyncHandler(async (req, res) => {
    const member = currentMember(req);

    const parsed = idParamSchema.safeParse(req.params);
    if (!parsed.success) throw notFound(SESSION_NOT_FOUND);

    const row = await loadOwnedSession(member.id, parsed.data.id);
    if (!row) throw notFound(SESSION_NOT_FOUND);

    const policy = await loadCoachingPolicy();
    const zone = readTimezone(req.query.timezone, sessionTimezone(row, policy.timezone));
    const files = await loadSessionFiles(member.id, row.id);

    res.json({ session: toSessionJson(row, policy, new Date(), { timezone: zone, files }) });
  })
);

/* -------------------------------------------- POST /sessions/:id/reschedule */

/**
 * POST /api/member/coaching/sessions/:id/reschedule
 *
 * The session keeps its id, its credit and its room; only the time moves. The
 * policy window is measured against the time it currently holds, because that
 * is the appointment the coach has already set aside.
 */
memberCoachingRouter.post(
  "/sessions/:id/reschedule",
  denyImpersonation,
  writeLimiter,
  asyncHandler(async (req, res) => {
    const member = currentMember(req);

    const params = idParamSchema.safeParse(req.params);
    if (!params.success) throw notFound(SESSION_NOT_FOUND);

    const parsed = rescheduleSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("We couldn't move that", parsed.error.flatten());

    const startsAt = new Date(parsed.data.startsAt);
    if (Number.isNaN(startsAt.getTime())) throw badRequest("That start time isn't valid.");

    const policy = await loadCoachingPolicy();
    const now = new Date();

    const client = await pool.connect();
    let moved: SessionRow;
    let zone: string;
    try {
      await client.query("BEGIN");
      await client.query(`SELECT pg_advisory_xact_lock($1, $2)`, [
        CALENDAR_LOCK_CLASS,
        CALENDAR_LOCK_KEY,
      ]);

      const current = await loadOwnedSession(member.id, params.data.id, client, true);
      if (!current) {
        await client.query("ROLLBACK");
        throw notFound(SESSION_NOT_FOUND);
      }

      zone = readTimezone(parsed.data.timezone, sessionTimezone(current, policy.timezone));

      if (current.status !== "scheduled" || current.scheduled_at === null) {
        await client.query("ROLLBACK");
        throw badRequest("That session can't be moved.");
      }
      if (current.scheduled_at.getTime() <= now.getTime()) {
        await client.query("ROLLBACK");
        throw badRequest("That session has already happened.");
      }

      const deadline = new Date(
        current.scheduled_at.getTime() - policy.cancellationWindowMinutes * MINUTE_MS
      );
      if (now.getTime() >= deadline.getTime()) {
        await client.query("ROLLBACK");
        throw badRequest(
          `Sessions can be moved up to ${hoursPhrase(policy.cancellationWindowMinutes)} beforehand. ` +
            "Yours is sooner than that, so please email us and we'll sort it out."
        );
      }

      const windowEnd = new Date(startsAt.getTime() + current.duration_minutes * MINUTE_MS);
      const padded = paddedWindow(startsAt, windowEnd);
      const rules = await loadAvailabilityRules(client);
      const overrides = await loadAvailabilityOverrides(padded.from, padded.to, client);
      // The session being moved must not count as an obstacle to its own new time.
      const existingSessions = await loadBusySessions(startsAt, windowEnd, {
        excludeSessionId: current.id,
        db: client,
      });

      const free = isSlotBookable(
        {
          rules,
          overrides,
          existingSessions,
          durationMinutes: current.duration_minutes,
          slotIntervalMinutes: policy.slotIntervalMinutes,
          memberTimezone: zone,
          now,
          minimumNoticeMinutes: policy.minimumNoticeMinutes,
        },
        startsAt
      );

      if (!free) {
        await client.query("ROLLBACK");
        throw badRequest(
          refusalReason({
            startsAt,
            durationMinutes: current.duration_minutes,
            now,
            policy,
            existingSessions,
          })
        );
      }

      await client.query(
        `UPDATE coaching_sessions
            SET scheduled_at = $2, timezone = $3, updated_at = now()
          WHERE id = $1`,
        [current.id, startsAt, zone]
      );

      const stored = await client.query<SessionRow>(`${SESSION_SELECT} WHERE s.id = $1`, [
        current.id,
      ]);
      moved = stored.rows[0];

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }

    await sendBookingMail({
      to: member.email,
      session: moved,
      timezone: zone,
      heading: `Moved: ${moved.offer_title ?? "your coaching session"}`,
      intro: "Your coaching session has been moved. The updated invitation is attached.",
      closing: "Need to change it again?",
    });

    res.json({
      session: toSessionJson(moved, policy, new Date(), { timezone: zone }),
      message: "Your session has been moved. We've emailed you an updated invitation.",
    });
  })
);

/* ------------------------------------------------ POST /sessions/:id/cancel */

/**
 * POST /api/member/coaching/sessions/:id/cancel
 *
 * Whether the credit comes back is the entire question a member has when they
 * click this, so the answer is in the response rather than left to be
 * discovered on the dashboard afterwards.
 */
memberCoachingRouter.post(
  "/sessions/:id/cancel",
  denyImpersonation,
  writeLimiter,
  asyncHandler(async (req, res) => {
    const member = currentMember(req);

    const params = idParamSchema.safeParse(req.params);
    if (!params.success) throw notFound(SESSION_NOT_FOUND);

    const parsed = cancelSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw badRequest("We couldn't cancel that", parsed.error.flatten());

    const policy = await loadCoachingPolicy();
    const now = new Date();

    const client = await pool.connect();
    let cancelled: SessionRow;
    let creditRestored = false;
    let openEnded = false;
    try {
      await client.query("BEGIN");

      const current = await loadOwnedSession(member.id, params.data.id, client, true);
      if (!current) {
        await client.query("ROLLBACK");
        throw notFound(SESSION_NOT_FOUND);
      }
      if (current.status === "cancelled") {
        await client.query("ROLLBACK");
        throw badRequest("That session is already cancelled.");
      }
      if (current.status !== "scheduled" || current.scheduled_at === null) {
        await client.query("ROLLBACK");
        throw badRequest("That session can't be cancelled.");
      }
      if (current.scheduled_at.getTime() <= now.getTime()) {
        await client.query("ROLLBACK");
        throw badRequest("That session has already happened.");
      }

      const deadline = new Date(
        current.scheduled_at.getTime() - policy.cancellationWindowMinutes * MINUTE_MS
      );
      const outsideWindow = now.getTime() < deadline.getTime();

      if (outsideWindow && current.credit_id !== null) {
        const restored = await client.query<{ id: number }>(
          `UPDATE coaching_credits
              SET sessions_used = sessions_used - 1, updated_at = now()
            WHERE id = $1 AND sessions_used > 0
            RETURNING id`,
          [current.credit_id]
        );
        creditRestored = (restored.rowCount ?? 0) > 0;

        // An open-ended package never spent a session, so there is nothing to
        // give back and saying "we've returned your credit" would be a lie.
        if (!creditRestored) {
          const held = await client.query<{ sessions_total: number }>(
            `SELECT sessions_total FROM coaching_credits WHERE id = $1`,
            [current.credit_id]
          );
          openEnded = (held.rows[0]?.sessions_total ?? 0) <= 0;
        }
      }

      await client.query(
        `UPDATE coaching_sessions
            SET status = 'cancelled', cancelled_at = now(), cancel_reason = $2, updated_at = now()
          WHERE id = $1`,
        [current.id, parsed.data.reason ?? ""]
      );

      const stored = await client.query<SessionRow>(`${SESSION_SELECT} WHERE s.id = $1`, [
        current.id,
      ]);
      cancelled = stored.rows[0];

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }

    const zone = sessionTimezone(cancelled, policy.timezone);

    const message = creditRestored
      ? "Your session is cancelled and the credit is back in your package."
      : openEnded
        ? "Your session is cancelled."
        : `Your session is cancelled. It was within ${hoursPhrase(
            policy.cancellationWindowMinutes
          )} of the start time, so it counts as used.`;

    await sendBookingMail({
      to: member.email,
      session: cancelled,
      timezone: zone,
      heading: `Cancelled: ${cancelled.offer_title ?? "your coaching session"}`,
      intro: message,
      closing: "Ready to rebook?",
    });

    const credits = await pool.query<CreditRow>(`${CREDIT_SELECT} WHERE c.member_id = $1`, [
      member.id,
    ]);

    res.json({
      session: toSessionJson(cancelled, policy, new Date(), { timezone: zone }),
      packages: credits.rows.map((row) => toPackageJson(row, new Date())),
      creditRestored,
      message,
    });
  })
);

/* --------------------------------------------------- GET /sessions/:id/ics */

memberCoachingRouter.get(
  "/sessions/:id/ics",
  asyncHandler(async (req, res) => {
    const member = currentMember(req);

    const parsed = idParamSchema.safeParse(req.params);
    if (!parsed.success) throw notFound(SESSION_NOT_FOUND);

    const row = await loadOwnedSession(member.id, parsed.data.id);
    if (!row) throw notFound(SESSION_NOT_FOUND);

    const body = buildSessionIcs({
      session: row,
      memberEmail: member.email,
      organiserEmail: organiserEmail(),
    });

    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${icsFilename(row)}"`);
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.send(body);
  })
);
