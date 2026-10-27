/** SQL fragments accept only application-owned aliases/placeholders. */
export function watchExemptionSql(course: string, member: string): string {
  return `EXISTS (SELECT 1 FROM course_watch_exemptions we
    WHERE we.course_id=${course}.id AND we.member_id=${member} AND we.revoked_at IS NULL)`;
}
export function watchRequirementSql(course: string, member: string): string {
  return `((${course}.require_full_video OR EXISTS (
    SELECT 1 FROM certificate_templates wt LEFT JOIN products wp ON wp.id=wt.product_id
    WHERE (wt.course_id=${course}.id OR wp.course_id=${course}.id)
      AND wt.enabled AND wt.issue_on='completion'))
    AND NOT ${watchExemptionSql(course, member)})`;
}

/** Known lengths use contiguous credit; unknown lengths use time-bounded percent. */
export function mediaWatchSatisfied(duration: number, played: number, percent: number): boolean {
  return duration > 0 ? played >= Math.ceil(duration * 0.95) : percent >= 90;
}
