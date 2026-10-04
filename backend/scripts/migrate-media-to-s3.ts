/** Explicitly gated migration: preserve sources, never replace an existing cloud object. */
import fs from "fs/promises";
import { constants } from "fs";
import path from "path";
import crypto from "crypto";
import { S3Client, HeadObjectCommand } from "@aws-sdk/client-s3";
import { mediaStore, objectKey } from "../src/services/objectStorage";
import { env } from "../src/config/env";

const roots = [
  { root: "/run/boss-media-source/public", prefix: "/uploads/" },
  { root: "/run/boss-media-source/protected", prefix: "protected:" },
];
const ledgerRoot = "/var/lib/postgresql/business-media-migration/bossclinician-20261004";
const ledgerPath = path.join(ledgerRoot, "manifest.json");
const stable = (a: any, b: any) => a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
async function digestFile(filename: string) {
  const f = await fs.open(filename, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await f.stat(); if (!before.isFile()) throw new Error("Nonregular migration source");
    const hash = crypto.createHash("sha256"); const b = Buffer.alloc(1024 * 1024); let offset = 0;
    while (offset < before.size) { const read = await f.read(b, 0, Math.min(b.length, before.size - offset), offset); if (!read.bytesRead) throw new Error("Truncated migration source"); hash.update(b.subarray(0, read.bytesRead)); offset += read.bytesRead; }
    if (!stable(before, await f.stat())) throw new Error("Changed migration source");
    return { stat: before, sha256: hash.digest("hex") };
  } finally { await f.close(); }
}
async function walk(root: string, relative = ""): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await fs.readdir(path.join(root, relative), { withFileTypes: true })) {
    const rel = path.join(relative, entry.name); const st = await fs.lstat(path.join(root, rel));
    if (st.isSymbolicLink()) throw new Error("Symlink in migration tree");
    if (st.isDirectory()) { const nested = await walk(root, rel); if ([".parts", ".joining", "chunks"].includes(entry.name)) { if (nested.length) throw new Error("Active staging requires quiesced review"); } else out.push(...nested); }
    else if (st.isFile()) out.push(rel);
    else throw new Error("Special file in migration tree");
  }
  return out.sort();
}
let stage = "gate";
async function main() {
  if (process.env.RUN_BOSS_MEDIA_MIGRATION !== "preserve-sources" || process.getuid?.() !== 1000 || env.mediaStorage.store !== "s3" || env.mediaStorage.bucket !== "bossclinician-media-662904411994-us-west-2") throw new Error("Migration gate refused");
  stage = "ledger-permissions";
  const dir = await fs.lstat(ledgerRoot); if (!dir.isDirectory() || dir.isSymbolicLink() || (dir.mode & 0o077)) throw new Error("Private encrypted manifest directory required");
  stage = "lock";
  const lock = await fs.open(path.join(ledgerRoot, "active.lock"), "wx", 0o600);
  const entries: any[] = [];
  let uploaded = 0; let existing = 0; let bytes = 0;
  const s3 = new S3Client({ region: env.mediaStorage.region });
  try {
    const store = mediaStore();
    const census = new Map<string, string[]>();
    for (const spec of roots) {
      stage = "root-confinement";
      if (await fs.realpath(spec.root) !== spec.root) throw new Error("Source root alias refused");
      stage = "source-census";
      const sourceFiles = await walk(spec.root); census.set(spec.root, sourceFiles);
      for (const relative of sourceFiles) {
        stage = "reference-validation";
        const filename = path.join(spec.root, relative); const reference = spec.prefix + relative; const key = objectKey(reference);
        if (await fs.realpath(filename) !== filename) throw new Error("Source path alias refused");
        stage = "source-hash";
        const source = await digestFile(filename);
        stage = "destination-head";
        let meta = await store.head(reference);
        if (!meta) {
          if (!stable(source.stat, await fs.lstat(filename))) throw new Error("Source changed before upload");
          // If a concurrent writer creates this key, S3 refuses conditional completion.
          stage = "conditional-upload";
          await store.putFile(reference, filename, "application/octet-stream", true);
          uploaded++; meta = await store.head(reference);
        } else existing++;
        if (!meta?.version || meta.version === "null" || meta.size !== source.stat.size) throw new Error("Destination version/size mismatch");
        stage = "kms-verification";
        const encryption = await s3.send(new HeadObjectCommand({ Bucket: env.mediaStorage.bucket, Key: key, VersionId: meta.version, ExpectedBucketOwner: env.mediaStorage.owner }));
        if (encryption.ServerSideEncryption !== "aws:kms" || encryption.SSEKMSKeyId !== env.mediaStorage.kmsKey) throw new Error("Destination encryption mismatch");
        stage = "version-readback";
        const stream = await store.open(reference, meta); const digest = crypto.createHash("sha256"); let received = 0;
        try { for await (const part of stream) { received += part.length; if (received > source.stat.size) throw new Error("Oversized destination stream"); digest.update(part); } } finally { stream.destroy(); }
        if (received !== source.stat.size || digest.digest("hex") !== source.sha256) throw new Error("Independent destination checksum mismatch");
        if (!stable(source.stat, await fs.lstat(filename))) throw new Error("Source changed during migration");
        entries.push({ source: filename, reference, key, bytes: received, sha256: source.sha256, versionId: meta.version, etag: meta.etag, sourceDevice: source.stat.dev, sourceInode: source.stat.ino, sourceMtimeMs: source.stat.mtimeMs }); bytes += received;
        const pending = ledgerPath + ".pending";
        await fs.writeFile(pending, JSON.stringify({ schemaVersion: 1, complete: false, generatedAt: new Date().toISOString(), entries }, null, 2), { mode: 0o600 }); await fs.rename(pending, ledgerPath);
      }
    }
    // A live upload or late modification invalidates whole-tree coverage; preserve
    // the partial ledger for a safe retry/final quiesced delta.
    for (const spec of roots) if (JSON.stringify(await walk(spec.root)) !== JSON.stringify(census.get(spec.root))) throw new Error("Source tree changed during migration");
    for (const entry of entries) {
      const current = await fs.lstat(entry.source);
      if (!current.isFile() || current.dev !== entry.sourceDevice || current.ino !== entry.sourceInode || current.size !== entry.bytes || current.mtimeMs !== entry.sourceMtimeMs) throw new Error("Late source mutation");
    }
    await fs.writeFile(ledgerPath + ".pending", JSON.stringify({ schemaVersion: 1, complete: true, generatedAt: new Date().toISOString(), bucket: env.mediaStorage.bucket, entries }, null, 2), { mode: 0o600 }); await fs.rename(ledgerPath + ".pending", ledgerPath);
    console.log(JSON.stringify({ status: "PASS", files: entries.length, bytes, uploaded, existingVerified: existing, versionPinnedReadback: true, originalsPreserved: true, manifest: ledgerPath }));
  } finally { await lock.close(); await fs.unlink(path.join(ledgerRoot, "active.lock")); s3.destroy(); }
}
main().catch((error) => { console.error(JSON.stringify({ status: "FAIL", stage, errorClass: error?.constructor?.name, errorCode: /^[A-Z0-9_]{1,40}$/.test(error?.code ?? "") ? error.code : undefined, reason: "Migration refused or verification failed; protected partial manifest retained; originals untouched" })); process.exitCode = 1; });
