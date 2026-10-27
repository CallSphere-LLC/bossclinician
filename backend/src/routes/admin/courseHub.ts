import { Router, type Request } from "express";
import { adminCourseAddonsRouter } from "./courseAddons";
import { z } from "zod";
import { pool } from "../../db/pool";
import { rowsToCamel } from "../../utils/case";
import { asyncHandler } from "../../utils/asyncHandler";
import { badRequest, notFound } from "../../utils/httpError";
import { recordAdminAction } from "../../services/adminAudit";
import { PRODUCT_CONTENT_COURSE_ID } from "../../services/access";
import { ensureCourseProduct } from "../../services/courseProduct";

/**
 * Kajabi's tabs across the top of every course: Outline, Offers, Customers,
 * Settings (sheet row 160). Outline is the curriculum router; this is the rest.
 *
 * Mounted at /admin/courses/:courseId/hub — three segments, so it never
 * competes with the CRUD router's `/:id`, the same way the preview is mounted.
 *
 * Read-mostly on purpose. Attaching an offer, creating one, giving somebody
 * access and scheduling a community event all go through the routers that
 * already own those writes (offers, community), so a grant made from a course
 * expands bundles, honours expiry and is audited exactly as one made anywhere
 * else. The only writes here are the course's own: its product, its community
 * link and its list of live sessions.
 */
export const adminCourseHubRouter = Router({ mergeParams: true });
adminCourseHubRouter.use("/add-ons", adminCourseAddonsRouter);

/** Read off a `Request` rather than the route's own params: `:courseId` is the
 * parent router's, and the typed params of "/offers" don't know about it. */
function courseIdOf(req: Request): number {
  const id = Number(req.params.courseId);
  if (!Number.isInteger(id) || id < 1) throw badRequest("Invalid course id");
  return id;
}

async function loadCourse(id: number): Promise<{ id: number; title: string; published: boolean; community_id: number | null }> {
  const result = await pool.query<{ id: number; title: string; published: boolean; community_id: number | null }>(
    `SELECT id, title, published, community_id FROM courses WHERE id = $1`,
    [id],
  );
  const row = result.rows[0];
  if (!row) throw notFound("Course not found");
  return row;
}

/** The products whose grants open this course, as a CTE body ($1 = course id). */
const COURSE_PRODUCTS = `SELECT p.id, p.title, p.kind, p.status FROM products p WHERE ${PRODUCT_CONTENT_COURSE_ID} = $1`;

/**
 * Whether a community has a door — the same three facts access.ts reads
 * (`COMMUNITY_IS_SOLD`, not exported): a paid flag, a community product, or a
 * plan. A free room needs nothing attached for a student to walk in.
 */
const COMMUNITY_IS_SOLD = `(
       c.access = 'paid'
    OR EXISTS (SELECT 1 FROM products sp WHERE sp.community_id = c.id AND sp.kind = 'community')
    OR EXISTS (SELECT 1 FROM plans pl WHERE pl.community_id = c.id)
  )`;

/* ------------------------------------------------------------------ offers */

/**
 * GET /offers — every offer that hands this course over.
 *
 * Directly, or through a bundle that contains the course product (access.ts
 * expands bundles one level, so a bundle offer really does grant it). A bundle
 * offer is listed with the bundle's name so the tab can say why it is there and
 * that detaching it means editing the bundle, not the offer.
 */
