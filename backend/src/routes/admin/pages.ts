import { Router } from "express";
import { pool } from "../../db/pool";
import { rowToCamel } from "../../utils/case";
import { asyncHandler } from "../../utils/asyncHandler";
import { badRequest, notFound } from "../../utils/httpError";
import { pageUpdateSchema } from "../../validation/schemas";
import { Page } from "../../types";

export const adminPagesRouter = Router();

/** Registered before "/:slug" so the literal path can't be captured as a slug. */
adminPagesRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const result = await pool.query(
      "SELECT slug, title, description, updated_at FROM pages ORDER BY slug"
    );
    res.json(result.rows.map((row) => rowToCamel(row)));
  })
);

adminPagesRouter.get(
  "/:slug",
  asyncHandler(async (req, res) => {
    const result = await pool.query("SELECT * FROM pages WHERE slug = $1", [req.params.slug]);
    if (result.rows.length === 0) throw notFound("Page not found");
    res.json(rowToCamel<Page>(result.rows[0]));
  })
);

adminPagesRouter.put(
  "/:slug",
  asyncHandler(async (req, res) => {
    const parsed = pageUpdateSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Invalid payload", parsed.error.flatten());
    const { title, description, sections } = parsed.data;
    const slug = req.params.slug;

    const existingRes = await pool.query("SELECT * FROM pages WHERE slug = $1", [slug]);
    const existing = existingRes.rows[0];

    const merged = {
      title: title ?? existing?.title ?? "",
      description: description ?? existing?.description ?? "",
      sections: sections !== undefined ? sections : existing?.sections ?? {},
    };

    const result = await pool.query(
      `INSERT INTO pages (slug, title, description, sections)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (slug) DO UPDATE SET
         title = $2, description = $3, sections = $4, updated_at = now()
       RETURNING *`,
      [slug, merged.title, merged.description, JSON.stringify(merged.sections)]
    );
    res.json(rowToCamel<Page>(result.rows[0]));
  })
);
