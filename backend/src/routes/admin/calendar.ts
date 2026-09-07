import { Router, type Request } from "express";
import { z } from "zod";
import { pool } from "../../db/pool";
import { asyncHandler } from "../../utils/asyncHandler";
import { badRequest } from "../../utils/httpError";
import { can, type Permission } from "../../services/permissions";

/**
 * The unified admin calendar — Calendar addendum §5, §6.
 *
 * One read over everything that occupies time in this business: coaching
 * appointments, registrable events, and community events. They stay three
 * separate tables on purpose (addendum §7): a coaching appointment carries a
 * client, a programme, a session status and internal notes that a generic
 * calendar event has nowhere to put, and flattening them into one row would
 * lose exactly the business data the addendum says to preserve. They are
 * unified at read time instead, into a shape the calendar can draw.
 *
 * `source` is on every entry from the first commit even though only one value
 * is possible today. §11 asks for an architecture that can take Outlook later
 * without a rewrite; a field added afterwards means every stored row and every
 * client needs a migration, where a field that was always there needs neither.
 */
export const adminCalendarRouter = Router();

function allows(req: Request, permission: Permission): boolean {
  return can(req.user?.role ?? "", permission);
}

const query = z.object({
  /** Inclusive ISO date. */
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** Exclusive ISO date. */
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export type CalendarSource = "boss-clinician" | "google" | "outlook";

export interface CalendarEntry {
  /** Stable across sources: "coaching:12", "event:3", "community-event:8". */
  id: string;
  kind: "coaching" | "event" | "community-event";
  source: CalendarSource;
  title: string;
  /** ISO instants. `end` is derived where a duration is known. */
  start: string;
  end: string | null;
  timezone: string | null;
  /** Who it is with, when that is a single identifiable person. */
  attendee: string | null;
  attendeeEmail: string | null;
  /** "Coaching session", "Live event", "Community event". */
  type: string;
  /** A joinable link, or a place. */
  location: string | null;
  status: string;
  /** Where clicking through goes in the admin. */
  to: string;
  /** Extra facts for the details drawer, already labelled for display. */
  detail: { label: string; value: string }[];
}

/** Minutes → an ISO instant, for the sources that store a duration. */
function endOf(start: Date, minutes: number | null): string | null {
  if (!minutes || minutes <= 0) return null;
  return new Date(start.getTime() + minutes * 60_000).toISOString();
}

adminCalendarRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = query.safeParse(req.query);
    if (!parsed.success) {
      throw badRequest("Check the dates you asked for.", parsed.error.flatten());
    }
    const { from, to } = parsed.data;
    if (from >= to) throw badRequest("The range has to start before it ends.");

    const entries: CalendarEntry[] = [];

    /* ── Coaching appointments ──────────────────────────────────────── */
    if (allows(req, "coaching.view")) {
      const rows = await pool.query<{
        id: number;
        scheduled_at: Date;
        duration_minutes: number;
        timezone: string;
        status: string;
        meeting_url: string | null;
        agenda: string | null;
        title: string | null;
        name: string | null;
        email: string | null;
      }>(
        `SELECT s.id, s.scheduled_at, s.duration_minutes, s.timezone, s.status,
                s.meeting_url, s.agenda, o.title, m.name, m.email
           FROM coaching_sessions s
           LEFT JOIN coaching_offers o ON o.id = s.offer_id
           LEFT JOIN members m         ON m.id = s.member_id
          WHERE s.scheduled_at >= $1::date AND s.scheduled_at < $2::date
          ORDER BY s.scheduled_at`,
        [from, to],
      );

      for (const row of rows.rows) {
        entries.push({
          id: `coaching:${row.id}`,
          kind: "coaching",
          source: "boss-clinician",
          title: row.title || "Coaching session",
          start: row.scheduled_at.toISOString(),
          end: endOf(row.scheduled_at, row.duration_minutes),
          timezone: row.timezone,
          attendee: row.name || row.email,
          attendeeEmail: row.email,
          type: "Coaching session",
          location: row.meeting_url || null,
          status: row.status,
          to: "/admin/coaching",
          detail: [
            { label: "Length", value: `${row.duration_minutes} minutes` },
            ...(row.agenda ? [{ label: "Agenda", value: row.agenda }] : []),
          ],
        });
      }
    }

    /* ── Registrable events (webinars, live classes) ────────────────── */
    if (allows(req, "marketing.view")) {
      const rows = await pool.query<{
        id: number;
        slug: string;
        title: string;
        starts_at: Date;
        duration_minutes: number;
        timezone: string;
        room_url: string | null;
        kind: string;
        published: boolean;
        registered: string;
      }>(
        `SELECT e.id, e.slug, e.title, e.starts_at, e.duration_minutes, e.timezone,
                e.room_url, e.kind, e.published,
                (SELECT COUNT(*)::text FROM event_registrations r WHERE r.event_id = e.id) AS registered
           FROM events e
          WHERE e.starts_at >= $1::date AND e.starts_at < $2::date
          ORDER BY e.starts_at`,
        [from, to],
      );

      for (const row of rows.rows) {
        entries.push({
          id: `event:${row.id}`,
          kind: "event",
          source: "boss-clinician",
          title: row.title,
          start: row.starts_at.toISOString(),
          end: endOf(row.starts_at, row.duration_minutes),
          timezone: row.timezone,
          // An event has an audience rather than an attendee; the head count
          // goes in `detail` where it can be labelled.
          attendee: null,
          attendeeEmail: null,
          type: row.kind === "live" ? "Live event" : `${row.kind} event`,
          location: row.room_url || null,
          status: row.published ? "published" : "draft",
          to: "/admin/marketing/events-v2",
          detail: [
            { label: "Registered", value: row.registered },
            { label: "Length", value: `${row.duration_minutes} minutes` },
          ],
        });
      }
    }

    /* ── Community events ───────────────────────────────────────────── */
    if (allows(req, "community.view")) {
      const rows = await pool.query<{
        id: number;
        title: string;
        starts_at: Date;
        duration_minutes: number;
        location_url: string | null;
        published: boolean;
        community: string | null;
      }>(
        `SELECT e.id, e.title, e.starts_at, e.duration_minutes, e.location_url,
                e.published, c.name AS community
           FROM community_events e
           LEFT JOIN communities c ON c.id = e.community_id
          WHERE e.starts_at >= $1::date AND e.starts_at < $2::date
          ORDER BY e.starts_at`,
        [from, to],
      );

      for (const row of rows.rows) {
        entries.push({
          id: `community-event:${row.id}`,
          kind: "community-event",
          source: "boss-clinician",
          title: row.title,
          start: row.starts_at.toISOString(),
          end: endOf(row.starts_at, row.duration_minutes),
          timezone: null,
          attendee: null,
          attendeeEmail: null,
          type: "Community event",
          location: row.location_url || null,
          status: row.published ? "published" : "draft",
          to: "/admin/marketing/events",
          detail: row.community ? [{ label: "Community", value: row.community }] : [],
        });
      }
    }

    entries.sort((a, b) => a.start.localeCompare(b.start));

    /**
     * The connection block the Calendar page's header reads.
     *
     * Reported as "not connected" rather than omitted, because the page has to
     * be able to offer the connect action (§3) and say plainly that nothing is
     * syncing yet. `available: false` is the honest state until a Google OAuth
     * client is configured — see `calendarSync.ts`.
     */
    res.json({
      range: { from, to },
      entries,
      connections: {
        google: {
          available: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
          connected: false,
          account: null,
          lastSyncedAt: null,
        },
      },
    });
  }),
);