adminCourseHubRouter.get(
  "/offers",
  asyncHandler(async (req, res) => {
    const courseId = courseIdOf(req);
    await loadCourse(courseId);

    const [products, offers] = await Promise.all([
      pool.query(`${COURSE_PRODUCTS} ORDER BY (p.kind = 'course') DESC, p.id`, [courseId]),
      pool.query(
        `WITH course_products AS (${COURSE_PRODUCTS}),
              links AS (
                SELECT op.offer_id, op.product_id, NULL::text AS via_bundle
                  FROM offer_products op JOIN course_products cp ON cp.id = op.product_id
                UNION ALL
                SELECT op.offer_id, bi.product_id, b.title AS via_bundle
                  FROM offer_products op
                  JOIN products b ON b.id = op.product_id AND b.kind = 'bundle'
                  JOIN product_bundle_items bi ON bi.bundle_product_id = b.id
                  JOIN course_products cp ON cp.id = bi.product_id
              ),
              one_per_offer AS (
                SELECT DISTINCT ON (offer_id) offer_id, product_id, via_bundle
                  FROM links ORDER BY offer_id, via_bundle NULLS FIRST
              )
         SELECT o.id, o.title, o.internal_title, o.slug, o.status, o.pricing_type, o.amount_cents,
                o.currency, o.interval, o.interval_count, o.installment_count,
                l.product_id, l.via_bundle,
                ((SELECT COUNT(*)::int FROM orders ord WHERE ord.offer_id = o.id AND ord.status = 'paid')
                 + (SELECT COUNT(DISTINCT pur.contact_id)::int FROM purchases pur
                     WHERE pur.offer_id = o.id AND pur.source = 'kajabi')) AS purchase_count
           FROM one_per_offer l
           JOIN offers o ON o.id = l.offer_id
          ORDER BY (o.status = 'published') DESC, (o.status = 'archived') ASC, o.title, o.id`,
        [courseId],
      ),
    ]);

    res.json({ products: rowsToCamel(products.rows), offers: rowsToCamel(offers.rows) });
  }),
);

/**
 * POST /product — the course's product, made if it has none. Idempotent: the
 * Offers tab calls it before every attach or create, and a course that already
 * has one is answered with it.
 */
adminCourseHubRouter.post(
  "/product",
  asyncHandler(async (req, res) => {
    const courseId = courseIdOf(req);
    await loadCourse(courseId);
    const product = await ensureCourseProduct(courseId);
    if (product.created) {
      await recordAdminAction({
        req,
        action: "product.create",
        entityType: "product",
        entityId: product.id,
        after: { courseId, title: product.title, kind: product.kind, via: "course.ensure_product" },
      });
    }
    res.status(product.created ? 201 : 200).json(product);
  }),
);

/* --------------------------------------------------------------- customers */

/**
 * GET /customers — everybody who has (or had) this course, with how far in.
 *
 * One row per person: a member can hold the course through a direct grant and a
 * bundle at once, and the live one wins. Progress is counted here from
 * `lesson_progress` over the course's published lessons rather than read from
 * `course_progress`, which is only rolled up when a student next completes a
 * lesson and so goes stale the moment a lesson is added.
 */
