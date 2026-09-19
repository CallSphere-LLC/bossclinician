import crypto from "crypto";
import fs from "fs";
import path from "path";
import { env } from "../../config/env";
import { storedExtension } from "../mediaStorage";
import type { RecordingStore, StoredRecording } from "./contract";

/**
 * Where a conversation's audio lives, and how the owner gets to hear it.
 *
 * Two implementations of the one interface in contract.ts. The local one is
 * what runs today, because this host has a Docker volume and no AWS
 * credentials; the S3 one is what the owner asked for and is complete, so
 * turning it on is an environment variable and a redeploy rather than a change
 * to any of the code that calls it.
 *
 * Three rules hold both of them together:
 *
 *  1. Audio of a real conversation is not a blog image. The local store writes
 *     into `env.protectedUploadDir` — the directory no static handler is
 *     mounted on — and refuses to resolve a key that would land anywhere else.
 *     A recording has no address on the open web at all.
 *  2. A stored key says which store holds it. The `protected:` prefix is the
 *     same convention services/signedUrls.ts uses for local protected files;
 *     an S3 key is bare. So switching the environment to `s3` changes where
 *     NEW recordings are written without silencing the ones already recorded —
 *     reads and deletes follow the key, not the environment.
 *  3. Audio arrives in numbered slices while the call is still going, and
 *     `finalize` joins them. Both stores keep every slice they were given as
 *     its own object until then, which is what makes a closed tab survivable:
 *     nothing has to have happened in the right order, or at all, for the
 *     recording to be recoverable later.
 *
 * Why slices rather than appending to one growing file: appending in place
 * would need a per-session cursor on disk to know where the next slice goes,
 * and it still could not place a slice that arrived out of order — which the
 * `pagehide` flush, sent with `keepalive` and capped at 64KB, routinely does.
 * Numbered slices need no cursor, tolerate any arrival order, make a retry a
 * harmless overwrite, and can be joined at any later time. The admin page joins
 * them the first time the owner opens the conversation, so a call nobody ever
 * closed is still a recording she can play.
 */

/** Marks a key as living in the protected upload directory. */
const LOCAL_PREFIX = "protected:";

/**
 * The one folder inside the protected root that recordings may occupy.
 *
 * Both a tidiness measure and the containment check: a key that resolves
 * outside this folder is refused, so a value that arrived from the database
 * cannot be talked into naming a course video or a certificate PDF.
 */
const LOCAL_FOLDER = "voice-recordings";

/** Long enough for the owner to press play and listen; short enough to leak safely. */
export const RECORDING_URL_TTL_SECONDS = 15 * 60;

/** The route the local store's links are redeemed at. See routes/admin/voiceSessions.ts. */
const LOCAL_PLAYBACK_ROUTE = "/api/admin/voice-recording";

/**
 * The most one slice may carry, and how many a conversation may have.
 *
 * Three seconds of the audio a browser produces is tens of kilobytes, and the
 * `pagehide` flush a closing tab sends is capped at 64KB by the browser itself,
 * so a quarter of a megabyte is several times generous either way. Together the
 * two numbers are the bound on what one conversation can be made to store —
 * about 300MB at the absolute worst, against a few megabytes in reality. The
 * caller must own the conversation to append to it at all, but "owns a
 * conversation" must not mean "may fill the volume".
 *
 * The slice count is also a real ceiling on length: 1,200 slices of three
 * seconds is an hour, which is twice the longest session any surface allows.
 */
export const MAX_RECORDING_CHUNK_BYTES = 256 * 1024;
export const MAX_RECORDING_CHUNKS = 1200;

/**
 * Joins already running, so the same conversation is only ever joined once.
 *
 * `finalize` is called lazily, from the admin page, which means two of them can
 * overlap for perfectly ordinary reasons: a double click, React running an
 * effect twice in development, the owner reopening the panel while the first
 * join is still reading slices. Both would write the same bytes, but the second
 * would then find the slices deleted or the temporary file already renamed and
 * fail — putting an error over a recording that plays perfectly well.
 *
 * One process is enough to cover that: the joins that race are the ones started
 * by the same page within a second of each other, and they land in this map.
 */
const joinsInFlight = new Map<string, Promise<StoredRecording>>();

function joinOnce(
  sessionId: string,
  join: () => Promise<StoredRecording>
): Promise<StoredRecording> {
  const running = joinsInFlight.get(sessionId);
  if (running) return running;

  const started = join().finally(() => joinsInFlight.delete(sessionId));
  joinsInFlight.set(sessionId, started);
  return started;
}

