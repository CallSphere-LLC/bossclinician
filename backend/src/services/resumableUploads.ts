import crypto from "crypto";
import fs from "fs";
import path from "path";
import type { Readable } from "stream";
import { pool } from "../db/pool";
import { conflict, insufficientStorage, payloadTooLarge } from "../utils/httpError";
import {
  ensureStorageDirs,
  kindFromMime,
  maxUploadBytes,
  partsDir,
  resolveMime,
  storageDir,
  storedExtension,
  type Visibility,
} from "./mediaStorage";
import { isProtectedRef, protectedRef } from "./signedUrls";

/**
 * Uploads that survive the network, the tab and the deploy.
 *
 * The single-request upload it sits beside is fine for a 200KB headshot and
 * hopeless for the thing this platform is actually built to sell: a 400MB
 * lesson video, posted from a clinic's wifi, through an nginx that gives the
 * whole request body 600 seconds. One drop and every byte so far is discarded
 * because there is nowhere for them to be kept: the request *was* the upload.
 *
 * So the upload becomes a session. The bytes accumulate in a `.part` file next
 * to where they are going, a row remembers how many of them have been
 * acknowledged, and the client sends the rest in chunks it can retry
 * individually. Every interesting failure then has the same answer, which is to
 * ask where to resume from and carry on:
 *
 *   - the connection drops mid-chunk        that chunk is re-sent
 *   - the laptop is offline for an hour     the session is still there
 *   - she closes the tab, or is logged out  the row and the bytes outlive it
 *   - the API is redeployed mid-upload      same; nothing lived in memory
 *   - two tabs resume the same file at once one holds the write lock
 *
 * `received_bytes` is the only authority on where a resume starts. The part
 * file can legitimately hold *more* than that, being bytes flushed to disk by a
 * chunk whose request then died, and those were never acknowledged to anyone,
 * so the next write truncates back to the acknowledged figure before it
 * appends. The file is therefore always a prefix of the real file and never a
 * splice of two attempts.
 */

const SESSION_TTL_DAYS = 7;

/** Bytes a single chunk request may carry. Comfortably above the client's 8MB. */
const MAX_CHUNK_BYTES = 64 * 1024 * 1024;

/** What the client is told to send. Small enough to retry cheaply on a bad line. */
export const RECOMMENDED_CHUNK_BYTES = 4 * 1024 * 1024;

/** How long one chunk write may hold a session before another tab may take it. */
const WRITE_LOCK_MINUTES = 5;

