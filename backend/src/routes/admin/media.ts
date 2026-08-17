import { Router } from "express";
import multer from "multer";
import path from "path";
import crypto from "crypto";
import fs from "fs";
import { pool } from "../../db/pool";
import { rowToCamel, rowsToCamel } from "../../utils/case";
import { asyncHandler } from "../../utils/asyncHandler";
import { env } from "../../config/env";
import { badRequest, notFound } from "../../utils/httpError";

export const adminMediaRouter = Router();

fs.mkdirSync(env.uploadDir, { recursive: true });

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

/** Coarse bucket used by the library's filter chips. */
function kindFromMime(mime: string): string {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime === "application/zip") return "file";
  return "document";
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, env.uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || "";
    const name = `${crypto.randomBytes(8).toString("hex")}${ext.toLowerCase()}`;
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
    res.json(rowsToCamel<MediaAsset>(result.rows));
  }),
);

adminMediaRouter.post("/", (req, res, next) => {
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

    const url = `/uploads/${file.filename}`;
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
        res.status(201).json(rowToCamel<MediaAsset>(result.rows[0]));
      })
      .catch((dbErr: unknown) => {
        // The bytes are already on disk; don't leave an orphan if the row fails.
        fs.promises.unlink(path.join(env.uploadDir, file.filename)).catch(() => undefined);
        next(dbErr);
      });
  });
});

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
    res.json(rowToCamel<MediaAsset>(result.rows[0]));
  }),
);

adminMediaRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const result = await pool.query(
      "DELETE FROM media_assets WHERE id = $1 RETURNING filename",
      [req.params.id],
    );
    if (result.rowCount === 0) throw notFound("Media asset not found");

    // basename() so a doctored filename column can never escape uploadDir.
    const filename = path.basename(String(result.rows[0].filename));
    await fs.promises.unlink(path.join(env.uploadDir, filename)).catch(() => undefined);

    res.status(204).end();
  }),
);