adminCourseHubRouter.get(
  "/customers",
  asyncHandler(async (req, res) => {
    const courseId = courseIdOf(req);
    await loadCourse(courseId);

    const [lessons, customers] = await Promise.all([
      pool.query<{ total: number }>(
        `SELECT COUNT(*)::int AS total
           FROM course_lessons l JOIN course_modules m ON m.id = l.module_id
          WHERE m.course_id = $1 AND l.published`,
        [courseId],
      ),
      pool.query(
        `WITH course_products AS (${COURSE_PRODUCTS}),
              published_lessons AS (
                SELECT l.id FROM course_lessons l JOIN course_modules m ON m.id = l.module_id
                 WHERE m.course_id = $1 AND l.published
              ),
              course_lesson_ids AS (
                SELECT l.id FROM course_lessons l JOIN course_modules m ON m.id = l.module_id
                 WHERE m.course_id = $1
              ),
              best_grant AS (
                SELECT DISTINCT ON (g.member_id)
                       g.member_id, g.source, g.offer_id, o.title AS offer_title, g.granted_at,
                       g.expires_at, g.revoked_at,
                       CASE WHEN g.status = 'active' AND g.expires_at IS NOT NULL AND g.expires_at <= now()
                            THEN 'expired' ELSE g.status END AS status
                  FROM access_grants g
                  JOIN course_products cp ON cp.id = g.product_id
                  LEFT JOIN offers o ON o.id = g.offer_id
                 ORDER BY g.member_id,
                          (g.status = 'active' AND (g.expires_at IS NULL OR g.expires_at > now())) DESC,
                          g.granted_at ASC
              )
         SELECT m.id AS member_id, m.contact_id, m.email::text AS email,
                EXISTS(SELECT 1 FROM course_watch_exemptions we WHERE we.member_id=m.id AND we.course_id=$1 AND we.revoked_at IS NULL) AS watch_exempt,
                COALESCE(NULLIF(TRIM(COALESCE(m.first_name, '') || ' ' || COALESCE(m.last_name, '')), ''),
                         NULLIF(m.name, ''), m.email::text) AS name,
                bg.source, bg.offer_id, bg.offer_title, bg.granted_at, bg.expires_at, bg.revoked_at, bg.status,
                (SELECT COUNT(*)::int FROM lesson_progress lp
                   JOIN published_lessons pl ON pl.id = lp.lesson_id
                  WHERE lp.member_id = m.id AND lp.completed_at IS NOT NULL) AS lessons_completed,
                (SELECT MAX(lp.last_viewed_at) FROM lesson_progress lp
                   JOIN course_lesson_ids cl ON cl.id = lp.lesson_id
                  WHERE lp.member_id = m.id) AS last_active_at
           FROM best_grant bg
           JOIN members m ON m.id = bg.member_id
          WHERE m.status <> 'deleted'
          ORDER BY (bg.status = 'active') DESC, bg.granted_at DESC, m.id DESC`,
        [courseId],
      ),
    ]);

    res.json({
      lessonsTotal: lessons.rows[0]?.total ?? 0,
      customers: rowsToCamel(customers.rows),
    });
  }),
);

/* ---------------------------------------------------------------- settings */

/**
 * GET /settings — the community this course belongs to, and both directions of
 * "paywall" between them:
 *
 *  - `communityOffers`: offers that sell the community, and the course product
 *    each also holds, if any (Kajabi's "put the course behind the community's
 *    paywall" — paying members get the course).
 *  - `courseOffers`: offers that sell the course directly, and the community
 *    product each also holds, if any (the buyer gets into the community, which
 *    the course's live sessions need: they are held in its live room).
 *
 * The product ids rather than yes/no, so switching one off removes exactly the
 * product that is there.
 *
 * Changing either is attaching a product to an offer, which the offers router
 * already does; this only reports the state.
 */
