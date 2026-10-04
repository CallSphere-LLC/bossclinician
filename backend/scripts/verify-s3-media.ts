/** Explicit synthetic proof only; never changes application configuration or business records. */
import express from "express";
import { randomUUID, createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { usesS3Media, mediaStore, persistStagedMedia, serveStoredMedia, removeStoredMedia } from "../src/services/objectStorage";
let stage = "gate";
async function main() {
  if (process.env.RUN_SYNTHETIC_S3_PROOF !== "yes" || !usesS3Media() || process.getuid?.() !== 1000) throw new Error("Synthetic UID/config gate failed");
  const ref = `protected:verification/${randomUUID()}.bin`;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "boss-s3-proof-"));
  const file = path.join(dir, "synthetic"); const bytes = Buffer.alloc(17 * 1024 * 1024, 41);
  let server: import("node:http").Server | undefined;
  try {
    await fs.writeFile(file, bytes, { mode: 0o600 });
    stage="multipart-write"; await persistStagedMedia(ref, file, "application/octet-stream");
    stage="head"; const meta = await mediaStore().head(ref); if (!meta?.version || meta.version === "null" || meta.size !== bytes.length) throw new Error("Versioned multipart verification failed");
    stage="version-read"; const body = await mediaStore().open(ref, meta); const hash = createHash("sha256"); let total = 0;
    for await (const chunk of body) { hash.update(chunk); total += chunk.length; }
    if (total !== bytes.length || hash.digest("hex") !== createHash("sha256").update(bytes).digest("hex")) throw new Error("Byte integrity proof failed");
    stage="http"; const app = express(); app.get("/synthetic", (req, res, next) => { void serveStoredMedia(req,res,ref).catch(next); });
    server = app.listen(0, "127.0.0.1"); await new Promise<void>(r => server!.once("listening",r));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/synthetic`;
    const range = await fetch(url, {headers:{Range:"bytes=2-9"}});
    if (range.status !== 206 || !Buffer.from(await range.arrayBuffer()).equals(bytes.subarray(2,10))) throw new Error("HTTP range proof failed");
    const head = await fetch(url,{method:"HEAD"}); if(head.status!==200 || Number(head.headers.get("content-length"))!==bytes.length || (await head.text())!=="")throw new Error("HTTP HEAD proof failed");
    stage="delete-marker"; await removeStoredMedia(ref);
    if(await mediaStore().head(ref)!==null)throw new Error("Versioned delete marker proof failed");
    console.log(JSON.stringify({result:"pass",uid:process.getuid?.(),gid:process.getgid?.(),bucket:process.env.MEDIA_STORAGE_BUCKET,bytes:bytes.length,version_pinned_sha256:true,http_range:true,http_head:true,explicit_kms:true,delete_marker:true,synthetic_historical_version_retained:true,business_data_touched:false}));
  } finally {
    if(server) await new Promise<void>(r=>server!.close(()=>r()));
    await fs.rm(dir,{recursive:true,force:true});
  }
}
main().catch((e)=>{console.error(JSON.stringify({result:"fail",stage,errorClass:e?.constructor?.name,httpStatus:e?.$metadata?.httpStatusCode,error:"Synthetic media runtime verification failed"}));process.exitCode=1;});
