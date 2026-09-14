import { Router } from "express";
import { z } from "zod";
import { partialUpdate } from "../../validation/partialUpdate";
import { pool } from "../../db/pool";
import { asyncHandler } from "../../utils/asyncHandler";
import { badRequest, notFound } from "../../utils/httpError";
import { listRedirects, normalizePath } from "../../services/redirects";
import { recordAdminAction } from "../../services/adminAudit";

/**
 * Redirect management and the 404 report.
 *
 * These two screens are the migration worklist. `redirects` starts seeded with
 * every URL the live Kajabi site publishes, most of them pointing at pages that
 * do not exist yet — `targetExists = false` is the "still needs a page" flag,
 * and the cutover checklist is simply that count reaching zero.
 *
 * The 404 report is the other half: Appendix B lists the URLs the sitemap knows
 * about, and real traffic finds the rest — old PDFs, email footers, and links
 * from other people's blogs that nobody has an inventory of.
 */
export const adminRedirectsRouter = Router();

const redirectSchema = z.object({
  fromPath: z.string().min(1).max(2000),
  toPath: z.string().min(1).max(2000),
  statusCode: z.union([z.literal(301), z.literal(302), z.literal(307), z.literal(308)]).default(301),
  targetExists: z.boolean().default(true),
  note: z.string().max(500).default(""),
});

const redirectUpdateSchema = partialUpdate(redirectSchema);

/**
 * Targets must be site-relative.
 *
 * nginx composes the Location header as `https://$host$target`, so an absolute
 * URL here would produce a malformed redirect. The generator refuses to build a
 * map containing one, which means an off-site target saved through this screen
 * would silently stop the whole map from regenerating.
 */
function assertRelativeTarget(toPath: string): void {
  if (!toPath.startsWith("/")) {
    throw badRequest("The destination needs to be a path on this site, starting with a slash.");
  }
}

adminRedirectsRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const rows = await listRedirects();
    const pending = rows.filter((r) => !r.targetExists).length;
    res.json({ items: rows, total: rows.length, needingPages: pending });
  })
);

adminRedirectsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = redirectSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Please check the details.", parsed.error.flatten());

    const fromPath = normalizePath(parsed.data.fromPath);
    assertRelativeTarget(parsed.data.toPath);

    if (normalizePath(parsed.data.toPath) === fromPath) {
      throw badRequest("That would send the page to itself.");
    }

    const result = await pool.query(
      `INSERT INTO redirects (from_path, to_path, status_code, target_exists, note)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (from_path) DO NOTHING
       RETURNING id`,
      [
        fromPath,
        parsed.data.toPath,
        parsed.data.statusCode,
        parsed.data.targetExists,
        parsed.data.note,
      ]
    );

    if (!result.rows[0]) {
      throw badRequest("There's already a redirect for that address.");
    }

    // Anything matching this path in the 404 report is now handled, so it stops
    // appearing on the list of things to fix.
    await pool.query(`UPDATE not_found_log SET resolved = true WHERE path = $1`, [fromPath]);

    await recordAdminAction({
      req,
      action: "redirect.create",
      entityType: "redirect",
      entityId: result.rows[0].id,
      after: { fromPath, toPath: parsed.data.toPath },
    });

    res.status(201).json({ id: result.rows[0].id, fromPath, toPath: parsed.data.toPath });
  })
);

adminRedirectsRouter.put(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw badRequest("Invalid id");

    const parsed = redirectUpdateSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Please check the details.", parsed.error.flatten());
    if (parsed.data.toPath) assertRelativeTarget(parsed.data.toPath);

    const result = await pool.query(
      `UPDATE redirects
          SET from_path     = COALESCE($2, from_path),
              to_path       = COALESCE($3, to_path),
              status_code   = COALESCE($4, status_code),
              target_exists = COALESCE($5, target_exists),
              note          = COALESCE($6, note),
              updated_at    = now()
        WHERE id = $1
        RETURNING id, from_path, to_path`,
      [
        id,
        parsed.data.fromPath ? normalizePath(parsed.data.fromPath) : null,
        parsed.data.toPath ?? null,
        parsed.data.statusCode ?? null,
        parsed.data.targetExists ?? null,
        parsed.data.note ?? null,
      ]
    );

    const row = result.rows[0];
    if (!row) throw notFound("Redirect not found");

    await recordAdminAction({
      req,
      action: "redirect.update",
      entityType: "redirect",
      entityId: id,
      after: { fromPath: row.from_path, toPath: row.to_path },
    });

    res.json({ id: row.id, fromPath: row.from_path, toPath: row.to_path });
  })
);

adminRedirectsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw badRequest("Invalid id");

    const result = await pool.query(`DELETE FROM redirects WHERE id = $1 RETURNING from_path`, [id]);
    if (!result.rows[0]) throw notFound("Redirect not found");

    await recordAdminAction({
      req,
      action: "redirect.delete",
      entityType: "redirect",
      entityId: id,
      before: { fromPath: result.rows[0].from_path },
    });

    res.status(204).end();
  })
);

/**
 * The 404 report.
 *
 * Ordered by how much traffic each dead path is actually losing, because that
 * is the order they are worth fixing in — a path nobody visits does not need a
 * redirect however broken it is.
 */
adminRedirectsRouter.get(
  "/not-found",
  asyncHandler(async (req, res) => {
    const includeResolved = req.query.includeResolved === "true";
    const result = await pool.query(
      `SELECT id, path, referrer, hit_count, first_seen, last_seen, resolved
         FROM not_found_log
        WHERE ($1::boolean OR resolved = false)
        ORDER BY resolved, hit_count DESC, last_seen DESC
        LIMIT 500`,
      [includeResolved]
    );

    res.json(
      result.rows.map((r) => ({
        id: r.id,
        path: r.path,
        referrer: r.referrer,
        hitCount: r.hit_count,
        firstSeen: r.first_seen,
        lastSeen: r.last_seen,
        resolved: r.resolved,
      }))
    );
  })
);

adminRedirectsRouter.post(
  "/not-found/:id/dismiss",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw badRequest("Invalid id");

    const result = await pool.query(
      `UPDATE not_found_log SET resolved = true WHERE id = $1 RETURNING path`,
      [id]
    );
    if (!result.rows[0]) throw notFound("Not found");

    res.json({ ok: true });
  })
);
