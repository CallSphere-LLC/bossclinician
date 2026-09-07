import { Router, type Request } from "express";
import { z } from "zod";
import { pool } from "../../db/pool";
import { asyncHandler } from "../../utils/asyncHandler";
import { badRequest } from "../../utils/httpError";
import { can, type Permission } from "../../services/permissions";

/**
 * The dashboard's non-KPI panels — Part II §19–§30.
 *
 * Mounted under /admin/dashboard, which is gated on `reports.view` alone. That
 * is the right gate for the money *totals* — reports are what the permission
 * describes — but these panels reach across module boundaries: they name
 * individual customers, sessions, posts and automations.
 *
 * The role this matters for is **Marketing**. It holds `reports.view` so a
 * campaign can be measured, and holds neither `orders.view`, `community.view`
 * nor `coaching.view`; on a bare mount it would read the failed-payment list,
 * the moderation queue and the coaching diary off the home screen. (Support is
 * the mirror image — it holds `orders.view` but not `reports.view`, so it never
 * reaches this endpoint at all, and Coach holds only `coaching.*`.)
 *
 * So every panel here is assembled per-caller: `gated()` runs a section's query
 * only when the role holds the matching module permission, and the section is
 * simply absent otherwise. Part IV is explicit that hiding a control is not the
 * same as enforcing a permission — this enforces it at the query, so the data
 * never reaches the browser to be hidden.
 */
export const adminDashboardPanelsRouter = Router();

function allows(req: Request, permission: Permission): boolean {
  return can(req.user?.role ?? "", permission);
}

/**
 * Run a query only if the caller may see its module, otherwise resolve to a
 * stand-in. Written as a helper so a new panel cannot be added without a
 * permission being named for it.
 */
async function gated<T>(
  req: Request,
  permission: Permission,
  run: () => Promise<T>,
  fallback: T,
): Promise<T> {
  if (!allows(req, permission)) return fallback;
  return run();
}

async function count(sql: string, params: unknown[] = []): Promise<number> {
  const res = await pool.query<{ n: string }>(sql, params);
  return Number(res.rows[0]?.n ?? 0);
}

/* ------------------------------------------------------------- §19 Attention */

type Severity = "critical" | "warning" | "info";

interface AttentionItem {
  key: string;
  title: string;
  /** The short explanation §19 asks for — consequence, not diagnosis. */
  detail: string;
  count: number;
  severity: Severity;
  actionLabel: string;
  to: string;
}

/**
 * What needs the owner today.
 *
 * Only non-zero rows are returned. §43 rules out empty blank cards, and a
 * "0 failed payments" row trains the eye to skip the panel that exists
 * precisely to be read.
 *
 * Deliberately absent: the "refund requests" row §19 illustrates. This
 * platform has no refund-request record — `orders.refund_request` is a
 * permission to raise one, and refunds are written straight to `refunds` when
 * taken. A row counting nothing would be a number the owner could not act on.
 */
