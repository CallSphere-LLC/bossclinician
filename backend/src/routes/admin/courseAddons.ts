import { Router, type Request } from "express";
import { z } from "zod";
import { pool } from "../../db/pool";
import { asyncHandler } from "../../utils/asyncHandler";
import { badRequest, notFound } from "../../utils/httpError";
import { recordAdminAction } from "../../services/adminAudit";

export const adminCourseAddonsRouter = Router({ mergeParams: true });
const id = z.coerce.number().int().positive().max(2147483647);
const input = z.object({ offerId: id, description: z.string().trim().max(300).default(''), sort: z.number().int().min(0).max(999).default(0) }).strict();
function courseId(req: Request): number {
  const parsed = id.safeParse(req.params.courseId);
  if (!parsed.success) throw badRequest('Invalid course id');
  return parsed.data;
}
async function exists(course: number) {
  if (!(await pool.query('SELECT id FROM courses WHERE id=$1',[course])).rowCount) throw notFound('Course not found');
}

adminCourseAddonsRouter.get('/', asyncHandler(async (req,res) => {
  const course = courseId(req); await exists(course);
  const [configured, candidates] = await Promise.all([
    pool.query(`SELECT a.offer_id AS "offerId",a.description,a.sort,o.title,o.status
      FROM course_addons a JOIN offers o ON o.id=a.offer_id WHERE course_id=$1 ORDER BY a.sort,a.offer_id`,[course]),
    pool.query(`SELECT o.id,o.title FROM offers o WHERE o.status='published'
      AND EXISTS(SELECT 1 FROM offer_products op WHERE op.offer_id=o.id)
      ORDER BY lower(o.title),o.id`),
  ]);
  res.json({ configured: configured.rows, offers: candidates.rows });
}));

adminCourseAddonsRouter.put('/', asyncHandler(async (req,res) => {
  const course = courseId(req); const parsed = input.safeParse(req.body);
  if (!parsed.success) throw badRequest('Choose an existing offer, a description up to 300 characters and an order from 0 to 999.');
  const data = parsed.data; const db = await pool.connect();
  let before: unknown;
  try {
    await db.query('BEGIN');
    if (!(await db.query('SELECT id FROM courses WHERE id=$1 FOR UPDATE',[course])).rowCount) throw notFound('Course not found');
    if (!(await db.query(`SELECT id FROM offers o WHERE id=$1 AND status='published'
      AND EXISTS(SELECT 1 FROM offer_products op WHERE op.offer_id=o.id)`,[data.offerId])).rowCount) throw badRequest('Choose a published offer with a product attached.');
    const current = await db.query('SELECT * FROM course_addons WHERE course_id=$1',[course]);
    before = current.rows.find(row => row.offer_id===data.offerId) ?? null;
    if (!before && current.rows.length>=12) throw badRequest('A course can show up to 12 optional add-ons.');
    await db.query(`INSERT INTO course_addons(course_id,offer_id,description,sort) VALUES($1,$2,$3,$4)
      ON CONFLICT(course_id,offer_id) DO UPDATE SET description=EXCLUDED.description,sort=EXCLUDED.sort`,[course,data.offerId,data.description,data.sort]);
    await db.query('COMMIT');
  } catch(error) { await db.query('ROLLBACK'); throw error; }
  finally { db.release(); }
  await recordAdminAction({req,action:'course.addon_save',entityType:'course',entityId:course,before,after:data});
  res.json(data);
}));

adminCourseAddonsRouter.delete('/:offerId', asyncHandler(async (req,res) => {
  const course=courseId(req); const offer=id.safeParse(req.params.offerId);
  if (!offer.success) throw badRequest('Invalid offer id');
  await exists(course);
  const removed=await pool.query('DELETE FROM course_addons WHERE course_id=$1 AND offer_id=$2 RETURNING *',[course,offer.data]);
  if (removed.rowCount) await recordAdminAction({req,action:'course.addon_remove',entityType:'course',entityId:course,before:removed.rows[0]});
  res.status(204).end();
}));
