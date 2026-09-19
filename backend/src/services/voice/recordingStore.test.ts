import fs from "fs";
import os from "os";
import path from "path";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * Where a conversation's audio may and may not end up.
 *
 * The rule under test is the one that cannot be checked by clicking around the
 * admin: a recording must never be reachable from the public static mount.
 * /uploads is handed to express.static, so a key that resolves anywhere inside
 * it — by a `..`, by an absolute path, by a prefix that was never checked —
 * publishes somebody's conversation on the open web, and nothing in the UI
 * would ever show that it had happened.
 *
 * The storage roots are pointed at scratch directories BEFORE anything that
 * reads config/env is imported, which is why every import below is dynamic.
 * The suite also proves the factory can decide "S3" without the AWS SDK being
 * installed, because on this host it is not.
 */

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "bc-voice-recordings-"));
const publicDir = path.join(scratch, "uploads");
const protectedDir = path.join(scratch, "uploads-protected");

type StoreModule = typeof import("./recordingStore");

let store: StoreModule;

beforeAll(async () => {
  process.env.UPLOAD_DIR = publicDir;
  process.env.PROTECTED_UPLOAD_DIR = protectedDir;
  process.env.JWT_SECRET = process.env.JWT_SECRET ?? "unit-test-secret";
  fs.mkdirSync(publicDir, { recursive: true });
  fs.mkdirSync(protectedDir, { recursive: true });
  store = await import("./recordingStore");
});

const S3_CONFIG = { store: "s3", bucket: "bc-voice", region: "us-east-1", prefix: "recordings" };
const LOCAL_CONFIG = { store: "local", bucket: "", region: "", prefix: "voice-recordings" };

describe("choosing a store", () => {
  it("defaults to the local disk, because this host has no AWS credentials", () => {
    expect(store.recordingStore(LOCAL_CONFIG)).toBeInstanceOf(store.LocalDiskRecordingStore);
  });

  it("selects S3 on one environment variable, without the SDK being installed", () => {
    // Construction must not load @aws-sdk/client-s3 — it is not a dependency of
    // this box, only of the deployment that turns the bucket on.
    expect(store.recordingStore(S3_CONFIG)).toBeInstanceOf(store.S3RecordingStore);
  });

  it("refuses a half-configured bucket at construction rather than at the first call", () => {
    expect(() => store.recordingStore({ ...S3_CONFIG, bucket: "" })).toThrow(
      /VOICE_RECORDING_BUCKET/
    );
    expect(() => store.recordingStore({ ...S3_CONFIG, region: "" })).toThrow(/REGION/);
  });

  it("reads and deletes through the store the KEY names, not the one the environment names", () => {
    // The day the bucket is switched on, every conversation recorded before it
    // is still on the volume. If reads followed the environment they would all
    // go silent at once.
    expect(store.recordingStoreFor("protected:2026/09/abc.webm", S3_CONFIG)).toBeInstanceOf(
      store.LocalDiskRecordingStore
    );
    expect(store.recordingStoreFor("2026/09/abc.webm", S3_CONFIG)).toBeInstanceOf(
      store.S3RecordingStore
    );
    expect(store.recordingStoreFor("2026/09/abc.webm", LOCAL_CONFIG)).toBeInstanceOf(
      store.LocalDiskRecordingStore
    );
  });
});

describe("naming a recording", () => {
  it("files a conversation under its own id, derived from nothing else", () => {
    // Derived from the id ALONE, because `finalize(sessionId)` is all the
    // store is given to find the slices with — a name that needed the date
    // would be unfindable the moment a call crossed midnight.
    const id = "9f1c7d2a-0000-4000-8000-000000000001";
    expect(store.recordingObjectKey(id, "audio/webm")).toBe(`9f/1c/${id}.webm`);
    expect(store.recordingPartsKey(id)).toBe(`9f/1c/${id}.parts`);
  });

  it("keeps the extension honest for every audio type a browser records", () => {
    const id = "abcd1234";
    expect(store.recordingObjectKey(id, "audio/mpeg")).toBe("ab/cd/abcd1234.mp3");
    expect(store.recordingObjectKey(id, "audio/mp4")).toBe("ab/cd/abcd1234.m4a");
    expect(store.recordingObjectKey(id, "audio/ogg")).toBe("ab/cd/abcd1234.ogg");
    expect(store.recordingObjectKey(id, "audio/wav")).toBe("ab/cd/abcd1234.wav");
  });

  it("strips anything from a session id that could steer the path", () => {
    expect(store.recordingObjectKey("../../etc/passwd", "audio/wav")).toBe(
      "et/cp/etcpasswd.wav"
    );
    expect(() => store.recordingObjectKey("../..", "audio/wav")).toThrow();
  });
});

