import { Router } from "express";
import { pool } from "../../db/pool";
import { rowToCamel, rowsToCamel } from "../../utils/case";
import { asyncHandler } from "../../utils/asyncHandler";
import { badRequest, notFound } from "../../utils/httpError";
import { recordAdminAction } from "../../services/adminAudit";
import { isProtectedRef } from "../../services/signedUrls";
import {
  bundleContentsSchema,
  idParamSchema,
  productCreateSchema,
  productFileCreateSchema,
  productFileUpdateSchema,
  productListQuerySchema,
  productResourceIssue,
  productUpdateSchema,
  PRODUCT_RESOURCE_FIELDS,
  PRODUCT_RESOURCE_LABEL,
  type CommerceIssue,
  type ProductKind,
  type ProductResourceField,
  type ProductResources,
} from "../../validation/commerceSchemas";

/**
 * Products — the things access is granted to. Mounted at /admin/products.
 *
 * A product carries no price. That belongs to an offer, and keeping the two
 * apart is the whole point of Phase 2: one Practice Protection Pack sold at
 * seven prices is one product and seven offers, not seven products.
 */
export const adminProductsRouter = Router();

/* ------------------------------------------------------------------- shared */

// A type alias rather than an interface so a row can be handed straight to
// rowToCamel — only aliases carry the implicit index signature it asks for.
type ProductRow = {
  id: number;
  slug: string;
  title: string;
  subtitle: string;
  description: string;
  thumbnail_url: string;
  kind: ProductKind;
  course_id: number | null;
  community_id: number | null;
  podcast_id: number | null;
  newsletter_id: number | null;
  coaching_offer_id: number | null;
  status: string;
  sort: number;
  created_at: string;
  updated_at: string;
};

const PRODUCT_COLUMNS = `p.id, p.slug, p.title, p.subtitle, p.description, p.thumbnail_url,
       p.kind, p.course_id, p.community_id, p.podcast_id, p.newsletter_id,
       p.coaching_offer_id, p.status, p.sort, p.created_at, p.updated_at`;

function parseId(raw: string, label = "product"): number {
  const parsed = idParamSchema.safeParse(raw);
  if (!parsed.success) throw badRequest(`Invalid ${label} id`);
  return parsed.data;
}

/** Answers a cross-field problem in the shape zod's own `flatten()` produces. */
function issueError(issue: CommerceIssue) {
  return badRequest(issue.message, { formErrors: [], fieldErrors: { [issue.field]: [issue.message] } });
}

function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === "23505";
}

/**
 * Escapes the characters LIKE reads as syntax, so a search for "100%" finds the
 * literal string. The wildcards go in the *value*; the pattern reaches Postgres
 * as a bind parameter and never as query text.
 */
function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

async function loadProduct(id: number): Promise<ProductRow> {
  const result = await pool.query<ProductRow>(
    `SELECT ${PRODUCT_COLUMNS} FROM products p WHERE p.id = $1`,
    [id],
  );
  const row = result.rows[0];
  if (!row) throw notFound("Product not found");
  return row;
}

function resourcesOf(row: ProductRow): ProductResources {
  return {
    courseId: row.course_id,
    communityId: row.community_id,
    podcastId: row.podcast_id,
    newsletterId: row.newsletter_id,
    coachingOfferId: row.coaching_offer_id,
  };
}

/**
 * One literal statement per resource, chosen by an already-validated field name.
 * No table name is ever assembled from anything the request supplied.
 */
const RESOURCE_EXISTS_SQL: Record<ProductResourceField, string> = {
  courseId: `SELECT 1 FROM courses WHERE id = $1`,
  communityId: `SELECT 1 FROM communities WHERE id = $1`,
  podcastId: `SELECT 1 FROM podcasts WHERE id = $1`,
  newsletterId: `SELECT 1 FROM newsletters WHERE id = $1`,
  coachingOfferId: `SELECT 1 FROM coaching_offers WHERE id = $1`,
};

/** Turns a foreign key that would fail into a sentence naming what is missing. */
async function assertResourcesExist(resources: ProductResources): Promise<void> {
  for (const field of PRODUCT_RESOURCE_FIELDS) {
    const id = resources[field] ?? null;
    if (id === null) continue;
    const found = await pool.query(RESOURCE_EXISTS_SQL[field], [id]);
    if (found.rowCount === 0) {
      throw issueError({ field, message: `That ${PRODUCT_RESOURCE_LABEL[field]} no longer exists.` });
    }
  }
}

