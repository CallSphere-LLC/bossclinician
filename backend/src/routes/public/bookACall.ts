import crypto from "crypto";
import { Router } from "express";
import type { PoolClient } from "pg";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { z } from "zod";
import { env } from "../../config/env";
import { pool } from "../../db/pool";
import { sendMail } from "../../email/mailer";
import { escapeHtml } from "../../email/templates";
import { leadsLimiter } from "../../middleware/rateLimit";
import {
  computeSlots,
  describeInstant,
  isSlotBookable,
  isValidTimeZone,
  type AvailabilityRule,
  type BookedSession,
  type Slot,
} from "../../services/availability";
import { loadAvailabilityOverrides, loadBusySessions } from "../../services/coachingCalendar";
import { linkContact, recordActivity, upsertContactWithStatus } from "../../services/contacts";
import { publishDomainEvent } from "../../services/domainEvents";
import { notificationRecipients } from "../../services/notificationRecipients";
import { asyncHandler } from "../../utils/asyncHandler";
import { badRequest, notFound } from "../../utils/httpError";

/**
 * `/api/book-a-call` — Yvette's public calls, booked on this site.
 *
 * Replaces the TidyCal pages every "Book A Call" used to send visitors to. A
 * visitor needs no account: they pick a time, give a name, an email and the
 * intake answers, and the call is theirs.
 *
 * A booking is a `coaching_sessions` row with `call_type_id` set and no member.
 * That is the point of the design rather than a shortcut: there is one coach and
 * one calendar, so the busy list both booking paths read (`loadBusySessions`)
 * has to contain both, and both take the same advisory lock below — a discovery
 * call and a member's coaching session can never be sold the same hour.
 *
 * Each call type keeps its own weekly hours (`book_a_call_windows`), the way
 * TidyCal kept them per booking type. The coach-wide blocked exceptions from
 * Admin -> Availability (holidays, a week off) still apply to every type; the
 * coach-wide *extra* openings do not, since a Saturday opened for a paying
 * client is not a Saturday offered to the public.
 */
export const bookACallRouter = Router();

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const MAX_WINDOW_DAYS = 62;
const MIN_FILL_MS = 2000;

/** Same class and key as routes/member/coaching.ts: one calendar, one lock. */
const CALENDAR_LOCK_CLASS = 8241;
const CALENDAR_LOCK_KEY = 0;

type Queryable = Pick<PoolClient, "query"> | typeof pool;

const CALL_NOT_FOUND = "We couldn't find that call.";
const BOOKING_NOT_FOUND = "We couldn't find that booking. The link may be incomplete.";

const slotsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 180,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please try again in a few minutes." },
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? ""),
});

/* ------------------------------------------------------------------ shapes */

export type QuestionType = "text" | "textarea" | "radio" | "checkbox";

export interface CallQuestion {
  id: string;
  label: string;
  type: QuestionType;
  required: boolean;
  options: string[];
}

interface CallTypeRow {
  id: number;
  slug: string;
  legacy_slug: string;
  title: string;
  summary: string;
  description_md: string;
  duration_minutes: number;
  padding_minutes: number;
  slot_interval_minutes: number;
  min_notice_minutes: number;
  horizon_days: number;
  max_per_day: number | null;
  timezone: string;
  price_cents: number;
  currency: string;
  location_label: string;
  meeting_url: string;
  questions: unknown;
  listed: boolean;
  featured: boolean;
  bookable: boolean;
  sort: number;
}

const TYPE_COLUMNS = `id, slug, legacy_slug, title, summary, description_md, duration_minutes,
  padding_minutes, slot_interval_minutes, min_notice_minutes, horizon_days, max_per_day,
  timezone, price_cents, currency, location_label, meeting_url, questions, listed, featured,
  bookable, sort`;

/** The jsonb column, treated as untrusted: an owner can edit it by hand. */
export function parseQuestions(value: unknown): CallQuestion[] {
  if (!Array.isArray(value)) return [];
  const out: CallQuestion[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (typeof raw !== "object" || raw === null) continue;
    const item = raw as Record<string, unknown>;
    const id = typeof item.id === "string" ? item.id.trim() : "";
    const label = typeof item.label === "string" ? item.label.trim() : "";
    if (!id || !label || seen.has(id)) continue;
    const type: QuestionType =
      item.type === "textarea" || item.type === "radio" || item.type === "checkbox"
        ? item.type
        : "text";
    const options = Array.isArray(item.options)
      ? item.options.filter((o): o is string => typeof o === "string" && o.trim() !== "")
      : [];
    // A choice question with nothing to choose would be unanswerable; ask it as text.
    const effective: QuestionType =
      (type === "radio" || type === "checkbox") && options.length === 0 ? "text" : type;
    seen.add(id);
    out.push({ id, label, type: effective, required: item.required === true, options });
  }
  return out;
}

