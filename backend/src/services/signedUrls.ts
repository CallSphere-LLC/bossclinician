import crypto from "crypto";
import fs from "fs";
import path from "path";
import { env } from "../config/env";

/**
 * Signed, expiring download links.
 *
 * A stored file is never addressed by its own path. The member asks for a link,
 * we mint a token that names the file, and the delivery route trusts the token
 * and nothing else — so the credential is short-lived and revocable by the clock
 * rather than by hoping a URL stays secret.
 *
 * The token is bound to the member id, which is the part that matters. Without
 * it, one customer's link is every customer's link: the Practice Protection Pack
 * gets posted in a Facebook group of 4,000 therapists and the product Yvette
 * sells for $297 is free for everyone who scrolls past. Binding the id means a
 * forwarded link is refused for whoever opens it, and the download_events row
 * behind it names the account it was minted for.
 *
 * HKDF over JWT_SECRET with its own `info` string, following auth/secrets.ts: a
 * download token and a session token are then not interchangeable even though
 * both are HMACs over the same base secret, and no new environment variable has
 * to be deployed for this to work.
 */

const DOWNLOAD_INFO = "bossclinician/download-link/v1";

/** Bumped if the payload layout ever changes, so old tokens fail closed. */
const VERSION = "d1";

/** Long enough to click, short enough that a leaked URL is already dead. */
export const DOWNLOAD_TTL_SECONDS = 15 * 60;

export type DownloadFileKind = "product" | "lesson";

export interface DownloadPayload {
  /** Which table `fileId` points at: product_files or lesson_files. */
  kind: DownloadFileKind;
  fileId: number;
  memberId: number;
  /** Unix seconds. */
  expiresAt: number;
}

let signingKey: Buffer | null = null;

function key(): Buffer {
  if (signingKey === null) {
    // Empty salt and a fixed info string, exactly as in auth/secrets.ts: the
    // derived key has to be identical across restarts and replicas or a link
    // minted by one process is unverifiable by the next.
    signingKey = Buffer.from(
      crypto.hkdfSync(
        "sha256",
        Buffer.from(env.jwtSecret, "utf8"),
        Buffer.alloc(0),
        Buffer.from(DOWNLOAD_INFO, "utf8"),
        32
      )
    );
  }
  return signingKey;
}

function sign(body: string): string {
  return crypto.createHmac("sha256", key()).update(body).digest("base64url");
}

/**
 * Mints a token for one file, one member, one quarter of an hour.
 *
 * The caller has already proved entitlement; this only records the decision. The
 * delivery route checks entitlement again anyway, because a refund processed in
 * the fourteen minutes after a link was minted has to take effect immediately.
 */
export function signDownload(input: {
  kind: DownloadFileKind;
  fileId: number;
  memberId: number;
  ttlSeconds?: number;
  now?: Date;
}): { token: string; expiresAt: Date } {
  const issuedAt = input.now ?? new Date();
  const ttl = input.ttlSeconds ?? DOWNLOAD_TTL_SECONDS;
  const expiresAt = Math.floor(issuedAt.getTime() / 1000) + ttl;

  const body = Buffer.from(
    [VERSION, input.kind, input.fileId, input.memberId, expiresAt].join("."),
    "utf8"
  ).toString("base64url");

  return { token: `${body}.${sign(body)}`, expiresAt: new Date(expiresAt * 1000) };
}

/** The payload of a token whose signature and expiry both hold, or null. */
export function verifyDownload(token: string, now: Date = new Date()): DownloadPayload | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, provided] = parts;
  if (!body || !provided) return null;

  const expected = sign(body);
  // Lengths must match before timingSafeEqual, which throws rather than
  // returning false when they differ.
  if (provided.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(provided, "utf8"), Buffer.from(expected, "utf8"))) {
    return null;
  }

  const fields = Buffer.from(body, "base64url").toString("utf8").split(".");
  if (fields.length !== 5) return null;
  const [version, kind, fileId, memberId, expiresAt] = fields;
  if (version !== VERSION) return null;
  if (kind !== "product" && kind !== "lesson") return null;

  const payload: DownloadPayload = {
    kind,
    fileId: Number(fileId),
    memberId: Number(memberId),
    expiresAt: Number(expiresAt),
  };
  if (
    !Number.isSafeInteger(payload.fileId) ||
    !Number.isSafeInteger(payload.memberId) ||
    !Number.isSafeInteger(payload.expiresAt) ||
    payload.fileId <= 0 ||
    payload.memberId <= 0
  ) {
    return null;
  }

  if (payload.expiresAt * 1000 <= now.getTime()) return null;

  return payload;
}

/** Media-library values arrive as the URL the admin sees, not a bare key. */
const UPLOAD_URL_PREFIX = /^\/?uploads\//i;

/**
 * Turns a stored relative path into an absolute one inside the upload root.
 *
 * Every storage_path in the database is relative to that root, and this is the
 * only place they are joined to it. `path.resolve` collapses `..` first, so the
 * containment test below is done on the real destination — checking the input
 * for ".." instead is the version that gets bypassed by "%2e%2e" or by a path
 * that only escapes after normalisation. Without it, `../../etc/passwd` in a
 * file row turns a download endpoint into a reader for the whole server.
 */
export function uploadPath(storagePath: string): string | null {
  const trimmed = storagePath.trim();
  if (trimmed === "") return null;
  if (trimmed.includes("\0")) return null;

  const root = path.resolve(env.uploadDir);
  const absolute = path.resolve(root, trimmed.replace(UPLOAD_URL_PREFIX, ""));
  if (absolute !== root && !absolute.startsWith(root + path.sep)) return null;
  return absolute;
}

/**
 * The absolute path of a stored file that exists and is really inside the root.
 *
 * realpath is the second half of the containment check: a symlink placed in the
 * upload directory passes the textual test above while pointing anywhere on the
 * disk, and it is resolved here before a single byte is read.
 */
export async function resolveStoredFile(storagePath: string): Promise<string | null> {
  const candidate = uploadPath(storagePath);
  if (candidate === null) return null;

  try {
    const real = await fs.promises.realpath(candidate);
    const root = await fs.promises.realpath(path.resolve(env.uploadDir));
    if (real !== root && !real.startsWith(root + path.sep)) return null;

    const stat = await fs.promises.stat(real);
    if (!stat.isFile()) return null;
    return real;
  } catch {
    // Missing, unreadable, or a broken symlink — all "there is no file here".
    return null;
  }
}