adminDashboardPanelsRouter.get(
  "/attention",
  asyncHandler(async (req, res) => {
    const items: AttentionItem[] = [];

    const [
      failedPayments,
      disputes,
      overdueInstalments,
      abandoned,
      affiliateApplications,
      communityReports,
      overdueSessions,
      failedAutomations,
      deadJobs,
    ] = await Promise.all([
      gated(req, "orders.view", () =>
        count(
          `SELECT COUNT(*)::text AS n FROM transactions
            WHERE kind = 'payment' AND status = 'failed'
              AND occurred_at >= now() - INTERVAL '30 days'`,
        ), 0),
      gated(req, "orders.view", () =>
        count(
          `SELECT COUNT(*)::text AS n FROM transactions
            WHERE (kind = 'dispute' OR status = 'disputed')
              AND occurred_at >= now() - INTERVAL '90 days'`,
        ), 0),
      // 'scheduled' past its due date is an instalment the processor never
      // took; 'failed' is one it tried and could not. Both are money owed on a
      // plan that is still granting access, so they count together.
      gated(req, "orders.view", () =>
        count(
          `SELECT COUNT(*)::text AS n FROM payment_plan_installments
            WHERE (status = 'failed' OR (status = 'scheduled' AND due_at < now()))`,
        ), 0),
      gated(req, "orders.view", () =>
        count(
          `SELECT COUNT(*)::text AS n FROM abandoned_checkouts
            WHERE recovered_order_id IS NULL
              AND created_at >= now() - INTERVAL '7 days'`,
        ), 0),
      gated(req, "orders.view", () =>
        count(`SELECT COUNT(*)::text AS n FROM affiliates WHERE status = 'pending'`), 0),
      gated(req, "community.view", () =>
        count(`SELECT COUNT(*)::text AS n FROM community_reports WHERE status = 'open'`), 0),
      // A session whose time has passed but which nobody marked completed or
      // cancelled: either it happened and needs writing up, or it did not and
      // the credit is still sitting unspent.
      gated(req, "coaching.view", () =>
        count(
          `SELECT COUNT(*)::text AS n FROM coaching_sessions
            WHERE status = 'scheduled' AND scheduled_at < now() - INTERVAL '2 hours'`,
        ), 0),
      gated(req, "marketing.view", () =>
        count(
          `SELECT COUNT(*)::text AS n FROM automation_runs
            WHERE status IN ('failed', 'partial')
              AND created_at >= now() - INTERVAL '7 days'`,
        ), 0),
      // Dead jobs are the quietest failure in the system: the queue stops
      // delivering and nothing else says so. This is the one panel row that
      // exists because of an outage rather than a spec line.
      gated(req, "settings.view", () =>
        count(`SELECT COUNT(*)::text AS n FROM jobs WHERE status = 'dead'`), 0),
    ]);

    const push = (item: AttentionItem) => {
      if (item.count > 0) items.push(item);
    };

    push({
      key: "failed-payments",
      title: "Failed payments",
      detail: "Some customers may lose access if the payment is not recovered.",
      count: failedPayments,
      severity: "critical",
      actionLabel: "Review payments",
      to: "/admin/sales/payments?status=failed",
    });
    push({
      key: "disputes",
      title: "Disputed payments",
      detail: "A card issuer is holding these funds. They have a deadline to respond by.",
      count: disputes,
      severity: "critical",
      actionLabel: "Review disputes",
      to: "/admin/sales/payments?status=disputed",
    });
    push({
      key: "overdue-instalments",
      title: "Overdue instalments",
      detail: "Payment plans with an instalment that has not been collected.",
      count: overdueInstalments,
      severity: "critical",
      actionLabel: "Review plans",
      to: "/admin/sales/plans",
    });
    push({
      key: "dead-jobs",
      title: "Background work that stopped",
      detail: "Emails and reminders in this queue are no longer being delivered.",
      count: deadJobs,
      severity: "critical",
      actionLabel: "Open settings",
      to: "/admin/settings/advanced",
    });
    push({
      key: "community-reports",
      title: "Reported posts",
      detail: "Members have flagged these for you to look at.",
      count: communityReports,
      severity: "warning",
      actionLabel: "Review reports",
      to: "/admin/community",
    });
    push({
      key: "failed-automations",
      title: "Automations that did not finish",
      detail: "Some customers did not get what the automation was meant to do.",
      count: failedAutomations,
      severity: "warning",
      actionLabel: "Review automations",
      to: "/admin/marketing/automations-v2",
    });
    push({
      key: "coaching-followup",
      title: "Coaching sessions to close off",
      detail: "These are past their time and still marked as scheduled.",
      count: overdueSessions,
      severity: "warning",
      actionLabel: "Open calendar",
      to: "/admin/coaching",
    });
    push({
      key: "affiliate-applications",
      title: "Partner applications waiting",
      detail: "Nobody can start referring until you approve them.",
      count: affiliateApplications,
      severity: "info",
      actionLabel: "Review applications",
      to: "/admin/partners",
    });
    push({
      key: "abandoned-checkouts",
      title: "Checkouts left unfinished",
      detail: "People who reached payment this week and did not complete it.",
      count: abandoned,
      severity: "info",
      actionLabel: "See who",
      to: "/admin/sales/payments",
    });

    res.json({ items });
  }),
);

/* ----------------------------------------------------------------- §20 Today */

interface TodayEntry {
  key: string;
  at: string;
  title: string;
  subtitle: string;
  kind: "coaching" | "community-event" | "event";
  to: string;
}

/**
 * Everything scheduled between now and the end of the day, in time order.
 *
 * The window opens at the start of *today* rather than at `now()` so a session
 * that started ten minutes ago is still on the list — it is the one the owner
 * is most likely to be looking for.
 */
