import { pool } from "../db/pool";
import { coursesRepo, resourcesRepo, testimonialsRepo } from "../db/repos";
import { rowToCamel, rowsToCamel } from "../utils/case";
import { BlogPost } from "../types";

/**
 * The data a server-rendered marketing page needs, read straight from Postgres.
 *
 * Deliberately not by calling our own HTTP API: a request that fans out to
 * localhost doubles the latency of every page, and it makes the render depend
 * on the API being reachable from inside its own process — a deadlock waiting
 * for a saturated connection pool.
 *
 * Each loader returns exactly the JSON shape the matching endpoint in
 * routes/public returns, because the browser hydrates against it and then keeps
 * using the same endpoint for every later navigation. Where a query is
 * duplicated from a route, the route is the source of truth for the contract.
 */

/** The list view's lighter "card" shape — no `bodyMd`. */
type BlogCard = Omit<BlogPost, "bodyMd">;

export interface BlogListResult {
  items: BlogCard[];
  total: number;
  page: number;
  pageSize: number;
}

/** Mirrors GET /api/blog with no paging arguments — the archive's first page. */
export async function loadBlogList(tag?: string): Promise<BlogListResult> {
  const limit = 10;
  const params: unknown[] = [];
  let whereSql = "WHERE published = true";
  if (tag) {
    params.push(tag);
    whereSql += ` AND $${params.length} = ANY(tags)`;
  }

  const countRes = await pool.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM blog_posts ${whereSql}`,
    params,
  );

  const listRes = await pool.query(
    `SELECT id, slug, title, excerpt, cover_image, tags, author, read_minutes, published,
            published_at, created_at, updated_at
       FROM blog_posts ${whereSql}
      ORDER BY published_at DESC NULLS LAST, created_at DESC
      LIMIT ${limit}`,
    params,
  );

  return {
    items: rowsToCamel<BlogCard>(listRes.rows),
    total: countRes.rows[0]?.count ?? 0,
    page: 1,
    pageSize: limit,
  };
}

/** Mirrors GET /api/blog/:slug. `null` where the endpoint answers 404. */
export async function loadBlogPost(slug: string): Promise<BlogPost | null> {
  const res = await pool.query(
    "SELECT * FROM blog_posts WHERE slug = $1 AND published = true",
    [slug],
  );
  if (res.rows.length === 0) return null;
  return rowToCamel<BlogPost>(res.rows[0]);
}

export async function loadTestimonials(): Promise<unknown[]> {
  return testimonialsRepo.list({ where: "published = true" });
}

export async function loadCourses(): Promise<unknown[]> {
  return coursesRepo.list({ where: "published = true" });
}

export async function loadResources(): Promise<unknown[]> {
  return resourcesRepo.list({ where: "published = true" });
}

interface CurriculumLesson {
  id: number;
  title: string;
  slug: string;
  durationMinutes: number;
  contentType: string;
  preview: boolean;
}

/**
 * Mirrors GET /api/courses/:slug.
 *
 * `owned` is always false: a browser asking for a document sends no access
 * token, so the render cannot know who is reading. A signed-in member's page
 * corrects itself after hydration — see usePageData's `revalidateForMembers`.
 */
export async function loadCourseDetail(slug: string): Promise<Record<string, unknown> | null> {
  const course = await coursesRepo.getBySlug(slug);
  if (!course || !course.published) return null;

  const outline = await pool.query<{
    module_id: number;
    module_title: string;
    module_summary: string;
    module_sort: number;
    lessons: CurriculumLesson[] | null;
  }>(
    `SELECT m.id      AS module_id,
            m.title   AS module_title,
            m.summary AS module_summary,
            m.sort    AS module_sort,
            COALESCE(
              json_agg(
                json_build_object(
                  'id', l.id,
                  'title', l.title,
                  'slug', l.slug,
                  'durationMinutes', l.duration_minutes,
                  'contentType', l.content_type,
                  'preview', l.preview
                ) ORDER BY l.sort, l.id
              ) FILTER (WHERE l.id IS NOT NULL),
              '[]'
            ) AS lessons
       FROM course_modules m
       LEFT JOIN course_lessons l ON l.module_id = m.id AND l.published = true
      WHERE m.course_id = $1
      GROUP BY m.id
      ORDER BY m.sort, m.id`,
    [course.id],
  );

  const offers = await pool.query(
    `SELECT DISTINCT o.slug, o.title, o.pricing_type, o.amount_cents, o.currency,
                     o.interval, o.interval_count, o.installment_count, o.checkout_headline
       FROM offers o
       JOIN offer_products op ON op.offer_id = o.id
       JOIN products p        ON p.id = op.product_id
      WHERE p.course_id = $1 AND o.status = 'published'
      ORDER BY o.amount_cents`,
    [course.id],
  );

  return {
    ...course,
    modules: outline.rows.map((m) => ({
      id: m.module_id,
      title: m.module_title,
      summary: m.module_summary,
      sort: m.module_sort,
      lessons: m.lessons ?? [],
    })),
    offers: offers.rows.map((o) => ({
      slug: o.slug,
      title: o.title,
      pricingType: o.pricing_type,
      amountCents: o.amount_cents,
      currency: o.currency,
      interval: o.interval,
      intervalCount: o.interval_count,
      installmentCount: o.installment_count,
      checkoutHeadline: o.checkout_headline,
    })),
    owned: false,
  };
}
