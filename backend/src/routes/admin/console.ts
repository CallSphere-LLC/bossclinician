import { Router, type Request } from "express";
import { z } from "zod";
import { pool } from "../../db/pool";
import { asyncHandler } from "../../utils/asyncHandler";
import { badRequest } from "../../utils/httpError";
import { can, type Permission } from "../../services/permissions";

/**
 * Console-wide services: the global search box and the notification feed.
 *
 * Both are Part II header features (§10, §42) and both cross every module, so
 * like the dashboard panels they are assembled per-caller rather than gated at
 * a mount point. A Support account searching "jane" must find her contact
 * record and her orders; it must not find the offer pricing it cannot open.
 */

function allows(req: Request, permission: Permission): boolean {
  return can(req.user?.role ?? "", permission);
}

/* ------------------------------------------------------------ §10 search */

export const adminSearchRouter = Router();

const searchQuery = z.object({
  q: z.string().trim().min(1).max(120),
  limit: z.coerce.number().int().min(1).max(20).optional(),
});

interface SearchHit {
  kind: "contact" | "order" | "product" | "offer";
  id: number;
  title: string;
  subtitle: string;
  to: string;
}

/**
 * One box over contacts, orders, products and offers — the four things §10
 * names.
 *
 * ILIKE with a leading wildcard cannot use a b-tree index, so each arm is
 * capped hard and the whole thing is capped again on the way out. This is a
 * type-ahead over a five-figure contact table, not a report: the right answer
 * is the first handful, fast.
 *
 * The term is passed as a bind parameter and the wildcards are added here, so
 * a search for "50%" is a search for the characters and not a pattern.
 */
adminSearchRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = searchQuery.safeParse(req.query);
    if (!parsed.success) throw badRequest("Type something to search for.");
    const { q, limit = 6 } = parsed.data;

    // Escape the LIKE metacharacters so a literal _ or % is searched for
    // rather than treated as a wildcard.
    const pattern = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;

    const [contacts, orders, products, offers] = await Promise.all([
      allows(req, "contacts.view")
        ? pool.query<{ id: number; name: string | null; email: string; ltv: string }>(
            `SELECT id, name, email, lifetime_value_cents::text AS ltv
               FROM contacts
              WHERE email ILIKE $1 ESCAPE '\\' OR name ILIKE $1 ESCAPE '\\'
              ORDER BY last_activity_at DESC NULLS LAST
              LIMIT $2`,
            [pattern, limit],
          )
        : null,
      allows(req, "orders.view")
        ? pool.query<{
            id: number;
            email: string;
            title: string | null;
            cents: string;
            currency: string;
            status: string;
          }>(
            `SELECT o.id, o.email,
                    COALESCE(f.title, o.course_title) AS title,
                    GREATEST(o.total_cents, o.amount_cents)::text AS cents,
                    o.currency, o.status
               FROM orders o
               LEFT JOIN offers f ON f.id = o.offer_id
              WHERE o.email ILIKE $1 ESCAPE '\\'
                 OR o.billing_name ILIKE $1 ESCAPE '\\'
                 OR COALESCE(f.title, o.course_title) ILIKE $1 ESCAPE '\\'
                 OR o.id::text = $3
              ORDER BY o.created_at DESC
              LIMIT $2`,
            [pattern, limit, q],
          )
        : null,
      allows(req, "products.view")
        ? pool.query<{ id: number; title: string; kind: string; status: string }>(
            `SELECT id, title, kind, status FROM products
              WHERE title ILIKE $1 ESCAPE '\\'
              ORDER BY status = 'published' DESC, title
              LIMIT $2`,
            [pattern, limit],
          )
        : null,
      allows(req, "offers.view")
        ? pool.query<{ id: number; title: string; pricing_type: string; status: string }>(
            `SELECT id, title, pricing_type, status FROM offers
              WHERE title ILIKE $1 ESCAPE '\\'
              ORDER BY status = 'published' DESC, title
              LIMIT $2`,
            [pattern, limit],
          )
        : null,
    ]);

    const hits: SearchHit[] = [
      ...(contacts?.rows ?? []).map((row) => ({
        kind: "contact" as const,
        id: row.id,
        title: row.name || row.email,
        subtitle: row.name ? row.email : "Contact",
        to: `/admin/contacts/${row.id}`,
      })),
      ...(orders?.rows ?? []).map((row) => ({
        kind: "order" as const,
        id: row.id,
        title: `Order #${row.id} · ${row.title ?? "Purchase"}`,
        subtitle: `${row.email} · ${row.status}`,
        to: "/admin/sales/payments",
      })),
      ...(products?.rows ?? []).map((row) => ({
        kind: "product" as const,
        id: row.id,
        title: row.title,
        subtitle: `${row.kind} · ${row.status}`,
        to: "/admin/products",
      })),
      ...(offers?.rows ?? []).map((row) => ({
        kind: "offer" as const,
        id: row.id,
        title: row.title,
        subtitle: `${row.pricing_type.replace(/_/g, " ")} · ${row.status}`,
        to: `/admin/offers/${row.id}`,
      })),
    ];

    res.json({ query: q, hits });
  }),
);