export interface UploadSession {
  id: string;
  adminUserId: number;
  originalName: string;
  mime: string;
  visibility: Visibility;
  sizeBytes: number;
  receivedBytes: number;
  storedName: string;
  fingerprint: string;
  status: "open" | "completed" | "aborted";
  mediaAssetId: number | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

interface SessionRow {
  id: string;
  admin_user_id: number;
  original_name: string;
  mime: string;
  visibility: Visibility;
  size_bytes: string | number;
  received_bytes: string | number;
  stored_name: string;
  fingerprint: string;
  status: "open" | "completed" | "aborted";
  media_asset_id: number | null;
  created_at: Date | string;
  updated_at: Date | string;
  expires_at: Date | string;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toSession(row: SessionRow): UploadSession {
  return {
    id: row.id,
    adminUserId: Number(row.admin_user_id),
    originalName: row.original_name,
    mime: row.mime,
    visibility: row.visibility,
    // BIGINT arrives as a string from pg. Converted here rather than at every
    // call site, because `"12" + 4` is the kind of arithmetic that silently
    // corrupts an offset instead of throwing.
    sizeBytes: Number(row.size_bytes),
    receivedBytes: Number(row.received_bytes),
    storedName: row.stored_name,
    fingerprint: row.fingerprint,
    status: row.status,
    mediaAssetId: row.media_asset_id,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    expiresAt: iso(row.expires_at),
  };
}

export function partPath(session: Pick<UploadSession, "id" | "visibility">): string {
  // basename on the id as well as the uuid check at the route: two independent
  // reasons a session id can never climb out of the parts folder.
  return path.join(partsDir(session.visibility), `${path.basename(session.id)}.part`);
}

/** The size of the part file on disk, or 0 if it is not there any more. */
async function partSize(session: UploadSession): Promise<number> {
  try {
    const stat = await fs.promises.stat(partPath(session));
    return stat.size;
  } catch {
    return 0;
  }
}

/**
 * Brings the row's figure back in line with the bytes that actually exist.
 *
 * The row can only ever be optimistic relative to the disk -- a restored
 * volume, a swept part file, a container whose storage was replaced -- and
 * resuming from an offset past the end of the file would write a hole into the
 * middle of a video and hand back an asset that plays for ten seconds and
 * stops. Trusting whichever is smaller costs a re-upload of the difference and
 * cannot produce a broken file.
 */
async function reconcile(session: UploadSession): Promise<UploadSession> {
  if (session.status !== "open") return session;
  const onDisk = await partSize(session);
  if (onDisk >= session.receivedBytes) return session;

  await pool.query(
    `UPDATE media_upload_sessions SET received_bytes = $2, updated_at = now() WHERE id = $1`,
    [session.id, onDisk],
  );
  return { ...session, receivedBytes: onDisk };
}

/**
 * The same file, chosen again, is the same upload.
 *
 * Name, size, modified time and audience: everything a browser will tell us
 * about a file without reading it. Hashed with the administrator's id so two
 * people uploading the same export never collide.
 */
export function uploadFingerprint(input: {
  adminUserId: number;
  originalName: string;
  sizeBytes: number;
  lastModified: number;
  visibility: Visibility;
}): string {
  return crypto
    .createHash("sha256")
    .update(
      [
        input.adminUserId,
        input.originalName,
        input.sizeBytes,
        input.lastModified,
        input.visibility,
      ].join(" "),
    )
    .digest("hex");
}

export class UnsupportedUploadError extends Error {}
export class UploadTooLargeError extends Error {}
/** A client that went away mid-chunk. There is no response left to send. */
export class ChunkInterrupted extends Error {}

/**
 * A file of this name is already in the library, and it is not this file.
 *
 * Carries the name so the refusal can say which one, because "that name is
 * taken" without the name is a puzzle rather than an instruction.
 */
export class DuplicateNameError extends Error {
  constructor(readonly originalName: string) {
    super(`A file called ${originalName} is already in your library.`);
  }
}

/**
 * The library row for a file that has already been uploaded under this name.
 *
 * Scoped to one audience: the same lesson.mp4 uploaded once for everyone and
 * once for buyers only is two genuinely different files, living in two
 * different volumes, and handing back the public one when she asked for the
 * paid one would put a course video on the open web.
 */
async function findAssetByName(
  originalName: string,
  visibility: Visibility,
): Promise<Record<string, unknown> | null> {
  const rows = await pool.query<Record<string, unknown>>(
    `SELECT * FROM media_assets WHERE original_name = $1 ORDER BY id DESC`,
    [originalName],
  );
  for (const row of rows.rows) {
    const rowVisibility: Visibility = isProtectedRef(String(row.url)) ? "protected" : "public";
    if (rowVisibility === visibility) return row;
  }
  return null;
}

/**
 * What `openUploadSession` decided to do about this file.
 *
 * `duplicate` is the answer to the same file being sent twice. Uploading 400MB
 * a second time to end up with two library rows called "Module 3.mp4" helps
 * nobody: the one already stored is handed straight back, and the caller shows
 * it as if the upload had just finished, because as far as she is concerned it
 * has.
 */
export type OpenUploadResult =
  | { kind: "session"; session: UploadSession; resumed: boolean }
  | { kind: "duplicate"; asset: Record<string, unknown> };

/**
 * Starts an upload, hands back the one already in flight, or refuses because
 * the file is already in the library.
 *
 * Idempotent on purpose, at both levels. A double-click, a retried create after
 * a lost response, or the same file dragged in twice must not produce two
 * sessions and two half-files; the unique index on (admin, fingerprint) makes
 * that a guarantee rather than a hope, and the conflict path below turns the
 * race into the resume it should have been. A file that finished uploading
 * yesterday is caught by name and size before a byte is sent again.
 */
export async function openUploadSession(input: {
  adminUserId: number;
  originalName: string;
  declaredMime: string;
  sizeBytes: number;
  lastModified: number;
  visibility: Visibility;
}): Promise<OpenUploadResult> {
  const mime = resolveMime(input.declaredMime, input.originalName);
  if (mime === null) throw new UnsupportedUploadError(input.declaredMime);
  if (input.sizeBytes > maxUploadBytes()) throw new UploadTooLargeError();

  ensureStorageDirs();

  // Before anything is written. Same name and same size is the same file, and
  // she gets the one she already has; same name and a different size is two
  // different files competing for one name, which the library has no way to
  // show her apart and this refuses rather than silently allows.
  const sameName = await findAssetByName(input.originalName, input.visibility);
  if (sameName) {
    if (Number(sameName.size_bytes) === input.sizeBytes) {
      return { kind: "duplicate", asset: sameName };
    }
    throw new DuplicateNameError(input.originalName);
  }

  const fingerprint = uploadFingerprint(input);

  const existing = await pool.query<SessionRow>(
    `SELECT * FROM media_upload_sessions
      WHERE admin_user_id = $1 AND fingerprint = $2 AND status = 'open'`,
    [input.adminUserId, fingerprint],
  );
  if (existing.rows[0]) {
    return { kind: "session", session: await reconcile(toSession(existing.rows[0])), resumed: true };
  }

  const id = crypto.randomUUID();
  const storedName = `${crypto.randomBytes(8).toString("hex")}${storedExtension(
    input.declaredMime,
    input.originalName,
  )}`;

  try {
    const created = await pool.query<SessionRow>(
      `INSERT INTO media_upload_sessions
         (id, admin_user_id, original_name, mime, visibility, size_bytes,
          stored_name, fingerprint, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now() + make_interval(days => $9))
       RETURNING *`,
      [
        id,
        input.adminUserId,
        input.originalName,
        mime,
        input.visibility,
        input.sizeBytes,
        storedName,
        fingerprint,
        SESSION_TTL_DAYS,
      ],
    );
    const session = toSession(created.rows[0]);
    // Created empty so the first chunk's positional write has a file to open,
    // and so a session with no bytes still shows up to the sweeper.
    await fs.promises.writeFile(partPath(session), "", { flag: "w" });
    return { kind: "session", session, resumed: false };
  } catch (err) {
    // 23505: two tabs asked at the same instant. The other one won; join it.
    if ((err as { code?: string }).code !== "23505") throw err;
    const raced = await pool.query<SessionRow>(
      `SELECT * FROM media_upload_sessions
        WHERE admin_user_id = $1 AND fingerprint = $2 AND status = 'open'`,
      [input.adminUserId, fingerprint],
    );
    if (!raced.rows[0]) throw err;
    return { kind: "session", session: await reconcile(toSession(raced.rows[0])), resumed: true };
  }
}

/** One session, scoped to its owner. Nobody resumes somebody else's upload. */
export async function findUploadSession(
  id: string,
  adminUserId: number,
): Promise<UploadSession | null> {
  const found = await pool.query<SessionRow>(
    `SELECT * FROM media_upload_sessions WHERE id = $1 AND admin_user_id = $2`,
    [id, adminUserId],
  );
  const row = found.rows[0];
  if (!row) return null;
  return reconcile(toSession(row));
}

/** Everything this administrator could still finish, newest first. */
export async function listOpenUploadSessions(adminUserId: number): Promise<UploadSession[]> {
  const rows = await pool.query<SessionRow>(
    `SELECT * FROM media_upload_sessions
      WHERE admin_user_id = $1 AND status = 'open' AND expires_at > now()
      ORDER BY updated_at DESC
      LIMIT 50`,
    [adminUserId],
  );
  const sessions: UploadSession[] = [];
  for (const row of rows.rows) sessions.push(await reconcile(toSession(row)));
  return sessions;
}

/**
 * Claims the right to write to a session.
 *
 * Without it, two tabs left open on the media library -- or a chunk retried
 * while the original request is still draining into the file -- both truncate
 * to the same offset and both append, and the file ends up holding one chunk's
 * bytes twice and the next chunk's never. The lock is time-boxed rather than
 * held forever, because the process that took it may simply have died.
 */
export async function lockUploadSession(
  id: string,
  adminUserId: number,
): Promise<UploadSession | null> {
  const locked = await pool.query<SessionRow>(
    `UPDATE media_upload_sessions
        SET writing_since = now()
      WHERE id = $1
        AND admin_user_id = $2
        AND status = 'open'
        AND (writing_since IS NULL OR writing_since < now() - make_interval(mins => $3))
      RETURNING *`,
    [id, adminUserId, WRITE_LOCK_MINUTES],
  );
  const row = locked.rows[0];
  if (!row) return null;
  return reconcile(toSession(row));
}

export async function unlockUploadSession(id: string): Promise<void> {
  await pool.query(`UPDATE media_upload_sessions SET writing_since = NULL WHERE id = $1`, [id]);
}

/**
 * Appends one chunk and acknowledges only what reached the disk.
 *
 * The offset must be exactly where the file ends; anything else is answered
 * with a 409 carrying the offset the caller should have used, which is how a
 * client that lost a response finds its place again rather than guessing.
 */
export async function appendChunk(
  session: UploadSession,
  offset: number,
  stream: Readable,
): Promise<UploadSession> {
  if (offset !== session.receivedBytes) {
    throw conflict("This upload is further along than that. Carry on from where it is.", {
      offset: session.receivedBytes,
      sizeBytes: session.sizeBytes,
    });
  }

  const remaining = session.sizeBytes - offset;
  if (remaining <= 0) return session;

  const file = partPath(session);
  // The tail beyond `receivedBytes` is bytes from a chunk whose request died
  // before it was acknowledged. Nobody is counting on them, so drop them and
  // start this write exactly at the acknowledged end of the file.
  try {
    await fs.promises.truncate(file, offset);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    await fs.promises.writeFile(file, "", { flag: "w" });
  }

  const written = await new Promise<number>((resolve, reject) => {
    const out = fs.createWriteStream(file, { flags: "r+", start: offset });
    let count = 0;
    let settled = false;

    const fail = (err: unknown): void => {
      if (settled) return;
      settled = true;
      out.destroy();
      reject(err);
    };

    stream.on("data", (chunk: Buffer) => {
      count += chunk.length;
      if (count > remaining || count > MAX_CHUNK_BYTES) {
        stream.destroy();
        fail(payloadTooLarge("That chunk carried more of the file than there is left."));
      }
    });
    // Express emits this when the client vanishes mid-body, which is the whole
    // point of this module. Not an error worth logging: the bytes that did land
    // are kept only up to the acknowledged offset, and the client re-sends.
    stream.on("aborted", () => fail(new ChunkInterrupted()));
    stream.on("error", fail);
    out.on("error", (err: NodeJS.ErrnoException) =>
      fail(
        err.code === "ENOSPC"
          ? insufficientStorage("There is no room left for uploads.")
          : err,
      ),
    );
    out.on("finish", () => {
      if (settled) return;
      settled = true;
      resolve(count);
    });

    stream.pipe(out);
  });

  const receivedBytes = offset + written;
  const updated = await pool.query<SessionRow>(
    `UPDATE media_upload_sessions
        SET received_bytes = $2,
            writing_since = NULL,
            updated_at = now(),
            expires_at = now() + make_interval(days => $3)
      WHERE id = $1
      RETURNING *`,
    [session.id, receivedBytes, SESSION_TTL_DAYS],
  );
  return toSession(updated.rows[0]);
}

/**
 * Turns a finished session into a library asset.
 *
 * Idempotent: a client that never saw the response to its first attempt asks
 * again and gets the same asset, rather than a second copy of a 400MB video.
 */
export async function completeUploadSession(
  session: UploadSession,
): Promise<Record<string, unknown>> {
  if (session.status === "completed" && session.mediaAssetId !== null) {
    const existing = await pool.query(`SELECT * FROM media_assets WHERE id = $1`, [
      session.mediaAssetId,
    ]);
    if (existing.rows[0]) return existing.rows[0];
  }

  if (session.receivedBytes !== session.sizeBytes) {
    throw conflict("That file isn't all here yet. It will carry on from where it stopped.", {
      offset: session.receivedBytes,
      sizeBytes: session.sizeBytes,
    });
  }

  // Checked again here, not only at the start: an upload can be open for a week
  // and the name it reserved is not reserved at all -- another tab, another
  // administrator, or the same person on their phone can land the same file
  // meanwhile. Same size means the work was wasted but the answer is still the
  // asset she wanted; a different size is the collision the create call refuses,
  // arriving late.
  const sameName = await findAssetByName(session.originalName, session.visibility);
  if (sameName) {
    if (Number(sameName.size_bytes) === session.sizeBytes) {
      await abortUploadSession(session);
      return sameName;
    }
    await abortUploadSession(session);
    throw new DuplicateNameError(session.originalName);
  }

  const from = partPath(session);
  const to = path.join(storageDir(session.visibility), session.storedName);

  await moveInto(from, to);

  const url =
    session.visibility === "protected"
      ? protectedRef(session.storedName)
      : `/uploads/${session.storedName}`;
  const kind = kindFromMime(session.mime);

  try {
    const inserted = await pool.query(
      `INSERT INTO media_assets (filename, original_name, url, mime, kind, size_bytes, title)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        session.storedName,
        session.originalName,
        url,
        session.mime,
        kind,
        session.sizeBytes,
        session.originalName,
      ],
    );
    const asset = inserted.rows[0] as { id: number };
    await pool.query(
      `UPDATE media_upload_sessions
          SET status = 'completed', media_asset_id = $2, writing_since = NULL, updated_at = now()
        WHERE id = $1`,
      [session.id, asset.id],
    );
    return inserted.rows[0];
  } catch (err) {
    // The row is what makes the file findable. Without it the bytes are litter,
    // so put them back where a retry of this same call will find them.
    await fs.promises.rename(to, from).catch(() => undefined);
    throw err;
  }
}

/** Same filesystem in every deployment we run; the copy is for the one that isn't. */
async function moveInto(from: string, to: string): Promise<void> {
  try {
    await fs.promises.rename(from, to);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EXDEV") throw err;
    await fs.promises.copyFile(from, to);
    await fs.promises.unlink(from).catch(() => undefined);
  }
}

/** She pressed stop, or discarded an unfinished upload she no longer wants. */
export async function abortUploadSession(session: UploadSession): Promise<void> {
  await fs.promises.unlink(partPath(session)).catch(() => undefined);
  await pool.query(
    `UPDATE media_upload_sessions
        SET status = 'aborted', writing_since = NULL, updated_at = now()
      WHERE id = $1 AND status = 'open'`,
    [session.id],
  );
}

/**
 * Abandoned uploads, on a disk that is not free.
 *
 * Three things rot here: sessions nobody came back to inside the week, the
 * finished rows themselves, and part files whose row is already gone (an
 * administrator deleted, a database restored from before the upload). The last
 * one is why the sweep looks at the directory and not only at the table.
 */
export async function sweepUploadSessions(): Promise<{
  expired: number;
  pruned: number;
  orphans: number;
}> {
  const stale = await pool.query<SessionRow>(
    `SELECT * FROM media_upload_sessions WHERE status = 'open' AND expires_at < now()`,
  );
  for (const row of stale.rows) {
    await fs.promises.unlink(partPath(toSession(row))).catch(() => undefined);
  }
  if (stale.rows.length > 0) {
    await pool.query(
      `UPDATE media_upload_sessions
          SET status = 'aborted', writing_since = NULL, updated_at = now()
        WHERE id = ANY($1::text[])`,
      [stale.rows.map((row) => row.id)],
    );
  }

  const pruned = await pool.query(
    `DELETE FROM media_upload_sessions
      WHERE status IN ('completed', 'aborted') AND updated_at < now() - interval '2 days'`,
  );

  let orphans = 0;
  for (const visibility of ["public", "protected"] as const) {
    const dir = partsDir(visibility);
    const entries = await fs.promises.readdir(dir).catch(() => [] as string[]);
    for (const entry of entries) {
      if (!entry.endsWith(".part")) continue;
      const id = entry.slice(0, -".part".length);
      const full = path.join(dir, entry);
      const stat = await fs.promises.stat(full).catch(() => null);
      // A part file younger than a day may belong to a session being created
      // right now, whose row this scan simply has not seen yet.
      if (!stat || Date.now() - stat.mtimeMs < 24 * 60 * 60 * 1000) continue;
      const owner = await pool.query(
        `SELECT 1 FROM media_upload_sessions WHERE id = $1 AND status = 'open'`,
        [id],
      );
      if (owner.rowCount === 0) {
        await fs.promises.unlink(full).catch(() => undefined);
        orphans += 1;
      }
    }
  }

  return { expired: stale.rows.length, pruned: pruned.rowCount ?? 0, orphans };
}
