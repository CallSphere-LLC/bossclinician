import crypto from "crypto";
import fs from "fs";
import path from "path";
import { env } from "../config/env";

/**
 * Signed, expiring links — and the two directories they address.
 *
 * Storage is split at the filesystem level, because that is the only version of
 * this that cannot be undone by a mistake somewhere else. `env.uploadDir` is
 * handed to express.static and holds what is meant to be public: blog covers,
 * testimonial photos, member avatars. `env.protectedUploadDir` is a sibling
 * directory no static handler is mounted on, and holds everything a customer
 * paid for: course video, lesson attachments, download-product files, coaching
 * session files, certificate PDFs. Nothing in the second directory is reachable
 * by any URL, so a random filename is not what stands between a $297 product and
 * a Facebook group of 4,000 therapists.
 *
 * A stored reference says which directory it means. `protected:<key>` is the
 * protected root; a bare key or an `/uploads/...` path is the public one. The
 * prefix selects a directory and grants nothing — entitlement is decided by
 * services/access.ts, every time, on the way out.
 *
 * A protected file is never addressed by its own path. The member asks for a
 * link, we mint a token that names the file and dies on its own clock, and the
 * delivery route trusts the token and nothing else.
 *
 * What binding the member id into that token buys is worth stating exactly,
 * because the download_events row behind it gets read as if it meant more. It
 * buys three things: a signed-in member who is not the one named is refused,
 * entitlement is re-checked on every hit so a refund takes effect within the
 * minute, and the link is dead fifteen minutes (or, for streamed media, two
 * hours) after it was minted. It does not identify who is holding the link. A
 * signed-out browser presenting it inside its lifetime is indistinguishable from
 * the member, and the event row names the account it was minted for — which is
 * the account answerable for having passed it on, not necessarily the pair of
 * hands that fetched the bytes.
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

/**
 * Longer, because a <video src> has to survive being watched.
 *
 * A ninety-minute lesson issues range requests against the same URL for as long
 * as it is playing, and fifteen minutes in they would start coming back 404 —
 * the player would stall halfway through a course somebody paid for. Two hours
 * covers the longest lesson with room to pause for lunch, and a link that
 * escapes is still dead by the evening.
 */
export const STREAM_TTL_SECONDS = 2 * 60 * 60;

/** A file delivered as a download: `Content-Disposition: attachment`. */
export type DownloadFileKind = "product" | "lesson";

/** Media delivered inline, to a player element that holds the URL as its src. */
export type StreamFileKind =
  | "lesson-video"
  | "lesson-audio"
  | "lesson-captions"
  | "lesson-attachment"
  | "coaching-file"
  | "podcast-episode"
  | "community-media";

export type SignedFileKind = DownloadFileKind | StreamFileKind;

/**
 * Every kind, with the life of the link it mints.
 *
 * One record rather than a union plus a switch: a kind added here without a
 * lifetime does not compile, and a lifetime is not something to leave to a
 * default.
 */
const KIND_TTL: Record<SignedFileKind, number> = {
  product: DOWNLOAD_TTL_SECONDS,
  lesson: DOWNLOAD_TTL_SECONDS,
  "lesson-video": STREAM_TTL_SECONDS,
  "lesson-audio": STREAM_TTL_SECONDS,
  "lesson-captions": STREAM_TTL_SECONDS,
  "lesson-attachment": STREAM_TTL_SECONDS,
  "coaching-file": STREAM_TTL_SECONDS,
  "podcast-episode": STREAM_TTL_SECONDS,
  "community-media": STREAM_TTL_SECONDS,
};

const STREAM_KINDS: ReadonlySet<string> = new Set<StreamFileKind>([
  "lesson-video",
  "lesson-audio",
  "lesson-captions",
  "lesson-attachment",
  "coaching-file",
  "podcast-episode",
  "community-media",
]);

export function isStreamKind(kind: SignedFileKind): kind is StreamFileKind {
  return STREAM_KINDS.has(kind);
}

function isSignedFileKind(value: string): value is SignedFileKind {
  return Object.prototype.hasOwnProperty.call(KIND_TTL, value);
}

