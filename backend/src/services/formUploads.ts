import crypto from "crypto";
import fs from "fs";
import path from "path";
import type { Request, Response } from "express";
import multer from "multer";
import { env } from "../config/env";
import { HttpError, badRequest, payloadTooLarge } from "../utils/httpError";
import { partsDir, storageDir } from "./mediaStorage";
import { protectedRef } from "./signedUrls";

/**
 * Files a stranger sends through a public form.
 *
 * This is an unauthenticated upload, so everything about it is treated as
 * hostile:
 *
 * - the type is decided by the file's first bytes, never by its name or the
 *   Content-Type the browser claimed;
 * - the size limit is enforced while the bytes stream in, so an oversized file
 *   is refused at the limit rather than after it has been written in full;
 * - the name on disk is random, and the name kept for display is cleaned;
 * - everything lands in the PROTECTED root, which no static handler serves, and
 *   is reachable only through the signed admin link (routes/public/verify.ts);
 * - every temporary file a request writes is deleted when the response closes,
 *   unless the route moved it into place first.
 *
 * Rate limits live with the route (routes/public/growthPublic.ts).
 */

/** The ceiling whatever a question says. The media library's own limit is higher. */
export const FORM_UPLOAD_HARD_CAP_MB = 10;

/** File questions one form may ask. Bounds the size of a single request. */
export const MAX_FILE_QUESTIONS = 5;

export const FILE_CATEGORIES = ["image", "pdf", "word", "spreadsheet"] as const;
export type FileCategory = (typeof FILE_CATEGORIES)[number];

export const DEFAULT_FILE_CATEGORIES: FileCategory[] = ["image", "pdf"];
export const DEFAULT_MAX_SIZE_MB = 5;

const MB = 1024 * 1024;

export function hardCapBytes(): number {
  return Math.min(FORM_UPLOAD_HARD_CAP_MB, Math.max(1, env.maxUploadMb)) * MB;
}

const JPEG = "image/jpeg";
const PNG = "image/png";
const GIF = "image/gif";
const WEBP = "image/webp";
const PDF = "application/pdf";
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** What each choice in the builder admits, and the one name each is stored under. */
const CATEGORY_MIMES: Record<FileCategory, string[]> = {
  image: [JPEG, PNG, GIF, WEBP],
  pdf: [PDF],
  word: [DOCX],
  spreadsheet: [XLSX],
};

const MIME_EXTENSION: Record<string, string> = {
  [JPEG]: ".jpg",
  [PNG]: ".png",
  [GIF]: ".gif",
  [WEBP]: ".webp",
  [PDF]: ".pdf",
  [DOCX]: ".docx",
  [XLSX]: ".xlsx",
};

const CATEGORY_WORDS: Record<FileCategory, string> = {
  image: "a photo (JPEG, PNG, GIF or WebP)",
  pdf: "a PDF",
  word: "a Word document (.docx)",
  spreadsheet: "a spreadsheet (.xlsx)",
};

export function isFileCategory(value: unknown): value is FileCategory {
  return typeof value === "string" && (FILE_CATEGORIES as readonly string[]).includes(value);
}

export interface FileRule {
  label: string;
  categories: FileCategory[];
  maxBytes: number;
}

/** A stored file question's limits, with the defaults and the hard cap applied. */
export function fileRuleFor(field: {
  key?: unknown;
  label?: unknown;
  fileTypes?: unknown;
  maxSizeMb?: unknown;
}): FileRule {
  const categories = Array.isArray(field.fileTypes) ? field.fileTypes.filter(isFileCategory) : [];
  const mb =
    typeof field.maxSizeMb === "number" && Number.isFinite(field.maxSizeMb) && field.maxSizeMb > 0
      ? field.maxSizeMb
      : DEFAULT_MAX_SIZE_MB;
  return {
    label: typeof field.label === "string" && field.label ? field.label : String(field.key ?? "this question"),
    categories: categories.length > 0 ? [...new Set(categories)] : DEFAULT_FILE_CATEGORIES,
    maxBytes: Math.min(Math.floor(mb * MB), hardCapBytes()),
  };
}

export function describeAccepted(categories: FileCategory[]): string {
  const words = categories.map((category) => CATEGORY_WORDS[category]);
  if (words.length <= 1) return words[0] ?? "a file";
  return `${words.slice(0, -1).join(", ")} or ${words[words.length - 1]}`;
}

function megabytes(bytes: number): string {
  const mb = bytes / MB;
  return Number.isInteger(mb) ? String(mb) : mb.toFixed(1);
}