/* ----------------------------------------------------- §42 notifications */

export const adminNotificationsRouter = Router();

const notificationsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export type NotificationCategory =
  | "sales"
  | "payments"
  | "customers"
  | "coaching"
  | "community"
  | "marketing"
  | "system";

interface Notification {
  id: string;
  category: NotificationCategory;
  title: string;
  detail: string;
  at: string;
  to: string;
}

/**
 * The notification feed, derived rather than stored.
 *
 * §42 asks for a header dropdown and a page, in seven categories. This system
 * has no admin notification table, and inventing one would mean a writer on
 * every path that can produce an event — a large change with a migration, a
 * backfill, and a new way for the queue to fall behind.
 *
 * The events themselves are already recorded: orders, failed charges,
 * enquiries, bookings, moderation reports and automation failures all have
 * rows with timestamps. So the feed is a union over those, ordered by time.
 * It is exact, it needs no backfill, and it cannot drift from the records it
 * describes. Read state is per-operator and lives in the browser — a
 * last-seen timestamp — because it is a preference, not a fact about the
 * business.
 *
 * Each arm is capped before the union so one very busy source cannot crowd out
 * the others.
 */
adminNotificationsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = notificationsQuery.safeParse(req.query);
    if (!parsed.success) throw badRequest("Check the request.");
    const limit = parsed.data.limit ?? 30;
    const per = Math.min(12, limit);

    const notifications: Notification[] = [];

    const [sales, payments, customers, coaching, community, marketing] = await Promise.all([
      allows(req, "orders.view")
        ? pool.query<{ id: number; email: string; title: string | null; cents: string; currency: string; created_at: Date }>(
            `SELECT o.id, o.email, COALESCE(f.title, o.course_title) AS title,
                    GREATEST(o.total_cents, o.amount_cents)::text AS cents,
                    o.currency, o.created_at
               FROM orders o
               LEFT JOIN offers f ON f.id = o.offer_id
              WHERE o.status IN ('paid', 'refunded')
              ORDER BY o.created_at DESC LIMIT $1`,
            [per],
          )
        : null,
      allows(req, "orders.view")
        ? pool.query<{ id: number; email: string; reason: string; occurred_at: Date }>(
            `SELECT id, email, failure_reason AS reason, occurred_at
               FROM transactions
              WHERE kind = 'payment' AND status = 'failed'
              ORDER BY occurred_at DESC LIMIT $1`,
            [per],
          )
        : null,
      allows(req, "contacts.view")
        ? pool.query<{ id: number; name: string | null; email: string; created_at: Date }>(
            `SELECT id, name, email, created_at FROM leads
              ORDER BY created_at DESC LIMIT $1`,
            [per],
          )
        : null,
      allows(req, "coaching.view")
        ? pool.query<{ id: number; name: string | null; email: string | null; title: string | null; scheduled_at: Date; booked_at: Date | null; created_at: Date }>(
            `SELECT s.id, m.name, m.email, o.title, s.scheduled_at, s.booked_at, s.created_at
               FROM coaching_sessions s
               LEFT JOIN members m         ON m.id = s.member_id
               LEFT JOIN coaching_offers o ON o.id = s.offer_id
              ORDER BY COALESCE(s.booked_at, s.created_at) DESC LIMIT $1`,
            [per],
          )
        : null,
      allows(req, "community.view")
        ? pool.query<{ id: number; reason: string; created_at: Date }>(
            `SELECT id, reason, created_at FROM community_reports
              WHERE status = 'open'
              ORDER BY created_at DESC LIMIT $1`,
            [per],
          )
        : null,
      allows(req, "marketing.view")
        ? pool.query<{ id: number; name: string; status: string; created_at: Date }>(
            `SELECT r.id, a.name, r.status, r.created_at
               FROM automation_runs r
               JOIN automations a ON a.id = r.automation_id
              WHERE r.status IN ('failed', 'partial')
              ORDER BY r.created_at DESC LIMIT $1`,
            [per],
          )
        : null,
    ]);

    const money = (cents: string, currency: string) => {
      const amount = (Number(cents) / 100).toFixed(2);
      return `${currency.toUpperCase()} ${amount}`;
    };

    for (const row of sales?.rows ?? []) {
      notifications.push({
        id: `sale-${row.id}`,
        category: "sales",
        title: `${row.title ?? "Purchase"} — ${money(row.cents, row.currency)}`,
        detail: row.email,
        at: row.created_at.toISOString(),
        to: "/admin/sales/payments",
      });
    }
    for (const row of payments?.rows ?? []) {
      notifications.push({
        id: `payment-${row.id}`,
        category: "payments",
        title: "Payment failed",
        detail: row.reason ? `${row.email} — ${row.reason}` : row.email,
        at: row.occurred_at.toISOString(),
        to: "/admin/sales/payments",
      });
    }
    for (const row of customers?.rows ?? []) {
      notifications.push({
        id: `lead-${row.id}`,
        category: "customers",
        title: "New application",
        detail: row.name || row.email,
        at: row.created_at.toISOString(),
        to: "/admin/leads",
      });
    }
    for (const row of coaching?.rows ?? []) {
      notifications.push({
        id: `coaching-${row.id}`,
        category: "coaching",
        title: `${row.title ?? "Coaching session"} booked`,
        detail: `${row.name || row.email || "A member"} — ${row.scheduled_at.toISOString().slice(0, 10)}`,
        at: (row.booked_at ?? row.created_at).toISOString(),
        to: "/admin/coaching",
      });
    }
    for (const row of community?.rows ?? []) {
      notifications.push({
        id: `report-${row.id}`,
        category: "community",
        title: "Post reported",
        detail: row.reason || "A member flagged a post",
        at: row.created_at.toISOString(),
        to: "/admin/community",
      });
    }
    for (const row of marketing?.rows ?? []) {
      notifications.push({
        id: `automation-${row.id}`,
        category: "marketing",
        title: `Automation ${row.status}`,
        detail: row.name,
        at: row.created_at.toISOString(),
        to: "/admin/marketing/automations-v2",
      });
    }

    // Only the owner and a manager see infrastructure trouble; it is not
    // actionable by anyone else and reads as alarm without a remedy.
    if (allows(req, "settings.manage")) {
      const dead = await pool.query<{ n: string; latest: Date | null }>(
        `SELECT COUNT(*)::text AS n, MAX(updated_at) AS latest FROM jobs WHERE status = 'dead'`,
      );
      const n = Number(dead.rows[0]?.n ?? 0);
      if (n > 0 && dead.rows[0]?.latest) {
        notifications.push({
          id: "system-dead-jobs",
          category: "system",
          title: `${n} background ${n === 1 ? "job has" : "jobs have"} stopped`,
          detail: "Emails and reminders in this queue are no longer being delivered.",
          at: dead.rows[0].latest.toISOString(),
          to: "/admin/settings/advanced",
        });
      }
    }

    notifications.sort((a, b) => b.at.localeCompare(a.at));
    res.json({ notifications: notifications.slice(0, limit) });
  }),
);
