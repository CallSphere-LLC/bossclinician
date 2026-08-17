import { Router } from "express";
import { pool } from "../../db/pool";
import { rowToCamel } from "../../utils/case";
import { asyncHandler } from "../../utils/asyncHandler";
import { notFound } from "../../utils/httpError";
import { Page } from "../../types";

export const pagesRouter = Router();

pagesRouter.get(
  "/pages/:slug",
  asyncHandler(async (req, res) => {
    const res_ = await pool.query("SELECT * FROM pages WHERE slug = $1", [req.params.slug]);
    if (res_.rows.length === 0) throw notFound("Page not found");
    res.json(rowToCamel<Page>(res_.rows[0]));
  })
);
