import { Router } from "express";
import { pool } from "../../db/pool";
import { rowToCamel, rowsToCamel } from "../../utils/case";
import { asyncHandler } from "../../utils/asyncHandler";
import { badRequest, notFound } from "../../utils/httpError";
import { leadStatusSchema } from "../../validation/schemas";
import { Lead } from "../../types";

export const adminLeadsRouter = Router();

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
      `SELECT * FROM leads ${where} ORDER BY created_at DESC`,
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