/** Raised by `finalize` when a conversation has no audio anywhere. */
export class MissingRecordingError extends Error {
  constructor(sessionId: string) {
    super(`No recording was received for conversation ${sessionId}`);
    this.name = "MissingRecordingError";
  }
}

/**
 * The one audio type the media library has no spelling for.
 *
 * `storedExtension` derives its extension from the library's own table, where
 * ".webm" is claimed by video/webm — so an audio-only WebM, which is exactly
 * what a browser's MediaRecorder produces by default, resolves to no extension
 * at all. A recording with no suffix is not a security problem (nothing serves
 * this directory) but it is an operational one: a volume full of files nobody
 * can identify by looking at it.
 */
const EXTRA_AUDIO_EXTENSIONS = new Map<string, string>([["audio/webm", ".webm"]]);

export function recordingExtension(contentType: string): string {
  return storedExtension(contentType, "") || (EXTRA_AUDIO_EXTENSIONS.get(contentType) ?? "");
}

/** The extension a stored recording was filed under, back to a type to serve it with. */
const EXTENSION_TO_TYPE = new Map<string, string>([
  [".webm", "audio/webm"],
  [".mp3", "audio/mpeg"],
  [".m4a", "audio/mp4"],
  [".ogg", "audio/ogg"],
  [".wav", "audio/wav"],
]);

/**
 * The folder one conversation's audio occupies, derived from its id alone.
 *
 * From the id ALONE, because `finalize(sessionId)` is all the contract gives
 * the store to find the slices with — there is no date and no content type to
 * hand it, and a name that needed either would be unfindable the moment a call
 * crossed midnight or a browser changed codec. The first four characters fan
 * the tree out so no single directory holds ten thousand conversations; the id
 * is a random UUID, so they are evenly spread and leak nothing.
 */
export function recordingFolder(sessionId: string): string {
  const safeId = sessionId.replace(/[^a-zA-Z0-9_-]/g, "");
  if (safeId.length < 4) throw new Error("A recording needs a session id to be named after");
  return `${safeId.slice(0, 2)}/${safeId.slice(2, 4)}/${safeId}`;
}

/** Where the finished recording lands, once its type is known. */
export function recordingObjectKey(sessionId: string, contentType: string): string {
  return `${recordingFolder(sessionId)}${recordingExtension(contentType)}`;
}

/** Where the slices of an unfinished recording wait. */
export function recordingPartsKey(sessionId: string): string {
  return `${recordingFolder(sessionId)}.parts`;
}

/**
 * Slice names sort lexically in the order they were recorded.
 *
 * Six digits: a slice every three seconds for an hour is 1,200 of them, and
 * padding is what stops slice 10 from sorting before slice 2 — which would
 * reassemble the conversation in the wrong order, silently, and only be
 * noticeable by listening to it.
 */
function partName(seq: number): string {
  return String(seq).padStart(6, "0");
}

/** A slice, as opposed to the little marker file that remembers the audio type. */
const PART_NAME_SHAPE = /^[0-9]{6}$/;

/** Written beside the slices, because `finalize` is given no content type. */
const TYPE_MARKER = "type";

/* ------------------------------------------------------------ local links */

/**
 * A short-lived bearer for one recording.
 *
 * The local store has to hand back something an `<audio src>` can hold, and it
 * cannot be the admin session cookie: that access token lives five minutes and
 * the admin client refreshes it on a 401, which a media element does not do —
 * Yvette would open a conversation, take a phone call, press play and get a
 * silent player. So the link is exactly what an S3 presigned GET is: a bearer
 * bound to one key and one expiry, and dead on its own clock.
 *
 * HKDF over JWT_SECRET with its own `info` string, following auth/secrets.ts
 * and services/signedUrls.ts: this token and a download token are not
 * interchangeable in either direction, and no new secret has to be deployed.
 */
const PLAYBACK_INFO = "bossclinician/voice-recording-link/v1";

/** Bumped if the payload layout changes, so old links fail closed. */
const PLAYBACK_VERSION = "v1";

let playbackKey: Buffer | null = null;

function signingKey(): Buffer {
  if (playbackKey === null) {
    playbackKey = Buffer.from(
      crypto.hkdfSync(
        "sha256",
        Buffer.from(env.jwtSecret, "utf8"),
        Buffer.alloc(0),
        Buffer.from(PLAYBACK_INFO, "utf8"),
        32
      )
    );
  }
  return playbackKey;
}

