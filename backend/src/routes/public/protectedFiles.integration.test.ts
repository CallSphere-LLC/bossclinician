import fs from "fs";
import os from "os";
import path from "path";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Client } from "pg";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { createTestDatabase, hasTestDatabase, insertCourseProduct, insertMember } from "../../testing/db";

/**
 * Integration tests for the door in front of paid bytes.
 *
 * The defect these exist for was not subtle and not theoretical: the upload
 * directory was served whole at /uploads, so the course video the player was
 * handed was also a public URL. Buy one course, copy the address out of the
 * page, post it. No expiry, no member, no record, and a refund changed nothing.
 *
 * Everything below is that exploit, attempted. A lesson's video is written to
 * the protected directory and asked for four ways: through the player, straight
 * off the public mount, from a second member's session, and after the buyer's
 * grant has been revoked. Only the first is meant to work.
 *
 * Skipped when TEST_DATABASE_URL is unset, like every other suite here.
 */

const describeDb = hasTestDatabase ? describe : describe.skip;

const VIDEO_BYTES = "the paid video";
const VIDEO_KEY = "a1b2c3d4e5f60718.mp4";

const PREVIEW_BYTES = "the sample lesson";
const PREVIEW_KEY = "0f1e2d3c4b5a6978.mp4";
const PREVIEW_ATTACHMENT_BYTES = "the sample workbook";
const PREVIEW_ATTACHMENT_KEY = "9876543210abcdef.pdf";