/** In an edit, `undefined` means "unchanged" and `null` means "clear it". */
function patched<T>(incoming: T | undefined, current: T): T {
  return incoming === undefined ? current : incoming;
}

/* -------------------------------------------------------------------- reads */

adminProductsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = productListQuerySchema.safeParse(req.query);
    if (!parsed.success) throw badRequest("Invalid query", parsed.error.flatten());
    const { q, kind, status } = parsed.data;

    const clauses: string[] = [];
    const params: unknown[] = [];
    if (q) {
      params.push(likePattern(q));
      clauses.push(`(p.title ILIKE $${params.length} OR p.slug ILIKE $${params.length})`);
    }
    if (kind) {
      params.push(kind);
      clauses.push(`p.kind = $${params.length}`);
    }
    if (status) {
      params.push(status);
      clauses.push(`p.status = $${params.length}`);
    }

    const result = await pool.query(
      `SELECT ${PRODUCT_COLUMNS},
              (SELECT COUNT(*)::int FROM offer_products op WHERE op.product_id = p.id) AS offer_count,
              (SELECT COUNT(*)::int FROM product_files f WHERE f.product_id = p.id) AS file_count,
              (SELECT COUNT(*)::int FROM access_grants g
                WHERE g.product_id = p.id AND g.status = 'active'
                  AND (g.expires_at IS NULL OR g.expires_at > now())) AS member_count
         FROM products p
         ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
        ORDER BY p.sort, p.title`,
      params,
    );

    res.json(rowsToCamel(result.rows));
  }),
);

adminProductsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const product = await loadProduct(id);

    const [files, bundleItems, offers] = await Promise.all([
      pool.query(
        `SELECT f.id, f.product_id, f.media_id, f.title, f.description, f.storage_path,
                f.filename, f.mime, f.size_bytes, f.download_count, f.sort,
                f.created_at, f.updated_at
           FROM product_files f WHERE f.product_id = $1 ORDER BY f.sort, f.id`,
        [id],
      ),
      pool.query(
        `SELECT bi.product_id, bi.sort, p.slug, p.title, p.kind, p.status
           FROM product_bundle_items bi
           JOIN products p ON p.id = bi.product_id
          WHERE bi.bundle_product_id = $1
          ORDER BY bi.sort, p.title`,
        [id],
      ),
      pool.query(
        `SELECT o.id, o.title, o.slug, o.status, o.pricing_type, o.amount_cents, o.currency
           FROM offer_products op
           JOIN offers o ON o.id = op.offer_id
          WHERE op.product_id = $1
          ORDER BY o.title`,
        [id],
      ),
    ]);

    res.json({
      ...rowToCamel(product),
      files: rowsToCamel(files.rows),
      bundleItems: rowsToCamel(bundleItems.rows),
      offers: rowsToCamel(offers.rows),
    });
  }),
);

/* ------------------------------------------------------------------- writes */

adminProductsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = productCreateSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Invalid payload", parsed.error.flatten());
    const data = parsed.data;

    await assertResourcesExist(data);

    let created: ProductRow | undefined;
    try {
      const result = await pool.query<ProductRow>(
        `INSERT INTO products AS p
           (slug, title, subtitle, description, thumbnail_url, kind, course_id,
            community_id, podcast_id, newsletter_id, coaching_offer_id, status, sort)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         RETURNING ${PRODUCT_COLUMNS}`,
        [
          data.slug,
          data.title,
          data.subtitle,
          data.description,
          data.thumbnailUrl,
          data.kind,
          data.courseId,
          data.communityId,
          data.podcastId,
          data.newsletterId,
          data.coachingOfferId,
          data.status,
          data.sort,
        ],
      );
      created = result.rows[0];
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw issueError({
          field: "slug",
          message: `The web address "${data.slug}" is already taken by another product.`,
        });
      }
      throw err;
    }

    if (!created) throw badRequest("Product could not be saved");
    const json = rowToCamel(created);

    await recordAdminAction({
      req,
      action: "product.create",
      entityType: "product",
      entityId: created.id,
      after: json,
    });

    res.status(201).json(json);
  }),
);