function zoneOf(row: CallTypeRow): string {
  return isValidTimeZone(row.timezone) ? row.timezone : "America/Los_Angeles";
}

function priceLabel(row: CallTypeRow): string {
  if (row.price_cents <= 0) return "Complimentary";
  const amount = row.price_cents / 100;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: (row.currency || "usd").toUpperCase(),
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
  }).format(amount);
}

function toTypeJson(row: CallTypeRow, detail: boolean) {
  return {
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    durationMinutes: row.duration_minutes,
    priceCents: row.price_cents,
    priceLabel: priceLabel(row),
    free: row.price_cents <= 0,
    locationLabel: row.location_label,
    featured: row.featured,
    listed: row.listed,
    bookable: row.bookable,
    hostTimezone: zoneOf(row),
    horizonDays: row.horizon_days,
    ...(detail
      ? {
          descriptionMd: row.description_md,
          questions: parseQuestions(row.questions),
          minimumNoticeMinutes: row.min_notice_minutes,
        }
      : {}),
  };
}

const slugSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/i);

async function loadCallType(slug: string): Promise<CallTypeRow | null> {
  const parsed = slugSchema.safeParse(slug);
  if (!parsed.success) return null;
  const value = parsed.data.toLowerCase();
  // The live slug wins over a TidyCal alias if the two ever collide.
  const res = await pool.query<CallTypeRow>(
    `SELECT ${TYPE_COLUMNS}
       FROM book_a_call_types
      WHERE archived_at IS NULL AND (slug = $1 OR legacy_slug = $1)
      ORDER BY (slug = $1) DESC
      LIMIT 1`,
    [value]
  );
  return res.rows[0] ?? null;
}

async function loadWindows(callTypeId: number, db: Queryable = pool): Promise<AvailabilityRule[]> {
  const res = await db.query<{
    id: number;
    weekday: number;
    start_minute: number;
    end_minute: number;
    timezone: string;
  }>(
    `SELECT id, weekday, start_minute, end_minute, timezone
       FROM book_a_call_windows
      WHERE call_type_id = $1
      ORDER BY weekday, start_minute, id`,
    [callTypeId]
  );
  return res.rows.map((row) => ({
    id: row.id,
    timezone: row.timezone,
    weekday: row.weekday,
    startMinute: row.start_minute,
    endMinute: row.end_minute,
    active: true,
  }));
}

/* --------------------------------------------------------------- the maths */

/**
 * Every appointment already on the calendar, widened by this type's buffer.
 *
 * TidyCal's "padding" keeps the coach clear either side of a call. Widening
 * the existing appointments (rather than the new slot) keeps the offered slot
 * itself honest — a 15-minute call is shown ending 15 minutes later — while
 * still refusing anything that would butt up against another call.
 */
export function padSessions(sessions: BookedSession[], paddingMinutes: number): BookedSession[] {
  if (paddingMinutes <= 0) return sessions;
  return sessions.map((session) => ({
    id: session.id,
    startsAt: new Date(session.startsAt.getTime() - paddingMinutes * MINUTE_MS),
    durationMinutes: session.durationMinutes + 2 * paddingMinutes,
  }));
}

/**
 * Calendar days (in the host's zone) on which this call type is already full.
 *
 * The Practice Alignment Call is one-a-day on TidyCal; `max_per_day` carries
 * that rule. Counted per type, so a coaching session does not use up the day's
 * discovery call.
 */
