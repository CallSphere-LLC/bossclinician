import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool";
import { asyncHandler } from "../../utils/asyncHandler";
import { badRequest, unauthorized, notFound } from "../../utils/httpError";
import { hasCourseAccess } from "../../services/access";

// Mounted under courses: requireAuth + products.manage protect this PUT.
export const courseWatchExemptionsRouter = Router({ mergeParams: true });
const bodySchema = z.object({
  exempt: z.boolean(),
  reason: z.string().trim().min(10).max(2000),
}).strict();
courseWatchExemptionsRouter.put("/:memberId", asyncHandler(async (req, res) => {
  const courseId = Number(req.params.courseId);
  const memberId = Number(req.params.memberId);
  if (![courseId, memberId].every(id => Number.isSafeInteger(id) && id > 0 && id <= 2147483647)) {
    throw badRequest("Invalid course or member");
  }
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) throw badRequest("Provide an exemption decision and a reason of 10–2000 characters.");
  const admin = req.user;
  if (!admin) throw unauthorized("Admin authentication required");
  if (parsed.data.exempt && !await hasCourseAccess(memberId, courseId)) {
    throw notFound("This member does not have active access to this course");
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Serialize grants/revocations for this exact member/course, including new rows.
    await client.query("SELECT pg_advisory_xact_lock($1::int,$2::int)", [courseId, memberId]);
    const before = (await client.query(
      "SELECT * FROM course_watch_exemptions WHERE member_id=$1 AND course_id=$2",
      [memberId, courseId]
    )).rows[0] ?? null;
    if (!parsed.data.exempt && !before) throw notFound("No viewing exemption exists");
    const after = (await client.query(
      `INSERT INTO course_watch_exemptions(member_id,course_id,reason,admin_user_id,revoked_at)
       VALUES($1,$2,$3,$4,CASE WHEN $5 THEN NULL ELSE now() END)
       ON CONFLICT(member_id,course_id) DO UPDATE SET reason=EXCLUDED.reason,
         admin_user_id=EXCLUDED.admin_user_id,updated_at=now(),revoked_at=EXCLUDED.revoked_at
       RETURNING *`,
      [memberId,courseId,parsed.data.reason,admin.sub,parsed.data.exempt]
    )).rows[0];
    // Audit and exception must commit together; a failed audit fails closed.
    await client.query(
      `INSERT INTO admin_audit_log(admin_user_id,admin_email,action,entity_type,entity_id,before_state,after_state,ip)
       VALUES($1,$2,$3,'course_watch_exemption',$4,$5::jsonb,$6::jsonb,$7)`,
      [admin.sub,admin.email,parsed.data.exempt ? "course.watch_exempt" : "course.watch_exemption_revoke",
       `${courseId}:${memberId}`,JSON.stringify(before),JSON.stringify(after),(req.ip ?? "").slice(0,64)]
    );
    await client.query("COMMIT");
    res.json({ memberId, courseId, exempt: after.revoked_at === null, reason: after.reason });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}));