function signPlayback(body: string): string {
  return crypto.createHmac("sha256", signingKey()).update(body).digest("base64url");
}

export function signRecordingToken(key: string, now: Date = new Date()): string {
  const expiresAt = Math.floor(now.getTime() / 1000) + RECORDING_URL_TTL_SECONDS;
  const body = Buffer.from([PLAYBACK_VERSION, expiresAt, key].join("\n"), "utf8").toString(
    "base64url"
  );
  return `${body}.${signPlayback(body)}`;
}

/** The key a token names, or null when its signature or its clock has run out. */
export function verifyRecordingToken(token: string, now: Date = new Date()): string | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, provided] = parts;
  if (!body || !provided) return null;

  const expected = signPlayback(body);
  // Lengths must match before timingSafeEqual, which throws rather than
  // returning false when they differ.
  if (provided.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(provided, "utf8"), Buffer.from(expected, "utf8"))) {
    return null;
  }

  const fields = Buffer.from(body, "base64url").toString("utf8").split("\n");
  if (fields.length !== 3) return null;
  const [version, expiresAt, key] = fields;
  if (version !== PLAYBACK_VERSION || !key) return null;

  const expiry = Number(expiresAt);
  if (!Number.isSafeInteger(expiry) || expiry * 1000 <= now.getTime()) return null;

  return key;
}

/** The type a stored key should be served as, from the extension it was filed under. */
export function recordingContentType(key: string): string {
  return EXTENSION_TO_TYPE.get(path.extname(key).toLowerCase()) ?? "application/octet-stream";
}

/* ------------------------------------------------------------- local disk */

/**
 * The store that runs today.
 *
 * Follows services/mediaStorage.ts: the bytes go under the protected root,
 * which is a sibling of the public one rather than a folder inside it, so
 * there is no static mount above them and no URL that reaches them. The only
 * way to the audio is a signed link redeemed by an administrator.
 */
export class LocalDiskRecordingStore implements RecordingStore {
  /** Exposed so the playback route can stream the file it names. */
  readonly root = path.resolve(env.protectedUploadDir, LOCAL_FOLDER);

  async putChunk(input: {
    sessionId: string;
    seq: number;
    body: Buffer;
    contentType: string;
  }): Promise<void> {
    const dir = this.resolve(`${LOCAL_PREFIX}${recordingPartsKey(input.sessionId)}`);
    if (dir === null) throw new Error("Refusing to write a recording outside its own directory");

    await fs.promises.mkdir(dir, { recursive: true });
    // The whole slice in one call, under a name derived from its sequence
    // number: a retried slice overwrites itself with identical bytes instead of
    // appending a second copy into the middle of the conversation.
    await fs.promises.writeFile(path.join(dir, partName(input.seq)), input.body);
    // The type is written beside the slices because `finalize` is given only a
    // session id, and the finished file has to be named — and later served —
    // as what it actually is.
    await fs.promises.writeFile(path.join(dir, TYPE_MARKER), input.contentType);
  }

  finalize(sessionId: string): Promise<StoredRecording> {
    return joinOnce(sessionId, () => this.joinParts(sessionId));
  }

