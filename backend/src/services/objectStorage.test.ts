import { beforeAll, afterAll, it, expect } from "vitest";
import express from "express";
import fs from "fs/promises";
import os from "os";
import path from "path";
import type { AddressInfo } from "net";
import { syntheticS3 } from "../testing/s3";
let remote: ReturnType<typeof syntheticS3>;
let storage: typeof import("./objectStorage");
let server: ReturnType<express.Express["listen"]>;
let url: string;
let fixtureRoot: string;
beforeAll(async () => {
  fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "bc-s3-suite-"));
  process.env.UPLOAD_DIR = path.join(fixtureRoot, "public"); process.env.PROTECTED_UPLOAD_DIR = path.join(fixtureRoot, "protected");
  remote = syntheticS3(); storage = await import("./objectStorage");
  const app = express();
  app.get("/asset", (req, res, next) => { void storage.serveStoredMedia(req, res, "protected:video.mp4").catch(next); });
  app.use((_err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.sendStatus(503));
  server = app.listen(0); await new Promise<void>(r => server.once("listening", r));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { if (server) await new Promise<void>(r => server.close(() => r())); remote?.transport.mockRestore(); if (fixtureRoot) await fs.rm(fixtureRoot, { recursive: true, force: true }); });
it("confines public/protected keys and rejects traversal, URL and ambiguous encodings", () => {
  expect(storage.objectKey("/uploads/logo.png")).toBe("media/public/logo.png");
  expect(storage.objectKey("protected:certificates/test.pdf")).toBe("media/protected/certificates/test.pdf");
  for (const ref of ["protected:", "../secret", "/etc/passwd", "protected:../public/x", "protected:a//b", "https://evil/x", "x%2fy", ".parts/a", "a\\b", "a\0b"]) expect(() => storage.objectKey(ref)).toThrow();
});
it("requires explicit account-pinned KMS configuration", () => {
  expect(() => new storage.S3MediaStore({ ...remote.config, kmsKey: "" })).toThrow();
  expect(() => new storage.S3MediaStore({ ...remote.config, owner: "999999999999" })).toThrow();
});
it("persists with KMS headers and supports bounded exact reads and missing objects", async () => {
  await storage.writeStoredMedia("/uploads/logo.png", Buffer.from("logo"), "image/png");
  expect(await storage.readStoredMedia("/uploads/logo.png", 4)).toEqual(Buffer.from("logo"));
  expect(await storage.readStoredMedia("/uploads/logo.png", 3)).toBeNull();
  expect(await storage.readStoredMedia("/uploads/missing.png", 4)).toBeNull();
  await storage.removeStoredMedia("/uploads/logo.png");
  expect(remote.objects.has("media/public/logo.png")).toBe(false);
});
it("serves actual HTTP HEAD, seek ranges, suffixes and invalid-range responses", async () => {
  remote.objects.set("media/protected/video.mp4", Buffer.from("0123456789"));
  const get = await fetch(url + "/asset", { headers: { Range: "bytes=2-5" } });
  expect(get.status).toBe(206); expect(get.headers.get("content-range")).toBe("bytes 2-5/10");
  expect(get.headers.get("cache-control")).toBe("private, no-store"); expect(await get.text()).toBe("2345");
  const suffix = await fetch(url + "/asset", { headers: { Range: "bytes=-3" } }); expect(await suffix.text()).toBe("789");
  const head = await fetch(url + "/asset", { method: "HEAD" }); expect(head.status).toBe(200); expect(head.headers.get("content-length")).toBe("10"); expect(await head.text()).toBe("");
  for (const range of ["bytes=20-30", "bytes=1-0", "bytes=-0", "bytes=0-1,3-4"]) {
    const r = await fetch(url + "/asset", { headers: { Range: range } }); expect(r.status).toBe(416); expect(r.headers.get("content-range")).toBe("bytes */10");
  }
  const changed = await fetch(url + "/asset", { headers: { Range: "bytes=2-5", "If-Range": '"old"' } }); expect(changed.status).toBe(200); expect(await changed.text()).toBe("0123456789");
});
it("uploads larger files in bounded multipart pieces and removes staging only when requested", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "bc-s3-unit-")); const file = path.join(dir, "video");
  try {
    const bytes = Buffer.alloc(17 * 1024 * 1024, 37); await fs.writeFile(file, bytes);
    await storage.persistStagedMedia("protected:large.mp4", file, "video/mp4");
    expect(remote.objects.get("media/protected/large.mp4")!.equals(bytes)).toBe(true);
    expect((await fs.stat(file)).size).toBe(bytes.length);
    expect(remote.calls.filter(c => c.name === "UploadPartCommand").map(c => c.input.ContentLength)).toEqual([16 * 1024 * 1024, 1024 * 1024]);
    await storage.finishStagedMedia(file); await expect(fs.stat(file)).rejects.toThrow();
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
it("fails closed on symlink source and permission failures rather than treating them as missing", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "bc-s3-unit-"));
  try { await fs.writeFile(path.join(dir, "source"), "data"); await fs.symlink(path.join(dir, "source"), path.join(dir, "link")); await expect(storage.persistStagedMedia("protected:file.pdf", path.join(dir, "link"), "application/pdf")).rejects.toThrow(); }
  finally { await fs.rm(dir, { recursive: true, force: true }); }
  remote.objects.set("media/protected/x.pdf", Buffer.from("unreadable"));
  remote.transport.mockRejectedValueOnce(Object.assign(new Error("denied"), { $metadata: { httpStatusCode: 403 } }));
  await expect(storage.mediaStore().head("protected:x.pdf")).rejects.toThrow("denied");
});
it("loads receipt logos from bounded trusted objects while rejecting invalid image bytes", async () => {
  const { loadReceiptLogo } = await import("./receiptLogo");
  const png = Buffer.from([137,80,78,71,13,10,26,10]); remote.objects.set("media/public/logo.png", png);
  expect((await loadReceiptLogo("/uploads/logo.png"))?.mime).toBe("image/png");
  remote.objects.set("media/public/logo.png", Buffer.from("<script>")); expect(await loadReceiptLogo("/uploads/logo.png")).toBeNull();
  expect(await loadReceiptLogo("https://attacker/logo.png")).toBeNull();
});