adminProductsRouter.put(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const parsed = productUpdateSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Invalid payload", parsed.error.flatten());
    const patch = parsed.data;

    const before = await loadProduct(id);

    // Validated against the row the edit produces, not against the fields it
    // carries: changing only `kind` on a course product has to be caught, and a
    // schema that sees one field cannot see that.
    const current = resourcesOf(before);
    const merged = {
      kind: patched(patch.kind, before.kind),
      courseId: patched(patch.courseId, current.courseId ?? null),
      communityId: patched(patch.communityId, current.communityId ?? null),
      podcastId: patched(patch.podcastId, current.podcastId ?? null),
      newsletterId: patched(patch.newsletterId, current.newsletterId ?? null),
      coachingOfferId: patched(patch.coachingOfferId, current.coachingOfferId ?? null),
    };

    const issue = productResourceIssue(merged.kind, merged);
    if (issue) throw issueError(issue);
    await assertResourcesExist(merged);

    let after: ProductRow | undefined;
    try {
      const result = await pool.query<ProductRow>(
        `UPDATE products AS p
            SET slug              = $1,
                title             = $2,
                subtitle          = $3,
                description       = $4,
                thumbnail_url     = $5,
                kind              = $6,
                course_id         = $7,
                community_id      = $8,
                podcast_id        = $9,
                newsletter_id     = $10,
                coaching_offer_id = $11,
                status            = $12,
                sort              = $13,
                updated_at        = now()
          WHERE p.id = $14
         RETURNING ${PRODUCT_COLUMNS}`,
        [
          patched(patch.slug, before.slug),
          patched(patch.title, before.title),
          patched(patch.subtitle, before.subtitle),
          patched(patch.description, before.description),
          patched(patch.thumbnailUrl, before.thumbnail_url),
          merged.kind,
          merged.courseId,
          merged.communityId,
          merged.podcastId,
          merged.newsletterId,
          merged.coachingOfferId,
          patched(patch.status, before.status),
          patched(patch.sort, before.sort),
          id,
        ],
      );
      after = result.rows[0];
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw issueError({ field: "slug", message: "That web address is already taken by another product." });
      }
      throw err;
    }

    if (!after) throw notFound("Product not found");
    const json = rowToCamel(after);

    await recordAdminAction({
      req,
      action: "product.update",
      entityType: "product",
      entityId: id,
      before: rowToCamel(before),
      after: json,
    });

    res.json(json);
  }),
);

/**
 * DELETE /admin/products/:id
 *
 * Refuses rather than cascades. `offer_products` and `access_grants` both hang
 * off this row with ON DELETE CASCADE, so removing a product that is in use
 * silently strips it from the offers that sell it and erases the entitlement of
 * everyone who bought it — leaving no record that they ever had it.
 */
adminProductsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const product = await loadProduct(id);

    const usage = await pool.query<{ offers: number; members: number; bundles: number }>(
      `SELECT (SELECT COUNT(*)::int FROM offer_products op WHERE op.product_id = $1) AS offers,
              (SELECT COUNT(*)::int FROM access_grants g
                WHERE g.product_id = $1 AND g.status = 'active') AS members,
              (SELECT COUNT(*)::int FROM product_bundle_items bi WHERE bi.product_id = $1) AS bundles`,
      [id],
    );
    const offers = usage.rows[0]?.offers ?? 0;
    const members = usage.rows[0]?.members ?? 0;
    const bundles = usage.rows[0]?.bundles ?? 0;

    if (members > 0) {
      throw badRequest(
        `${members} ${members === 1 ? "person has" : "people have"} access to "${product.title}". ` +
          `Deleting it would take it out of their library and erase the record of what they bought. ` +
          `Set it to Archived instead.`,
      );
    }
    if (offers > 0) {
      throw badRequest(
        `"${product.title}" is sold by ${offers} ${offers === 1 ? "offer" : "offers"}. ` +
          `Remove it from those offers first, or set it to Archived.`,
      );
    }
    if (bundles > 0) {
      throw badRequest(
        `"${product.title}" is part of ${bundles} ${bundles === 1 ? "bundle" : "bundles"}. ` +
          `Take it out of them first.`,
      );
    }

    await pool.query(`DELETE FROM products WHERE id = $1`, [id]);

    await recordAdminAction({
      req,
      action: "product.delete",
      entityType: "product",
      entityId: id,
      before: rowToCamel(product),
    });

    res.status(204).end();
  }),
);

/* -------------------------------------------------------------------- files */

const FILE_COLUMNS = `f.id, f.product_id, f.media_id, f.title, f.description, f.storage_path,
       f.filename, f.mime, f.size_bytes, f.download_count, f.sort, f.created_at, f.updated_at`;

