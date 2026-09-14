import { Router } from "express";
import { pool } from "../../db/pool";
import { asyncHandler } from "../../utils/asyncHandler";

/**
 * Marketing → Overview — mounted at /api/admin/marketing-overview.
 *
 * One read-only round trip for the whole summary page: emails and how they were
 * received, the sequences that are running and who is in them, form replies,
 * automation runs and the problems they hit, and the events still to come.
 *
 * Every figure is read live from the tables the list screens themselves read,
 * not from the nightly `report_daily` rollup. The point of the page is "what is
 * happening in my marketing right now", and a tile that disagrees with the list
 * it links to — because one was worked out last night — reads as a bug.
 *
 * The definitions deliberately match the ones already on the site, so the
 * overview never argues with another screen:
 * - an email counts as sent on the same statuses the email reports count
 *   (`sent`, `delivered`, `bounced`, `complained`), and rates are over sends;
 * - "people in a sequence" is the Sequences list's own `active_count`;
 * - a run "had problems" when the automation run log would badge it
 *   "Ran with problems" or "Didn't run" — including the older runner's
 *   `success` rows whose log shows a blocked step (see `displayedRunStatus`
 *   in AutomationBuilder.tsx, mirrored by PROBLEM_LOG_PATTERN below).
 */
export const adminMarketingOverviewRouter = Router();

export const WINDOW_DAYS = 30;

/** The mail that belongs to marketing, as opposed to receipts and resets. */
const MARKETING_SOURCES = ["broadcast", "sequence", "automation"] as const;

/** Statuses that mean the provider took the message — the reports' definition of a send. */
const SENT_STATUSES = ["sent", "delivered", "bounced", "complained"] as const;

/** Statuses that mean it never left. Shown so a 0% open rate is never the only clue. */
const NOT_SENT_STATUSES = ["failed", "suppressed"] as const;

/**
 * Postgres spelling of the pattern `displayedRunStatus` uses in the automation
 * builder to repair an older `success` row whose log shows a step that did
 * nothing. `\y` is Postgres's word boundary, the equivalent of JS `\b`.
 */
export const PROBLEM_LOG_PATTERN =
  "\\yblocked\\y|none chosen|skipped,? no contact|no account|no longer exists|nothing done";

export interface MarketingOverview {
  windowDays: number;
  generatedAt: string;
  /**
   * Every email figure counts delivery-log rows (`email_messages`, one row per
   * recipient per attempt) from the three marketing sources, over the same
   * window: `COALESCE(sent_at, created_at)` in the last `windowDays` days. So
   * `sent + notSent + queued` is every marketing row in the window, and each
   * `bySource` sums to the figure it breaks down.
   */
  emails: {
    /** Rows the mail service took (sent, delivered, bounced, complained). */
    sent: number;
    /** `sent`, split by source. Sums to `sent`. */
    bySource: { broadcast: number; sequence: number; automation: number };
    /** Of the campaign emails in `bySource.broadcast`, those whose campaign is no longer on the campaigns list. */
    broadcastUnlisted: number;
    /** Sent rows with an open / a click reported. Emails, not people. */
    opened: number;
    clicked: number;
    /** Percent, one decimal place; null when nothing was sent. */
    openRate: number | null;
    clickRate: number | null;
    /** Rows that never left (failed or suppressed). Every attempt is a row, so a retried email counts once per try. */
    notSent: number;
    /** `notSent`, split by source. Sums to `notSent`. */
    notSentBySource: { broadcast: number; sequence: number; automation: number };
    /** Distinct recipients among the `notSent` rows. */
    notSentPeople: number;
    /** Distinct emails (recipient + source + subject) among the `notSent` rows. */
    notSentEmails: number;
    /** Of `notSentEmails`, those that went out on a later try. */
    notSentLaterSent: number;
    /** Rows still waiting to go out. */
    queued: number;
    /** Campaigns on the campaigns list marked sent in the window. Campaigns, not emails. */
    campaignsSent: number;
    /** Campaigns scheduled to go out, whenever that is. */
    campaignsScheduled: number;
    /** Whether an open or click has ever been reported, on any message. */
    trackingSeen: boolean;
  };
  sequences: {
    active: number;
    total: number;
    /** Enrolments in an active sequence right now; sums the `top` rows when every active sequence is listed. */
    enrolled: number;
    /** The same, counting each person once however many sequences they are in. */
    people: number;
    top: { id: number; name: string; enrolled: number }[];
  };
  forms: {
    replies: number;
    previousReplies: number;
    formsWithReplies: number;
    top: { id: number; name: string; replies: number }[];
  };
  automations: {
    active: number;
    /** Distinct automations that ran at least once (practice runs and skips excluded). */
    ran: number;
    runs: number;
    problemRuns: number;
    failedRuns: number;
    withProblems: number;
    skippedRuns: number;
    problemAutomations: { id: number; name: string; problemRuns: number }[];
  };
  events: {
    upcoming: number;
    upcomingPublished: number;
    upcomingDrafts: number;
    alwaysOn: number;
    /**
     * Registrations for the upcoming live events counted in `upcoming` — the
     * Events list's own per-event `registrationCount`, summed. It used to count
     * registrations whose `session_at` is still ahead, which drops people who
     * registered before an event was rescheduled (their session_at is the old
     * date) and adds always-on sessions, so it disagreed with the rows below it.
     */
    registrations: number;
    communityUpcoming: number;
    next: {
      id: number;
      title: string;
      startsAt: string;
      published: boolean;
      registrations: number;
    }[];
  };
}

