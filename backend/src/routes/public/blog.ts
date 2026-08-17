import { Router } from "express";
import { pool } from "../../db/pool";
import { rowToCamel, rowsToCamel } from "../../utils/case";
import { asyncHandler } from "../../utils/asyncHandler";
import { notFound } from "../../utils/httpError";
import { BlogPost } from "../../types";

export const blogRouter = Router();

/** Fields returned for the list view — a lighter "card" shape (no full bodyMd). */
type BlogCard = Omit<BlogPost, "bodyMd">;

blogRouter.get(
  "/blog",
  asyncHandler(async (req, res) => {
    const tag = typeof req.query.tag === "string" ? req.query.tag : undefined;
    const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit ?? "10"), 10) || 10));
    const offset = (page - 1) * limit;

    const where = ["published = true"];
    const params: unknown[] = [];
    if (tag) {
      params.push(tag);
      where.push(`$${params.length} = ANY(tags)`);
    }
    const whereSql = `WHERE ${where.join(" AND ")}`;

    const countRes = await pool.query(`SELECT COUNT(*)::int AS count FROM blog_posts ${whereSql}`, params);
    const total = countRes.rows[0]?.count ?? 0;

    params.push(limit);
    params.push(offset);
    const listRes = await pool.query(
      `SELECT id, slug, title, excerpt, cover_image, tags, author, read_minutes, published, published_at, created_at, updated_at
       FROM blog_posts ${whereSql}
       ORDER BY published_at DESC NULLS LAST, created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    res.json({
      items: rowsToCamel<BlogCard>(listRes.rows),
      total,
      page,
      pageSize: limit,
    });
  })
);

blogRouter.get(
  "/blog/:slug",
  asyncHandler(async (req, res) => {
    const result = await pool.query("SELECT * FROM blog_posts WHERE slug = $1 AND published = true", [
      req.params.slug,
    ]);
    if (result.rows.length === 0) throw notFound("Post not found");
    res.json(rowToCamel<BlogPost>(result.rows[0]));
  })
);
