/** SQL fragments accept only application-owned aliases/placeholders. */
export function watchExemptionSql(course: string, member: string): string {
  return `EXISTS (SELECT 1 FROM course_watch_exemptions we
    WHERE we.course_id=${course}.id AND we.member_id=${member} AND we.revoked_at IS NULL)`;
}
/**
 * Whether full viewing is required. With a lesson alias, that lesson's own
 * setting (course_lessons.watch_rule, migration 178) decides first and 'inherit'
 * falls through to the course rule. A member's exemption wins over all of them.
 */
export function watchRequirementSql(course: string, member: string, lesson?: string): string {
  const courseRule = `(${course}.require_full_video OR EXISTS (
    SELECT 1 FROM certificate_templates wt LEFT JOIN products wp ON wp.id=wt.product_id
    WHERE (wt.course_id=${course}.id OR wp.course_id=${course}.id)
      AND wt.enabled AND wt.issue_on='completion'))`;
  const rule = lesson
    ? `(CASE ${lesson}.watch_rule WHEN 'required' THEN true WHEN 'skippable' THEN false ELSE ${courseRule} END)`
    : courseRule;
  return `(${rule}
    AND NOT ${watchExemptionSql(course, member)})`;
}

/**
 * A lesson the owner marked "Can be skipped": nothing waits for it and it does not
 * count against finishing the course. A quiz or evaluation can never be skipped.
 */
export function lessonSkippableSql(lesson: string): string {
  return `(${lesson}.watch_rule = 'skippable' AND COALESCE(${lesson}.content_type, '') <> 'assessment')`;
}

/** Known lengths use contiguous credit; unknown lengths use time-bounded percent. */
export function mediaWatchSatisfied(duration: number, played: number, percent: number): boolean {
  return duration > 0 ? played >= Math.ceil(duration * 0.95) : percent >= 90;
}