// size_bytes is BIGINT, which pg hands back as a string rather than risk the
// silent precision loss of a JS number.
type ProductFileRow = {
  id: number;
  product_id: number;
  media_id: number | null;
  title: string;
  description: string;
  storage_path: string;
  filename: string;
  mime: string;
  size_bytes: string;
  download_count: number;
  sort: number;
  created_at: string;
  updated_at: string;
};

async function assertMediaExists(mediaId: number | null): Promise<void> {
  if (mediaId === null) return;
  const found = await pool.query(`SELECT 1 FROM media_assets WHERE id = $1`, [mediaId]);
  if (found.rowCount === 0) {
    throw issueError({ field: "mediaId", message: "That file is no longer in the media library." });
  }
}

/**
 * A product's files are the thing somebody paid for.
 *
 * They are delivered by a signed link that expires and knows whose it is, and
 * none of that means anything if the same bytes also sit at an address the
 * customer can copy out of the page and post. A file uploaded for everyone
 * already has such an address, so attaching one here is refused rather than
 * silently sold.
 */
function assertProtectedFile(storagePath: string): void {
  if (isProtectedRef(storagePath)) return;
  throw issueError({
    field: "storagePath",
    message:
      "That file was uploaded for everyone, so anyone with the web address can open it without paying. " +
      "Upload it again and choose 'only people who bought it'.",
  });
}

adminProductsRouter.get(
  "/:id/files",
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    await loadProduct(id);

    const result = await pool.query(
      `SELECT ${FILE_COLUMNS} FROM product_files f WHERE f.product_id = $1 ORDER BY f.sort, f.id`,
      [id],
    );
    res.json(rowsToCamel(result.rows));
  }),
);

adminProductsRouter.post(
  "/:id/files",
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const parsed = productFileCreateSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Invalid payload", parsed.error.flatten());
    const data = parsed.data;

    await loadProduct(id);
    await assertMediaExists(data.mediaId);
    assertProtectedFile(data.storagePath);

    const result = await pool.query<ProductFileRow>(
      `INSERT INTO product_files AS f
         (product_id, media_id, title, description, storage_path, filename, mime, size_bytes, sort)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING ${FILE_COLUMNS}`,
      [
        id,
        data.mediaId,
        data.title,
        data.description,
        data.storagePath,
        data.filename,
        data.mime,
        data.sizeBytes,
        data.sort,
      ],
    );

    const created = result.rows[0];
    if (!created) throw badRequest("File could not be saved");
    const json = rowToCamel(created);

    await recordAdminAction({
      req,
      action: "product.file_add",
      entityType: "product",
      entityId: id,
      after: json,
    });

    res.status(201).json(json);
  }),
);

adminProductsRouter.put(
  "/:id/files/:fileId",
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const fileId = parseId(req.params.fileId, "file");
    const parsed = productFileUpdateSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Invalid payload", parsed.error.flatten());
    const patch = parsed.data;

    // Constrained by product as well as file id, so a file belonging to another
    // product cannot be edited through this product's URL.
    const existing = await pool.query<ProductFileRow>(
      `SELECT ${FILE_COLUMNS} FROM product_files f WHERE f.id = $1 AND f.product_id = $2`,
      [fileId, id],
    );
    const before = existing.rows[0];
    if (!before) throw notFound("File not found");

    if (patch.mediaId !== undefined) await assertMediaExists(patch.mediaId);
    if (patch.storagePath !== undefined) assertProtectedFile(patch.storagePath);

    // Merged in JS rather than with COALESCE, because a request clearing the
    // media link sends null and COALESCE cannot tell that from an absent key.
    const result = await pool.query<ProductFileRow>(
      `UPDATE product_files AS f
          SET media_id     = $1,
              title        = $2,
              description  = $3,
              storage_path = $4,
              filename     = $5,
              mime         = $6,
              size_bytes   = $7,
              sort         = $8,
              updated_at   = now()
        WHERE f.id = $9 AND f.product_id = $10
       RETURNING ${FILE_COLUMNS}`,
      [
        patched(patch.mediaId, before.media_id),
        patched(patch.title, before.title),
        patched(patch.description, before.description),
        patched(patch.storagePath, before.storage_path),
        patched(patch.filename, before.filename),
        patched(patch.mime, before.mime),
        patch.sizeBytes === undefined ? before.size_bytes : patch.sizeBytes,
        patched(patch.sort, before.sort),
        fileId,
        id,
      ],
    );

    const after = result.rows[0];
    if (!after) throw notFound("File not found");
    const json = rowToCamel(after);

    await recordAdminAction({
      req,
      action: "product.file_update",
      entityType: "product",
      entityId: id,
      before: rowToCamel(before),
      after: json,
    });

    res.json(json);
  }),
);

