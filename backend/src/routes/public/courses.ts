import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { notFound } from "../../utils/httpError";
import { coursesRepo } from "../../db/repos";
import { pool } from "../../db/pool";
import { loadPublicCourseOffers } from "../../services/courseOffers";
import { optionalMember } from "../../middleware/memberAuth";

export const coursesRouter = Router();

coursesRouter.get(
  "/courses",
  asyncHandler(async (_req, res) => {
    const items = await coursesRepo.list({ where: "published = true" });
    res.json(items);
  })
);

interface CurriculumLesson {
  id: number;
  title: string;
  slug: string;
  durationMinutes: number;
  contentType: string;
  preview: boolean;
}

/**
 * A single course, for its public sales page.
 *
 * This exists because the redirect map points 55 legacy bossclinician.com
 * product URLs at `/courses/<slug>` — `/fullybooked`, `/credentialwithconfidencekit`
 * and the rest. Those are the pages the business's existing links, email
 * footers and Instagram bio actually lead to, so they have to resolve to
 * something real rather than a 404 the day the domain moves.
 *
 * The curriculum is included as an outline only: titles, lengths and which
 * lessons are free previews. No lesson body, no video URL, no attachment —
 * this is an unauthenticated route, and the outline is a selling point while
 * the content is the thing being sold.
 */
coursesRouter.get(
  "/courses/:slug",
  optionalMember,
  asyncHandler(async (req, res) => {
    const course = await coursesRepo.getBySlug(req.params.slug);
    if (!course || !course.published) throw notFound("Course not found");

    const outline = await pool.query<{
      module_id: number;
      module_title: string;
      module_summary: string;
      module_sort: number;
      lessons: CurriculumLesson[] | null;
    }>(
      `SELECT m.id            AS module_id,
              m.title         AS module_title,
              m.summary       AS module_summary,
              m.sort          AS module_sort,
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
      [course.id]
    );

    // Offers are what this is actually bought through; a course may be sold at
    // several prices, so the page needs all of them rather than one.
    const offers = await loadPublicCourseOffers(course.id);

    let owned = false;
    if (req.member) {
      const grant = await pool.query(
        `SELECT 1 FROM access_grants g
           JOIN products p ON p.id = g.product_id
          WHERE g.member_id = $1 AND COALESCE(p.course_id, p.legacy_course_id) = $2 AND g.status = 'active'
            AND (g.expires_at IS NULL OR g.expires_at > now())
          LIMIT 1`,
        [req.member.id, course.id]
      );
      owned = grant.rows.length > 0;
    }

    res.json({
      ...course,
      modules: outline.rows.map((m) => ({
        id: m.module_id,
        title: m.module_title,
        summary: m.module_summary,
        sort: m.module_sort,
        lessons: m.lessons ?? [],
      })),
      offers,
      owned,
    });
  })
);
