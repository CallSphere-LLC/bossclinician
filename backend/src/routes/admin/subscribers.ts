import { Router } from "express";
import { pool } from "../../db/pool";
import { rowsToCamel } from "../../utils/case";
import { asyncHandler } from "../../utils/asyncHandler";
import { Subscriber } from "../../types";

export const adminSubscribersRouter = Router();

adminSubscribersRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const result = await pool.query("SELECT * FROM subscribers ORDER BY created_at DESC");
    res.json(rowsToCamel<Subscriber>(result.rows));
  })
);