/** Percent to one decimal place, or null when there is nothing to divide by. */
export function percentOf(part: number, whole: number): number | null {
  if (whole <= 0) return null;
  return Math.round((part / whole) * 1000) / 10;
}

const n = (value: unknown): number => Number(value ?? 0);

export async function readMarketingOverview(): Promise<MarketingOverview> {
  const window = `${WINDOW_DAYS} days`;

  const [emails, campaigns, tracking, sequences, topSequences, forms, topForms, runs, problemAutomations, activeAutomations, events, nextEvents, communityEvents] =
    await Promise.all([
      pool.query<{
        sent: string;
        broadcast: string;
        sequence: string;
        automation: string;
        broadcast_unlisted: string;
        opened: string;
        clicked: string;
        not_sent: string;
        not_sent_broadcast: string;
        not_sent_sequence: string;
        not_sent_automation: string;
        not_sent_people: string;
        not_sent_emails: string;
        not_sent_later_sent: string;
        queued: string;
      }>(
        // One window, one row set: every figure below is a FILTER over `win`,
        // so "sent", "not sent" and "queued" cannot drift onto different dates.
        // A sequence step that fails is retried on the next tick and writes a
        // new row each time, which is why the not-sent attempts are also
        // collapsed into distinct emails and checked for a later success.
        `WITH win AS (
           SELECT lower(m.to_email) AS to_email, m.source_type, m.source_id, m.subject, m.status,
                  m.created_at, m.first_opened_at, m.first_clicked_at,
                  (m.source_type = 'broadcast'
                    AND NOT EXISTS (SELECT 1 FROM email_campaigns c WHERE c.id = m.source_id)) AS unlisted
             FROM email_messages m
            WHERE m.source_type = ANY($1::text[])
              AND COALESCE(m.sent_at, m.created_at) >= now() - $4::interval
         ),
         failed AS (
           SELECT to_email, source_type, source_id, subject, MAX(created_at) AS last_try
             FROM win
            WHERE status = ANY($3::text[])
            GROUP BY to_email, source_type, source_id, subject
         )
         SELECT COUNT(*) FILTER (WHERE status = ANY($2::text[]))                                    AS sent,
                COUNT(*) FILTER (WHERE status = ANY($2::text[]) AND source_type = 'broadcast')      AS broadcast,
                COUNT(*) FILTER (WHERE status = ANY($2::text[]) AND source_type = 'sequence')       AS sequence,
                COUNT(*) FILTER (WHERE status = ANY($2::text[]) AND source_type = 'automation')     AS automation,
                COUNT(*) FILTER (WHERE status = ANY($2::text[]) AND unlisted)                       AS broadcast_unlisted,
                COUNT(*) FILTER (WHERE status = ANY($2::text[]) AND first_opened_at IS NOT NULL)    AS opened,
                COUNT(*) FILTER (WHERE status = ANY($2::text[]) AND first_clicked_at IS NOT NULL)   AS clicked,
                COUNT(*) FILTER (WHERE status = ANY($3::text[]))                                    AS not_sent,
                COUNT(*) FILTER (WHERE status = ANY($3::text[]) AND source_type = 'broadcast')      AS not_sent_broadcast,
                COUNT(*) FILTER (WHERE status = ANY($3::text[]) AND source_type = 'sequence')       AS not_sent_sequence,
                COUNT(*) FILTER (WHERE status = ANY($3::text[]) AND source_type = 'automation')     AS not_sent_automation,
                COUNT(DISTINCT to_email) FILTER (WHERE status = ANY($3::text[]))                    AS not_sent_people,
                (SELECT COUNT(*) FROM failed)                                                        AS not_sent_emails,
                (SELECT COUNT(*) FROM failed f
                  WHERE EXISTS (
                          SELECT 1 FROM email_messages s
                           WHERE lower(s.to_email) = f.to_email
                             AND s.source_type = f.source_type
                             AND s.source_id IS NOT DISTINCT FROM f.source_id
                             AND s.subject = f.subject
                             AND s.status = ANY($2::text[])
                             AND s.created_at > f.last_try))                                         AS not_sent_later_sent,
                COUNT(*) FILTER (WHERE status = 'queued')                                           AS queued
           FROM win`,
        [MARKETING_SOURCES, SENT_STATUSES, NOT_SENT_STATUSES, window]
      ),
      pool.query<{ sent: string; scheduled: string }>(
        `SELECT COUNT(*) FILTER (WHERE status = 'sent' AND COALESCE(sent_at, updated_at) >= now() - $1::interval) AS sent,
                COUNT(*) FILTER (WHERE status = 'scheduled')                                                   AS scheduled
           FROM email_campaigns`,
        [window]
      ),
      pool.query<{ seen: boolean }>(
        `SELECT EXISTS (
                  SELECT 1 FROM email_messages
                   WHERE first_opened_at IS NOT NULL OR first_clicked_at IS NOT NULL
                ) AS seen`
      ),
      pool.query<{ active: string; total: string; enrolled: string; people: string }>(
        `SELECT (SELECT COUNT(*) FROM email_sequences WHERE status = 'active')      AS active,
                (SELECT COUNT(*) FROM email_sequences WHERE status <> 'archived')   AS total,
                COUNT(s.id)                                                          AS enrolled,
                COUNT(DISTINCT s.contact_id)                                         AS people
           FROM sequence_subscriptions s
           JOIN email_sequences q ON q.id = s.sequence_id
          WHERE s.status = 'active' AND q.status = 'active'`
      ),
      pool.query<{ id: number; name: string; enrolled: string }>(
        `SELECT q.id, q.name,
                (SELECT COUNT(*) FROM sequence_subscriptions s
                  WHERE s.sequence_id = q.id AND s.status = 'active') AS enrolled
           FROM email_sequences q
          WHERE q.status = 'active'
          ORDER BY enrolled DESC, q.name
          LIMIT 3`
      ),
      pool.query<{ replies: string; previous: string; forms: string }>(
        `SELECT COUNT(*) FILTER (WHERE created_at >= now() - $1::interval)                         AS replies,
                COUNT(*) FILTER (WHERE created_at <  now() - $1::interval
                                   AND created_at >= now() - ($1::interval * 2))                    AS previous,
                COUNT(DISTINCT form_id) FILTER (WHERE created_at >= now() - $1::interval)           AS forms
           FROM form_submissions
          WHERE created_at >= now() - ($1::interval * 2)`,
        [window]
      ),
      pool.query<{ id: number; name: string; replies: string }>(
        `SELECT f.id, f.name, COUNT(*) AS replies
           FROM form_submissions s
           JOIN forms f ON f.id = s.form_id
          WHERE s.created_at >= now() - $1::interval
          GROUP BY f.id, f.name
          ORDER BY replies DESC, f.name
          LIMIT 3`,
        [window]
      ),
      pool.query<{
        runs: string;
        ran: string;
        problem_runs: string;
        failed_runs: string;
        with_problems: string;
        skipped_runs: string;
      }>(
        `WITH recent AS (
           SELECT automation_id, status,
                  (status IN ('partial','failed')
                    OR (status = 'success' AND log::text ~* $2)) AS had_problem
             FROM automation_runs
            WHERE NOT is_test
              AND created_at >= now() - $1::interval
         )
         SELECT COUNT(*) FILTER (WHERE status <> 'skipped')                          AS runs,
                COUNT(DISTINCT automation_id) FILTER (WHERE status <> 'skipped')     AS ran,
                COUNT(*) FILTER (WHERE had_problem)                                  AS problem_runs,
                COUNT(*) FILTER (WHERE status = 'failed')                            AS failed_runs,
                COUNT(DISTINCT automation_id) FILTER (WHERE had_problem)             AS with_problems,
                COUNT(*) FILTER (WHERE status = 'skipped')                           AS skipped_runs
           FROM recent`,
        [window, PROBLEM_LOG_PATTERN]
      ),
      pool.query<{ id: number; name: string; problem_runs: string }>(
        `SELECT a.id, a.name, COUNT(*) AS problem_runs
           FROM automation_runs r
           JOIN automations a ON a.id = r.automation_id
          WHERE NOT r.is_test
            AND r.created_at >= now() - $1::interval
            AND (r.status IN ('partial','failed') OR (r.status = 'success' AND r.log::text ~* $2))
          GROUP BY a.id, a.name
          ORDER BY problem_runs DESC, a.name
          LIMIT 3`,
        [window, PROBLEM_LOG_PATTERN]
      ),
      pool.query<{ active: string }>(
        `SELECT COUNT(*) AS active FROM automations WHERE status = 'active'`
      ),
      pool.query<{
        upcoming: string;
        published: string;
        drafts: string;
        always_on: string;
        registrations: string;
      }>(
        `SELECT COUNT(*) FILTER (WHERE kind = 'live' AND starts_at > now())                     AS upcoming,
                COUNT(*) FILTER (WHERE kind = 'live' AND starts_at > now() AND published)       AS published,
                COUNT(*) FILTER (WHERE kind = 'live' AND starts_at > now() AND NOT published)   AS drafts,
                COUNT(*) FILTER (WHERE kind = 'evergreen' AND published)                        AS always_on,
                (SELECT COUNT(*) FROM event_registrations r
                   JOIN events x ON x.id = r.event_id
                  WHERE x.kind = 'live' AND x.starts_at > now())                                AS registrations
           FROM events`
      ),
      pool.query<{
        id: number;
        title: string;
        starts_at: Date;
        published: boolean;
        registrations: string;
      }>(
        `SELECT e.id, e.title, e.starts_at, e.published,
                (SELECT COUNT(*) FROM event_registrations r WHERE r.event_id = e.id) AS registrations
           FROM events e
          WHERE e.kind = 'live' AND e.starts_at > now()
          ORDER BY e.starts_at
          LIMIT 3`
      ),
      pool.query<{ upcoming: string }>(
        `SELECT COUNT(*) AS upcoming FROM community_events
          WHERE published AND starts_at > now()`
      ),
    ]);

  const e = emails.rows[0];
  const sent = n(e?.sent);
  const opened = n(e?.opened);
  const clicked = n(e?.clicked);
  const r = runs.rows[0];
  const ev = events.rows[0];
  const sq = sequences.rows[0];
  const f = forms.rows[0];

  return {
    windowDays: WINDOW_DAYS,
    generatedAt: new Date().toISOString(),
    emails: {
      sent,
      bySource: {
        broadcast: n(e?.broadcast),
        sequence: n(e?.sequence),
        automation: n(e?.automation),
      },
      broadcastUnlisted: n(e?.broadcast_unlisted),
      opened,
      clicked,
      openRate: percentOf(opened, sent),
      clickRate: percentOf(clicked, sent),
      notSent: n(e?.not_sent),
      notSentBySource: {
        broadcast: n(e?.not_sent_broadcast),
        sequence: n(e?.not_sent_sequence),
        automation: n(e?.not_sent_automation),
      },
      notSentPeople: n(e?.not_sent_people),
      notSentEmails: n(e?.not_sent_emails),
      notSentLaterSent: n(e?.not_sent_later_sent),
      queued: n(e?.queued),
      campaignsSent: n(campaigns.rows[0]?.sent),
      campaignsScheduled: n(campaigns.rows[0]?.scheduled),
      trackingSeen: Boolean(tracking.rows[0]?.seen),
    },
    sequences: {
      active: n(sq?.active),
      total: n(sq?.total),
      enrolled: n(sq?.enrolled),
      people: n(sq?.people),
      top: topSequences.rows.map((row) => ({
        id: row.id,
        name: row.name,
        enrolled: n(row.enrolled),
      })),
    },
    forms: {
      replies: n(f?.replies),
      previousReplies: n(f?.previous),
      formsWithReplies: n(f?.forms),
      top: topForms.rows.map((row) => ({ id: row.id, name: row.name, replies: n(row.replies) })),
    },
    automations: {
      active: n(activeAutomations.rows[0]?.active),
      ran: n(r?.ran),
      runs: n(r?.runs),
      problemRuns: n(r?.problem_runs),
      failedRuns: n(r?.failed_runs),
      withProblems: n(r?.with_problems),
      skippedRuns: n(r?.skipped_runs),
      problemAutomations: problemAutomations.rows.map((row) => ({
        id: row.id,
        name: row.name,
        problemRuns: n(row.problem_runs),
      })),
    },
    events: {
      upcoming: n(ev?.upcoming),
      upcomingPublished: n(ev?.published),
      upcomingDrafts: n(ev?.drafts),
      alwaysOn: n(ev?.always_on),
      registrations: n(ev?.registrations),
      communityUpcoming: n(communityEvents.rows[0]?.upcoming),
      next: nextEvents.rows.map((row) => ({
        id: row.id,
        title: row.title,
        startsAt: new Date(row.starts_at).toISOString(),
        published: row.published,
        registrations: n(row.registrations),
      })),
    },
  };
}

adminMarketingOverviewRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    res.json(await readMarketingOverview());
  })
);