adminCourseHubRouter.get(
  "/settings",
  asyncHandler(async (req, res) => {
    const courseId = courseIdOf(req);
    const course = await loadCourse(courseId);

    const [communities, courseProducts] = await Promise.all([
      pool.query(
        `SELECT c.id, c.name, c.slug, c.access, c.published, c.live_room_enabled,
                (c.archived_at IS NOT NULL) AS archived, ${COMMUNITY_IS_SOLD} AS sold
           FROM communities c
          ORDER BY (c.archived_at IS NOT NULL), c.name, c.id`,
      ),
      pool.query<{ id: number }>(`${COURSE_PRODUCTS} ORDER BY (p.kind = 'course') DESC, p.id`, [courseId]),
    ]);

    const communityId = course.community_id;
    let community: Record<string, unknown> | null = null;
    let communityOffers: Record<string, unknown>[] = [];
    let courseOffers: Record<string, unknown>[] = [];

    if (communityId !== null) {
      community = rowsToCamel(communities.rows).find((row) => Number(row.id) === communityId) ?? null;
      const [products, sellers, ownOffers] = await Promise.all([
        pool.query(
          `SELECT p.id, p.title, p.kind, p.status FROM products p
            WHERE p.community_id = $1 AND p.kind IN ('community', 'access_group')
            ORDER BY (p.status = 'archived'), (p.kind = 'community') DESC, p.id`,
          [communityId],
        ),
        pool.query(
          `WITH course_products AS (${COURSE_PRODUCTS})
           SELECT DISTINCT o.id, o.title, o.internal_title, o.status,
                  (SELECT x.product_id FROM offer_products x JOIN course_products cp ON cp.id = x.product_id
                    WHERE x.offer_id = o.id ORDER BY x.product_id LIMIT 1) AS course_product_id
             FROM offers o
             JOIN offer_products op ON op.offer_id = o.id
             JOIN products p ON p.id = op.product_id
            WHERE p.community_id = $2 AND p.kind IN ('community', 'access_group')
            ORDER BY o.title, o.id`,
          [courseId, communityId],
        ),
        pool.query(
          `WITH course_products AS (${COURSE_PRODUCTS})
           SELECT DISTINCT o.id, o.title, o.internal_title, o.status,
                  (SELECT x.product_id FROM offer_products x JOIN products xp ON xp.id = x.product_id
                    WHERE x.offer_id = o.id AND xp.community_id = $2
                      AND xp.kind IN ('community', 'access_group')
                    ORDER BY x.product_id LIMIT 1) AS community_product_id
             FROM offers o
             JOIN offer_products op ON op.offer_id = o.id
             JOIN course_products cp ON cp.id = op.product_id
            ORDER BY o.title, o.id`,
          [courseId, communityId],
        ),
      ]);
      if (community) community.products = rowsToCamel(products.rows);
      communityOffers = rowsToCamel(sellers.rows);
      courseOffers = rowsToCamel(ownOffers.rows);
    }

    res.json({
      courseId,
      published: course.published,
      communityId,
      courseProductId: courseProducts.rows[0]?.id ?? null,
      communities: rowsToCamel(communities.rows),
      community,
      communityOffers,
      courseOffers,
    });
  }),
);

const settingsSchema = z.object({
  communityId: z.number().int().positive().nullable(),
});

adminCourseHubRouter.put(
  "/settings",
  asyncHandler(async (req, res) => {
    const courseId = courseIdOf(req);
    const parsed = settingsSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Invalid payload", parsed.error.flatten());
    const before = await loadCourse(courseId);
    const { communityId } = parsed.data;

    if (communityId !== null) {
      const found = await pool.query<{ archived: boolean }>(
        `SELECT (archived_at IS NOT NULL) AS archived FROM communities WHERE id = $1`,
        [communityId],
      );
      if (!found.rows[0]) throw badRequest("That community no longer exists.");
      if (found.rows[0].archived && before.community_id !== communityId) {
        throw badRequest("That community is archived. Restore it on the Community page first.");
      }
    }

    await pool.query(`UPDATE courses SET community_id = $2, updated_at = now() WHERE id = $1`, [
      courseId,
      communityId,
    ]);
    await recordAdminAction({
      req,
      action: "course.community_link",
      entityType: "course",
      entityId: courseId,
      before: { communityId: before.community_id },
      after: { communityId },
    });
    res.json({ courseId, communityId });
  }),
);

/* ------------------------------------------------------------ live sessions */

/**
 * The course's live sessions. Each is a community event in the course's
 * community (so it is on that community's calendar and opens its live room)
 * plus the draft lesson its replay goes into. The event and the lesson are
 * created by their own routers first; this records that they belong together.
 *
 * There is no recording here: the live room is peer-to-peer and nothing captures
 * it. "Becomes a lesson" means the replay lesson is waiting in the outline, as a
 * draft, for the recording she uploads or links afterwards.
 */
