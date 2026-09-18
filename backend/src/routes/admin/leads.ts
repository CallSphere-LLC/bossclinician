import { Router } from "express";
import { pool } from "../../db/pool";
import { rowToCamel, rowsToCamel } from "../../utils/case";
import { asyncHandler } from "../../utils/asyncHandler";
import { badRequest, notFound } from "../../utils/httpError";
import { leadStatusSchema } from "../../validation/schemas";
import { recordAdminAction } from "../../services/adminAudit";
import { Lead } from "../../types";

export const adminLeadsRouter = Router();

/**
 * How many rows this list will hold in memory.
 *
 * Same ceiling and same reason as the members list
 * (routes/admin/members.ts): the API runs in a 1GB container that also renders
 * the marketing pages, and `SELECT *` over a table every contact form on the
 * public site writes to is a read that grows without bound. The enquiries
 * screen shows newest first and nobody scrolls a thousand of them; the rows
 * past this are still in the database and still in the exports.
 */
const LIST_CEILING = 1000;

adminLeadsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const params: unknown[] = [];
    let where = "";
    if (status) {
      params.push(status);
      where = "WHERE status = $1";
    }
    const result = await pool.query(
      `SELECT * FROM leads ${where} ORDER BY created_at DESC LIMIT ${LIST_CEILING}`,
      params
    );
    res.json(rowsToCamel<Lead>(result.rows));
  })
);

adminLeadsRouter.put(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw badRequest("Invalid id");
    const parsed = leadStatusSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Invalid payload", parsed.error.flatten());

    const result = await pool.query(
      `UPDATE leads SET status = $1 WHERE id = $2 RETURNING *`,
      [parsed.data.status, id]
    );
    if (result.rows.length === 0) throw notFound("Lead not found");
    res.json(rowToCamel<Lead>(result.rows[0]));
  })
);

/**
 * DELETE /:id — removes one enquiry.
 *
 * Only the enquiry goes. The person stays in Contacts with their tags, purchases
 * and history: a lead row is the message they sent, not who they are. Audited
 * with the row as it was, because a delete is the one change the list itself
 * cannot show afterwards.
 */
adminLeadsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw badRequest("Invalid id");

    const result = await pool.query(`DELETE FROM leads WHERE id = $1 RETURNING *`, [id]);
    if (result.rows.length === 0) throw notFound("Lead not found");

    await recordAdminAction({
      req,
      action: "lead.delete",
      entityType: "lead",
      entityId: id,
      before: rowToCamel<Lead>(result.rows[0]),
    });
    res.status(204).end();
  })
);
