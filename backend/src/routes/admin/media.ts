import { Router, type Request } from "express";
import multer from "multer";
import path from "path";
import crypto from "crypto";
import fs from "fs";
import { z } from "zod";
import { pool } from "../../db/pool";
import { rowToCamel } from "../../utils/case";
import { asyncHandler } from "../../utils/asyncHandler";
import { env } from "../../config/env";
import { badRequest, notFound } from "../../utils/httpError";
import { adminPreviewUrl, isProtectedRef, protectedRef } from "../../services/signedUrls";

export const adminMediaRouter = Router();

fs.mkdirSync(env.uploadDir, { recursive: true });
fs.mkdirSync(env.protectedUploadDir, { recursive: true });

/**
 * Where an upload lands, and therefore who can open it.
 *
 * Asked at upload time rather than worked out from the file type, because the
 * same mp4 is a promotional trailer on the sales page and the second lesson of a
 * $297 course, and nothing about the bytes says which. Being wrong in one
 * direction is a broken image on a blog post; in the other it is the course
 * given away, so there is no default — the request has to say.
 */
const VISIBILITIES = ["public", "protected"] as const;
type Visibility = (typeof VISIBILITIES)[number];

const uploadQuerySchema = z.object({ visibility: z.enum(VISIBILITIES) });

const VISIBILITY_REQUIRED =
  "Say whether this file is for everyone or only for people who bought it.";

function storageDir(visibility: Visibility): string {
  return visibility === "protected" ? env.protectedUploadDir : env.uploadDir;
}

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

export interface MediaAsset {
  id: number;
  filename: string;
  originalName: string;
  url: string;
  mime: string;
  kind: string;
  sizeBytes: number;
  title: string;
  folder: string;
  createdAt: string;
}

/**
 * What the library shows: the row, which directory it is in, and an address the
 * admin screens can point an <img>, <video> or <audio> at.
 *
 * `url` is a storage reference, and for a protected file it is not a URL at all
 * — `protected:abc.mp4` in a src attribute draws an empty box, which is how a
 * video Yvette uploaded turns out to be unplayable on the one screen where she
 * could have caught it. `previewUrl` is the playable form: a signed link for a
 * protected file, the same path for a public one. It is minted here so a grid of
 * twelve videos costs one request rather than thirteen.
 */
type MediaAssetJson = MediaAsset & { visibility: Visibility; previewUrl: string };

function toMediaJson(row: Record<string, unknown>, adminUserId: number): MediaAssetJson {
  const asset = rowToCamel<MediaAsset>(row);
  const isProtected = isProtectedRef(asset.url);
  return {
    ...asset,
    visibility: isProtected ? "protected" : "public",
    previewUrl: isProtected
      ? adminPreviewUrl({ assetId: asset.id, adminUserId }).url
      : asset.url,
  };
}

/** The signed-in administrator. Non-null: every route here is behind requireAuth. */
function adminId(req: Request): number {
  return Number(req.user?.sub);
}

/**
 * SVG stays excluded on purpose: it can carry embedded scripts and we serve
 * /uploads from the same origin as the admin, so a stored SVG is a stored-XSS
 * vector. Everything else below is inert when served as a download/media file.
 */
const ALLOWED_MIME = new Set([
  // images
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/avif",
  // video
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "video/x-m4v",
  // audio
  "audio/mpeg",
  "audio/mp4",
  "audio/wav",
  "audio/webm",
  "audio/ogg",
  // documents
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
  "text/plain",
  "application/zip",
]);

/**
 * Extension fallback for when the client declares a useless MIME type.
 *
 * Browsers and OSes routinely send `application/octet-stream` for .mp4/.mov
 * uploads, so a MIME-only whitelist rejects perfectly valid course videos.
 * This stays deny-by-default: the extension must itself be whitelisted, and
 * the resolved type is what gets stored.
 */
const EXT_TO_MIME = new Map<string, string>([
  [".mp4", "video/mp4"],
  [".m4v", "video/x-m4v"],
  [".webm", "video/webm"],
  [".mov", "video/quicktime"],
  [".mp3", "audio/mpeg"],
  [".m4a", "audio/mp4"],
  [".wav", "audio/wav"],
  [".ogg", "audio/ogg"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".gif", "image/gif"],
  [".avif", "image/avif"],
  [".pdf", "application/pdf"],
  [".csv", "text/csv"],
  [".txt", "text/plain"],
  [".zip", "application/zip"],
  [".doc", "application/msword"],
  [".docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  [".ppt", "application/vnd.ms-powerpoint"],
  [".pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
  [".xls", "application/vnd.ms-excel"],
  [".xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
]);

/** The extension each allowed type is stored under, first entry winning. */
const MIME_TO_EXT = new Map<string, string>();
for (const [ext, mime] of EXT_TO_MIME) {
  if (!MIME_TO_EXT.has(mime)) MIME_TO_EXT.set(mime, ext);
}

/** Resolves the effective MIME type, or null if the upload isn't allowed. */
export function resolveMime(declared: string, originalName: string): string | null {
  if (ALLOWED_MIME.has(declared)) return declared;

  // Only fall back when the declaration carries no information. A client that
  // explicitly claims a disallowed type is still rejected.
  if (declared === "application/octet-stream" || declared === "") {
    const ext = path.extname(originalName).toLowerCase();
    return EXT_TO_MIME.get(ext) ?? null;
  }
  return null;
}

/**
 * The suffix the stored file is written under.
 *
 * Never the uploader's own: /uploads is handed to express.static, which reads
 * the Content-Type off the extension and not off the `mime` column, so a file
 * called "notes.html" — or "logo.svg" — declared as text/plain lands as live
 * markup on the site's own origin however inert its declared type was. That is
 * the stored-XSS the SVG exclusion above exists to prevent, reached by a
 * filename instead of a MIME type.
 *
 * An extension the whitelist already knows is kept, so an .m4a stays an .m4a;
 * anything else is replaced by the one its resolved type is served under. The
 * name the uploader chose survives untouched in `original_name`.
 */
export function storedExtension(declared: string, originalName: string): string {
  const ext = path.extname(originalName).toLowerCase();
  if (EXT_TO_MIME.has(ext)) return ext;
  const mime = resolveMime(declared, originalName);
  return mime === null ? "" : (MIME_TO_EXT.get(mime) ?? "");
}

/** Coarse bucket used by the library's filter chips. */
function kindFromMime(mime: string): string {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime === "application/zip") return "file";
  return "document";
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
      cb(new Error(`Unsupported file type: ${file.mimetype || "unknown"}`));
      return;
    }
    cb(null, true);
  },
});

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
 * POST /admin/media?visibility=public|protected
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

    const url =
      visibility === "protected" ? protectedRef(file.filename) : `/uploads/${file.filename}`;
    // Non-null: fileFilter already rejected anything resolveMime can't map.
    const mime = resolveMime(file.mimetype, file.originalname) ?? file.mimetype;
    const kind = kindFromMime(mime);

    pool
      .query(
        `INSERT INTO media_assets (filename, original_name, url, mime, kind, size_bytes, title)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [file.filename, file.originalname, url, mime, kind, file.size, file.originalname],
      )
      .then((result) => {
        res.status(201).json(toMediaJson(result.rows[0], adminId(req)));
      })
      .catch((dbErr: unknown) => {
        // The bytes are already on disk; don't leave an orphan if the row fails.
        fs.promises
          .unlink(path.join(storageDir(visibility), file.filename))
          .catch(() => undefined);
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