adminCourseHubRouter.get(
  "/live-sessions",
  asyncHandler(async (req, res) => {
    const courseId = courseIdOf(req);
    await loadCourse(courseId);
    const result = await pool.query(
      `SELECT s.id, s.community_event_id, s.lesson_id, s.created_at,
              COALESCE(e.title, s.title) AS title,
              COALESCE(e.starts_at, s.starts_at) AS starts_at,
              e.duration_minutes, e.community_id, c.name AS community_name, c.slug AS community_slug,
              (e.id IS NOT NULL) AS event_exists,
              l.title AS lesson_title, l.published AS lesson_published, l.module_id AS lesson_module_id,
              (COALESCE(l.video_url, '') <> '' OR COALESCE(l.embed_html, '') <> ''
                OR COALESCE(l.audio_url, '') <> '') AS lesson_has_recording
         FROM course_live_sessions s
         LEFT JOIN community_events e ON e.id = s.community_event_id
         LEFT JOIN communities c ON c.id = e.community_id
         LEFT JOIN course_lessons l ON l.id = s.lesson_id
        WHERE s.course_id = $1
        ORDER BY COALESCE(e.starts_at, s.starts_at) DESC NULLS LAST, s.id DESC`,
      [courseId],
    );
    res.json(rowsToCamel(result.rows));
  }),
);

const liveSessionSchema = z.object({
  communityEventId: z.number().int().positive(),
  lessonId: z.number().int().positive().nullable().default(null),
});

adminCourseHubRouter.post(
  "/live-sessions",
  asyncHandler(async (req, res) => {
    const courseId = courseIdOf(req);
    const parsed = liveSessionSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Invalid payload", parsed.error.flatten());
    await loadCourse(courseId);
    const { communityEventId, lessonId } = parsed.data;

    const event = await pool.query<{ title: string; starts_at: Date | null }>(
      `SELECT title, starts_at FROM community_events WHERE id = $1`,
      [communityEventId],
    );
    if (!event.rows[0]) throw badRequest("That live session is no longer on the community calendar.");

    if (lessonId !== null) {
      // Constrained by course, so a lesson from another course can't be named.
      const lesson = await pool.query(
        `SELECT 1 FROM course_lessons l JOIN course_modules m ON m.id = l.module_id
          WHERE l.id = $1 AND m.course_id = $2`,
        [lessonId, courseId],
      );
      if (lesson.rowCount === 0) throw badRequest("That replay lesson isn't part of this course.");
    }

    const result = await pool.query(
      `INSERT INTO course_live_sessions (course_id, community_event_id, lesson_id, title, starts_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (course_id, community_event_id) WHERE community_event_id IS NOT NULL
       DO UPDATE SET lesson_id = COALESCE(EXCLUDED.lesson_id, course_live_sessions.lesson_id)
       RETURNING id, course_id, community_event_id, lesson_id, title, starts_at, created_at`,
      [courseId, communityEventId, lessonId, event.rows[0].title, event.rows[0].starts_at],
    );

    await recordAdminAction({
      req,
      action: "course.live_session_add",
      entityType: "course",
      entityId: courseId,
      after: { communityEventId, lessonId },
    });
    res.status(201).json(rowsToCamel(result.rows)[0]);
  }),
);

/**
 * DELETE /live-sessions/:sessionId — takes it off the course's list. The
 * community event and the replay lesson are removed by their own screens (the
 * tab offers both), so a lesson that already holds a recording is never lost
 * by tidying a list.
 */
adminCourseHubRouter.delete(
  "/live-sessions/:sessionId",
  asyncHandler(async (req, res) => {
    const courseId = courseIdOf(req);
    const sessionId = Number(req.params.sessionId);
    if (!Number.isInteger(sessionId) || sessionId < 1) throw badRequest("Invalid session id");
    const removed = await pool.query(
      `DELETE FROM course_live_sessions WHERE id = $1 AND course_id = $2 RETURNING community_event_id, lesson_id`,
      [sessionId, courseId],
    );
    if (removed.rowCount === 0) throw notFound("Live session not found");
    await recordAdminAction({
      req,
      action: "course.live_session_remove",
      entityType: "course",
      entityId: courseId,
      before: rowsToCamel(removed.rows)[0],
    });
    res.status(204).end();
  }),
);
