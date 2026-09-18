import { Router, type Request } from "express";
import multer from "multer";
import path from "path";
import crypto from "crypto";
import fs from "fs";
import { z } from "zod";
import { pool } from "../../db/pool";
import { asyncHandler } from "../../utils/asyncHandler";
import { badRequest, conflict, notFound } from "../../utils/httpError";
import { adminPreviewUrl, isProtectedRef, protectedRef } from "../../services/signedUrls";
import { toMediaJson } from "../../services/mediaAssets";
import {
  VISIBILITIES,
  ensureStorageDirs,
  kindFromMime,
  resolveMime,
  storageDir,
  storedExtension,
  unsupportedTypeMessage,
  type Visibility,
} from "../../services/mediaStorage";
import { adminMediaUploadsRouter } from "./mediaUploads";
import { env } from "../../config/env";

export const adminMediaRouter = Router();

ensureStorageDirs();

// Re-exported: the file-type rules moved to services/mediaStorage so the
// resumable upload path applies exactly the same ones, and media.test.ts pins
// them here, where the stored-XSS bug they exist to prevent was found.
export { resolveMime, storedExtension };
export type { MediaAsset } from "../../services/mediaAssets";

const uploadQuerySchema = z.object({ visibility: z.enum(VISIBILITIES) });

const VISIBILITY_REQUIRED =
  "Say whether this file is for everyone or only for people who bought it.";

/**
 * Fails closed.
 *
 * The upload route validates the query before a byte is read, so an unusable
 * value never reaches here. If one ever did, the safe place to put a file is the
 * directory nobody can browse.
 */
function requestedVisibility(req: Request): Visibility {
  const parsed = uploadQuerySchema.safeParse(req.query);
  return parsed.success ? parsed.data.visibility : "protected";
}

/** The signed-in administrator. Non-null: every route here is behind requireAuth. */
function adminId(req: Request): number {
  return Number(req.user?.sub);
}

const storage = multer.diskStorage({
  destination: (req, _file, cb) => cb(null, storageDir(requestedVisibility(req))),
  filename: (_req, file, cb) => {
    const ext = storedExtension(file.mimetype, file.originalname);
    const name = `${crypto.randomBytes(8).toString("hex")}${ext}`;
    cb(null, name);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: env.maxUploadMb * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!resolveMime(file.mimetype, file.originalname)) {
      cb(new Error(unsupportedTypeMessage(file.mimetype)));
      return;
    }
    cb(null, true);
  },
});

/**
 * Resumable uploads, mounted first.
 *
 * Ahead of the `/:id` routes below because `/uploads` is a single path segment
 * and would otherwise be read as the id of an asset to rename or delete.
 */
adminMediaRouter.use("/uploads", adminMediaUploadsRouter);

const MAX_TAGS = 20;
const MAX_TAG_LENGTH = 40;
const MAX_FOLDER_LENGTH = 80;

/**
 * Tags as they are stored: lower-cased, single-spaced, no leading "#", no
 * repeats, first mention wins the position.
 *
 * Lower-cased because "Workbook" and "workbook" are one label to the person who
 * typed them and two to `= ANY(tags)`.
 */
