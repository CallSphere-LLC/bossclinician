import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import type { Client } from "pg";
import type { AddressInfo } from "net";
import { createTestDatabase, hasTestDatabase } from "../../testing/db";

const describeDb = hasTestDatabase ? describe : describe.skip;

/**
 * The resumable upload path, exercised the way it actually fails.
 *
 * Every test here is a scene from a real upload of a real course video: the
 * connection dying in the middle of a chunk, the tab being closed and reopened
 * the next morning, two tabs racing, the same file dragged in twice. The
 * assertions are about the bytes, not about the JSON: an upload that reports
 * success and stores a corrupt video is the failure this whole path exists to
 * make impossible.
 */
describeDb("resumable media uploads (integration)", () => {
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let client: Client;
  let server: ReturnType<express.Express["listen"]>;
  let baseUrl: string;
  let uploadDir: string;
  let protectedDir: string;
  let sweep: () => Promise<{ expired: number; pruned: number; orphans: number }>;

  /** Whose request it is. Flipped to prove one admin cannot touch another's. */
  let currentAdmin = 1;

  beforeAll(async () => {
    db = await createTestDatabase("media_uploads");
    client = db.client;
    await client.query(
      `INSERT INTO admin_users (id, email, password_hash, name, role) VALUES
         (1, 'owner@bossclinician.test', 'unused', 'Test Owner', 'owner'),
         (2, 'coach@bossclinician.test', 'unused', 'Test Coach', 'coach')`,
    );

    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "bc-uploads-"));
    uploadDir = path.join(root, "public");
    protectedDir = path.join(root, "paid");

    process.env.DATABASE_URL = db.url;
    process.env.UPLOAD_DIR = uploadDir;
    process.env.PROTECTED_UPLOAD_DIR = protectedDir;
    // Small on purpose: the "too big" refusal has to be provable without
    // pushing half a gigabyte through a test.
    process.env.MAX_UPLOAD_MB = "1";
    process.env.JWT_SECRET ??= "media-uploads-integration-secret";
    process.env.STRIPE_SECRET_KEY = "";

    const [{ adminMediaRouter }, { errorHandler }, resumable] = await Promise.all([
      import("./media"),
      import("../../middleware/errorHandler"),
      import("../../services/resumableUploads"),
    ]);
    sweep = resumable.sweepUploadSessions;

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.user = { sub: currentAdmin, email: "owner@bossclinician.test", role: "owner" };
      next();
    });
    app.use("/media", adminMediaRouter);
    app.use(errorHandler);

    server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    // The app's own pool holds connections to the scratch database; dropping it
    // underneath them makes Postgres terminate them, which surfaces as an
    // unhandled error long after the assertions have passed.
    const { pool } = await import("../../db/pool");
    await pool.end().catch(() => undefined);
    await db.drop();
  });

  // ------------------------------------------------------------- utilities

  interface SessionJson {
    uploadId: string;
    offset: number;
    sizeBytes: number;
    chunkSize: number;
    resumed?: boolean;
  }

  async function start(input: {
    fileName: string;
    sizeBytes: number;
    mime?: string;
    visibility?: "public" | "protected";
    lastModified?: number;
  }): Promise<Response> {
    return fetch(`${baseUrl}/media/uploads`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fileName: input.fileName,
        sizeBytes: input.sizeBytes,
        mime: input.mime ?? "video/mp4",
        visibility: input.visibility ?? "protected",
        lastModified: input.lastModified ?? 1_700_000_000_000,
      }),
    });
  }

  async function send(uploadId: string, offset: number, bytes: Buffer): Promise<Response> {
    return fetch(`${baseUrl}/media/uploads/${uploadId}?offset=${offset}`, {
      method: "PUT",
      headers: { "Content-Type": "application/octet-stream" },
      body: bytes,
    });
  }

  function partFile(uploadId: string): string {
    return path.join(protectedDir, ".parts", `${uploadId}.part`);
  }

  // ---------------------------------------------------------------- scenes

  it("carries a video across a dropped connection and stores it byte for byte", async () => {
    const video = crypto.randomBytes(90_000);
    const created = await start({ fileName: "Module 3 - Boundaries.mp4", sizeBytes: video.length });
    expect(created.status).toBe(201);
    const session = (await created.json()) as SessionJson;
    expect(session.offset).toBe(0);

    // The first chunk lands.
    const first = await send(session.uploadId, 0, video.subarray(0, 40_000));
    expect(first.status).toBe(200);
    expect(((await first.json()) as { offset: number }).offset).toBe(40_000);

    // Now the connection dies mid-chunk. The bytes that reached the disk were
    // never acknowledged, and the next write has to throw them away rather than
    // leave them wedged in the middle of the file.
    await fs.promises.appendFile(partFile(session.uploadId), Buffer.alloc(9_999, 0x7a));

    const status = await fetch(`${baseUrl}/media/uploads/${session.uploadId}`);
    expect(((await status.json()) as SessionJson).offset).toBe(40_000);

    const second = await send(session.uploadId, 40_000, video.subarray(40_000));
    const secondBody = (await second.json()) as { offset: number; complete: boolean };
    expect(secondBody.offset).toBe(video.length);
    expect(secondBody.complete).toBe(true);

    const finished = await fetch(`${baseUrl}/media/uploads/${session.uploadId}/complete`, {
      method: "POST",
    });
    expect(finished.status).toBe(201);
    const asset = (await finished.json()) as {
      id: number;
      filename: string;
      sizeBytes: string | number;
      visibility: string;
      url: string;
    };
    expect(asset.visibility).toBe("protected");
    expect(Number(asset.sizeBytes)).toBe(video.length);

    const stored = await fs.promises.readFile(path.join(protectedDir, asset.filename));
    expect(stored.equals(video)).toBe(true);
    // The junk from the dead chunk is nowhere in it, and the part file is gone.
    expect(fs.existsSync(partFile(session.uploadId))).toBe(false);
  });

  it("tells a client that lost its place where the file actually ends", async () => {
    const bytes = crypto.randomBytes(6_000);
    const created = await start({ fileName: "Welcome.mp4", sizeBytes: bytes.length });
    const session = (await created.json()) as SessionJson;
    await send(session.uploadId, 0, bytes.subarray(0, 3_000));

    // The classic: the response to a chunk was lost, so the client sends the
    // same chunk again from the offset it still believes in.
    const confused = await send(session.uploadId, 0, bytes.subarray(0, 3_000));
    expect(confused.status).toBe(409);
    const body = (await confused.json()) as { details?: { offset?: number } };
    expect(body.details?.offset).toBe(3_000);

    // Following that advice finishes the file correctly.
    await send(session.uploadId, 3_000, bytes.subarray(3_000));
    const done = await fetch(`${baseUrl}/media/uploads/${session.uploadId}/complete`, {
      method: "POST",
    });
    const asset = (await done.json()) as { filename: string };
    const stored = await fs.promises.readFile(path.join(protectedDir, asset.filename));
    expect(stored.equals(bytes)).toBe(true);
  });

  it("resumes the same upload when she closes the tab and comes back to it", async () => {
    const bytes = crypto.randomBytes(20_000);
    const first = await start({
      fileName: "Session 2 recording.mp4",
      sizeBytes: bytes.length,
      lastModified: 1_699_000_000_000,
    });
    const session = (await first.json()) as SessionJson;
    await send(session.uploadId, 0, bytes.subarray(0, 12_345));

    // The tab is gone. The list the media library loads on arrival is what
    // brings the upload back.
    const listed = (await (await fetch(`${baseUrl}/media/uploads`)).json()) as SessionJson[];
    const waiting = listed.find((entry) => entry.uploadId === session.uploadId);
    expect(waiting?.offset).toBe(12_345);

    // Choosing the same file again joins the session rather than starting a
    // second one and a second half-file.
    const again = await start({
      fileName: "Session 2 recording.mp4",
      sizeBytes: bytes.length,
      lastModified: 1_699_000_000_000,
    });
    expect(again.status).toBe(200);
    const rejoined = (await again.json()) as SessionJson;
    expect(rejoined.uploadId).toBe(session.uploadId);
    expect(rejoined.offset).toBe(12_345);

    await send(rejoined.uploadId, rejoined.offset, bytes.subarray(12_345));
    const done = await fetch(`${baseUrl}/media/uploads/${rejoined.uploadId}/complete`, {
      method: "POST",
    });
    expect(done.status).toBe(201);
  });

  it("hands back the file she already has instead of uploading it twice", async () => {
    const bytes = crypto.randomBytes(4_000);
    const created = await start({ fileName: "Workbook cover.png", sizeBytes: bytes.length, mime: "image/png", visibility: "public" });
    const session = (await created.json()) as SessionJson;
    await send(session.uploadId, 0, bytes);
    const first = (await (
      await fetch(`${baseUrl}/media/uploads/${session.uploadId}/complete`, { method: "POST" })
    ).json()) as { id: number };

    const repeat = await start({
      fileName: "Workbook cover.png",
      sizeBytes: bytes.length,
      mime: "image/png",
      visibility: "public",
    });
    expect(repeat.status).toBe(200);
    const body = (await repeat.json()) as { duplicate: boolean; asset: { id: number } };
    expect(body.duplicate).toBe(true);
    expect(body.asset.id).toBe(first.id);

    // And nothing was written twice.
    const rows = await client.query(
      "SELECT count(*)::int AS n FROM media_assets WHERE original_name = 'Workbook cover.png'",
    );
    expect(rows.rows[0].n).toBe(1);
  });

  it("refuses a second, different file that wants the same name", async () => {
    const refused = await start({
      fileName: "Workbook cover.png",
      sizeBytes: 4_001,
      mime: "image/png",
      visibility: "public",
    });
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: string }).error).toContain("Workbook cover.png");
  });

  it("says no before a byte is sent, not after", async () => {
    const tooBig = await start({ fileName: "Retreat day one.mp4", sizeBytes: 5 * 1024 * 1024 });
    expect(tooBig.status).toBe(413);

    const wrongKind = await start({
      fileName: "installer.exe",
      sizeBytes: 100,
      mime: "application/x-msdownload",
    });
    expect(wrongKind.status).toBe(400);
    expect(((await wrongKind.json()) as { error: string }).error).toMatch(/unsupported file type/i);
  });

  it("refuses to send more of the file than there is left", async () => {
    const created = await start({ fileName: "Short clip.mp4", sizeBytes: 500 });
    const session = (await created.json()) as SessionJson;
    const overflowing = await send(session.uploadId, 0, crypto.randomBytes(900));
    expect(overflowing.status).toBe(413);
  });

  it("keeps one administrator's upload out of another's hands", async () => {
    const created = await start({ fileName: "Private notes.pdf", sizeBytes: 100, mime: "application/pdf" });
    const session = (await created.json()) as SessionJson;

    currentAdmin = 2;
    try {
      const peek = await fetch(`${baseUrl}/media/uploads/${session.uploadId}`);
      expect(peek.status).toBe(404);
      const write = await send(session.uploadId, 0, crypto.randomBytes(100));
      expect(write.status).toBe(404);
      const listed = (await (await fetch(`${baseUrl}/media/uploads`)).json()) as SessionJson[];
      expect(listed.some((entry) => entry.uploadId === session.uploadId)).toBe(false);
    } finally {
      currentAdmin = 1;
    }
  });

  it("will not finish a file that is not all there", async () => {
    const created = await start({ fileName: "Half a lesson.mp4", sizeBytes: 8_000 });
    const session = (await created.json()) as SessionJson;
    await send(session.uploadId, 0, crypto.randomBytes(2_000));

    const early = await fetch(`${baseUrl}/media/uploads/${session.uploadId}/complete`, {
      method: "POST",
    });
    expect(early.status).toBe(409);
    expect(((await early.json()) as { details?: { offset?: number } }).details?.offset).toBe(2_000);
  });

  it("clears out uploads nobody came back for", async () => {
    const created = await start({ fileName: "Abandoned.mp4", sizeBytes: 3_000 });
    const session = (await created.json()) as SessionJson;
    await send(session.uploadId, 0, crypto.randomBytes(1_000));
    expect(fs.existsSync(partFile(session.uploadId))).toBe(true);

    await client.query("UPDATE media_upload_sessions SET expires_at = now() - interval '1 day' WHERE id = $1", [
      session.uploadId,
    ]);
    const result = await sweep();
    expect(result.expired).toBeGreaterThanOrEqual(1);
    expect(fs.existsSync(partFile(session.uploadId))).toBe(false);

    const row = await client.query("SELECT status FROM media_upload_sessions WHERE id = $1", [
      session.uploadId,
    ]);
    expect(row.rows[0].status).toBe("aborted");
  });

  it("refuses a chunk sent as anything but raw bytes", async () => {
    const created = await start({ fileName: "Mislabelled.mp4", sizeBytes: 100 });
    const session = (await created.json()) as SessionJson;
    const wrong = await fetch(`${baseUrl}/media/uploads/${session.uploadId}?offset=0`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ not: "bytes" }),
    });
    expect(wrong.status).toBe(400);
  });
});