it("aborts a failed multipart upload and retains the source for retry", async () => {
  const file = path.join(fixtureRoot, "retry"); await fs.writeFile(file, Buffer.alloc(17 * 1024 * 1024, 11));
  const original = remote.transport.getMockImplementation()!;
  remote.transport.mockImplementation((async (command: any) => { if (command.constructor.name === "UploadPartCommand") throw new Error("synthetic upload failure"); return (original as any)(command); }) as any);
  try {
    await expect(storage.persistStagedMedia("protected:retry.mp4", file, "video/mp4")).rejects.toThrow("synthetic upload failure");
    expect(remote.calls.some(c => c.name === "AbortMultipartUploadCommand" && c.input.Key.endsWith("retry.mp4"))).toBe(true);
    expect(remote.objects.has("media/protected/retry.mp4")).toBe(false); expect((await fs.stat(file)).size).toBe(17 * 1024 * 1024);
  } finally { remote.transport.mockImplementation(original); await fs.unlink(file); }
});
it("keeps historical voice keys stable while finalized audio lives only in S3", async () => {
  const { LocalDiskRecordingStore, mediaRecordingReference } = await import("./voice/recordingStore");
  const voice = new LocalDiskRecordingStore(); const sessionId = "abcd-synthetic-voice";
  await voice.putChunk({ sessionId, seq: 0, body: Buffer.from("first"), contentType: "audio/webm" });
  await voice.putChunk({ sessionId, seq: 1, body: Buffer.from("second"), contentType: "audio/webm" });
  const done = await voice.finalize(sessionId);
  expect(done.key).toBe("protected:ab/cd/abcd-synthetic-voice.webm");
  expect(remote.objects.get(storage.objectKey(mediaRecordingReference(done.key)))?.toString()).toBe("firstsecond");
  await expect(fs.stat(voice.resolve(done.key)!)).rejects.toThrow();
  expect((await voice.finalize(sessionId)).key).toBe(done.key);
  expect(await voice.url(done.key)).toMatch(/^\/api\/admin\/voice-recording\//);
  await voice.remove(done.key); expect(remote.objects.has(storage.objectKey(mediaRecordingReference(done.key)))).toBe(false);
});

it("refuses writes without version evidence and retains staging", async () => {
  const file = path.join(fixtureRoot, "unversioned"); await fs.writeFile(file, "preserve-me");
  remote.transport.mockResolvedValueOnce({} as never);
  await expect(storage.persistStagedMedia("protected:unversioned.pdf", file, "application/pdf")).rejects.toThrow("versioning");
  expect(await fs.readFile(file, "utf8")).toBe("preserve-me");
});
it("aborts multipart if its staging file changes before completion", async () => {
  const file = path.join(fixtureRoot, "mutating"); await fs.writeFile(file, Buffer.alloc(17 * 1024 * 1024, 19));
  const original = remote.transport.getMockImplementation()!; let changed = false;
  remote.transport.mockImplementation((async (command: any) => {
    const result = await (original as any)(command);
    if (!changed && command.constructor.name === "UploadPartCommand") { changed = true; await fs.appendFile(file, "changed"); }
    return result;
  }) as any);
  try {
    await expect(storage.persistStagedMedia("protected:mutating.mp4", file, "video/mp4")).rejects.toThrow("source changed");
    expect(remote.objects.has("media/protected/mutating.mp4")).toBe(false);
    expect(remote.calls.some(c => c.name === "AbortMultipartUploadCommand" && c.input.Key.endsWith("mutating.mp4"))).toBe(true);
  } finally { remote.transport.mockImplementation(original); }
});

it("proves HEAD-403 absence with a bounded prefix list and preserves list failures", async () => {
  const denied = Object.assign(new Error("denied"), { $metadata: { httpStatusCode: 403 } });
  remote.transport.mockRejectedValueOnce(denied);
  expect(await storage.mediaStore().head("protected:missing.pdf")).toBeNull();
  const listed = remote.calls.find(c => c.name === "ListObjectsV2Command" && c.input.Prefix === "media/protected/missing.pdf");
  expect(listed?.input.MaxKeys).toBe(1);
  remote.transport.mockRejectedValueOnce(denied).mockRejectedValueOnce(denied);
  await expect(storage.mediaStore().head("protected:missing.pdf")).rejects.toThrow("denied");
});

it("migration create-only writes refuse to replace existing small or multipart objects", async () => {
  remote.objects.set("media/protected/existing.pdf", Buffer.from("preserve"));
  await expect(storage.mediaStore().putBuffer("protected:existing.pdf", Buffer.from("replacement"), "application/pdf", true)).rejects.toThrow("Precondition");
  expect(remote.objects.get("media/protected/existing.pdf")?.toString()).toBe("preserve");
  const file = path.join(fixtureRoot, "create-only"); await fs.writeFile(file, Buffer.alloc(17 * 1024 * 1024, 21));
  await expect(storage.mediaStore().putFile("protected:existing.pdf", file, "application/pdf", true)).rejects.toThrow("Precondition");
  expect(remote.objects.get("media/protected/existing.pdf")?.toString()).toBe("preserve");
  expect(remote.calls.some(c => c.name === "AbortMultipartUploadCommand" && c.input.Key.endsWith("existing.pdf"))).toBe(true);
});