describe("the local disk store", () => {
  const identity = (sessionId: string) => ({ sessionId, contentType: "audio/webm" });

  it("writes into the protected root and nowhere near the public one", async () => {
    const local = new store.LocalDiskRecordingStore();
    await local.putChunk({ ...identity("conversation-one"), seq: 0, body: Buffer.from("opus") });
    const recording = await local.finalize("conversation-one");

    expect(recording.key.startsWith("protected:")).toBe(true);
    expect(recording.bytes).toBe(4);
    expect(recording.contentType).toBe("audio/webm");

    const onDisk = local.resolve(recording.key);
    expect(onDisk).not.toBeNull();
    expect(onDisk!.startsWith(path.resolve(protectedDir) + path.sep)).toBe(true);
    expect(fs.existsSync(onDisk!)).toBe(true);

    // The public root is what express.static serves. Nothing of this may be
    // inside it, at any depth.
    const published = fs.readdirSync(publicDir, { recursive: true }) as string[];
    expect(published).toHaveLength(0);
  });

  it("joins the slices of a streamed call back into one recording, in order", async () => {
    const local = new store.LocalDiskRecordingStore();
    // Out of order and with one slice sent twice, which is what a flaky
    // connection and a `keepalive` flush from a closing tab actually produce.
    for (const [seq, text] of [
      [1, "second"],
      [0, "first"],
      [2, "third"],
      [1, "second"],
    ] as const) {
      await local.putChunk({ ...identity("streamed"), seq, body: Buffer.from(text) });
    }

    const recording = await local.finalize("streamed");
    expect(fs.readFileSync(local.resolve(recording.key)!, "utf8")).toBe("firstsecondthird");
    expect(recording.bytes).toBe("firstsecondthird".length);

    // Joining twice has to give the same answer rather than an empty file:
    // the owner can open the same conversation again tomorrow.
    const again = await local.finalize("streamed");
    expect(again.key).toBe(recording.key);
    expect(again.bytes).toBe(recording.bytes);
    expect(fs.readFileSync(local.resolve(recording.key)!, "utf8")).toBe("firstsecondthird");
  });

  it("keeps what arrived when a slice was dropped on the way", async () => {
    const local = new store.LocalDiskRecordingStore();
    // A hole where a request never made it: those three seconds are lost, the
    // recording is not.
    await local.putChunk({ ...identity("abandoned"), seq: 0, body: Buffer.from("aaa") });
    await local.putChunk({ ...identity("abandoned"), seq: 2, body: Buffer.from("ccc") });

    const recording = await local.finalize("abandoned");
    expect(fs.readFileSync(local.resolve(recording.key)!, "utf8")).toBe("aaaccc");
  });

  it("orders a hundred slices by number, not by the text of their names", async () => {
    const local = new store.LocalDiskRecordingStore();
    for (let seq = 0; seq < 12; seq += 1) {
      await local.putChunk({ ...identity("ordered"), seq, body: Buffer.from(`[${seq}]`) });
    }
    const recording = await local.finalize("ordered");
    expect(fs.readFileSync(local.resolve(recording.key)!, "utf8")).toBe(
      "[0][1][2][3][4][5][6][7][8][9][10][11]"
    );
  });

  it("keeps the finished recording when a late slice arrives after the join", async () => {
    const local = new store.LocalDiskRecordingStore();
    await local.putChunk({ ...identity("straggler"), seq: 0, body: Buffer.from("the whole call") });
    const recording = await local.finalize("straggler");

    // A `pagehide` flush that raced the join, landing in a folder that had just
    // been emptied. Rebuilding from it would replace the conversation with its
    // last three seconds, so the finished recording has to win.
    await local.putChunk({ ...identity("straggler"), seq: 9, body: Buffer.from("tail") });
    const after = await local.finalize("straggler");

    expect(after.key).toBe(recording.key);
    expect(fs.readFileSync(local.resolve(after.key)!, "utf8")).toBe("the whole call");
  });

  it("survives two people joining the same conversation at once", async () => {
    const local = new store.LocalDiskRecordingStore();
    await local.putChunk({ ...identity("doubled"), seq: 0, body: Buffer.from("one call") });

    // The ordinary way this happens: the panel is opened twice in a second, or
    // an effect runs twice in development. Both have to come back with the
    // recording rather than one of them erroring over a file that plays fine.
    const [first, second] = await Promise.all([
      local.finalize("doubled"),
      local.finalize("doubled"),
    ]);
    expect(second.key).toBe(first.key);
    expect(second.bytes).toBe(first.bytes);
    expect(fs.readFileSync(local.resolve(first.key)!, "utf8")).toBe("one call");
  });

  it("says so plainly when a conversation has no audio at all", async () => {
    const local = new store.LocalDiskRecordingStore();
    await expect(local.finalize("silent")).rejects.toBeInstanceOf(store.MissingRecordingError);
  });

  it("refuses a key that tries to climb out of the recordings folder", () => {
    const local = new store.LocalDiskRecordingStore();
    for (const key of [
      "protected:../../uploads/leak.webm",
      "protected:../certificates/receipt.pdf",
      `protected:${path.resolve(publicDir, "leak.webm")}`,
      "protected:",
      "protected:\0.webm",
      // Not this store's key at all: a bare key belongs to the bucket.
      "ab/cd/abcd.webm",
    ]) {
      expect(local.resolve(key)).toBeNull();
    }
  });

  it("keeps the slices of an unfinished call out of the public root too", async () => {
    const local = new store.LocalDiskRecordingStore();
    await local.putChunk({ ...identity("unfinished"), seq: 0, body: Buffer.from("audio") });
    const published = fs.readdirSync(publicDir, { recursive: true }) as string[];
    expect(published).toHaveLength(0);
  });

  it("hands back a link that names the recording and dies on its own clock", async () => {
    const local = new store.LocalDiskRecordingStore();
    await local.putChunk({ ...identity("conversation-two"), seq: 0, body: Buffer.from("audio") });
    const recording = await local.finalize("conversation-two");

    const url = await local.url(recording.key);
    const token = url.slice(url.lastIndexOf("/") + 1);
    expect(store.verifyRecordingToken(token)).toBe(recording.key);

    // Tampered, and expired: both have to fail, or the link is not a credential.
    expect(store.verifyRecordingToken(`${token}x`)).toBeNull();
    const later = new Date(Date.now() + (store.RECORDING_URL_TTL_SECONDS + 60) * 1000);
    expect(store.verifyRecordingToken(token, later)).toBeNull();
  });

  it("refuses to mint a link for a key it does not hold", async () => {
    const local = new store.LocalDiskRecordingStore();
    await expect(local.url("protected:../../uploads/leak.webm")).rejects.toThrow();
  });

  it("takes the unjoined slices away with the conversation", async () => {
    const local = new store.LocalDiskRecordingStore();
    await local.putChunk({ ...identity("removed"), seq: 0, body: Buffer.from("audio") });
    // The key a never-finalized conversation would have had, which is what the
    // admin delete resolves before asking the store to forget it.
    await local.remove(`protected:${store.recordingObjectKey("removed", "audio/webm")}`);
    await expect(local.finalize("removed")).rejects.toBeInstanceOf(store.MissingRecordingError);
  });

  it("treats deleting a recording that is already gone as done", async () => {
    const local = new store.LocalDiskRecordingStore();
    await local.putChunk({ ...identity("conversation-three"), seq: 0, body: Buffer.from("audio") });
    const recording = await local.finalize("conversation-three");
    await local.remove(recording.key);
    expect(fs.existsSync(local.resolve(recording.key)!)).toBe(false);
    // Deleting a conversation must not fail because the volume was restored
    // from a backup that predates the call.
    await expect(local.remove(recording.key)).resolves.toBeUndefined();
  });
});
