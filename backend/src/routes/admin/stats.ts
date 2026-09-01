import { Router } from "express";
import { pool } from "../../db/pool";
import { rowsToCamel } from "../../utils/case";
import { asyncHandler } from "../../utils/asyncHandler";
import {
  MAILABLE_CONTACT_COUNT_SQL,
  MAILABLE_CONTACT_SERIES_SQL,
} from "../../services/audience";

export const statsRouter = Router();

statsRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const [leads, subscribers, posts, chats] = await Promise.all([
      pool.query("SELECT COUNT(*)::int AS count FROM leads"),
      pool.query(`SELECT ${MAILABLE_CONTACT_COUNT_SQL} AS count`),
      pool.query("SELECT COUNT(*)::int AS count FROM blog_posts WHERE published = true"),
      pool.query("SELECT COUNT(*)::int AS count FROM chat_sessions"),
    ]);

    const [newLeads, courses, testimonials, resources] = await Promise.all([
      pool.query("SELECT COUNT(*)::int AS count FROM leads WHERE status = 'new'"),
      pool.query("SELECT COUNT(*)::int AS count FROM courses WHERE published = true"),
      pool.query("SELECT COUNT(*)::int AS count FROM testimonials WHERE published = true"),
      pool.query("SELECT COUNT(*)::int AS count FROM resources WHERE published = true"),
    ]);

    res.json({
      leads: leads.rows[0].count,
      subscribers: subscribers.rows[0].count,
      posts: posts.rows[0].count,
      chats: chats.rows[0].count,
      newLeads: newLeads.rows[0].count,
      courses: courses.rows[0].count,
      testimonials: testimonials.rows[0].count,
      resources: resources.rows[0].count,
    });
  })
);

/**
 * GET /admin/stats/overview — everything the dashboard needs in one round trip.
 *
 * The daily series is built off generate_series so days with no activity come
 * back as explicit zeros; charting a sparse array would silently misdraw the
 * shape of the trend.
 */
statsRouter.get(
  "/overview",
  asyncHandler(async (_req, res) => {
    const [totals, series, leadsByStatus, recentLeads, topCourses, revenue] = await Promise.all([
      pool.query(
        `SELECT
           (SELECT COUNT(*)::int FROM leads)                             AS leads,
           (SELECT COUNT(*)::int FROM leads WHERE status = 'new')        AS new_leads,
           ${MAILABLE_CONTACT_COUNT_SQL}                                 AS subscribers,
           (SELECT COUNT(*)::int FROM blog_posts WHERE published = true) AS posts,
           (SELECT COUNT(*)::int FROM chat_sessions)                     AS chats,
           (SELECT COUNT(*)::int FROM courses WHERE published = true)    AS courses,
           (SELECT COUNT(*)::int FROM members)                           AS members,
           (SELECT COUNT(*)::int FROM enrollments)                       AS enrollments,
           (SELECT COUNT(*)::int FROM course_lessons)                    AS lessons,
           (SELECT COUNT(*)::int FROM media_assets)                      AS media,
           (SELECT COALESCE(SUM(size_bytes), 0)::bigint FROM media_assets) AS storage_bytes`,
      ),
      pool.query(
        `WITH days AS (
           SELECT generate_series(CURRENT_DATE - INTERVAL '29 days', CURRENT_DATE, INTERVAL '1 day')::date AS day
         ),
         l AS (
           SELECT created_at::date AS day, COUNT(*)::int AS c FROM leads
           WHERE created_at >= CURRENT_DATE - INTERVAL '29 days' GROUP BY 1
         ),
         s AS (
           ${MAILABLE_CONTACT_SERIES_SQL}
         ),
         o AS (
           SELECT created_at::date AS day, COALESCE(SUM(amount_cents), 0)::int AS cents FROM orders
           WHERE status = 'paid' AND created_at >= CURRENT_DATE - INTERVAL '29 days' GROUP BY 1
         )
         SELECT to_char(d.day, 'YYYY-MM-DD') AS date,
                COALESCE(l.c, 0)     AS leads,
                COALESCE(s.c, 0)     AS subscribers,
                COALESCE(o.cents, 0) AS revenue_cents
         FROM days d
         LEFT JOIN l ON l.day = d.day
         LEFT JOIN s ON s.day = d.day
         LEFT JOIN o ON o.day = d.day
         ORDER BY d.day`,
      ),
      pool.query(
        "SELECT status, COUNT(*)::int AS count FROM leads GROUP BY status ORDER BY count DESC",
      ),
      pool.query(
        "SELECT id, name, email, source, status, created_at FROM leads ORDER BY created_at DESC LIMIT 6",
      ),
      pool.query(
        `SELECT c.id, c.title, COUNT(e.id)::int AS enrollments
         FROM courses c LEFT JOIN enrollments e ON e.course_id = c.id
         GROUP BY c.id, c.title ORDER BY enrollments DESC, c.sort LIMIT 5`,
      ),
      pool.query(
        `SELECT
           COALESCE(SUM(amount_cents) FILTER (WHERE status = 'paid'), 0)::int AS total_cents,
           COALESCE(SUM(amount_cents) FILTER (WHERE status = 'paid'
             AND created_at >= CURRENT_DATE - INTERVAL '30 days'), 0)::int     AS last30_cents,
           COUNT(*) FILTER (WHERE status = 'paid')::int                        AS paid_orders
         FROM orders`,
      ),
    ]);

    const totalsRow = totals.rows[0] as Record<string, unknown>;

    res.json({
      totals: {
        leads: Number(totalsRow.leads),
        newLeads: Number(totalsRow.new_leads),
        subscribers: Number(totalsRow.subscribers),
        posts: Number(totalsRow.posts),
        chats: Number(totalsRow.chats),
        courses: Number(totalsRow.courses),
        members: Number(totalsRow.members),
        enrollments: Number(totalsRow.enrollments),
        lessons: Number(totalsRow.lessons),
        media: Number(totalsRow.media),
        storageBytes: Number(totalsRow.storage_bytes),
      },
      revenue: {
        totalCents: Number(revenue.rows[0].total_cents),
        last30Cents: Number(revenue.rows[0].last30_cents),
        paidOrders: Number(revenue.rows[0].paid_orders),
      },
      series: rowsToCamel(series.rows),
      leadsByStatus: rowsToCamel(leadsByStatus.rows),
      recentLeads: rowsToCamel(recentLeads.rows),
      topCourses: rowsToCamel(topCourses.rows),
    });
  })
);
