import { pool } from "../db/pool";
import { forbidden, notFound } from "../utils/httpError";
import { loadCourseForMember } from "./curriculum";
import { hasCourseAccess } from "./access";
export async function assertLessonAssessmentAccess(memberId: number | undefined, lessonId: number): Promise<void> {
  if (!memberId) throw forbidden("Sign in to take this lesson assessment.");
  const row = await pool.query(`SELECT m.course_id FROM course_lessons l JOIN course_modules m ON m.id=l.module_id WHERE l.id=$1 AND l.published`, [lessonId]);
  const courseId = row.rows[0]?.course_id;
  if (!courseId || !(await hasCourseAccess(memberId, courseId))) throw notFound("Assessment not found");
  const course = await loadCourseForMember(memberId, courseId);
  const lesson = course?.modules.flatMap(module => module.lessons).find(lesson => lesson.id === lessonId);
  if (!lesson?.unlocked) throw forbidden("Complete the earlier lessons before taking this assessment.");
}
export async function assertAssessmentCompleted(memberId: number, lessonId: number): Promise<void> {
  const result = await pool.query(`SELECT a.kind, a.require_pass,
    EXISTS(SELECT 1 FROM assessment_attempts t WHERE t.assessment_id=a.id AND t.member_id=$2
      AND t.completed_at IS NOT NULL AND (a.kind <> 'graded' OR NOT a.require_pass OR t.passed)) AS complete
    FROM course_lessons l LEFT JOIN assessments a ON l.id=a.lesson_id AND a.published
    WHERE l.id=$1 AND l.content_type='assessment' `, [lessonId,memberId]);
  if (result.rows.some(row => !row.complete)) throw forbidden("Complete this assessment before marking the lesson finished. A required pass must be earned first.");
}