  private async joinParts(sessionId: string): Promise<StoredRecording> {
    const dir = this.resolve(`${LOCAL_PREFIX}${recordingPartsKey(sessionId)}`);
    if (dir === null) throw new MissingRecordingError(sessionId);

    let entries: string[];
    try {
      entries = await fs.promises.readdir(dir);
    } catch {
      // No slices waiting: either this was joined already, or nothing ever
      // arrived. A finished file with this conversation's name is the
      // difference, and finalizing twice has to give the same answer.
      const finished = await this.findFinished(sessionId);
      if (finished === null) throw new MissingRecordingError(sessionId);
      return finished;
    }

    const parts = entries.filter((name) => PART_NAME_SHAPE.test(name)).sort();
    if (parts.length === 0) {
      const finished = await this.findFinished(sessionId);
      if (finished === null) throw new MissingRecordingError(sessionId);
      return finished;
    }

    // Slices AND a finished recording. Two ways to get here, and the same
    // answer to both: a slice that raced the join and landed after the folder
    // was emptied, or a crash between writing the joined file and clearing the
    // slices. Keeping the finished recording is the only safe move — rebuilding
    // it from a lone three-second tail would replace an hour of conversation
    // with the last thing anybody said.
    const already = await this.findFinished(sessionId);
    if (already !== null) {
      await fs.promises.rm(dir, { recursive: true, force: true });
      return already;
    }

    const contentType = await fs.promises
      .readFile(path.join(dir, TYPE_MARKER), "utf8")
      .then((value) => value.trim())
      .catch(() => "audio/webm");

    const key = `${LOCAL_PREFIX}${recordingObjectKey(sessionId, contentType)}`;
    const file = this.resolve(key);
    if (file === null) throw new Error("Refusing to write a recording outside its own directory");

    // Joined through a temporary name and renamed into place: a rename is
    // atomic where an append is not, so nothing ever reads a half-written
    // recording — including this process's own playback route, which serves the
    // finished name. Two joins of the same conversation share one promise
    // (`joinOnce` above) rather than racing here.
    const joining = `${file}.joining`;
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    const out = fs.createWriteStream(joining);
    try {
      for (const part of parts) {
        out.write(await fs.promises.readFile(path.join(dir, part)));
      }
      await new Promise<void>((resolve, reject) => {
        out.end(() => resolve());
        out.on("error", reject);
      });
      await fs.promises.rename(joining, file);
    } catch (err) {
      await fs.promises.rm(joining, { force: true });
      throw err;
    }

    await fs.promises.rm(dir, { recursive: true, force: true });
    const stat = await fs.promises.stat(file);
    return { key, bytes: stat.size, contentType };
  }

  async url(key: string): Promise<string> {
    if (this.resolve(key) === null) throw new Error("That recording is not one this store holds");
    return `${LOCAL_PLAYBACK_ROUTE}/${signRecordingToken(key)}`;
  }

  async remove(key: string): Promise<void> {
    const file = this.resolve(key);
    if (file === null) return;
    // A recording already gone is the state the caller wanted. Deleting the
    // conversation must not fail because the volume was restored from a backup
    // that predates the call.
    await fs.promises.rm(file, { force: true });
    // And the slices, if the call was never closed: they are part of the
    // conversation too, and "delete this conversation" has to mean all of it.
    await fs.promises.rm(`${file.slice(0, file.length - path.extname(file).length)}.parts`, {
      recursive: true,
      force: true,
    });
  }

  /** A recording this conversation already has, joined by an earlier call. */
  private async findFinished(sessionId: string): Promise<StoredRecording | null> {
    const folder = recordingFolder(sessionId);
    const dir = this.resolve(`${LOCAL_PREFIX}${path.dirname(folder)}`);
    if (dir === null) return null;

    const name = path.basename(folder);
    let entries: string[];
    try {
      entries = await fs.promises.readdir(dir);
    } catch {
      return null;
    }

    // The finished file is `<id><ext>`; anything else beginning with the id is
    // the slice folder, which this path has already established is not there.
    const found = entries.find(
      (entry) => entry.startsWith(name) && entry !== `${name}.parts` && !entry.endsWith(".joining")
    );
    if (found === undefined) return null;

    const stat = await fs.promises.stat(path.join(dir, found));
    const key = `${LOCAL_PREFIX}${path.dirname(folder)}/${found}`;
    return { key, bytes: stat.size, contentType: recordingContentType(found) };
  }

  /**
   * The absolute path a key names, or null if it names anything else.
   *
   * `path.resolve` collapses `..` first, so the containment test runs on the
   * real destination — inspecting the key for ".." instead is the version that
   * is bypassed by a path which only escapes after normalisation. Without this,
   * a key of `../../uploads/x.mp3` would put a recording on the public web,
   * which is the one outcome this whole file exists to prevent.
   */
  resolve(key: string): string | null {
    if (!key.startsWith(LOCAL_PREFIX)) return null;
    const relative = key.slice(LOCAL_PREFIX.length).trim();
    if (relative === "" || relative.includes("\0")) return null;

    const absolute = path.resolve(this.root, relative);
    if (absolute !== this.root && !absolute.startsWith(this.root + path.sep)) return null;
    return absolute;
  }
}

/* -------------------------------------------------------------------- S3 */