async function fullDays(
  row: CallTypeRow,
  from: Date,
  to: Date,
  db: Queryable = pool
): Promise<Set<string>> {
  const out = new Set<string>();
  if (!row.max_per_day) return out;
  const res = await db.query<{ scheduled_at: Date }>(
    `SELECT scheduled_at
       FROM coaching_sessions
      WHERE call_type_id = $1
        AND status <> 'cancelled'
        AND scheduled_at IS NOT NULL
        AND scheduled_at >= $2 AND scheduled_at < $3`,
    [row.id, new Date(from.getTime() - DAY_MS), new Date(to.getTime() + DAY_MS)]
  );
  const counts = new Map<string, number>();
  for (const session of res.rows) {
    const key = describeInstant(session.scheduled_at, zoneOf(row)).day;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  for (const [key, count] of counts) if (count >= row.max_per_day) out.add(key);
  return out;
}

function resolveWindow(raw: { from?: string; to?: string }, row: CallTypeRow, now: Date) {
  const requestedFrom = raw.from ? new Date(raw.from) : now;
  const fromMs = Number.isNaN(requestedFrom.getTime()) ? now.getTime() : requestedFrom.getTime();
  const from = new Date(Math.max(fromMs, now.getTime()));
  const horizon = now.getTime() + row.horizon_days * DAY_MS;
  const requestedTo = raw.to ? new Date(raw.to) : new Date(from.getTime() + 14 * DAY_MS);
  const toMs = Number.isNaN(requestedTo.getTime()) ? from.getTime() + 14 * DAY_MS : requestedTo.getTime();
  const capped = Math.min(toMs, horizon, from.getTime() + MAX_WINDOW_DAYS * DAY_MS);
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

/* --------------------------------------------------------------- answers */

export interface StoredAnswer {
  id: string;
  label: string;
  answer: string | string[];
}

/**
 * The visitor's answers, checked against the questions as stored.
 *
 * A choice must be one of the options offered — the answers land in Yvette's
 * inbox and her contacts, and a forged "option" is just free text by another
 * name. Unknown keys are dropped rather than refused.
 */
export function validateAnswers(
  questions: CallQuestion[],
  raw: Record<string, unknown>
): { answers: StoredAnswer[]; errors: Record<string, string> } {
  const answers: StoredAnswer[] = [];
  const errors: Record<string, string> = {};

  for (const question of questions) {
    const value = raw[question.id];

    if (question.type === "checkbox") {
      const picked = (Array.isArray(value) ? value : typeof value === "string" ? [value] : [])
        .filter((v): v is string => typeof v === "string")
        .map((v) => v.trim())
        .filter((v) => question.options.includes(v));
      const unique = [...new Set(picked)];
      if (unique.length === 0) {
        if (question.required) errors[question.id] = "Please choose at least one.";
        continue;
      }
      answers.push({ id: question.id, label: question.label, answer: unique });
      continue;
    }

    const text = typeof value === "string" ? value.trim() : "";
    if (question.type === "radio") {
      if (!text) {
        if (question.required) errors[question.id] = "Please choose one.";
        continue;
      }
      if (!question.options.includes(text)) {
        errors[question.id] = "Please choose one of the options.";
        continue;
      }
      answers.push({ id: question.id, label: question.label, answer: text });
      continue;
    }

    const limit = question.type === "textarea" ? 4000 : 500;
    if (!text) {
      if (question.required) errors[question.id] = "Please answer this one.";
      continue;
    }
    if (text.length > limit) {
      errors[question.id] = `Please keep this under ${limit} characters.`;
      continue;
    }
    answers.push({ id: question.id, label: question.label, answer: text });
  }

  return { answers, errors };
}

/** The answers as plain text: for the session's agenda, the lead and the emails. */
export function answersText(answers: StoredAnswer[]): string {
  return answers
    .map((a) => `${a.label}\n${Array.isArray(a.answer) ? a.answer.map((x) => `- ${x}`).join("\n") : a.answer}`)
    .join("\n\n");
}

function answersHtml(answers: StoredAnswer[]): string {
  return answers
    .map(
      (a) =>
        `<p><strong>${escapeHtml(a.label)}</strong><br>${
          Array.isArray(a.answer)
            ? a.answer.map((x) => escapeHtml(x)).join("<br>")
            : escapeHtml(a.answer).replace(/\n/g, "<br>")
        }</p>`
    )
    .join("");
}

/* -------------------------------------------------------------------- ics */

function icsEscape(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

function foldLine(line: string): string {
  if (line.length <= 74) return line;
  const parts: string[] = [line.slice(0, 74)];
  for (let i = 74; i < line.length; i += 73) parts.push(` ${line.slice(i, i + 73)}`);
  return parts.join("\r\n");
}

function icsStamp(date: Date): string {
  return `${date.toISOString().replace(/[-:]/g, "").split(".")[0]}Z`;
}

function organiserEmail(): string {
  const match = /<([^>]+)>/.exec(env.smtp.from);
  return (match ? match[1] : env.smtp.from).trim() || "no-reply@bossclinician.com";
}

interface BookingRow {
  id: number;
  scheduled_at: Date;
  duration_minutes: number;
  status: string;
  meeting_url: string;
  agenda: string;
  timezone: string;
  guest_name: string;
  guest_email: string;
  answers: unknown;
  manage_token: string;
  created_at: Date;
  updated_at: Date;
  cancelled_at: Date | null;
  call_type_id: number;
  type_slug: string;
  type_title: string;
  type_timezone: string;
  type_meeting_url: string;
  type_location_label: string;
}

const BOOKING_SELECT = `
  SELECT s.id, s.scheduled_at, s.duration_minutes, s.status, s.meeting_url, s.agenda,
         s.timezone, s.guest_name, s.guest_email, s.answers, s.manage_token,
         s.created_at, s.updated_at, s.cancelled_at, s.call_type_id,
         t.slug AS type_slug, t.title AS type_title, t.timezone AS type_timezone,
         t.meeting_url AS type_meeting_url, t.location_label AS type_location_label
    FROM coaching_sessions s
    JOIN book_a_call_types t ON t.id = s.call_type_id`;

/** The room: what was given at booking, else whatever the type says now. */
function meetingUrlOf(row: BookingRow): string {
  return row.meeting_url || row.type_meeting_url || "";
}

function manageUrl(token: string): string {
  return `${env.publicSiteUrl}/book-a-call/manage/${token}`;
}

export function buildBookingIcs(row: BookingRow): string {
  const start = row.scheduled_at;
  const end = new Date(start.getTime() + row.duration_minutes * MINUTE_MS);
  const host = env.publicSiteUrl.replace(/^https?:\/\//, "") || "bossclinician";
  const cancelled = row.status === "cancelled";
  const meeting = meetingUrlOf(row);
  const sequence = Math.max(0, Math.floor((row.updated_at.getTime() - row.created_at.getTime()) / 1000));
  const description = [
    `${row.type_title} with Yvette Howard`,
    meeting && !cancelled ? `Join here: ${meeting}` : row.type_location_label,
    `Manage your booking: ${manageUrl(row.manage_token)}`,
  ]
    .filter(Boolean)
    .join("\n");

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Boss Clinician//Book A Call//EN",
    "CALSCALE:GREGORIAN",
    cancelled ? "METHOD:CANCEL" : "METHOD:REQUEST",
    "BEGIN:VEVENT",
    // Same UID scheme as member sessions: the row is a coaching session.
    `UID:coaching-session-${row.id}@${host}`,
    `DTSTAMP:${icsStamp(new Date())}`,
    `DTSTART:${icsStamp(start)}`,
    `DTEND:${icsStamp(end)}`,
    `SEQUENCE:${sequence}`,
    `STATUS:${cancelled ? "CANCELLED" : "CONFIRMED"}`,
    `SUMMARY:${icsEscape(`${row.type_title} — Boss Clinician`)}`,
    `DESCRIPTION:${icsEscape(description)}`,
    meeting && !cancelled ? `LOCATION:${icsEscape(meeting)}` : `LOCATION:${icsEscape(row.type_location_label)}`,
    `ORGANIZER;CN=Yvette Howard:mailto:${organiserEmail()}`,
    `ATTENDEE;CN=${icsEscape(row.guest_name || row.guest_email)};RSVP=FALSE:mailto:${row.guest_email}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean);

  return `${lines.map(foldLine).join("\r\n")}\r\n`;
}

function bookingJson(row: BookingRow) {
  const answers = Array.isArray(row.answers) ? (row.answers as StoredAnswer[]) : [];
  return {
    callSlug: row.type_slug,
    callTitle: row.type_title,
    startsAt: row.scheduled_at.toISOString(),
    durationMinutes: row.duration_minutes,
    status: row.status,
    cancelled: row.status === "cancelled",
    canCancel: row.status === "scheduled" && row.scheduled_at.getTime() > Date.now(),
    timezone: row.timezone,
    hostTimezone: isValidTimeZone(row.type_timezone) ? row.type_timezone : "America/Los_Angeles",
    meetingUrl: meetingUrlOf(row),
    locationLabel: row.type_location_label,
    name: row.guest_name,
    email: row.guest_email,
    answers,
    token: row.manage_token,
    icsUrl: `${env.publicSiteUrl}/api/book-a-call/bookings/${row.manage_token}/ics`,
    manageUrl: manageUrl(row.manage_token),
  };
}

/* ------------------------------------------------------------------ email */

async function mailGuest(row: BookingRow, kind: "booked" | "cancelled"): Promise<void> {
  const when = describeInstant(row.scheduled_at, row.timezone).label;
  const meeting = meetingUrlOf(row);
  const first = (row.guest_name || "").split(/\s+/)[0] || "there";
  const booked = kind === "booked";

  const subject = booked ? `You're booked: ${row.type_title}` : `Cancelled: ${row.type_title}`;
  const where = meeting
    ? `Join here: ${meeting}`
    : `${row.type_location_label} — Yvette will send your link before the call.`;
  const text = [
    `Hi ${first},`,
    "",
    booked
      ? `Your ${row.type_title} with Yvette Howard is confirmed. The calendar invitation is attached.`
      : `Your ${row.type_title} has been cancelled. The attached file removes it from your calendar.`,
    "",
    `${row.type_title} — ${when}`,
    `${row.duration_minutes} minutes`,
    booked ? where : "",
    "",
    booked
      ? `Need to cancel or pick another time? ${manageUrl(row.manage_token)}`
      : `Book another time: ${env.publicSiteUrl}/book-a-call/${row.type_slug}`,
  ]
    .filter((line, i, all) => line !== "" || all[i - 1] !== "")
    .join("\n");

  const html = [
    `<p>Hi ${escapeHtml(first)},</p>`,
    `<p>${
      booked
        ? `Your ${escapeHtml(row.type_title)} with Yvette Howard is confirmed. The calendar invitation is attached.`
        : `Your ${escapeHtml(row.type_title)} has been cancelled. The attached file removes it from your calendar.`
    }</p>`,
    `<p><strong>${escapeHtml(row.type_title)}</strong><br>${escapeHtml(when)}<br>${row.duration_minutes} minutes</p>`,
    booked
      ? meeting
        ? `<p><a href="${escapeHtml(meeting)}">Join the call</a></p>`
        : `<p>${escapeHtml(row.type_location_label)} — Yvette will send your link before the call.</p>`
      : "",
    booked
      ? `<p>Need to cancel or pick another time? <a href="${escapeHtml(manageUrl(row.manage_token))}">Manage your booking</a>.</p>`
      : `<p><a href="${escapeHtml(`${env.publicSiteUrl}/book-a-call/${row.type_slug}`)}">Book another time</a></p>`,
  ].join("");

  await sendMail({
    to: row.guest_email,
    subject,
    text,
    html,
    topic: booked ? "book_a_call_confirmation" : "book_a_call_cancellation",
    sourceId: row.id,
    attachments: [
      { filename: `booking-${row.id}.ics`, content: buildBookingIcs(row), contentType: "text/calendar; charset=utf-8" },
    ],
  });
}

async function mailOwner(row: BookingRow, kind: "booked" | "cancelled", reason = ""): Promise<void> {
  const to = await notificationRecipients("lead");
  if (!to) return;
  const hostZone = isValidTimeZone(row.type_timezone) ? row.type_timezone : "America/Los_Angeles";
  const whenHost = describeInstant(row.scheduled_at, hostZone).label;
  const whenGuest = describeInstant(row.scheduled_at, row.timezone).label;
  const answers = Array.isArray(row.answers) ? (row.answers as StoredAnswer[]) : [];
  const booked = kind === "booked";
  const name = row.guest_name || row.guest_email;

  const subject = booked
    ? `New booking: ${row.type_title} — ${name}, ${whenHost}`
    : `Cancelled: ${row.type_title} — ${name}, ${whenHost}`;
  const text = [
    booked ? `${name} booked a ${row.type_title}.` : `${name} cancelled their ${row.type_title}.`,
    "",
    `When: ${whenHost}`,
    whenGuest !== whenHost ? `(their time: ${whenGuest})` : "",
    `Email: ${row.guest_email}`,
    reason ? `Reason: ${reason}` : "",
    "",
    answers.length ? answersText(answers) : "",
  ]
    .filter(Boolean)
    .join("\n");
  const html = [
    `<p>${escapeHtml(booked ? `${name} booked a ${row.type_title}.` : `${name} cancelled their ${row.type_title}.`)}</p>`,
    `<p><strong>When:</strong> ${escapeHtml(whenHost)}${
      whenGuest !== whenHost ? `<br>(their time: ${escapeHtml(whenGuest)})` : ""
    }<br><strong>Email:</strong> <a href="mailto:${escapeHtml(row.guest_email)}">${escapeHtml(row.guest_email)}</a>${
      reason ? `<br><strong>Reason:</strong> ${escapeHtml(reason)}` : ""
    }</p>`,
    answersHtml(answers),
  ].join("");

  await sendMail({
    to,
    subject,
    text,
    html,
    replyTo: row.guest_email,
    topic: booked ? "book_a_call_owner_notice" : "book_a_call_owner_cancel",
    sourceId: row.id,
    attachments: [
      { filename: `booking-${row.id}.ics`, content: buildBookingIcs(row), contentType: "text/calendar; charset=utf-8" },
    ],
  });
}

function fireAndLog(label: string, work: Promise<unknown>): void {
  work.catch((err) => {
    // eslint-disable-next-line no-console
    console.error(`[book-a-call] ${label} failed:`, err instanceof Error ? err.message : err);
  });
}

/* ----------------------------------------------------------------- routes */

/** GET /api/book-a-call — the listed call types, for the chooser. */
bookACallRouter.get(
  "/book-a-call",
  asyncHandler(async (_req, res) => {
    const found = await pool.query<CallTypeRow>(
      `SELECT ${TYPE_COLUMNS}
         FROM book_a_call_types
        WHERE archived_at IS NULL AND listed = true
        ORDER BY featured DESC, sort, id`
    );
    res.json({ calls: found.rows.map((row) => toTypeJson(row, false)) });
  })
);

/** GET /api/book-a-call/types/:slug — one call type, listed or not, with its questions. */
bookACallRouter.get(
  "/book-a-call/types/:slug",
  asyncHandler(async (req, res) => {
    const row = await loadCallType(req.params.slug);
    if (!row) throw notFound(CALL_NOT_FOUND);
    res.json({ call: toTypeJson(row, true) });
  })
);

const windowSchema = z.object({
  from: z.string().trim().max(40).optional(),
  to: z.string().trim().max(40).optional(),
  timezone: z.string().trim().max(64).optional(),
});

/** GET /api/book-a-call/types/:slug/slots — open start times, as UTC instants. */
bookACallRouter.get(
  "/book-a-call/types/:slug/slots",
  slotsLimiter,
  asyncHandler(async (req, res) => {
    const row = await loadCallType(req.params.slug);
    if (!row || !row.bookable) throw notFound(CALL_NOT_FOUND);

    const query = windowSchema.safeParse(req.query);
    if (!query.success) throw badRequest("Invalid date range", query.error.flatten());

    const zone =
      query.data.timezone && isValidTimeZone(query.data.timezone) ? query.data.timezone : zoneOf(row);
    const now = new Date();
    const window = resolveWindow(query.data, row, now);
    const pad = row.padding_minutes * MINUTE_MS;

    const [rules, overrides, busy, full] = await Promise.all([
      loadWindows(row.id),
      loadAvailabilityOverrides(new Date(window.from.getTime() - DAY_MS), new Date(window.to.getTime() + DAY_MS)),
      loadBusySessions(
        new Date(window.from.getTime() - pad),
        new Date(window.to.getTime() + row.duration_minutes * MINUTE_MS + pad)
      ),
      fullDays(row, window.from, window.to),
    ]);

    const slots = computeSlots({
      rules,
      overrides: overrides.filter((o) => !o.available),
      existingSessions: padSessions(busy, row.padding_minutes),
      durationMinutes: row.duration_minutes,
      slotIntervalMinutes: row.slot_interval_minutes,
      from: window.from,
      to: window.to,
      memberTimezone: zone,
      now,
      minimumNoticeMinutes: row.min_notice_minutes,
    }).filter((slot) => !full.has(describeInstant(slot.startsAt, zoneOf(row)).day));

    res.json({
      call: { slug: row.slug, title: row.title, durationMinutes: row.duration_minutes },
      timezone: zone,
      from: window.from.toISOString(),
      to: window.to.toISOString(),
      horizonDays: row.horizon_days,
      slots: slots.map(slotJson),
    });
  })
);

const bookSchema = z.object({
  startsAt: z.string().datetime({ offset: true }),
  name: z.string().trim().min(1, "Please tell us your name.").max(200),
  email: z.string().trim().toLowerCase().email("Please check your email address.").max(254),
  timezone: z.string().trim().max(64).optional(),
  answers: z.record(z.string().max(80), z.union([z.string().max(5000), z.array(z.string().max(500)).max(40)])).optional(),
  company: z.string().max(200).optional(),
  elapsedMs: z.number().optional(),
});

/** POST /api/book-a-call/types/:slug/book — books the call for a visitor. */
bookACallRouter.post(
  "/book-a-call/types/:slug/book",
  leadsLimiter,
  asyncHandler(async (req, res) => {
    const row = await loadCallType(req.params.slug);
    if (!row) throw notFound(CALL_NOT_FOUND);
    if (!row.bookable) throw badRequest("This call can't be booked online yet. Please get in touch instead.");

    const parsed = bookSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Please check the form", parsed.error.flatten());
    const input = parsed.data;

    const startsAt = new Date(input.startsAt);
    if (Number.isNaN(startsAt.getTime())) throw badRequest("That start time isn't valid.");
    const zone = input.timezone && isValidTimeZone(input.timezone) ? input.timezone : zoneOf(row);

    const questions = parseQuestions(row.questions);
    const { answers, errors } = validateAnswers(questions, input.answers ?? {});
    if (Object.keys(errors).length > 0) {
      // Same envelope zod's flatten() produces, so the client reads one shape.
      throw badRequest("Please answer the questions marked below.", {
        fieldErrors: Object.fromEntries(Object.entries(errors).map(([k, v]) => [`answers.${k}`, [v]])),
      });
    }

    // A filled honeypot, or a form sent faster than anyone can read it, is a
    // script. It is told the call is booked and nothing is written or sent.
    if (input.company?.trim() || (input.elapsedMs !== undefined && input.elapsedMs < MIN_FILL_MS)) {
      res.status(201).json({ booking: null, message: "You're booked." });
      return;
    }

    const now = new Date();
    const end = new Date(startsAt.getTime() + row.duration_minutes * MINUTE_MS);
    const pad = row.padding_minutes * MINUTE_MS;
    const token = crypto.randomBytes(24).toString("base64url");
    const agenda = answersText(answers).slice(0, 8000);

    const client = await pool.connect();
    let sessionId: number;
    try {
      await client.query("BEGIN");
      await client.query(`SELECT pg_advisory_xact_lock($1, $2)`, [CALENDAR_LOCK_CLASS, CALENDAR_LOCK_KEY]);

      const rules = await loadWindows(row.id, client);
      const overrides = await loadAvailabilityOverrides(
        new Date(startsAt.getTime() - DAY_MS),
        new Date(end.getTime() + DAY_MS),
        client
      );
      const busy = await loadBusySessions(new Date(startsAt.getTime() - pad), new Date(end.getTime() + pad), {
        db: client,
      });
      const padded = padSessions(busy, row.padding_minutes);

      const free = isSlotBookable(
        {
          rules,
          overrides: overrides.filter((o) => !o.available),
          existingSessions: padded,
          durationMinutes: row.duration_minutes,
          slotIntervalMinutes: row.slot_interval_minutes,
          memberTimezone: zone,
          now,
          minimumNoticeMinutes: row.min_notice_minutes,
        },
        startsAt
      );
      const horizonOk = startsAt.getTime() <= now.getTime() + row.horizon_days * DAY_MS;

      if (!free || !horizonOk) {
        await client.query("ROLLBACK");
        const taken = padded.some(
          (s) => startsAt.getTime() < s.startsAt.getTime() + s.durationMinutes * MINUTE_MS && s.startsAt.getTime() < end.getTime()
        );
        throw badRequest(
          startsAt.getTime() < now.getTime() + row.min_notice_minutes * MINUTE_MS
            ? "That time is too soon to book. Please pick a later one."
            : taken
              ? "That time has just been taken. Please pick another."
              : "That isn't one of the times on offer. Please pick one from the list."
        );
      }

      const full = await fullDays(row, startsAt, end, client);
      if (full.has(describeInstant(startsAt, zoneOf(row)).day)) {
        await client.query("ROLLBACK");
        throw badRequest("That day is fully booked for this call. Please pick another day.");
      }

      const inserted = await client.query<{ id: number }>(
        `INSERT INTO coaching_sessions
           (offer_id, member_id, call_type_id, scheduled_at, duration_minutes, status,
            meeting_url, agenda, timezone, booked_at, guest_name, guest_email, answers, manage_token)
         VALUES (NULL, NULL, $1, $2, $3, 'scheduled', $4, $5, $6, now(), $7, $8, $9::jsonb, $10)
         RETURNING id`,
        [
          row.id,
          startsAt,
          row.duration_minutes,
          row.meeting_url,
          agenda,
          zone,
          input.name,
          input.email,
          JSON.stringify(answers),
          token,
        ]
      );
      sessionId = inserted.rows[0].id;
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }

    // Everything below is bookkeeping around a booking that already exists; a
    // failure here must not turn the visitor's confirmed call into an error.
    let contactId: number | null = null;
    try {
      const contact = await upsertContactWithStatus({
        email: input.email,
        name: input.name,
        timezone: zone,
        source: `book-a-call: ${row.slug}`,
        consentSource: `book-a-call: ${row.slug}`,
        consentIp: req.ip ?? "",
      });
      contactId = contact.id;
      await pool.query(`UPDATE coaching_sessions SET contact_id = $2 WHERE id = $1`, [sessionId, contactId]);

      // A booked discovery call is an enquiry too: it belongs in her Leads.
      const lead = await pool.query<{ id: number }>(
        `INSERT INTO leads (name, email, message, source, meta)
         VALUES ($1, $2, $3, $4, $5::jsonb) RETURNING id`,
        [
          input.name,
          input.email,
          agenda,
          `book-a-call:${row.slug}`,
          JSON.stringify({ callType: row.slug, sessionId, startsAt: startsAt.toISOString(), timezone: zone }),
        ]
      );
      await linkContact("lead", lead.rows[0].id, contactId);

      await recordActivity({
        contactId,
        kind: "coaching.booked",
        title: `Booked a ${row.title}`,
        body: `${describeInstant(startsAt, zoneOf(row)).label}\n\n${agenda}`,
        subjectType: "coaching_session",
        subjectId: sessionId,
        meta: { callType: row.slug },
      });
      if (contact.created) {
        await publishDomainEvent("contact_created", {
          eventKey: `contact-created:${contactId}`,
          contactId,
          email: input.email,
          name: input.name,
          source: `book-a-call:${row.slug}`,
        });
      }
      await publishDomainEvent("coaching_session_booked", {
        eventKey: `coaching-session-booked:${sessionId}`,
        contactId,
        email: input.email,
        name: input.name,
        subjectId: null,
        source: "book-a-call",
        facts: {
          sessionId,
          callType: row.slug,
          offerTitle: row.title,
          scheduledAt: startsAt.toISOString(),
          timezone: zone,
        },
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[book-a-call] contact bookkeeping failed:", err instanceof Error ? err.message : err);
    }

    const stored = await pool.query<BookingRow>(`${BOOKING_SELECT} WHERE s.id = $1`, [sessionId]);
    const booking = stored.rows[0];

    fireAndLog("guest confirmation", mailGuest(booking, "booked"));
    fireAndLog("owner notice", mailOwner(booking, "booked"));

    res.status(201).json({
      booking: bookingJson(booking),
      message: "You're booked. A confirmation and calendar invitation are on their way to your inbox.",
    });
  })
);

/* ----------------------------------------------------- managing a booking */

const tokenSchema = z.string().trim().min(20).max(80).regex(/^[A-Za-z0-9_-]+$/);

async function bookingFor(token: string): Promise<BookingRow | null> {
  const parsed = tokenSchema.safeParse(token);
  if (!parsed.success) return null;
  const res = await pool.query<BookingRow>(`${BOOKING_SELECT} WHERE s.manage_token = $1`, [parsed.data]);
  return res.rows[0] ?? null;
}

/** GET /api/book-a-call/bookings/:token — the guest's own booking. */
bookACallRouter.get(
  "/book-a-call/bookings/:token",
  slotsLimiter,
  asyncHandler(async (req, res) => {
    const row = await bookingFor(req.params.token);
    if (!row) throw notFound(BOOKING_NOT_FOUND);
    res.json({ booking: bookingJson(row) });
  })
);

/** GET /api/book-a-call/bookings/:token/ics — the calendar file. */
bookACallRouter.get(
  "/book-a-call/bookings/:token/ics",
  slotsLimiter,
  asyncHandler(async (req, res) => {
    const row = await bookingFor(req.params.token);
    if (!row) throw notFound(BOOKING_NOT_FOUND);
    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="booking-${row.id}.ics"`);
    res.setHeader("Cache-Control", "no-store");
    res.send(buildBookingIcs(row));
  })
);

const cancelSchema = z.object({ reason: z.string().trim().max(500).optional() });

/** POST /api/book-a-call/bookings/:token/cancel — the guest cancels. */
bookACallRouter.post(
  "/book-a-call/bookings/:token/cancel",
  leadsLimiter,
  asyncHandler(async (req, res) => {
    const parsed = cancelSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw badRequest("Invalid request", parsed.error.flatten());
    const existing = await bookingFor(req.params.token);
    if (!existing) throw notFound(BOOKING_NOT_FOUND);
    if (existing.status === "cancelled") {
      res.json({ booking: bookingJson(existing), message: "This call was already cancelled." });
      return;
    }
    if (existing.status !== "scheduled" || existing.scheduled_at.getTime() <= Date.now()) {
      throw badRequest("This call has already started, so it can't be cancelled here.");
    }

    const reason = parsed.data.reason ?? "";
    await pool.query(
      `UPDATE coaching_sessions
          SET status = 'cancelled', cancelled_at = now(), cancel_reason = $2, updated_at = now()
        WHERE id = $1 AND status = 'scheduled'`,
      [existing.id, reason]
    );
    const row = (await bookingFor(req.params.token)) as BookingRow;

    if (row.status === "cancelled") {
      fireAndLog("guest cancellation", mailGuest(row, "cancelled"));
      fireAndLog("owner cancellation", mailOwner(row, "cancelled", reason));
    }

    res.json({ booking: bookingJson(row), message: "Your call is cancelled." });
  })
);
