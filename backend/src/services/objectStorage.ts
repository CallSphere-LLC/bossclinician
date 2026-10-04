import fs from "fs";
import path from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import type { Request, Response } from "express";
import { S3Client, ListObjectsV2Command, HeadObjectCommand, GetObjectCommand, PutObjectCommand, DeleteObjectCommand,
  CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand, AbortMultipartUploadCommand } from "@aws-sdk/client-s3";
import { env } from "../config/env";
import { resolveStoredFile, uploadPath } from "./signedUrls";

export interface ObjectStoreConfig { bucket: string; region: string; kmsKey: string; owner: string; }
export interface StoredObject { size: number; contentType?: string; etag?: string; version?: string; }
/** Logical references stay in PostgreSQL. Bucket names and prefixes never come from requests. */
export function objectKey(reference: string): string {
  const protectedFile = reference.startsWith("protected:");
  const key = protectedFile ? reference.slice(10) : reference.replace(/^\/?uploads\//, "");
  if (!key || key.length > 1024 || key.includes("\\") || key.includes("%") || key.includes(":")) throw new Error("Invalid object reference");
  if (key.split("/").some(p => !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(p) || p === "." || p === "..")) throw new Error("Invalid object reference");
  return `media/${protectedFile ? "protected" : "public"}/${key}`;
}
const PART_BYTES = 16 * 1024 * 1024;
export class S3MediaStore {
  constructor(readonly config: ObjectStoreConfig, private client = new S3Client({ region: config.region })) {
    if (!config.bucket || !config.region || !/^\d{12}$/.test(config.owner) || !config.kmsKey.startsWith(`arn:aws:kms:${config.region}:${config.owner}:key/`)) throw new Error("Incomplete S3 media configuration");
    this.client.middlewareStack.add((next) => async (args) => {
      try { return await next(args); }
      catch (cause) {
        const status = (cause as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
        throw Object.assign(new Error("Media storage request failed"), { $metadata: { httpStatusCode: status } });
      }
    }, { step: "initialize", name: "sanitizeMediaStorageErrors", override: true });
  }
  private location(reference: string) { return { Bucket: this.config.bucket, Key: objectKey(reference), ExpectedBucketOwner: this.config.owner }; }
  private requireVersion(version: string | undefined): void {
    if (!version || version === "null") throw new Error("Media storage versioning is required");
  }
  private encryption() { return { ServerSideEncryption: "aws:kms" as const, SSEKMSKeyId: this.config.kmsKey, BucketKeyEnabled: true }; }
  async head(reference: string): Promise<StoredObject | null> {
    try {
      const h = await this.client.send(new HeadObjectCommand(this.location(reference)));
      if (h.ContentLength === undefined) throw new Error("Missing object length");
      return { size: h.ContentLength, contentType: h.ContentType, etag: h.ETag, version: h.VersionId };
    } catch (e) {
      const status = (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (status === 404) return null;
      if (status === 403) {
        // A prefix-scoped ListBucket grant does not authorize an unprefixed HEAD's
        // missing-key check. Prove absence using one bounded, exact-prefix list;
        // an existing but unreadable object must remain a permission failure.
        const { Bucket, Key, ExpectedBucketOwner } = this.location(reference);
        const listed = await this.client.send(new ListObjectsV2Command({ Bucket, Prefix: Key, MaxKeys: 1, ExpectedBucketOwner }));
        if (!listed.Contents?.some(item => item.Key === Key)) return null;
      }
      throw e;
    }
  }
  async open(reference: string, metadata: StoredObject, range?: string): Promise<Readable> {
    const r = await this.client.send(new GetObjectCommand({ ...this.location(reference), VersionId: metadata.version, IfMatch: metadata.etag, Range: range }));
    if (!(r.Body instanceof Readable)) throw new Error("Object stream unavailable");
    return r.Body;
  }
  async putBuffer(reference: string, bytes: Buffer, contentType: string, createOnly = false): Promise<void> {
    const written = await this.client.send(new PutObjectCommand({ ...this.location(reference), ...this.encryption(), Body: bytes, ContentLength: bytes.length, ContentType: contentType, ...(createOnly ? { IfNoneMatch: "*" } : {}) }));
    this.requireVersion(written.VersionId);
  }
  /** Read from one confined, non-symlink descriptor. Large files use bounded sequential multipart. */
  async putFile(reference: string, filename: string, contentType: string, createOnly = false): Promise<void> {
    const file = await fs.promises.open(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    let uploadId: string | undefined;
    try {
      const st = await file.stat();
      if (!st.isFile() || st.size > PART_BYTES * 10000) throw new Error("Invalid upload file");
      const stable = async () => {
        const current = await file.stat();
        if (current.dev !== st.dev || current.ino !== st.ino || current.size !== st.size || current.mtimeMs !== st.mtimeMs || current.ctimeMs !== st.ctimeMs) throw new Error("Upload source changed while storing");
      };
      if (st.size <= PART_BYTES) {
        const bytes = Buffer.alloc(st.size); let offset = 0;
        while (offset < bytes.length) { const r = await file.read(bytes, offset, bytes.length - offset, offset); if (!r.bytesRead) throw new Error("Upload truncated"); offset += r.bytesRead; }
        await stable();
        await this.putBuffer(reference, bytes, contentType, createOnly);
        await stable(); return;
      }
      uploadId = (await this.client.send(new CreateMultipartUploadCommand({ ...this.location(reference), ...this.encryption(), ContentType: contentType }))).UploadId;
      if (!uploadId) throw new Error("Missing multipart upload id");
      const parts: { PartNumber: number; ETag: string }[] = [];
      let offset = 0;
      while (offset < st.size) {
        const bytes = Buffer.alloc(Math.min(PART_BYTES, st.size - offset)); let filled = 0;
        while (filled < bytes.length) { const r = await file.read(bytes, filled, bytes.length - filled, offset + filled); if (!r.bytesRead) throw new Error("Upload truncated"); filled += r.bytesRead; }
        const n = parts.length + 1;
        const p = await this.client.send(new UploadPartCommand({ ...this.location(reference), UploadId: uploadId, PartNumber: n, Body: bytes, ContentLength: bytes.length }));
        if (!p.ETag) throw new Error("Missing multipart acknowledgement");
        parts.push({ PartNumber: n, ETag: p.ETag }); offset += filled;
      }
      await stable();
      const completed = await this.client.send(new CompleteMultipartUploadCommand({ ...this.location(reference), UploadId: uploadId, MultipartUpload: { Parts: parts }, ...(createOnly ? { IfNoneMatch: "*" } : {}) }));
      this.requireVersion(completed.VersionId);
      await stable();
      uploadId = undefined;
    } finally {
      try { await file.close(); }
      finally { if (uploadId) await this.client.send(new AbortMultipartUploadCommand({ ...this.location(reference), UploadId: uploadId })).catch(() => undefined); }
    }
  }
  async remove(reference: string): Promise<void> { await this.client.send(new DeleteObjectCommand(this.location(reference))); }
}
let cached: S3MediaStore | undefined;
export function usesS3Media(): boolean { return env.mediaStorage.store === "s3"; }
export function mediaStore(): S3MediaStore { return cached ??= new S3MediaStore(env.mediaStorage); }
/** Commit bytes before publishing a database reference; retain staging until that publication succeeds. */
export async function persistStagedMedia(reference: string, filename: string, contentType: string): Promise<void> {
  if (usesS3Media()) await mediaStore().putFile(reference, filename, contentType);
}
export async function finishStagedMedia(filename: string): Promise<void> {
  if (usesS3Media()) await fs.promises.unlink(filename).catch(() => undefined);
}
export async function writeStoredMedia(reference: string, bytes: Buffer, mime: string): Promise<void> {
  if (usesS3Media()) return mediaStore().putBuffer(reference, bytes, mime);
  const destination = uploadPath(reference);
  if (!destination) throw new Error("Invalid storage reference");
  await fs.promises.mkdir(path.dirname(destination), { recursive: true });
  await fs.promises.writeFile(destination, bytes);
}
export async function removeStoredMedia(reference: string): Promise<void> {
  if (usesS3Media()) await mediaStore().remove(reference);
  else { const filename = await resolveStoredFile(reference); if (filename) await fs.promises.unlink(filename); }
}
export async function readStoredMedia(reference: string, limit: number): Promise<Buffer | null> {
  const store = mediaStore(); const meta = await store.head(reference);
  if (!meta || meta.size <= 0 || meta.size > limit) return null;
  const stream = await store.open(reference, meta); const chunks: Buffer[] = []; let size = 0;
  try { for await (const chunk of stream) { const b = Buffer.from(chunk); size += b.length; if (size > limit || size > meta.size) throw new Error("Object read exceeded bound"); chunks.push(b); } }
  finally { stream.destroy(); }
  if (size !== meta.size) throw new Error("Object read truncated");
  return Buffer.concat(chunks, size);
}
export function requestedRange(value: string | undefined, size: number): { start: number; end: number } | null {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2]) || size === 0) throw new Error("Unsatisfiable range");
  let start: number; let end: number;
  if (!match[1]) { const suffix = Number(match[2]); if (!Number.isSafeInteger(suffix) || suffix <= 0) throw new Error("Unsatisfiable range"); start = Math.max(0, size - suffix); end = size - 1; }
  else { start = Number(match[1]); end = match[2] ? Number(match[2]) : size - 1; }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) throw new Error("Unsatisfiable range");
  return { start, end: Math.min(end, size - 1) };
}
/** Called only after the existing route's authorization; never redirect protected content around it. */
export async function serveStoredMedia(req: Request, res: Response, reference: string): Promise<void> {
  const store = mediaStore(); const meta = await store.head(reference);
  if (!meta) { res.sendStatus(404); return; }
  let range: ReturnType<typeof requestedRange>;
  // A changed If-Range validator means return the complete representation.
  const rangeHeader = req.headers["if-range"] && req.headers["if-range"] !== meta.etag ? undefined : req.headers.range;
  try { range = requestedRange(rangeHeader, meta.size); }
  catch { res.setHeader("Content-Range", `bytes */${meta.size}`); res.status(416).end(); return; }
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (!res.hasHeader("Cache-Control")) res.setHeader("Cache-Control", "private, no-store");
  if (!res.hasHeader("Content-Type")) res.type(reference.split(".").pop() || "application/octet-stream");
  if (meta.etag) res.setHeader("ETag", meta.etag);
  res.setHeader("Content-Length", range ? range.end - range.start + 1 : meta.size);
  if (range) { res.status(206); res.setHeader("Content-Range", `bytes ${range.start}-${range.end}/${meta.size}`); }
  if (req.method === "HEAD") { res.end(); return; }
  const stream = await store.open(reference, meta, range ? `bytes=${range.start}-${range.end}` : undefined);
  const cancel = () => stream.destroy(); res.once("close", cancel);
  try { await pipeline(stream, res); } finally { res.off("close", cancel); stream.destroy(); }
}
