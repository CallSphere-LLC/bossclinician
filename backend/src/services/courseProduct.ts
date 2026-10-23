import { pool } from "../db/pool";
import { PRODUCT_CONTENT_COURSE_ID } from "./access";
import { notFound } from "../utils/httpError";

/**
 * The product a course is sold and granted through.
 *
 * Access is granted to products, never to courses (services/access.ts), so a
 * course with no product can be built, previewed and put on the website and
 * still can't be bought or given to anybody. "Add a course" made exactly that —
 * The Board Room (course 65) — and the course's Offers tab had nothing to attach
 * an offer to. Every course now gets one when it is made; this is also what the
 * Offers tab calls before attaching or creating an offer, for a course made
 * before that.
 */

/** Arbitrary but fixed: the first half of the advisory lock key below. */
const COURSE_PRODUCT_LOCK_CLASS = 146_001;

export interface CourseProductRef {
  id: number;
  title: string;
  kind: string;
  status: string;
}

/**
 * The web address for a new course product.
 *
 * The course's own slug when it is free — that is what migration 002's backfill
 * used, so most products already match their course — otherwise the first of
 * `<slug>-course`, `<slug>-course-2`, … nobody has. `products.slug` is UNIQUE.
 */
export function courseProductSlug(courseSlug: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base = courseSlug.trim() || "course";
  if (!used.has(base)) return base;
  if (!used.has(`${base}-course`)) return `${base}-course`;
  for (let n = 2; ; n += 1) {
    const candidate = `${base}-course-${n}`;
    if (!used.has(candidate)) return candidate;
  }
}

/**
 * Returns the course's product, creating one when it has none.
 *
 * "Has one" uses the access engine's own definition, so a coaching programme's
 * workbook (named through `legacy_course_id`) answers with its coaching product
 * rather than gaining a second one. Serialised per course with an advisory lock:
 * two quick clicks would otherwise mint two products, and `access_grants` is
 * unique per product, so the course's customers would be split across them.
 */
export async function ensureCourseProduct(courseId: number): Promise<CourseProductRef & { created: boolean }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SELECT pg_advisory_xact_lock($1, $2)`, [COURSE_PRODUCT_LOCK_CLASS, courseId]);

    const existing = await client.query<CourseProductRef>(
      `SELECT p.id, p.title, p.kind, p.status
         FROM products p
        WHERE ${PRODUCT_CONTENT_COURSE_ID} = $1
        ORDER BY (p.kind = 'course') DESC, (p.status = 'archived') ASC, p.id
        LIMIT 1`,
      [courseId],
    );
    if (existing.rows[0]) {
      await client.query("COMMIT");
      return { ...existing.rows[0], created: false };
    }

    const course = await client.query<{
      slug: string; title: string; subtitle: string | null; description: string | null;
      image: string | null; sort: number;
    }>(`SELECT slug, title, subtitle, description, image, sort FROM courses WHERE id = $1`, [courseId]);
    const row = course.rows[0];
    if (!row) throw notFound("Course not found");

    const taken = await client.query<{ slug: string }>(
      `SELECT slug FROM products WHERE slug = $1 OR slug LIKE $2`,
      [row.slug, `${row.slug.replace(/[\\%_]/g, (c) => `\\${c}`)}-course%`],
    );
    const slug = courseProductSlug(row.slug, taken.rows.map((r) => r.slug));

    // Published like every other course product: the product is the thing access
    // hangs off, and the course's own "Live on your site" switch is what decides
    // whether anybody can see it. A draft product is refused as an order bump.
    const created = await client.query<CourseProductRef>(
      `INSERT INTO products (slug, title, subtitle, description, thumbnail_url, kind, course_id, status, sort)
       VALUES ($1, $2, $3, $4, $5, 'course', $6, 'published', $7)
       RETURNING id, title, kind, status`,
      [slug, row.title, row.subtitle ?? "", row.description ?? "", row.image ?? "", courseId, row.sort ?? 0],
    );
    await client.query("COMMIT");
    return { ...created.rows[0], created: true };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