adminProductsRouter.delete(
  "/:id/files/:fileId",
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const fileId = parseId(req.params.fileId, "file");

    const result = await pool.query<ProductFileRow>(
      `DELETE FROM product_files AS f WHERE f.id = $1 AND f.product_id = $2 RETURNING ${FILE_COLUMNS}`,
      [fileId, id],
    );
    const removed = result.rows[0];
    if (!removed) throw notFound("File not found");

    await recordAdminAction({
      req,
      action: "product.file_delete",
      entityType: "product",
      entityId: id,
      before: rowToCamel(removed),
    });

    res.status(204).end();
  }),
);

/* ------------------------------------------------------------------- bundle */

adminProductsRouter.get(
  "/:id/bundle",
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const product = await loadProduct(id);

    const result = await pool.query(
      `SELECT bi.product_id, bi.sort, p.slug, p.title, p.kind, p.status, p.thumbnail_url
         FROM product_bundle_items bi
         JOIN products p ON p.id = bi.product_id
        WHERE bi.bundle_product_id = $1
        ORDER BY bi.sort, p.title`,
      [id],
    );

    res.json({ productId: id, kind: product.kind, items: rowsToCamel(result.rows) });
  }),
);

/**
 * PUT /admin/products/:id/bundle — replaces the whole contents.
 *
 * Whole-set rather than add-one/remove-one because the editor shows a bundle as
 * a single list, and sending the list that is on screen is the only version that
 * cannot leave a stray product behind when two tabs are open on it.
 */
adminProductsRouter.put(
  "/:id/bundle",
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const parsed = bundleContentsSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Invalid payload", parsed.error.flatten());
    const { items } = parsed.data;

    const bundle = await loadProduct(id);
    if (bundle.kind !== "bundle") {
      throw badRequest(
        `"${bundle.title}" is not a bundle. Change its type to Bundle before putting products inside it.`,
      );
    }

    const wanted = new Set<number>();
    for (const item of items) {
      if (item.productId === id) throw badRequest("A bundle cannot contain itself.");
      if (wanted.has(item.productId)) throw badRequest("The same product is listed twice.");
      wanted.add(item.productId);
    }

    if (wanted.size > 0) {
      const contents = await pool.query<{ id: number; title: string; kind: ProductKind }>(
        `SELECT id, title, kind FROM products WHERE id = ANY($1::int[])`,
        [[...wanted]],
      );
      if (contents.rows.length !== wanted.size) {
        throw badRequest("One of the products in this bundle no longer exists.");
      }
      // access.ts expands a bundle exactly one level when it grants an offer, so
      // a bundle nested inside a bundle is paid for and never delivered.
      const nested = contents.rows.find((row) => row.kind === "bundle");
      if (nested) {
        throw badRequest(
          `"${nested.title}" is itself a bundle, and a bundle inside a bundle is not delivered. ` +
            `Add its contents to this bundle directly instead.`,
        );
      }
    }

    const before = await pool.query(
      `SELECT product_id, sort FROM product_bundle_items WHERE bundle_product_id = $1 ORDER BY sort`,
      [id],
    );

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`DELETE FROM product_bundle_items WHERE bundle_product_id = $1`, [id]);
      for (const item of items) {
        await client.query(
          `INSERT INTO product_bundle_items (bundle_product_id, product_id, sort) VALUES ($1, $2, $3)`,
          [id, item.productId, item.sort],
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }

    const after = await pool.query(
      `SELECT bi.product_id, bi.sort, p.slug, p.title, p.kind, p.status
         FROM product_bundle_items bi
         JOIN products p ON p.id = bi.product_id
        WHERE bi.bundle_product_id = $1
        ORDER BY bi.sort, p.title`,
      [id],
    );

    await recordAdminAction({
      req,
      action: "product.bundle_update",
      entityType: "product",
      entityId: id,
      before: rowsToCamel(before.rows),
      after: rowsToCamel(after.rows),
    });

    res.json({ productId: id, items: rowsToCamel(after.rows) });
  }),
);
