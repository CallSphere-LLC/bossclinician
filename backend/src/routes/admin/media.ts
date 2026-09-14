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

/** GET /admin/media?kind=video — newest first. */
adminMediaRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const kind = typeof req.query.kind === "string" ? req.query.kind : "";
    const result =
      kind && kind !== "all"
        ? await pool.query(
            "SELECT * FROM media_assets WHERE kind = $1 ORDER BY created_at DESC",
            [kind],
          )
        : await pool.query("SELECT * FROM media_assets ORDER BY created_at DESC");
    res.json(result.rows.map((row) => toMediaJson(row, adminId(req))));
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

/** PATCH /admin/media/:id — rename (title only; the stored file is immutable). */
adminMediaRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const { title } = req.body as { title?: string };
    if (typeof title !== "string") throw badRequest("title is required");
    const result = await pool.query(
      "UPDATE media_assets SET title = $1 WHERE id = $2 RETURNING *",
      [title, req.params.id],
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
