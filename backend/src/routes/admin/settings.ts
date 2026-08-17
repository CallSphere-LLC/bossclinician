import { Router } from "express";
import { pool } from "../../db/pool";
import { asyncHandler } from "../../utils/asyncHandler";
import { badRequest } from "../../utils/httpError";
import { settingsUpdateSchema } from "../../validation/schemas";

export const adminSettingsRouter = Router();

adminSettingsRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const result = await pool.query("SELECT key, value FROM settings WHERE key != 'seed_completed'");
    const merged: Record<string, unknown> = {};
    for (const row of result.rows) merged[row.key] = row.value;
    res.json(merged);
  })
);

/** Body is a flat map of {key: value}; each key is upserted into the settings table. */
adminSettingsRouter.put(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = settingsUpdateSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Invalid payload", parsed.error.flatten());

    const entries = Object.entries(parsed.data).filter(([key]) => key !== "seed_completed");
    for (const [key, value] of entries) {
      await pool.query(
        `INSERT INTO settings (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = $2`,
        [key, JSON.stringify(value)]
      );
    }

    const result = await pool.query("SELECT key, value FROM settings WHERE key != 'seed_completed'");
    const merged: Record<string, unknown> = {};
    for (const row of result.rows) merged[row.key] = row.value;
    res.json(merged);
  })
);