/* ----------------------------------------------------------- magic bytes */

/** Enough of the head to tell every accepted format apart. */
const HEAD_BYTES = 12;

type Family = "jpeg" | "png" | "gif" | "webp" | "pdf" | "zip";

/**
 * The format family the first bytes belong to, or null.
 *
 * A short list rather than a library, for the reason routes/member/communityUploads.ts
 * gives: every accepted type has a fixed signature, and a dependency that parses
 * untrusted files is more attack surface than the check it replaces.
 */
export function sniffFamily(head: Buffer): Family | null {
  const starts = (...bytes: number[]): boolean =>
    head.length >= bytes.length && bytes.every((byte, index) => head[index] === byte);

  if (starts(0xff, 0xd8, 0xff)) return "jpeg";
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "png";
  if (head.subarray(0, 6).toString("latin1") === "GIF87a" || head.subarray(0, 6).toString("latin1") === "GIF89a") {
    return "gif";
  }
  if (head.subarray(0, 4).toString("latin1") === "RIFF" && head.subarray(8, 12).toString("latin1") === "WEBP") {
    return "webp";
  }
  if (head.subarray(0, 5).toString("latin1") === "%PDF-") return "pdf";
  if (starts(0x50, 0x4b, 0x03, 0x04)) return "zip";
  return null;
}

function familyAllowed(family: Family, categories: FileCategory[]): boolean {
  if (family === "zip") return categories.includes("word") || categories.includes("spreadsheet");
  if (family === "pdf") return categories.includes("pdf");
  return categories.includes("image");
}

const FAMILY_MIME: Record<Exclude<Family, "zip">, string> = {
  jpeg: JPEG,
  png: PNG,
  gif: GIF,
  webp: WEBP,
  pdf: PDF,
};

/**
 * Which Office document a zip is, or null for any other zip.
 *
 * An OOXML package names its parts in plain text in every entry header, so the
 * markers are found by a byte search rather than by unpacking anything. A
 * package carrying a VBA project is refused outright: a .docx cannot hold
 * macros, so one that does is a .docm wearing the wrong name.
 */
export function officeKind(bytes: Buffer): "word" | "spreadsheet" | null {
  if (!bytes.includes("[Content_Types].xml")) return null;
  if (bytes.includes("vbaProject.bin")) return null;
  if (bytes.includes("word/document.xml")) return "word";
  if (bytes.includes("xl/workbook.xml")) return "spreadsheet";
  return null;
}

/** The type these bytes really are, if a question with these choices accepts it. */
export function detectMime(bytes: Buffer, categories: FileCategory[]): string | null {
  const family = sniffFamily(bytes.subarray(0, HEAD_BYTES));
  if (family === null || !familyAllowed(family, categories)) return null;
  if (family !== "zip") return FAMILY_MIME[family];
  const kind = officeKind(bytes);
  if (kind === null || !categories.includes(kind)) return null;
  return CATEGORY_MIMES[kind][0];
}

/* ------------------------------------------------------------- filenames */

/**
 * Busboy reads a multipart filename as latin1, so "Résumé.pdf" from a browser
 * that sent UTF-8 arrives as mojibake. Re-read it as UTF-8 when that is what it
 * was; leave it alone when it wasn't.
 */
function decodeFilename(raw: string): string {
  if (!/[^\x00-\x7f]/.test(raw)) return raw;
  // Anything past U+00FF can't have come from a latin1 read, and re-encoding it
  // as latin1 would keep only its low byte — U+202E, a direction override,
  // would turn into a "." and change what the name says.
  if (/[^\x00-\xff]/.test(raw)) return raw;
  const utf8 = Buffer.from(raw, "latin1").toString("utf8");
  return utf8.includes("\uFFFD") ? raw : utf8;
}

/**
 * A display name that is safe to show and to hand back as a download name.
 *
 * Path parts, control characters, bidi overrides (which make "cod.exe" read as
 * "exe.doc"), and characters that are special in a filesystem or a header are
 * removed; the extension is replaced by the one the detected type is stored
 * under, so the name never claims to be something the bytes are not. The file
 * on disk is never called this — it gets a random name.
 */