adminDashboardPanelsRouter.get(
  "/today",
  asyncHandler(async (req, res) => {
    const [coaching, communityEvents, events] = await Promise.all([
      gated(
        req,
        "coaching.view",
        async () =>
          (
            await pool.query<{
              id: number;
              scheduled_at: Date;
              title: string | null;
              name: string | null;
              email: string | null;
              duration_minutes: number;
            }>(
              `SELECT s.id, s.scheduled_at, o.title, m.name, m.email, s.duration_minutes
                 FROM coaching_sessions s
                 LEFT JOIN coaching_offers o ON o.id = s.offer_id
                 LEFT JOIN members m         ON m.id = s.member_id
                WHERE s.status = 'scheduled'
                  AND s.scheduled_at >= date_trunc('day', now())
                  AND s.scheduled_at <  date_trunc('day', now()) + INTERVAL '1 day'
                ORDER BY s.scheduled_at`,
            )
          ).rows,
        [],
      ),
      gated(
        req,
        "community.view",
        async () =>
          (
            await pool.query<{ id: number; starts_at: Date; title: string; community: string | null }>(
              `SELECT e.id, e.starts_at, e.title, c.name AS community
                 FROM community_events e
                 LEFT JOIN communities c ON c.id = e.community_id
                WHERE e.published
                  AND e.starts_at >= date_trunc('day', now())
                  AND e.starts_at <  date_trunc('day', now()) + INTERVAL '1 day'
                ORDER BY e.starts_at`,
            )
          ).rows,
        [],
      ),
      gated(
        req,
        "marketing.view",
        async () =>
          (
            await pool.query<{ id: number; slug: string; starts_at: Date; title: string; registered: string }>(
              `SELECT e.id, e.slug, e.starts_at, e.title,
                      (SELECT COUNT(*)::text FROM event_registrations r WHERE r.event_id = e.id) AS registered
                 FROM events e
                WHERE e.published AND e.kind = 'live'
                  AND e.starts_at >= date_trunc('day', now())
                  AND e.starts_at <  date_trunc('day', now()) + INTERVAL '1 day'
                ORDER BY e.starts_at`,
            )
          ).rows,
        [],
      ),
    ]);

    const entries: TodayEntry[] = [
      ...coaching.map((row) => ({
        key: `coaching-${row.id}`,
        at: row.scheduled_at.toISOString(),
        title: row.title || "Coaching session",
        subtitle: row.name || row.email || "Unassigned",
        kind: "coaching" as const,
        to: "/admin/coaching",
      })),
      ...communityEvents.map((row) => ({
        key: `community-event-${row.id}`,
        at: row.starts_at.toISOString(),
        title: row.title,
        subtitle: row.community || "Community",
        kind: "community-event" as const,
        to: "/admin/marketing/events",
      })),
      ...events.map((row) => ({
        key: `event-${row.id}`,
        at: row.starts_at.toISOString(),
        title: row.title,
        subtitle: `${row.registered} registered`,
        kind: "event" as const,
        to: "/admin/marketing/events-v2",
      })),
    ].sort((a, b) => a.at.localeCompare(b.at));

    res.json({ entries });
  }),
);

/* ------------------------------------------------- §21–§30 the rest of home */

const pulseQuery = z.object({ days: z.coerce.number().int().min(2).max(365).optional() });

/**
 * One request for the eight summary panels below the fold.
 *
 * Individually these are eight small queries; as eight endpoints they are
 * eight round trips, eight auth checks and eight chances for a partially
 * rendered dashboard. Each section is independently permission-gated and
 * independently absent, so the shape the browser gets already describes what
 * this operator is allowed to see.
 */