export function normaliseTags(raw: readonly string[]): string[] {
  const seen = new Set<string>();
  for (const value of raw) {
    const tag = value
      .trim()
      .replace(/^#+/, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase()
      .slice(0, MAX_TAG_LENGTH)
      .trim();
    if (tag !== "") seen.add(tag);
    if (seen.size >= MAX_TAGS) break;
  }
  return Array.from(seen);
}

/**
 * A folder is a name, not a path: one level, no slashes to build a tree the
 * screen has no way to draw. "" means "not in a folder".
 */
export function normaliseFolder(raw: string): string {
  return raw
    .replace(/[\\\/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_FOLDER_LENGTH)
    .trim();
}

/** What PATCH /admin/media/:id accepts. Every key optional, at least one present. */
export const mediaPatchSchema = z
  .object({
    title: z.string().trim().max(300).optional(),
    folder: z.string().max(200).transform(normaliseFolder).optional(),
    altText: z.string().trim().max(500).optional(),
    tags: z.array(z.string().max(200)).max(100).transform(normaliseTags).optional(),
  })
  .refine(
    (patch) =>
      patch.title !== undefined ||
      patch.folder !== undefined ||
      patch.altText !== undefined ||
      patch.tags !== undefined,
    { message: "Nothing to change" },
  );

export interface MediaListFilters {
  kind?: string;
  /** Present and empty means "not in a folder"; absent means every folder. */
  folder?: string;
  tag?: string;
  q?: string;
}

/**
 * The library query for a set of filters.
 *
 * Pure, so media.test.ts can pin that each filter is a bound parameter and
 * that a search reaches tags and alt text as well as the two names.
 */
export function buildMediaListQuery(filters: MediaListFilters): { text: string; values: unknown[] } {
  const where: string[] = [];
  const values: unknown[] = [];
  const bind = (value: unknown): string => {
    values.push(value);
    return `$${values.length}`;
  };

  if (filters.kind && filters.kind !== "all") where.push(`kind = ${bind(filters.kind)}`);
  if (filters.folder !== undefined) where.push(`folder = ${bind(normaliseFolder(filters.folder))}`);

  const tag = filters.tag === undefined ? undefined : normaliseTags([filters.tag])[0];
  if (tag !== undefined) where.push(`${bind(tag)} = ANY(tags)`);

  const q = filters.q?.trim().slice(0, 200) ?? "";
  if (q !== "") {
    const like = bind(`%${q.replace(/[\\%_]/g, (char) => `\\${char}`)}%`);
    where.push(
      `(title ILIKE ${like} ESCAPE '\\' OR original_name ILIKE ${like} ESCAPE '\\'
        OR alt_text ILIKE ${like} ESCAPE '\\'
        OR EXISTS (SELECT 1 FROM unnest(tags) AS t(tag) WHERE t.tag ILIKE ${like} ESCAPE '\\'))`,
    );
  }

  return {
    text: `SELECT * FROM media_assets${where.length > 0 ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at DESC`,
    values,
  };
}

function queryString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/**
 * GET /admin/media?kind=video&folder=Workbooks&tag=intake&q=consent — newest first.
 *
 * Every filter is optional and they narrow together. `folder=` with nothing
 * after it asks for the files that are not in a folder.
 */
adminMediaRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const query = buildMediaListQuery({
      kind: queryString(req.query.kind),
      folder: queryString(req.query.folder),
      tag: queryString(req.query.tag),
      q: queryString(req.query.q),
    });
    const result = await pool.query(query.text, query.values);
    res.json(result.rows.map((row) => toMediaJson(row, adminId(req))));
  }),
);

/**
 * GET /admin/media/folders — every folder in use, with how many files it holds.
 *
 * Above the `/:id` routes for the same reason `/uploads` is: a single path
 * segment that would otherwise be read as an asset id. A folder exists only
 * while something is in it, so there is no table of them to keep in step.
 */
adminMediaRouter.get(
  "/folders",
  asyncHandler(async (_req, res) => {
    const result = await pool.query<{ folder: string; count: number }>(
      `SELECT folder, count(*)::int AS count
         FROM media_assets
        WHERE folder <> ''
        GROUP BY folder
        ORDER BY lower(folder)`,
    );
    res.json(result.rows.map((row) => ({ name: row.folder, count: row.count })));
  }),
);

/**
 * The library row for a file already stored under this name for this audience.
 *
 * The same rule the resumable path applies before it accepts a byte, applied
 * here after multer has already written the file: this route streams first and
 * asks questions afterwards, so the duplicate check cannot come earlier without
 * rewriting it into the chunked one — which is what /uploads already is.
 */
async function assetWithName(
  originalName: string,
  visibility: Visibility,
): Promise<Record<string, unknown> | null> {
  const rows = await pool.query<Record<string, unknown>>(
    "SELECT * FROM media_assets WHERE original_name = $1 ORDER BY id DESC",
    [originalName],
  );
  for (const row of rows.rows) {
    const rowVisibility: Visibility = isProtectedRef(String(row.url)) ? "protected" : "public";
    if (rowVisibility === visibility) return row;
  }
  return null;
}

/**
 * POST /admin/media?visibility=public|protected
 *
 * The whole file in one request. Kept for API clients and for the small
 * uploads that were never the problem; the admin itself now uses /uploads,
 * which survives an interruption instead of discarding 400MB.
 *
 * The visibility rides in the query string rather than in the form, because the
 * destination has to be known before the first byte is written and a multipart
 * field is only readable once it has been parsed — which, for a field the client
 * happened to append after the file, is far too late.
 *
 * `url` is what every other table stores to point at this asset. A public file
 * gets the path it is served from; a protected one gets a reference that names
 * the storage key and no location, since it has no URL of its own and is only
 * ever reachable through a signed link.
 */
