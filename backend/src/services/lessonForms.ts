import { pool } from "../db/pool";
import { notFound } from "../utils/httpError";
import { hasCourseAccess } from "./access";
import { loadCourseForMember } from "./curriculum";

/**
 * Forms that live inside a lesson (migration 112).
 *
 * A lesson carries a form through `course_lessons.tool_key = 'form-<slug>'`:
 * tool_key is the existing "interactive thing under the lesson's text" column
 * (migration 104), already served by the member and preview lesson endpoints
 * and left alone by the course editor. The form itself is an ordinary row in
 * `forms`, built and read in Admin → Forms.
 *
 * Such a form is reached through the course, not through /f/<slug>: it is
 * normally unpublished, and the member route checks that the person may open a
 * lesson carrying it instead.
 */

export const LESSON_FORM_PREFIX = "form-";

/** The same shape tool_key's CHECK constraint enforces, minus the prefix. */
const SLUG_SHAPE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** The tool_key that puts this form inside a lesson. */
export function lessonFormToolKey(slug: string): string {
  return `${LESSON_FORM_PREFIX}${slug}`;
}

/** The form slug a lesson's tool_key names, or null when it names something else. */
export function formSlugFromToolKey(toolKey: unknown): string | null {
  if (typeof toolKey !== "string" || !toolKey.startsWith(LESSON_FORM_PREFIX)) return null;
  const slug = toolKey.slice(LESSON_FORM_PREFIX.length);
  return SLUG_SHAPE.test(slug) ? slug : null;
}

/** A slug off a URL, or null when it could not be one. */
export function cleanFormSlug(raw: unknown): string | null {
  return typeof raw === "string" && raw.length <= 120 && SLUG_SHAPE.test(raw) ? raw : null;
}

export interface LessonFormRow {
  id: number;
  slug: string;
  name: string;
  description_md: string;
  description: string;
  fields: unknown;
  submit_label: string;
  success_message: string;
  notify_on_submit?: boolean;
  notify_emails?: string;
  create_lead: boolean;
}

/**
 * The form, if this member may fill it in: some published lesson carries it,
 * they hold access to that lesson's course, and that lesson is open to them
 * (drip and "finish the previous lesson first" both respected). Anything else
 * is the same 404 — ids and slugs are guessable, and a 403 would confirm the
 * form exists.
 */
export async function loadLessonFormForMember(memberId: number, slug: string): Promise<LessonFormRow> {
  const lessons = await pool.query<{ id: number; course_id: number }>(
    `SELECT l.id, m.course_id
       FROM course_lessons l
       JOIN course_modules m ON m.id = l.module_id
      WHERE l.tool_key = $1 AND l.published
      ORDER BY l.id`,
    [lessonFormToolKey(slug)],
  );

  let allowed = false;
  for (const lesson of lessons.rows) {
    if (!(await hasCourseAccess(memberId, lesson.course_id))) continue;
    const course = await loadCourseForMember(memberId, lesson.course_id);
    const view = course?.modules.flatMap((module) => module.lessons).find((entry) => entry.id === lesson.id);
    if (view?.unlocked) {
      allowed = true;
      break;
    }
  }
  if (!allowed) throw notFound("Form not found");

  const form = await pool.query<LessonFormRow>(`SELECT * FROM forms WHERE slug = $1`, [slug]);
  if (!form.rows[0]) throw notFound("Form not found");
  return form.rows[0];
}

/** The lessons a form is attached to, for the builder's "used in" note. */
export async function lessonsUsingForm(
  slug: string,
): Promise<{ id: number; title: string; courseId: number; courseTitle: string; published: boolean }[]> {
  const result = await pool.query<{
    id: number;
    title: string;
    course_id: number;
    course_title: string;
    published: boolean;
  }>(
    `SELECT l.id, l.title, c.id AS course_id, c.title AS course_title, l.published
       FROM course_lessons l
       JOIN course_modules m ON m.id = l.module_id
       JOIN courses c ON c.id = m.course_id
      WHERE l.tool_key = $1
      ORDER BY c.title, m.sort, l.sort, l.id`,
    [lessonFormToolKey(slug)],
  );
  return result.rows.map((row) => ({
    id: row.id,
    title: row.title,
    courseId: row.course_id,
    courseTitle: row.course_title,
    published: row.published,
  }));
}
