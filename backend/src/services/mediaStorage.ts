import fs from "fs";
import path from "path";
import { env } from "../config/env";

/**
 * Where uploaded bytes live, and what is allowed to become one of them.
 *
 * Extracted from routes/admin/media.ts so the resumable upload path
 * (services/resumableUploads.ts) decides "may this file exist, and under what
 * name" with exactly the same rules as the single-request path. Two answers to
 * that question is how the stored-XSS hole below gets reopened by a route that
 * was written later and did not know.
 */

/**
 * Where an upload lands, and therefore who can open it.
 *
 * Asked at upload time rather than worked out from the file type, because the
 * same mp4 is a promotional trailer on the sales page and the second lesson of a
 * $297 course, and nothing about the bytes says which. Being wrong in one
 * direction is a broken image on a blog post; in the other it is the course
 * given away, so there is no default — the request has to say.
 */
export const VISIBILITIES = ["public", "protected"] as const;
export type Visibility = (typeof VISIBILITIES)[number];

export function storageDir(visibility: Visibility): string {
  return visibility === "protected" ? env.protectedUploadDir : env.uploadDir;
}

/**
 * Where a half-finished upload accumulates.
 *
 * Inside the destination root rather than beside it, because the two roots are
 * separate Docker volumes (docker-compose.yml) and finishing an upload has to
 * be a rename within one filesystem — a cross-device copy of 400MB at the exact
 * moment she is watching the progress bar hit 100% is the slowest possible
 * place to put that work.
 *
 * Dot-prefixed, and the public root's static mount is served with
 * `dotfiles: "deny"` (app.ts), so a part file is never reachable at
 * /uploads/.parts/... while it is being written.
 */
export function partsDir(visibility: Visibility): string {
  return path.join(storageDir(visibility), ".parts");
}

/** Every directory the upload paths write into. Safe to call repeatedly. */
export function ensureStorageDirs(): void {
  for (const visibility of VISIBILITIES) {
    fs.mkdirSync(storageDir(visibility), { recursive: true });
    fs.mkdirSync(partsDir(visibility), { recursive: true });
  }
}

export function maxUploadBytes(): number {
  return env.maxUploadMb * 1024 * 1024;
}

/**
 * SVG stays excluded on purpose: it can carry embedded scripts and we serve
 * /uploads from the same origin as the admin, so a stored SVG is a stored-XSS
 * vector. Everything else below is inert when served as a download/media file.
 */
export const ALLOWED_MIME = new Set([
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
export const EXT_TO_MIME = new Map<string, string>([
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
export function kindFromMime(mime: string): string {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime === "application/zip") return "file";
  return "document";
}

/** The refusal the admin screens recognise and rewrite into her own words. */
export function unsupportedTypeMessage(declared: string): string {
  return `Unsupported file type: ${declared || "unknown"}`;
}
