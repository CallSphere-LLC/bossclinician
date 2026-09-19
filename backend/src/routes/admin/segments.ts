import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool";
import { rowToCamel, rowsToCamel } from "../../utils/case";
import { asyncHandler } from "../../utils/asyncHandler";
import { badRequest, notFound } from "../../utils/httpError";
import { recordAdminAction } from "../../services/adminAudit";
import { normaliseSlugs } from "../../services/contacts";
import {
  countSegment,
  listSegmentContacts,
  segmentDefinitionSchema,
} from "../../services/segments";

/**
 * Segments, mounted at /admin/segments.
 *
 * A segment is a saved question — "everyone who bought the masterclass and has
 * not been active since March" — kept as rules rather than as SQL. The rules are
 * compiled in services/segments.ts, which is where the allowlist that makes that
 * safe lives; nothing in this file interprets a rule itself.
 */
export const adminSegmentsRouter = Router();

const SEGMENT_COLUMNS = `id, name, slug::text AS slug, description, definition,
       contact_count, counted_at, created_at, updated_at`;

const idSchema = z.coerce.number().int().positive();

function parseId(raw: string): number {
  const parsed = idSchema.safeParse(raw);
  if (!parsed.success) throw badRequest("Invalid segment id");
  return parsed.data;
}

adminSegmentsRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const result = await pool.query(
      `SELECT ${SEGMENT_COLUMNS} FROM segments ORDER BY lower(name)`
    );
    res.json(rowsToCamel(result.rows));
  })
);

/**
 * GET /options — the choices a rule can point at.
 *
 * The builder cannot ask somebody to type an offer's identifier, so it needs the
 * things she might pick by name. Returned as one call because three round trips
 * to populate one dropdown row is three chances for the screen to render empty.
 */
adminSegmentsRouter.get(
  "/options",
  asyncHandler(async (_req, res) => {
    const [tags, offers, sequences] = await Promise.all([
      pool.query(`SELECT slug::text AS slug, name FROM tags ORDER BY lower(name)`),
      pool.query(
        `SELECT id, title FROM offers WHERE status <> 'archived' ORDER BY lower(title)`
      ),
      pool.query(
        `SELECT id, name FROM email_sequences WHERE status <> 'archived' ORDER BY lower(name)`
      ),
    ]);

    res.json({
      tags: rowsToCamel(tags.rows),
      offers: rowsToCamel(offers.rows),
      sequences: rowsToCamel(sequences.rows),
    });
  })
);

const previewSchema = z.object({
  definition: segmentDefinitionSchema,
});

/**
 * POST /preview — how many people a set of rules finds, before it is saved.
 *
 * The count and a first page of names come back together: a number on its own
 * is not enough for somebody to tell "everyone who bought X" from "everyone who
 * did not", and the twenty names are how the rules get checked before a mailing
 * goes out to them.
 */
adminSegmentsRouter.post(
  "/preview",
  asyncHandler(async (req, res) => {
    const parsed = previewSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Invalid payload", parsed.error.flatten());

    const definition = parsed.data.definition;
    const [count, contacts] = await Promise.all([
      countSegment(definition),
      listSegmentContacts(definition, { limit: 20, offset: 0 }),
    ]);

    res.json({ count, items: rowsToCamel(contacts) });
  })
);

export const createSchema = z.object({
  name: z.string().trim().min(1).max(140),
  description: z.string().trim().max(500).optional(),
  definition: segmentDefinitionSchema,
});

adminSegmentsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Invalid payload", parsed.error.flatten());
    const { name, definition } = parsed.data;

    // Compiled before it is stored. A definition that cannot be turned into a
    // query must not reach the table, because the next thing to read it is a
    // background job with nobody watching.
    const count = await countSegment(definition);

    const [slug] = normaliseSlugs([name]);
    if (!slug) throw badRequest("Give this group a name with some letters or numbers in it");

    const existing = await pool.query(`SELECT 1 FROM segments WHERE slug = $1::citext`, [slug]);
    if (existing.rowCount) throw badRequest("You already have a group with that name");

    const result = await pool.query(
      `INSERT INTO segments (name, slug, description, definition, contact_count, counted_at)
       VALUES ($1, $2, $3, $4::jsonb, $5, now())
       RETURNING ${SEGMENT_COLUMNS}`,
      [name, slug, parsed.data.description ?? "", JSON.stringify(definition), count]
    );

    await recordAdminAction({
      req,
      action: "segment.create",
      entityType: "segment",
      entityId: result.rows[0].id,
      after: { name, slug, count },
    });

    res.status(201).json(rowToCamel(result.rows[0]));
  })
);

adminSegmentsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const result = await pool.query(`SELECT ${SEGMENT_COLUMNS} FROM segments WHERE id = $1`, [id]);
    if (result.rowCount === 0) throw notFound("Segment not found");
    res.json(rowToCamel(result.rows[0]));
  })
);

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

adminSegmentsRouter.get(
  "/:id/contacts",
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) throw badRequest("Invalid query", parsed.error.flatten());
    const { page, limit } = parsed.data;

    const segment = await pool.query<{ definition: unknown }>(
      `SELECT ${SEGMENT_COLUMNS} FROM segments WHERE id = $1`,
      [id]
    );
    if (segment.rowCount === 0) throw notFound("Segment not found");

    const definition = segment.rows[0].definition;
    const [count, items] = await Promise.all([
      countSegment(definition),
      listSegmentContacts(definition, { limit, offset: (page - 1) * limit }),
    ]);

    res.json({
      segment: rowToCamel(segment.rows[0]),
      items: rowsToCamel(items),
      total: count,
      page,
      pageSize: limit,
    });
  })
);

export const updateSchema = z.object({
  name: z.string().trim().min(1).max(140).optional(),
  description: z.string().trim().max(500).optional(),
  definition: segmentDefinitionSchema.optional(),
});

adminSegmentsRouter.put(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Invalid payload", parsed.error.flatten());
    const { name, description, definition } = parsed.data;

    const count = definition === undefined ? null : await countSegment(definition);

    const result = await pool.query(
      `UPDATE segments AS s
          SET name        = COALESCE($2::text, s.name),
              description = COALESCE($3::text, s.description),
              definition  = COALESCE($4::jsonb, s.definition),
              contact_count = COALESCE($5::int, s.contact_count),
              counted_at    = CASE WHEN $5::int IS NULL THEN s.counted_at ELSE now() END,
              updated_at  = now()
        WHERE s.id = $1
       RETURNING ${SEGMENT_COLUMNS}`,
      [
        id,
        name ?? null,
        description ?? null,
        definition === undefined ? null : JSON.stringify(definition),
        count,
      ]
    );
    if (result.rowCount === 0) throw notFound("Segment not found");

    await recordAdminAction({
      req,
      action: "segment.update",
      entityType: "segment",
      entityId: id,
      after: { name, count },
    });

    res.json(rowToCamel(result.rows[0]));
  })
);

/**
 * DELETE /:id
 *
 * `email_campaigns.segment_id` is `ON DELETE SET NULL`, so a broadcast that was
 * sent to this group keeps its own record of having been sent — it simply stops
 * naming a group that no longer exists.
 *
 * A campaign that has NOT gone out yet is a different matter, and the reason
 * for the check below. `resolveAudience` reads the segment when there is one and
 * falls back to the legacy `audience` column when there is not — and that column
 * defaults to `all_subscribers`. So deleting a group that a scheduled email is
 * pointed at does not cancel the email; it silently re-points it at the entire
 * list, and the next tick sends it with nobody in the loop.
 *
 * The check is written as "anything that is not finished" rather than as a list
 * of the states that block. The list version named draft, scheduled and sending
 * and left out `failed` — which services/broadcasts.ts writes whenever a send
 * cannot start, and which the console still offers a Send button for. Deleting a
 * group a failed campaign pointed at, then pressing Send, mailed the whole list.
 * `status` has no CHECK constraint behind it and is writable through the generic
 * campaigns CRUD route, so any list of blocking states is a list that can be
 * walked around; `sent` is the only state from which the segment genuinely no
 * longer matters, because that campaign will never resolve an audience again.
 */
adminSegmentsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);

    const inUse = await pool.query<{ name: string }>(
      `SELECT name FROM email_campaigns
        WHERE segment_id = $1 AND status <> 'sent'
        ORDER BY id
        LIMIT 3`,
      [id]
    );
    if (inUse.rowCount) {
      throw badRequest(
        `This group is still chosen as the audience for ${inUse.rows
          .map((row) => `"${row.name}"`)
          .join(", ")}. Point those emails at another group first.`
      );
    }

    const result = await pool.query(`DELETE FROM segments WHERE id = $1`, [id]);
    if (result.rowCount === 0) throw notFound("Segment not found");

    await recordAdminAction({
      req,
      action: "segment.delete",
      entityType: "segment",
      entityId: id,
    });

    res.status(204).end();
  })
);