/**
 * The store the owner asked for.
 *
 * The SDK is loaded on first use rather than imported at the top of this file,
 * for two reasons that both matter: the default deployment never installs a
 * reason to load several megabytes of AWS client into a 640MB heap, and the
 * factory below has to be able to answer "which store is configured" on a box
 * where the package is not installed at all.
 *
 * Streaming is slice objects plus a joining `finalize`, NOT a multipart upload —
 * which is the obvious choice and does not work here: S3 requires every part of
 * a multipart upload except the last to be at least 5MB, and three seconds of
 * browser audio is tens of kilobytes. Buffering fifty slices in the API process
 * to reach that floor is exactly the state a closed tab destroys, which is the
 * thing streaming exists to prevent. So each slice is its own small object and
 * finalize writes the joined one and deletes them.
 *
 * Objects are written with no ACL, so they inherit the bucket's own policy —
 * which must have Block Public Access on. Playback is a presigned GET that
 * expires on the same clock the local link does, so the admin page cannot tell
 * the two stores apart and does not have to.
 */
export class S3RecordingStore implements RecordingStore {
  private readonly bucket: string;
  private readonly region: string;
  private readonly prefix: string;
  private client: unknown = null;

  constructor(config: { bucket: string; region: string; prefix: string }) {
    // Refused at construction, not at the first recording: a misconfigured
    // bucket must be a boot-time complaint, not a conversation that is lost
    // half an hour after somebody flipped the switch.
    if (config.bucket === "") {
      throw new Error("VOICE_RECORDING_STORE=s3 needs VOICE_RECORDING_BUCKET");
    }
    if (config.region === "") {
      throw new Error("VOICE_RECORDING_STORE=s3 needs VOICE_RECORDING_REGION (or AWS_REGION)");
    }
    this.bucket = config.bucket;
    this.region = config.region;
    this.prefix = config.prefix.replace(/^\/+|\/+$/g, "");
  }

  /** The object key for a recording key, with the configured folder in front. */
  private objectName(key: string): string {
    return this.prefix === "" ? key : `${this.prefix}/${key}`;
  }

  private async s3(): Promise<{
    client: import("@aws-sdk/client-s3").S3Client;
    sdk: typeof import("@aws-sdk/client-s3");
  }> {
    const sdk = await import("@aws-sdk/client-s3");
    if (this.client === null) {
      // No explicit credentials: the SDK's default chain reads
      // AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY, a shared profile, or the
      // instance role — so the deployment chooses, and no secret has to pass
      // through this app's own configuration.
      this.client = new sdk.S3Client({ region: this.region });
    }
    return { client: this.client as import("@aws-sdk/client-s3").S3Client, sdk };
  }

  async putChunk(input: {
    sessionId: string;
    seq: number;
    body: Buffer;
    contentType: string;
  }): Promise<void> {
    const { client, sdk } = await this.s3();
    await client.send(
      new sdk.PutObjectCommand({
        Bucket: this.bucket,
        Key: `${this.objectName(recordingPartsKey(input.sessionId))}/${partName(input.seq)}`,
        Body: input.body,
        ContentType: input.contentType,
      })
    );
  }

  finalize(sessionId: string): Promise<StoredRecording> {
    return joinOnce(sessionId, () => this.joinParts(sessionId));
  }

