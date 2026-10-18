import { pool } from "../db/pool";
import { forbidden, notFound, unauthorized } from "../utils/httpError";
import { loadMemberLesson } from "./curriculum";
import { hasCourseAccess } from "./access";
export async function assertLessonAssessmentAccess(memberId: number | undefined, lessonId: number): Promise<void> {
  // 401, not 403: the member client refreshes its 15-minute access token on a
  // 401 and retries. optionalMember treats an expired token as "signed out", so
  // a student who spent longer than that answering a quiz used to get a 403
  // here, the client never refreshed, and "Submit" appeared to do nothing.
  if (!memberId) throw unauthorized("Please sign in again to take this lesson assessment.");
  const row = await pool.query(`SELECT m.course_id FROM course_lessons l JOIN course_modules m ON m.id=l.module_id WHERE l.id=$1 AND l.published`, [lessonId]);
  const courseId = row.rows[0]?.course_id;
  if (!courseId || !(await hasCourseAccess(memberId, courseId))) throw notFound("Assessment not found");
  // The same gate the player uses: lock, schedule and drip are all decided in
  // services/curriculum.ts, so a quiz cannot be reached before its lesson opens.
  const found = await loadMemberLesson(memberId, courseId, lessonId);
  if (!found) throw notFound("Assessment not found");
  if (!found.lesson.unlocked) {
    throw forbidden(found.lesson.unlockLabel
      ? `This assessment isn't open yet. ${found.lesson.unlockLabel}.`
      : "Complete the earlier lessons before taking this assessment.");
  }
}
export async function assertAssessmentCompleted(memberId: number, lessonId: number): Promise<void> {
  const result = await pool.query(`SELECT a.kind, a.require_pass,
    EXISTS(SELECT 1 FROM assessment_attempts t WHERE t.assessment_id=a.id AND t.member_id=$2
      AND t.completed_at IS NOT NULL AND (a.kind <> 'graded' OR NOT a.require_pass OR t.passed)) AS complete
    FROM course_lessons l LEFT JOIN assessments a ON l.id=a.lesson_id AND a.published
    WHERE l.id=$1 AND l.content_type='assessment' `, [lessonId,memberId]);
  if (result.rows.some(row => !row.complete)) throw forbidden("Complete this assessment before marking the lesson finished. A required pass must be earned first.");
}