export function sanitizeFilename(raw: string, extension: string): string {
  const decoded = decodeFilename(String(raw ?? ""));
  const base = decoded.replace(/\\/g, "/").split("/").pop() ?? "";
  const dot = base.lastIndexOf(".");
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const cleaned = stem
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, "")
    .replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g, "")
    .replace(/[<>:"/\\|?*`$%;]/g, "")
    .replace(/\s+/g, " ")
    .replace(/^[\s.\-]+/, "")
    .trim()
    .slice(0, 100)
    .trim();
  return `${cleaned || "upload"}${extension}`;
}

/* ------------------------------------------------------ receiving a file */

/** One file that arrived in full and passed every check, waiting to be kept. */
export interface StagedFile {
  fieldKey: string;
  tempPath: string;
  sizeBytes: number;
  mime: string;
  extension: string;
  displayName: string;
}

interface UploadContext {
  rules: Map<string, FileRule>;
  /** Every temp file this request wrote, finished or not. */
  tempPaths: string[];
  finished: StagedFile[];
  seen: Set<string>;
  aborted: boolean;
}

const contexts = new WeakMap<Request, UploadContext>();

function unlinkQuietly(filePath: string): void {
  fs.unlink(filePath, () => undefined);
}

function typeRefusal(rule: FileRule): HttpError {
  return badRequest(`“${rule.label}” takes ${describeAccepted(rule.categories)}. That file isn't one.`);
}

/**
 * The multer storage engine: stream to a temp file, counting and sniffing as
 * the bytes arrive.
 */
const formFileStorage: multer.StorageEngine = {
  _handleFile(req, file, cb) {
    const ctx = contexts.get(req as Request);
    const rule = ctx?.rules.get(file.fieldname);
    if (!ctx || !rule || ctx.aborted) {
      file.stream.resume();
      cb(badRequest("This form got a file it didn't ask for."));
      return;
    }

    const directory = partsDir("protected");
    fs.mkdirSync(directory, { recursive: true });
    const tempPath = path.join(directory, `form-${crypto.randomBytes(16).toString("hex")}.part`);
    // Recorded before a byte is written, so the close hook removes it whatever
    // happens from here on.
    ctx.tempPaths.push(tempPath);

    const out = fs.createWriteStream(tempPath, { flags: "wx", mode: 0o600 });
    let size = 0;
    let head = Buffer.alloc(0);
    let sniffed = false;
    let settled = false;

    const fail = (err: unknown): void => {
      if (settled) return;
      settled = true;
      ctx.aborted = true;
      out.destroy();
      unlinkQuietly(tempPath);
      // Drain what is left of this part so the parser can finish and the error
      // response can go out; the Content-Length check bounds how much that is.
      file.stream.resume();
      cb(err instanceof Error ? err : badRequest("That file couldn't be received."));
    };

    const checkHead = (): boolean => {
      sniffed = true;
      const family = sniffFamily(head);
      if (family === null || !familyAllowed(family, rule.categories)) {
        fail(typeRefusal(rule));
        return false;
      }
      return true;
    };

    file.stream.on("data", (chunk: Buffer) => {
      if (settled) return;
      size += chunk.length;
      if (size > rule.maxBytes) {
        fail(payloadTooLarge(`“${rule.label}” takes files up to ${megabytes(rule.maxBytes)} MB. That one is bigger.`));
        return;
      }
      if (!sniffed) {
        head = Buffer.concat([head, chunk]).subarray(0, HEAD_BYTES);
        if (head.length >= HEAD_BYTES && !checkHead()) return;
      }
      if (!out.write(chunk)) {
        file.stream.pause();
        out.once("drain", () => file.stream.resume());
      }
    });

    file.stream.on("error", fail);
    out.on("error", fail);

    file.stream.on("end", () => {
      if (settled) return;
      if (size === 0) {
        fail(badRequest(`The file for “${rule.label}” is empty.`));
        return;
      }
      if (!sniffed && !checkHead()) return;

      out.end(() => {
        if (settled) return;
        fs.promises
          .readFile(tempPath)
          .then((bytes) => {
            if (settled) return;
            const mime = detectMime(bytes, rule.categories);
            if (mime === null) {
              fail(typeRefusal(rule));
              return;
            }
            const extension = MIME_EXTENSION[mime] ?? "";
            settled = true;
            ctx.finished.push({
              fieldKey: file.fieldname,
              tempPath,
              sizeBytes: size,
              mime,
              extension,
              displayName: sanitizeFilename(file.originalname, extension),
            });
            cb(null, { path: tempPath, size });
          })
          .catch(fail);
      });
    });
  },

  _removeFile(_req, file, cb) {
    const stored = (file as { path?: string }).path;
    if (stored) unlinkQuietly(stored);
    cb(null);
  },
};

/** Room for the answers themselves beside the files. */
const PAYLOAD_BYTES = 1 * MB;
/** Multipart boundaries and part headers. */
const ENVELOPE_BYTES = 64 * 1024;

function translateUploadError(err: unknown, rules: Map<string, FileRule>): HttpError {
  if (err instanceof HttpError) return err;
  if (err instanceof multer.MulterError) {
    const rule = err.field ? rules.get(err.field) : undefined;
    switch (err.code) {
      case "LIMIT_FILE_SIZE":
        return payloadTooLarge(
          rule
            ? `“${rule.label}” takes files up to ${megabytes(rule.maxBytes)} MB. That one is bigger.`
            : `Files can be up to ${megabytes(hardCapBytes())} MB.`,
        );
      case "LIMIT_FILE_COUNT":
        return badRequest("That's more files than this form asks for.");
      case "LIMIT_FIELD_VALUE":
        return payloadTooLarge("Those answers are too long to send.");
      default:
        return badRequest("That reply wasn't in a shape this form accepts.");
    }
  }
  return badRequest("The upload didn't arrive in one piece. Please try again.");
}

/**
 * Reads a multipart form reply: its `payload` field and one file per file
 * question.
 *
 * Resolves with the files that arrived in full and passed every check; any
 * failure rejects with a message meant for the visitor. Whatever happens, every
 * temp file is removed once the response has closed — the route keeps a file by
 * renaming it out of the way first (see `keepStagedFile`).
 */
export async function receiveFormFiles(
  req: Request,
  res: Response,
  fileFields: { key: string; label?: string; fileTypes?: unknown; maxSizeMb?: unknown }[],
): Promise<StagedFile[]> {
  const rules = new Map(fileFields.map((field) => [field.key, fileRuleFor(field)]));
  const ctx: UploadContext = { rules, tempPaths: [], finished: [], seen: new Set(), aborted: false };
  contexts.set(req, ctx);
  res.on("close", () => {
    for (const tempPath of ctx.tempPaths) unlinkQuietly(tempPath);
  });

  // Refused before a byte is read. Behind nginx the body is buffered and sent
  // with a real Content-Length, so this is what stops a 500MB body reaching the
  // parser at all; the streaming counts above are the check that can't be lied to.
  let ceiling = PAYLOAD_BYTES + ENVELOPE_BYTES;
  for (const rule of rules.values()) ceiling += rule.maxBytes;
  const declared = Number(req.headers["content-length"]);
  if (Number.isFinite(declared) && declared > ceiling) {
    throw payloadTooLarge(
      rules.size === 0
        ? "This form doesn't take files."
        : `That's more than this form accepts — files can be up to ${megabytes(Math.max(...[...rules.values()].map((rule) => rule.maxBytes)))} MB each.`,
    );
  }

  const parser = multer({
    storage: formFileStorage,
    limits: {
      // One byte over the cap, so the per-question count above trips first and
      // says which question; this is the backstop if it somehow doesn't.
      fileSize: hardCapBytes() + 1,
      files: rules.size,
      fields: 4,
      fieldSize: PAYLOAD_BYTES,
      fieldNameSize: 100,
      parts: rules.size + 4,
      headerPairs: 50,
    },
    fileFilter: (_req, file, cb) => {
      const rule = rules.get(file.fieldname);
      if (!rule) {
        cb(badRequest("This form got a file it didn't ask for."));
        return;
      }
      if (ctx.seen.has(file.fieldname)) {
        cb(badRequest(`Please attach just one file for “${rule.label}”.`));
        return;
      }
      ctx.seen.add(file.fieldname);
      cb(null, true);
    },
  }).any();

  await new Promise<void>((resolve, reject) => {
    parser(req, res, (err?: unknown) => {
      if (err) reject(translateUploadError(err, rules));
      else resolve();
    });
  });

  return ctx.finished;
}

/**
 * Moves a received file to its permanent, random name in the protected root.
 *
 * A rename within one volume: the temp directory is inside the protected root
 * for exactly this reason (services/mediaStorage.ts).
 */
export async function keepStagedFile(
  staged: StagedFile,
): Promise<{ filename: string; reference: string; absolutePath: string }> {
  const directory = storageDir("protected");
  await fs.promises.mkdir(directory, { recursive: true });
  const filename = `${crypto.randomBytes(16).toString("hex")}${staged.extension}`;
  const absolutePath = path.join(directory, filename);
  await fs.promises.rename(staged.tempPath, absolutePath);
  return { filename, reference: protectedRef(filename), absolutePath };
}