  private async joinParts(sessionId: string): Promise<StoredRecording> {
    const { client, sdk } = await this.s3();
    const folder = this.objectName(recordingFolder(sessionId));
    const partsFolder = `${this.objectName(recordingPartsKey(sessionId))}/`;

    // One listing answers both questions: which slices are waiting, and whether
    // a finished recording is already there from an earlier finalize.
    const listed = await client.send(
      new sdk.ListObjectsV2Command({ Bucket: this.bucket, Prefix: folder })
    );
    const keys = (listed.Contents ?? [])
      .map((object) => object.Key)
      .filter((name): name is string => typeof name === "string");

    const parts = keys.filter((name) => name.startsWith(partsFolder)).sort();
    const finished = keys.find((name) => !name.startsWith(partsFolder));

    if (parts.length === 0) {
      if (finished === undefined) throw new MissingRecordingError(sessionId);
      const head = await client.send(
        new sdk.HeadObjectCommand({ Bucket: this.bucket, Key: finished })
      );
      return {
        key: finished.slice(this.prefix === "" ? 0 : this.prefix.length + 1),
        bytes: head.ContentLength ?? 0,
        contentType: head.ContentType ?? recordingContentType(finished),
      };
    }

    // Slices AND a finished recording: a slice that raced the join, or a crash
    // between writing the joined object and deleting the slices. Either way the
    // finished recording wins — rebuilding it from a lone tail would replace
    // the conversation with its last three seconds.
    if (finished !== undefined) {
      const head = await client.send(
        new sdk.HeadObjectCommand({ Bucket: this.bucket, Key: finished })
      );
      await client.send(
        new sdk.DeleteObjectsCommand({
          Bucket: this.bucket,
          Delete: { Objects: parts.map((part) => ({ Key: part })) },
        })
      );
      return {
        key: finished.slice(this.prefix === "" ? 0 : this.prefix.length + 1),
        bytes: head.ContentLength ?? 0,
        contentType: head.ContentType ?? recordingContentType(finished),
      };
    }

    // The slices carry the type they were recorded as; the first one is as good
    // an answer as the last.
    const firstPart = await client.send(
      new sdk.GetObjectCommand({ Bucket: this.bucket, Key: parts[0]! })
    );
    const contentType = firstPart.ContentType ?? "audio/webm";

    const bodies: Buffer[] = [Buffer.from((await firstPart.Body?.transformToByteArray()) ?? [])];
    for (const part of parts.slice(1)) {
      const got = await client.send(new sdk.GetObjectCommand({ Bucket: this.bucket, Key: part }));
      const bytes = await got.Body?.transformToByteArray();
      if (bytes) bodies.push(Buffer.from(bytes));
    }
    const joined = Buffer.concat(bodies);

    const key = recordingObjectKey(sessionId, contentType);
    await client.send(
      new sdk.PutObjectCommand({
        Bucket: this.bucket,
        Key: this.objectName(key),
        Body: joined,
        ContentType: contentType,
      })
    );
    // Only after the joined object is safely written. A crash between the two
    // leaves the slices behind, which costs storage and is repairable; the
    // other order loses the conversation.
    await client.send(
      new sdk.DeleteObjectsCommand({
        Bucket: this.bucket,
        Delete: { Objects: parts.map((part) => ({ Key: part })) },
      })
    );

    return { key, bytes: joined.byteLength, contentType };
  }

  async url(key: string): Promise<string> {
    const { client, sdk } = await this.s3();
    const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
    return getSignedUrl(
      client,
      new sdk.GetObjectCommand({ Bucket: this.bucket, Key: this.objectName(key) }),
      { expiresIn: RECORDING_URL_TTL_SECONDS }
    );
  }

  async remove(key: string): Promise<void> {
    const { client, sdk } = await this.s3();
    await client.send(
      new sdk.DeleteObjectCommand({ Bucket: this.bucket, Key: this.objectName(key) })
    );

    // And the slices, if this conversation never finished.
    const partsFolder = `${this.objectName(key.slice(0, key.length - path.extname(key).length))}.parts/`;
    const listed = await client.send(
      new sdk.ListObjectsV2Command({ Bucket: this.bucket, Prefix: partsFolder })
    );
    const parts = (listed.Contents ?? [])
      .map((object) => object.Key)
      .filter((name): name is string => typeof name === "string");
    if (parts.length > 0) {
      await client.send(
        new sdk.DeleteObjectsCommand({
          Bucket: this.bucket,
          Delete: { Objects: parts.map((part) => ({ Key: part })) },
        })
      );
    }
  }
}

/* ---------------------------------------------------------------- factory */

export type RecordingStoreConfig = {
  store: string;
  bucket: string;
  region: string;
  prefix: string;
};

/**
 * Which store new recordings are written to.
 *
 * Every call site asks this rather than constructing a store, so "where does
 * audio go" is answered in one place and switching it is one variable.
 */
export function recordingStore(config: RecordingStoreConfig = env.voiceRecording): RecordingStore {
  if (config.store === "s3") {
    return new S3RecordingStore({
      bucket: config.bucket,
      region: config.region,
      prefix: config.prefix,
    });
  }
  return new LocalDiskRecordingStore();
}

/**
 * Which store holds a recording that already exists.
 *
 * The half of the switch that is easy to forget: on the day the bucket is
 * turned on, every conversation recorded before it is still on the volume. A
 * factory that read only the environment would hand those keys to S3 and every
 * one of them would go silent. The key says where it lives — `protected:` is
 * the local disk — so reading and deleting follow the key.
 */
export function recordingStoreFor(
  key: string,
  config: RecordingStoreConfig = env.voiceRecording
): RecordingStore {
  if (key.startsWith(LOCAL_PREFIX)) return new LocalDiskRecordingStore();
  return recordingStore(config);
}

/** Whether a key is one the local disk holds. Used by the playback route. */
export function isLocalRecordingKey(key: string): boolean {
  return key.startsWith(LOCAL_PREFIX);
}