adminDashboardPanelsRouter.get(
  "/pulse",
  asyncHandler(async (req, res) => {
    const parsed = pulseQuery.safeParse(req.query);
    if (!parsed.success) throw badRequest("Check the date range.", parsed.error.flatten());
    const days = parsed.data.days ?? 30;
    const since = `${days} days`;

    const body: Record<string, unknown> = {};

    /* §21 Program performance — one row per sellable product that has members. */
    if (allows(req, "products.view")) {
      const programs = await pool.query<{
        id: number;
        title: string;
        kind: string;
        members: string;
        revenue_cents: string;
        completion: string | null;
      }>(
        `SELECT p.id,
                p.title,
                p.kind,
                (SELECT COUNT(*)::text FROM access_grants g
                  WHERE g.product_id = p.id AND g.status = 'active') AS members,
                (SELECT COALESCE(SUM(oi.amount_cents), 0)::text
                   FROM order_items oi
                   JOIN orders o ON o.id = oi.order_id
                  WHERE oi.product_id = p.id
                    -- 'refunded' counts as a sale here for the same reason the
                    -- nightly rollup counts it: the money moved, and a program
                    -- whose revenue silently drops on refund cannot be
                    -- reconciled against the ledger (Part IV).
                    AND o.status IN ('paid', 'refunded')
                    AND o.created_at >= now() - $1::interval) AS revenue_cents,
                -- Average completion across everyone enrolled on the course
                -- behind this product. Null for a product with no course, which
                -- is not the same as 0% and must not render as a full-width
                -- empty progress bar.
                (SELECT ROUND(AVG(e.progress))::text
                   FROM enrollments e
                  WHERE p.course_id IS NOT NULL AND e.course_id = p.course_id) AS completion
           FROM products p
          WHERE p.status = 'published'
          ORDER BY (SELECT COUNT(*) FROM access_grants g
                     WHERE g.product_id = p.id AND g.status = 'active') DESC,
                   p.title
          LIMIT 6`,
        [since],
      );

      body.programs = programs.rows.map((row) => ({
        id: row.id,
        title: row.title,
        kind: row.kind,
        members: Number(row.members),
        revenueCents: Number(row.revenue_cents),
        completionPercent: row.completion === null ? null : Number(row.completion),
      }));
    }

    /* §22–§23 Sales overview and the recent-sales table. */
    if (allows(req, "orders.view")) {
      const [summary, recent] = await Promise.all([
        pool.query<{
          purchases: string;
          refunds: string;
          upsells: string;
          recovered: string;
          abandoned: string;
        }>(
          `SELECT
             (SELECT COUNT(*)::text FROM orders
               WHERE status IN ('paid', 'refunded')
                 AND created_at >= now() - $1::interval) AS purchases,
             (SELECT COUNT(*)::text FROM refunds
               WHERE created_at >= now() - $1::interval) AS refunds,
             (SELECT COUNT(*)::text FROM orders
               WHERE status IN ('paid', 'refunded') AND parent_order_id IS NOT NULL
                 AND created_at >= now() - $1::interval) AS upsells,
             (SELECT COUNT(*)::text FROM abandoned_checkouts
               WHERE recovered_order_id IS NOT NULL
                 AND recovered_at >= now() - $1::interval) AS recovered,
             (SELECT COUNT(*)::text FROM abandoned_checkouts
               WHERE created_at >= now() - $1::interval) AS abandoned`,
          [since],
        ),
        pool.query<{
          id: number;
          email: string;
          name: string | null;
          offer: string | null;
          pricing_type: string | null;
          total_cents: string;
          currency: string;
          status: string;
          created_at: Date;
        }>(
          `SELECT o.id,
                  o.email,
                  COALESCE(NULLIF(o.billing_name, ''), c.name) AS name,
                  COALESCE(f.title, o.course_title)            AS offer,
                  f.pricing_type,
                  GREATEST(o.total_cents, o.amount_cents)::text AS total_cents,
                  o.currency,
                  o.status,
                  o.created_at
             FROM orders o
             LEFT JOIN offers   f ON f.id = o.offer_id
             LEFT JOIN contacts c ON c.id = o.contact_id
            ORDER BY o.created_at DESC
            LIMIT 8`,
        ),
      ]);

      const s = summary.rows[0];
      body.sales = {
        purchases: Number(s?.purchases ?? 0),
        refunds: Number(s?.refunds ?? 0),
        upsells: Number(s?.upsells ?? 0),
        recoveredCheckouts: Number(s?.recovered ?? 0),
        abandonedCheckouts: Number(s?.abandoned ?? 0),
        recent: recent.rows.map((row) => ({
          id: row.id,
          customer: row.name || row.email,
          email: row.email,
          offer: row.offer || "—",
          // §23's "Type" column. A legacy order predates offers entirely and
          // has no pricing type to report.
          type: row.pricing_type || "one_time",
          amountCents: Number(row.total_cents),
          currency: row.currency,
          status: row.status,
          at: row.created_at.toISOString(),
        })),
      };
    }

    /* §24 Contacts overview. */
    if (allows(req, "contacts.view")) {
      const contacts = await pool.query<{
        total: string;
        new_this_period: string;
        members: string;
        subscribed: string;
        top_name: string | null;
        top_email: string | null;
        top_value: string | null;
      }>(
        `SELECT
           (SELECT COUNT(*)::text FROM contacts) AS total,
           (SELECT COUNT(*)::text FROM contacts
             WHERE created_at >= now() - $1::interval) AS new_this_period,
           (SELECT COUNT(*)::text FROM members WHERE status = 'active') AS members,
           (SELECT COUNT(*)::text FROM contacts
             WHERE email_marketing_status = 'subscribed') AS subscribed,
           t.name, t.email, t.lifetime_value_cents::text
         FROM (SELECT name, email, lifetime_value_cents FROM contacts
                ORDER BY lifetime_value_cents DESC NULLS LAST LIMIT 1) t`,
        [since],
      );

      // The subquery is a LATERAL-free join against exactly one row, so an
      // empty contacts table yields no rows at all rather than a row of zeros.
      const c = contacts.rows[0];
      body.contacts = {
        total: Number(c?.total ?? 0),
        newThisPeriod: Number(c?.new_this_period ?? 0),
        members: Number(c?.members ?? 0),
        subscribed: Number(c?.subscribed ?? 0),
        topCustomer: c?.top_email
          ? {
              name: c.top_name || c.top_email,
              email: c.top_email,
              lifetimeValueCents: Number(c.top_value ?? 0),
            }
          : null,
      };
    }

    /* §25 Marketing performance, and §26 course performance. */
    if (allows(req, "marketing.view")) {
      const marketing = await pool.query<{
        sends: string;
        opens: string;
        clicks: string;
        unsubs: string;
        sequences: string;
        automations: string;
      }>(
        `SELECT
           (SELECT COALESCE(SUM(value_count), 0)::text FROM report_daily
             WHERE metric = 'email_sends'  AND dimension = ''
               AND day >= (now() - $1::interval)::date) AS sends,
           (SELECT COALESCE(SUM(value_count), 0)::text FROM report_daily
             WHERE metric = 'email_opens'  AND dimension = ''
               AND day >= (now() - $1::interval)::date) AS opens,
           (SELECT COALESCE(SUM(value_count), 0)::text FROM report_daily
             WHERE metric = 'email_clicks' AND dimension = ''
               AND day >= (now() - $1::interval)::date) AS clicks,
           (SELECT COALESCE(SUM(value_count), 0)::text FROM report_daily
             WHERE metric = 'email_unsubs' AND dimension = ''
               AND day >= (now() - $1::interval)::date) AS unsubs,
           (SELECT COUNT(*)::text FROM email_sequences WHERE status = 'active') AS sequences,
           (SELECT COUNT(*)::text FROM automations    WHERE status = 'active') AS automations`,
        [since],
      );

      const m = marketing.rows[0];
      const sends = Number(m?.sends ?? 0);
      // Rates are computed here rather than in the browser so every surface
      // that shows an open rate divides by the same denominator.
      const rate = (n: number) => (sends === 0 ? null : Math.round((n / sends) * 1000) / 10);
      body.marketing = {
        sends,
        opens: Number(m?.opens ?? 0),
        clicks: Number(m?.clicks ?? 0),
        unsubscribes: Number(m?.unsubs ?? 0),
        openRate: rate(Number(m?.opens ?? 0)),
        clickRate: rate(Number(m?.clicks ?? 0)),
        unsubscribeRate: rate(Number(m?.unsubs ?? 0)),
        activeSequences: Number(m?.sequences ?? 0),
        activeAutomations: Number(m?.automations ?? 0),
      };
    }

    if (allows(req, "products.view")) {
      const courses = await pool.query<{
        id: number;
        title: string;
        learners: string;
        completion: string | null;
      }>(
        `SELECT c.id, c.title,
                COUNT(e.id)::text          AS learners,
                ROUND(AVG(e.progress))::text AS completion
           FROM courses c
           JOIN enrollments e ON e.course_id = c.id
          WHERE c.published
          GROUP BY c.id, c.title
          ORDER BY COUNT(e.id) DESC
          LIMIT 5`,
      );
      body.courses = courses.rows.map((row) => ({
        id: row.id,
        title: row.title,
        learners: Number(row.learners),
        completionPercent: row.completion === null ? 0 : Number(row.completion),
      }));
    }

    /* §27 Coaching summary. */
    if (allows(req, "coaching.view")) {
      const coaching = await pool.query<{
        today: string;
        this_week: string;
        completed: string;
        cancelled: string;
        upcoming: string;
      }>(
        `SELECT
           COUNT(*) FILTER (
             WHERE scheduled_at >= date_trunc('day', now())
               AND scheduled_at <  date_trunc('day', now()) + INTERVAL '1 day')::text AS today,
           COUNT(*) FILTER (
             WHERE scheduled_at >= date_trunc('week', now())
               AND scheduled_at <  date_trunc('week', now()) + INTERVAL '1 week')::text AS this_week,
           COUNT(*) FILTER (
             WHERE status = 'completed'
               AND scheduled_at >= now() - $1::interval)::text AS completed,
           COUNT(*) FILTER (
             WHERE status = 'cancelled'
               AND scheduled_at >= now() - $1::interval)::text AS cancelled,
           COUNT(*) FILTER (
             WHERE status = 'scheduled' AND scheduled_at >= now())::text AS upcoming
         FROM coaching_sessions`,
        [since],
      );

      const next = await pool.query<{
        id: number;
        scheduled_at: Date;
        title: string | null;
        name: string | null;
        email: string | null;
      }>(
        `SELECT s.id, s.scheduled_at, o.title, m.name, m.email
           FROM coaching_sessions s
           LEFT JOIN coaching_offers o ON o.id = s.offer_id
           LEFT JOIN members m         ON m.id = s.member_id
          WHERE s.status = 'scheduled' AND s.scheduled_at >= now()
          ORDER BY s.scheduled_at
          LIMIT 3`,
      );

      const k = coaching.rows[0];
      body.coaching = {
        today: Number(k?.today ?? 0),
        thisWeek: Number(k?.this_week ?? 0),
        completed: Number(k?.completed ?? 0),
        cancelled: Number(k?.cancelled ?? 0),
        upcoming: Number(k?.upcoming ?? 0),
        next: next.rows.map((row) => ({
          id: row.id,
          at: row.scheduled_at.toISOString(),
          title: row.title || "Coaching session",
          member: row.name || row.email || "Unassigned",
        })),
      };
    }

    /* §28 Community summary. */
    if (allows(req, "community.view")) {
      const community = await pool.query<{
        active_members: string;
        posts: string;
        comments: string;
        reported: string;
      }>(
        `SELECT
           (SELECT COUNT(*)::text FROM community_memberships) AS active_members,
           (SELECT COUNT(*)::text FROM community_posts
             WHERE status = 'visible' AND created_at >= now() - INTERVAL '7 days') AS posts,
           (SELECT COUNT(*)::text FROM community_comments
             WHERE status = 'visible' AND created_at >= now() - INTERVAL '7 days') AS comments,
           (SELECT COUNT(*)::text FROM community_reports WHERE status = 'open') AS reported`,
      );
      const cm = community.rows[0];
      body.community = {
        activeMembers: Number(cm?.active_members ?? 0),
        postsThisWeek: Number(cm?.posts ?? 0),
        commentsThisWeek: Number(cm?.comments ?? 0),
        reportedPosts: Number(cm?.reported ?? 0),
      };
    }

    /* §29 Applications. The spec's four buckets are New / Reviewing /
       Approved / Follow-up; this system's enquiry lifecycle is the five
       states the Leads screen already uses, so the real vocabulary is
       reported rather than a mapping invented to fit the illustration. */
    if (allows(req, "contacts.view")) {
      const applications = await pool.query<{ status: string; n: string }>(
        `SELECT status, COUNT(*)::text AS n
           FROM leads
          WHERE created_at >= now() - $1::interval
          GROUP BY status`,
        [since],
      );
      body.applications = applications.rows.map((row) => ({
        status: row.status,
        count: Number(row.n),
      }));
    }

    /* §30 Recent activity — the unified contact timeline the platform already
       writes to on every purchase, lesson, email and booking. */
    if (allows(req, "contacts.view")) {
      const activity = await pool.query<{
        id: number;
        kind: string;
        title: string;
        occurred_at: Date;
        contact_id: number | null;
        name: string | null;
        email: string | null;
      }>(
        `SELECT a.id, a.kind, a.title, a.occurred_at, a.contact_id, c.name, c.email
           FROM contact_activity a
           LEFT JOIN contacts c ON c.id = a.contact_id
          ORDER BY a.occurred_at DESC
          LIMIT 12`,
      );
      body.activity = activity.rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        title: row.title,
        at: row.occurred_at.toISOString(),
        contactId: row.contact_id,
        person: row.name || row.email || "Someone",
      }));
    }

    res.json({ days, ...body });
  }),
);