adminMediaRouter.post("/", (req, res, next) => {
  const query = uploadQuerySchema.safeParse(req.query);
  if (!query.success) {
    next(badRequest(VISIBILITY_REQUIRED, query.error.flatten()));
    return;
  }
  const { visibility } = query.data;

  upload.single("file")(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        // Let the central error handler map this (e.g. LIMIT_FILE_SIZE -> 413).
        next(err);
        return;
      }
      next(badRequest(err instanceof Error ? err.message : "Upload failed"));
      return;
    }
    const file = req.file;
    if (!file) {
      next(badRequest("No file uploaded (field name must be 'file')"));
      return;
    }

    // multer named the file (random hex, see `storage`), so this cannot leave the
    // directory today. The containment check keeps it that way if the naming
    // ever changes: unlink is the one call in this handler that removes things.
    const discard = async (): Promise<void> => {
      const directory = path.resolve(storageDir(visibility));
      const target = path.resolve(directory, file.filename);
      if (!target.startsWith(directory + path.sep)) return;
      await fs.promises.unlink(target).catch(() => undefined);
    };

    const url =
      visibility === "protected" ? protectedRef(file.filename) : `/uploads/${file.filename}`;
    // Non-null: fileFilter already rejected anything resolveMime can't map.
    const mime = resolveMime(file.mimetype, file.originalname) ?? file.mimetype;
    const kind = kindFromMime(mime);

    assetWithName(file.originalname, visibility)
      .then(async (existing) => {
        if (existing) {
          // Same name and same size is the file she already has: give it back
          // and drop the copy. A different size under the same name is two
          // files the library cannot tell apart, which it refuses.
          await discard();
          if (Number(existing.size_bytes) === file.size) {
            res.status(200).json(toMediaJson(existing, adminId(req)));
            return;
          }
          next(
            conflict(
              `You already have a different file called "${file.originalname}". Rename this one and try again.`,
              { duplicateName: file.originalname },
            ),
          );
          return;
        }

        const result = await pool.query(
          `INSERT INTO media_assets (filename, original_name, url, mime, kind, size_bytes, title)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING *`,
          [file.filename, file.originalname, url, mime, kind, file.size, file.originalname],
        );
        res.status(201).json(toMediaJson(result.rows[0], adminId(req)));
      })
      .catch(async (dbErr: unknown) => {
        // The bytes are already on disk; don't leave an orphan if the row fails.
        await discard();
        next(dbErr);
      });
  });
});

/**
 * POST /admin/media/preview — a link the admin screens can actually play.
 *
 * Takes the stored reference rather than an id, because that is what the rest of
 * the admin holds: a lesson row says `protected:abc.mp4`, not "media asset 41".
 * The reference is looked up in the library, so the only files this can ever
 * mint a link for are ones already in it — a path typed into the request body
 * addresses nothing.
 *
 * A public file needs no link and gets its own path straight back, so callers
 * can put every reference through here without asking which sort it is.
 */
adminMediaRouter.post(
  "/preview",
  asyncHandler(async (req, res) => {
    const parsed = z
      .object({ reference: z.string().trim().min(1).max(500) })
      .safeParse(req.body);
    if (!parsed.success) throw badRequest("Tell us which file you want to look at.");
    const { reference } = parsed.data;

    if (!isProtectedRef(reference)) {
      res.json({ url: reference, expiresAt: null });
      return;
    }

    const found = await pool.query<{ id: number }>(
      "SELECT id FROM media_assets WHERE url = $1 ORDER BY id DESC LIMIT 1",
      [reference],
    );
    const asset = found.rows[0];
    if (asset === undefined) throw notFound("We couldn't find that file any more.");

    // Non-null: every admin route is mounted behind requireAuth.
    const adminUserId = Number(req.user?.sub);
    const link = adminPreviewUrl({ assetId: asset.id, adminUserId });
    res.json({ url: link.url, expiresAt: link.expiresAt.toISOString() });
  }),
);

/**
 * PATCH /admin/media/:id — the name, folder, alt text and tags.
 *
 * Everything the library knows *about* a file. The stored file itself is
 * immutable, and so is who may open it: that was decided by the directory the
 * bytes were written to. A key left out of the body is left alone.
 */
adminMediaRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const parsed = mediaPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      throw badRequest("Tell us what to change about this file.", parsed.error.flatten());
    }
    const { title, folder, altText, tags } = parsed.data;
    const result = await pool.query(
      `UPDATE media_assets
          SET title    = COALESCE($1, title),
              folder   = COALESCE($2, folder),
              alt_text = COALESCE($3, alt_text),
              tags     = COALESCE($4::text[], tags)
        WHERE id = $5 RETURNING *`,
      [title ?? null, folder ?? null, altText ?? null, tags ?? null, req.params.id],
    );
    if (result.rowCount === 0) throw notFound("Media asset not found");
    res.json(toMediaJson(result.rows[0], adminId(req)));
  }),
);

adminMediaRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const result = await pool.query(
      "DELETE FROM media_assets WHERE id = $1 RETURNING filename, url",
      [req.params.id],
    );
    if (result.rowCount === 0) throw notFound("Media asset not found");

    // The row's own url says which of the two directories holds the bytes, and
    // basename() so a doctored filename column can never escape either of them.
    const stored = result.rows[0] as { filename: unknown; url: unknown };
    const directory = storageDir(isProtectedRef(String(stored.url)) ? "protected" : "public");
    const filename = path.basename(String(stored.filename));
    await fs.promises.unlink(path.join(directory, filename)).catch(() => undefined);

    res.status(204).end();
  }),
);