describeDb("protected file delivery (integration)", () => {
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let client: Client;
  let server: Server;
  let baseUrl: string;
  let storage: string;
  let buyerToken: string;
  let strangerToken: string;
  let productId: number;
  let buyerId: number;
  let previewAttachmentId: number;

  beforeAll(async () => {
    db = await createTestDatabase("protectedfiles");
    client = db.client;

    // config/env reads process.env at import time, so both storage roots have to
    // point at scratch directories before the first dynamic import.
    storage = fs.mkdtempSync(path.join(os.tmpdir(), "bc-storage-"));
    process.env.DATABASE_URL = db.url;
    process.env.JWT_SECRET ??= "integration-test-secret";
    process.env.UPLOAD_DIR = path.join(storage, "public");
    process.env.PROTECTED_UPLOAD_DIR = path.join(storage, "protected");
    fs.mkdirSync(process.env.UPLOAD_DIR, { recursive: true });
    fs.mkdirSync(process.env.PROTECTED_UPLOAD_DIR, { recursive: true });
    fs.writeFileSync(path.join(process.env.PROTECTED_UPLOAD_DIR, VIDEO_KEY), VIDEO_BYTES);
    fs.writeFileSync(path.join(process.env.PROTECTED_UPLOAD_DIR, PREVIEW_KEY), PREVIEW_BYTES);
    fs.writeFileSync(
      path.join(process.env.PROTECTED_UPLOAD_DIR, PREVIEW_ATTACHMENT_KEY),
      PREVIEW_ATTACHMENT_BYTES
    );

    const { createApp } = await import("../../app");
    const { signMemberAccessToken } = await import("../../auth/memberSession");

    buyerId = await insertMember(client, "buyer@example.com");
    const strangerId = await insertMember(client, "stranger@example.com");
    buyerToken = signMemberAccessToken({ sub: buyerId, email: "buyer@example.com" });
    strangerToken = signMemberAccessToken({ sub: strangerId, email: "stranger@example.com" });

    const course = await insertCourseProduct(client, "boundaries");
    productId = course.productId;

    const mod = await client.query<{ id: number }>(
      `INSERT INTO course_modules (course_id, title, sort) VALUES ($1, 'Module one', 0) RETURNING id`,
      [course.courseId]
    );
    await client.query(
      `INSERT INTO course_lessons (module_id, slug, title, content_type, video_url, published, sort)
       VALUES ($1, 'the-lesson', 'The lesson', 'video', $2, true, 0)`,
      [mod.rows[0].id, `protected:${VIDEO_KEY}`]
    );

    // A module that has not dripped yet, holding the lesson the sales page
    // already plays to strangers. The player unlocks it and the redemption path
    // has to agree, or the page renders and the video stalls.
    const dripped = await client.query<{ id: number }>(
      `INSERT INTO course_modules (course_id, title, drip_days, sort)
       VALUES ($1, 'Module two', 14, 1) RETURNING id`,
      [course.courseId]
    );
    const previewLesson = await client.query<{ id: number }>(
      `INSERT INTO course_lessons
         (module_id, slug, title, content_type, video_url, preview, published, sort)
       VALUES ($1, 'the-sample', 'The sample', 'video', $2, true, true, 0)
       RETURNING id`,
      [dripped.rows[0].id, `protected:${PREVIEW_KEY}`]
    );
    const attachment = await client.query<{ id: number }>(
      `INSERT INTO lesson_files (lesson_id, title, storage_path, filename, mime, sort)
       VALUES ($1, 'Workbook', $2, 'workbook.pdf', 'application/pdf', 0)
       RETURNING id`,
      [previewLesson.rows[0].id, `protected:${PREVIEW_ATTACHMENT_KEY}`]
    );
    previewAttachmentId = attachment.rows[0].id;

    await client.query(
      `INSERT INTO access_grants (member_id, product_id, source, status)
       VALUES ($1, $2, 'purchase', 'active')`,
      [buyerId, productId]
    );

    server = createApp().listen(0);
    await new Promise<void>((resolve) => {
      server.once("listening", () => resolve());
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server?.close(resolve));
    // The app's own pool holds connections to the scratch database, and dropping
    // it out from under them is what turns teardown into a page of errors.
    const { pool } = await import("../../db/pool");
    await pool.end().catch(() => undefined);
    await db?.drop();
    fs.rmSync(storage, { recursive: true, force: true });
  });

  async function lessonVideoUrl(): Promise<string> {
    const res = await fetch(`${baseUrl}/api/member/library/p-boundaries/lessons/the-lesson`, {
      headers: { Authorization: `Bearer ${buyerToken}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { lesson: { videoUrl: string } };
    return body.lesson.videoUrl;
  }

  it("hands the player a signed link instead of a path on disk", async () => {
    const videoUrl = await lessonVideoUrl();

    expect(videoUrl.startsWith("/api/files/")).toBe(true);
    // The two shapes that were the whole defect: the stored key, and the public
    // mount it used to be served from.
    expect(videoUrl).not.toContain("/uploads/");
    expect(videoUrl).not.toContain(VIDEO_KEY);
  });

  it("serves the bytes to whoever holds a fresh link", async () => {
    // No Authorization header: a <video> element cannot send one, which is the
    // reason the credential is in the URL at all.
    const res = await fetch(`${baseUrl}${await lessonVideoUrl()}`);
    expect(res.status).toBe(200);
    await expect(res.text()).resolves.toBe(VIDEO_BYTES);
  });

  it("does not serve the same file off the public mount", async () => {
    for (const url of [
      `/uploads/${VIDEO_KEY}`,
      `/uploads/../protected/${VIDEO_KEY}`,
      `/uploads/%2e%2e/protected/${VIDEO_KEY}`,
    ]) {
      const res = await fetch(`${baseUrl}${url}`);
      expect(res.status).toBe(404);
    }
  });

  it("refuses a forwarded link for the member who opens it", async () => {
    const res = await fetch(`${baseUrl}${await lessonVideoUrl()}`, {
      headers: { Authorization: `Bearer ${strangerToken}` },
    });
    expect(res.status).toBe(404);
  });

  it("plays a preview lesson sitting inside a module that has not dripped", async () => {
    // Day one of a fourteen-day drip. The lesson page opens because `preview`
    // overrides the schedule; the bytes have to follow the same rule.
    const res = await fetch(`${baseUrl}/api/member/library/p-boundaries/lessons/the-sample`, {
      headers: { Authorization: `Bearer ${buyerToken}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { lesson: { locked: boolean; videoUrl: string } };
    expect(body.lesson.locked).toBe(false);
    expect(body.lesson.videoUrl.startsWith("/api/files/")).toBe(true);

    const played = await fetch(`${baseUrl}${body.lesson.videoUrl}`);
    expect(played.status).toBe(200);
    await expect(played.text()).resolves.toBe(PREVIEW_BYTES);
  });

  it("hands over that preview lesson's workbook too", async () => {
    const link = await fetch(
      `${baseUrl}/api/member/downloads/lesson/${previewAttachmentId}/link`,
      { method: "POST", headers: { Authorization: `Bearer ${buyerToken}` } }
    );
    expect(link.status).toBe(200);
    const { url } = (await link.json()) as { url: string };

    const file = await fetch(`${baseUrl}${url}`);
    expect(file.status).toBe(200);
    await expect(file.text()).resolves.toBe(PREVIEW_ATTACHMENT_BYTES);
  });

  it("lists that workbook as available rather than as locked", async () => {
    const res = await fetch(`${baseUrl}/api/member/downloads`, {
      headers: { Authorization: `Bearer ${buyerToken}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      files: { id: number; kind: string; available: boolean; linkUrl: string | null }[];
    };
    const workbook = body.files.find((f) => f.kind === "lesson" && f.id === previewAttachmentId);
    expect(workbook?.available).toBe(true);
    expect(workbook?.linkUrl).not.toBeNull();
  });

  it("stops working the moment the grant behind it is revoked", async () => {
    const videoUrl = await lessonVideoUrl();
    // Still inside the link's lifetime — the refund is what ends it, not the
    // clock.
    expect((await fetch(`${baseUrl}${videoUrl}`)).status).toBe(200);

    await client.query(
      `UPDATE access_grants SET status = 'revoked', revoked_at = now()
        WHERE member_id = $1 AND product_id = $2`,
      [buyerId, productId]
    );

    expect((await fetch(`${baseUrl}${videoUrl}`)).status).toBe(404);
  });
});
