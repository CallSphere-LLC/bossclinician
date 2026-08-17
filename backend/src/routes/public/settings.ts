import { Router } from "express";
import { pool } from "../../db/pool";
import { asyncHandler } from "../../utils/asyncHandler";

export const settingsRouter = Router();

settingsRouter.get(
  "/settings",
  asyncHandler(async (_req, res) => {
    const result = await pool.query("SELECT key, value FROM settings WHERE key != 'seed_completed'");
    const merged: Record<string, unknown> = {};
    for (const row of result.rows) {
      merged[row.key] = row.value;
    }
    res.json(merged);
  })
);
