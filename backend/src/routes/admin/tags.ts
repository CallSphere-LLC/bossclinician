import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool";
import { rowToCamel, rowsToCamel } from "../../utils/case";
import { asyncHandler } from "../../utils/asyncHandler";
import { badRequest, notFound } from "../../utils/httpError";
import { recordAdminAction } from "../../services/adminAudit";
import { normaliseSlugs } from "../../services/contacts";

/**
 * Tags, mounted at /admin/tags.
 *
 * The name is what the owner reads and renames; the slug is what automations,
 * imports and segment rules match on, and it never changes after creation. That
 * split is the whole reason `slug` exists: renaming "Quiz — Steady Grower" must
 * not silently detach every rule that referenced it.
 */
export const adminTagsRouter = Router();

const TAG_COLUMNS = `id, name, slug::text AS slug, colour, description, contact_count,
       created_at, updated_at`;

const idSchema = z.coerce.number().int().positive();

function parseId(raw: string): number {
  const parsed = idSchema.safeParse(raw);
  if (!parsed.success) throw badRequest("Invalid tag id");
  return parsed.data;
}

/**
 * The live count, rather than the denormalised one.
 *
 * `tags.contact_count` is refreshed by the rollup job and is right for a list
 * of forty tags read a hundred times a day; this screen is where somebody
 * decides whether a tag is safe to delete, and being an hour stale there is the
 * difference between "nobody has this" and "two hundred people do".
 */
const LIVE_COUNT = `(SELECT COUNT(*)::int FROM contact_tags ct WHERE ct.tag_id = t.id) AS contact_count`;

adminTagsRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const result = await pool.query(
      `SELECT t.id, t.name, t.slug::text AS slug, t.colour, t.description,
              ${LIVE_COUNT}, t.created_at, t.updated_at
         FROM tags t
        ORDER BY lower(t.name)`
    );
    res.json(rowsToCamel(result.rows));
  })
);

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  colour: z.string().trim().max(20).optional(),
  description: z.string().trim().max(500).optional(),
});

adminTagsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Invalid payload", parsed.error.flatten());
    const { name } = parsed.data;

    // Derived here rather than asked for: the owner types a name, and the
    // identifier the rest of the platform matches on is our problem.
    const [slug] = normaliseSlugs([name]);
    if (!slug) throw badRequest("Give the tag a name with some letters or numbers in it");

    const existing = await pool.query(`SELECT 1 FROM tags WHERE slug = $1::citext`, [slug]);
    if (existing.rowCount) throw badRequest("You already have a tag with that name");

    const result = await pool.query(
      `INSERT INTO tags (name, slug, colour, description)
       VALUES ($1, $2, $3, $4)
       RETURNING ${TAG_COLUMNS}`,
      [name, slug, parsed.data.colour ?? "", parsed.data.description ?? ""]
    );

    await recordAdminAction({
      req,
      action: "tag.create",
      entityType: "tag",
      entityId: result.rows[0].id,
      after: { name, slug },
    });

    res.status(201).json(rowToCamel(result.rows[0]));
  })
);

const updateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  colour: z.string().trim().max(20).optional(),
  description: z.string().trim().max(500).optional(),
});

/** The slug is absent from the editable set on purpose — see the file comment. */
adminTagsRouter.put(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Invalid payload", parsed.error.flatten());
    const { name, colour, description } = parsed.data;

    const result = await pool.query(
      `UPDATE tags AS t
          SET name        = COALESCE($2::text, t.name),
              colour      = COALESCE($3::text, t.colour),
              description = COALESCE($4::text, t.description),
              updated_at  = now()
        WHERE t.id = $1
       RETURNING ${TAG_COLUMNS}`,
      [id, name ?? null, colour ?? null, description ?? null]
    );
    if (result.rowCount === 0) throw notFound("Tag not found");

    await recordAdminAction({
      req,
      action: "tag.update",
      entityType: "tag",
      entityId: id,
      after: { name },
    });

    res.json(rowToCamel(result.rows[0]));
  })
);

/**
 * DELETE /:id
 *
 * The tag goes and `contact_tags` cascades, so every contact loses it. Nobody
 * loses anything else — a tag is a label, not a record — but a segment or
 * automation matching on that slug quietly starts matching nothing, which is
 * why the screen says how many people have it before asking.
 */
adminTagsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const result = await pool.query(`DELETE FROM tags WHERE id = $1 RETURNING slug::text AS slug`, [
      id,
    ]);
    if (result.rowCount === 0) throw notFound("Tag not found");

    await recordAdminAction({
      req,
      action: "tag.delete",
      entityType: "tag",
      entityId: id,
      before: { slug: result.rows[0].slug },
    });

    res.status(204).end();
  })
);

const contactsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

adminTagsRouter.get(
  "/:id/contacts",
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const parsed = contactsQuerySchema.safeParse(req.query);
    if (!parsed.success) throw badRequest("Invalid query", parsed.error.flatten());
    const { page, limit } = parsed.data;

    const tag = await pool.query(`SELECT ${TAG_COLUMNS} FROM tags WHERE id = $1`, [id]);
    if (tag.rowCount === 0) throw notFound("Tag not found");

    const [items, total] = await Promise.all([
      pool.query(
        `SELECT c.id, c.email::text AS email, c.name, c.email_marketing_status,
                c.lifetime_value_cents, c.order_count, c.last_activity_at, ct.created_at AS tagged_at
           FROM contact_tags ct
           JOIN contacts c ON c.id = ct.contact_id
          WHERE ct.tag_id = $1
          ORDER BY ct.created_at DESC, c.id DESC
          LIMIT $2 OFFSET $3`,
        [id, limit, (page - 1) * limit]
      ),
      pool.query<{ count: number }>(
        `SELECT COUNT(*)::int AS count FROM contact_tags WHERE tag_id = $1`,
        [id]
      ),
    ]);

    res.json({
      tag: rowToCamel(tag.rows[0]),
      items: rowsToCamel(items.rows),
      total: total.rows[0]?.count ?? 0,
      page,
      pageSize: limit,
    });
  })
);
