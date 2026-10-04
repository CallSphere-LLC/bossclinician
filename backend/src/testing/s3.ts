import { S3Client } from "@aws-sdk/client-s3";
import { Readable } from "stream";
import { vi } from "vitest";
/** Synthetic SDK transport: no AWS request or credentials, real adapter and HTTP authorization remain exercised. */
export function syntheticS3() {
  const objects = new Map<string, Buffer>();
  const calls: { name: string; input: Record<string, any> }[] = [];
  const uploads = new Map<string, Buffer[]>();
  const config = { bucket: "synthetic-boss-media", region: "us-west-2", owner: "123456789012", kmsKey: "arn:aws:kms:us-west-2:123456789012:key/synthetic" };
  process.env.MEDIA_STORAGE_STORE = "s3"; process.env.MEDIA_STORAGE_BUCKET = config.bucket;
  process.env.MEDIA_STORAGE_REGION = config.region; process.env.MEDIA_STORAGE_ACCOUNT = config.owner;
  process.env.MEDIA_STORAGE_KMS_KEY = config.kmsKey;
  const transport = vi.spyOn(S3Client.prototype, "send").mockImplementation((async (command: any) => {
    const i = command.input; const name = command.constructor.name; calls.push({ name, input: i });
    if (i.Bucket !== config.bucket || i.ExpectedBucketOwner !== config.owner || !(i.Key ?? i.Prefix ?? "").startsWith("media/")) throw new Error("Synthetic bucket scope violation");
    if (name === "PutObjectCommand" || name === "CreateMultipartUploadCommand") {
      if (i.ServerSideEncryption !== "aws:kms" || i.SSEKMSKeyId !== config.kmsKey) throw new Error("Missing explicit KMS encryption");
    }
    if ((name === "PutObjectCommand" || name === "CompleteMultipartUploadCommand") && i.IfNoneMatch === "*" && objects.has(i.Key)) throw Object.assign(new Error("Precondition failed"), { $metadata: { httpStatusCode: 412 } });
    if (name === "PutObjectCommand") { objects.set(i.Key, Buffer.from(i.Body)); return { VersionId: "v1" }; }
    if (name === "CreateMultipartUploadCommand") { uploads.set(i.Key, []); return { UploadId: "synthetic-mpu" }; }
    if (name === "UploadPartCommand") { uploads.get(i.Key)![i.PartNumber - 1] = Buffer.from(i.Body); return { ETag: `"part${i.PartNumber}"` }; }
    if (name === "CompleteMultipartUploadCommand") { objects.set(i.Key, Buffer.concat(uploads.get(i.Key)!)); uploads.delete(i.Key); return { VersionId: "v1" }; }
    if (name === "AbortMultipartUploadCommand") { uploads.delete(i.Key); return {}; }
    if (name === "DeleteObjectCommand") { objects.delete(i.Key); return {}; }
    if (name === "ListObjectsV2Command") return { Contents: [...objects.keys()].filter(key => key.startsWith(i.Prefix)).sort().slice(0, i.MaxKeys).map(Key => ({ Key })) };
    const bytes = objects.get(i.Key);
    if (!bytes) throw Object.assign(new Error("Synthetic missing object"), { $metadata: { httpStatusCode: 404 } });
    if (name === "HeadObjectCommand") return { ContentLength: bytes.length, ETag: '"synthetic"', VersionId: "v1" };
    if (name === "GetObjectCommand") {
      const m = i.Range && /^bytes=(\d+)-(\d+)$/.exec(i.Range);
      return { Body: Readable.from([m ? bytes.subarray(Number(m[1]), Number(m[2]) + 1) : bytes]) };
    }
    throw new Error("Unexpected synthetic command");
  }) as any);
  return { objects, calls, uploads, config, transport };
}