export interface DownloadPayload {
  /**
   * Which table `fileId` points at: product_files, lesson_files,
   * course_lessons (the four `lesson-*` kinds, one per media column),
   * coaching_session_files, podcast_episodes or community_posts.
   */
  kind: SignedFileKind;
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
 * Mints a token for one file, one member, one kind's worth of time.
 *
 * The caller has already proved entitlement; this only records the decision. The
 * delivery route checks entitlement again anyway, because a refund processed in
 * the fourteen minutes after a link was minted has to take effect immediately.
 */
export function signDownload(input: {
  kind: SignedFileKind;
  fileId: number;
  memberId: number;
  ttlSeconds?: number;
  now?: Date;
}): { token: string; expiresAt: Date } {
  const issuedAt = input.now ?? new Date();
  const ttl = input.ttlSeconds ?? KIND_TTL[input.kind];
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
  if (kind === undefined || !isSignedFileKind(kind)) return null;

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

/**
 * The route a token is redeemed at.
 *
 * Held here because minting and delivery have to agree on it, and they live in
 * different layers: a member route mints, routes/public/verify.ts serves.
 */
const FILE_ROUTE = "/api/files";

/**
 * A ready-to-use link for one file and one member.
 *
 * Relative on purpose: the link is for this member's browser on this origin, and
 * an absolute URL is the shape that ends up pasted somewhere else.
 */
export function signedFileUrl(input: {
  kind: SignedFileKind;
  fileId: number;
  memberId: number;
  now?: Date;
}): { url: string; expiresAt: Date } {
  const { token, expiresAt } = signDownload(input);
  return { url: `${FILE_ROUTE}/${token}`, expiresAt };
}

/* ------------------------------------------------------------ stored files */

/** Marks a stored reference as living in the protected directory. */
const PROTECTED_PREFIX = "protected:";

/** Media-library values arrive as the URL the admin sees, not a bare key. */
const UPLOAD_URL_PREFIX = /^\/?uploads\//i;

/** The reference form for a file in the protected directory. */
export function protectedRef(storageKey: string): string {
  return `${PROTECTED_PREFIX}${storageKey}`;
}

/** The key inside the protected directory, or null for a public reference. */
export function readProtectedRef(reference: string): string | null {
  const trimmed = reference.trim();
  if (!trimmed.toLowerCase().startsWith(PROTECTED_PREFIX)) return null;
  const storageKey = trimmed.slice(PROTECTED_PREFIX.length).trim();
  return storageKey === "" ? null : storageKey;
}

/**
 * Whether this reference names a file that is not on the open web.
 *
 * The question every surface that hands a URL to a customer has to ask: a
 * protected reference has to be signed before it can be used, a public one is
 * already a working URL, and an absolute http(s) link belongs to somebody else
 * (a Vimeo embed, a Zoom recording) and is passed through untouched.
 */
export function isProtectedRef(reference: string): boolean {
  return readProtectedRef(reference) !== null;
}

/**
 * Whether this reference names a file on somebody else's host.
 *
 * A Vimeo embed, a Zoom recording, a caption file on a CDN: not ours to sign,
 * not ours to serve, and already a working URL.
 */
export function isExternalRef(reference: string): boolean {
  return /^https?:\/\//i.test(reference.trim());
}

/**
 * The URL to hand a customer for one stored reference.
 *
 * Every surface that puts paid media in front of a member asks the same
 * question, so it is answered once. A protected reference is signed into a link
 * bound to that member and dead on its own clock; anything else is already an
 * address a browser can fetch and is returned untouched. A caller that skips
 * this and emits the stored value gets `https://site/protected:abc.mp3`, which
 * is a 404 wearing the shape of a URL.
 *
 * `expiresAt` is null exactly when nothing was signed, which is also how a
 * caller tells "this URL will stop working" from "this URL is permanent".
 */
export function deliverableUrl(input: {
  reference: string;
  kind: StreamFileKind;
  fileId: number;
  memberId: number;
  now?: Date;
}): { url: string; expiresAt: Date | null } {
  if (!isProtectedRef(input.reference)) return { url: input.reference, expiresAt: null };
  return signedFileUrl({
    kind: input.kind,
    fileId: input.fileId,
    memberId: input.memberId,
    now: input.now,
  });
}

/**
 * Turns a stored reference into an absolute path inside the root it names.
 *
 * Every storage path in the database is relative to one of the two roots, and
 * this is the only place they are joined to one. `path.resolve` collapses `..`
 * first, so the containment test below is done on the real destination —
 * checking the input for ".." instead is the version that gets bypassed by
 * "%2e%2e" or by a path that only escapes after normalisation. Without it,
 * `../../etc/passwd` in a file row turns a download endpoint into a reader for
 * the whole server.
 */
export function uploadPath(storagePath: string): string | null {
  const trimmed = storagePath.trim();
  if (trimmed === "") return null;
  if (trimmed.includes("\0")) return null;
  if (trimmed.toLowerCase().startsWith(PROTECTED_PREFIX) && readProtectedRef(trimmed) === null) {
    return null;
  }

  const storageKey = readProtectedRef(trimmed);
  const root = path.resolve(storageKey === null ? env.uploadDir : env.protectedUploadDir);
  const relative = (storageKey ?? trimmed).replace(UPLOAD_URL_PREFIX, "");

  const absolute = path.resolve(root, relative);
  if (absolute !== root && !absolute.startsWith(root + path.sep)) return null;
  return absolute;
}

/**
 * The absolute path of a stored file that exists and is really inside its root.
 *
 * realpath is the second half of the containment check: a symlink placed in
 * either upload directory passes the textual test above while pointing anywhere
 * on the disk — including from the protected directory into somebody's home —
 * and it is resolved here before a single byte is read.
 */
export async function resolveStoredFile(storagePath: string): Promise<string | null> {
  const candidate = uploadPath(storagePath);
  if (candidate === null) return null;

  const rootDir = isProtectedRef(storagePath) ? env.protectedUploadDir : env.uploadDir;

  try {
    const real = await fs.promises.realpath(candidate);
    const root = await fs.promises.realpath(path.resolve(rootDir));
    if (real !== root && !real.startsWith(root + path.sep)) return null;

    const stat = await fs.promises.stat(real);
    if (!stat.isFile()) return null;
    return real;
  } catch {
    // Missing, unreadable, or a broken symlink — all "there is no file here".
    return null;
  }
}
