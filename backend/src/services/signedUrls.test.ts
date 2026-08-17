import fs from "fs";
import path from "path";
import { afterAll, describe, expect, it } from "vitest";
import { env } from "../config/env";
import {
  DOWNLOAD_TTL_SECONDS,
  isProtectedRef,
  isStreamKind,
  protectedRef,
  resolveStoredFile,
  signDownload,
  signedFileUrl,
  STREAM_TTL_SECONDS,
  uploadPath,
  verifyDownload,
  type SignedFileKind,
} from "./signedUrls";

/**
 * The three things in this module that must never quietly regress: a download
 * token that works for somebody it was not minted for, a storage path that
 * reaches outside the directory it belongs to, and a protected reference that
 * resolves into the directory express.static serves. All three are silent in
 * production until the day they are not.
 */

const scratch: string[] = [];

function scratchFile(name: string, body: string, root: string = env.uploadDir): string {
  fs.mkdirSync(root, { recursive: true });
  const absolute = path.join(root, name);
  fs.writeFileSync(absolute, body);
  scratch.push(absolute);
  return absolute;
}

afterAll(() => {
  for (const file of scratch) fs.rmSync(file, { force: true });
});

describe("signDownload / verifyDownload", () => {
  it("round-trips the file, the member and the kind", () => {
    const { token } = signDownload({ kind: "product", fileId: 7, memberId: 42 });
    expect(verifyDownload(token)).toMatchObject({ kind: "product", fileId: 7, memberId: 42 });
  });

  it("expires fifteen minutes out by default", () => {
    const now = new Date("2026-03-03T10:00:00Z");
    const { expiresAt } = signDownload({ kind: "lesson", fileId: 1, memberId: 1, now });
    expect(expiresAt.getTime() - now.getTime()).toBe(DOWNLOAD_TTL_SECONDS * 1000);
  });

  it("refuses a token one millisecond past its expiry", () => {
    const now = new Date("2026-03-03T10:00:00Z");
    const { token, expiresAt } = signDownload({ kind: "product", fileId: 1, memberId: 1, now });
    expect(verifyDownload(token, new Date(expiresAt.getTime() - 1))).not.toBeNull();
    expect(verifyDownload(token, new Date(expiresAt.getTime() + 1))).toBeNull();
  });

  it("refuses a signature lifted onto another member's payload", () => {
    // The forwarded-link case: the same file, the same expiry, one digit of the
    // member id changed. Without the id inside the signed body this would pass
    // and one purchase would serve everybody it was shared with.
    const mine = signDownload({ kind: "product", fileId: 7, memberId: 42 });
    const theirs = signDownload({ kind: "product", fileId: 7, memberId: 43 });
    const [, signature] = mine.token.split(".");
    const [body] = theirs.token.split(".");
    expect(verifyDownload(`${body}.${signature}`)).toBeNull();
  });

  it("gives a streamed lesson longer than a download, and says which is which", () => {
    const now = new Date("2026-03-03T10:00:00Z");
    const video = signDownload({ kind: "lesson-video", fileId: 3, memberId: 9, now });
    const workbook = signDownload({ kind: "lesson", fileId: 3, memberId: 9, now });

    expect(video.expiresAt.getTime() - now.getTime()).toBe(STREAM_TTL_SECONDS * 1000);
    expect(workbook.expiresAt.getTime() - now.getTime()).toBe(DOWNLOAD_TTL_SECONDS * 1000);
    expect(verifyDownload(video.token, now)).toMatchObject({
      kind: "lesson-video",
      fileId: 3,
      memberId: 9,
    });

    expect(isStreamKind("lesson-video")).toBe(true);
    expect(isStreamKind("coaching-file")).toBe(true);
    expect(isStreamKind("product")).toBe(false);
    expect(isStreamKind("lesson")).toBe(false);
  });

  it("refuses a kind the delivery route has no case for", () => {
    // Signed by us, so the signature holds; the kind is the only thing wrong
    // with it. The route switches on this value to decide which table to check
    // entitlement against, and a kind it does not know is a request it cannot
    // authorise.
    const { token } = signDownload({
      kind: "certificate" as SignedFileKind,
      fileId: 1,
      memberId: 1,
    });
    expect(verifyDownload(token)).toBeNull();
  });

  it("mints a relative link on our own origin", () => {
    const { url } = signedFileUrl({ kind: "product", fileId: 7, memberId: 42 });
    expect(url.startsWith("/api/files/")).toBe(true);
    expect(verifyDownload(url.slice("/api/files/".length))).toMatchObject({ memberId: 42 });
  });

  it("refuses a tampered signature, a tampered body, and junk", () => {
    const { token } = signDownload({ kind: "product", fileId: 7, memberId: 42 });
    const [body, signature] = token.split(".");
    expect(verifyDownload(`${body}.${signature.slice(0, -2)}AA`)).toBeNull();
    expect(
      verifyDownload(
        `${Buffer.from("d1.product.8.42.99999999999", "utf8").toString("base64url")}.${signature}`
      )
    ).toBeNull();
    expect(verifyDownload("nonsense")).toBeNull();
    expect(verifyDownload("")).toBeNull();
    expect(verifyDownload("a.b.c")).toBeNull();
  });
});

describe("uploadPath", () => {
  it("resolves a plain key inside the upload root", () => {
    expect(uploadPath("pack.pdf")).toBe(path.join(env.uploadDir, "pack.pdf"));
    expect(uploadPath("certificates/x.pdf")).toBe(
      path.join(env.uploadDir, "certificates", "x.pdf")
    );
  });

  it("accepts the media library's own URL form", () => {
    expect(uploadPath("/uploads/pack.pdf")).toBe(path.join(env.uploadDir, "pack.pdf"));
    expect(uploadPath("uploads/pack.pdf")).toBe(path.join(env.uploadDir, "pack.pdf"));
  });

  it("refuses anything that leaves the upload root", () => {
    expect(uploadPath("../../etc/passwd")).toBeNull();
    expect(uploadPath("nested/../../../etc/passwd")).toBeNull();
    expect(uploadPath("/etc/passwd")).toBeNull();
    expect(uploadPath("..")).toBeNull();
    expect(uploadPath("")).toBeNull();
    expect(uploadPath("   ")).toBeNull();
    expect(uploadPath("pack\u0000.pdf")).toBeNull();
  });

  it("sends a protected reference to the directory nothing serves", () => {
    // The whole point of the split: this path must not be under uploadDir, or
    // express.static publishes every course video in it.
    const resolved = uploadPath(protectedRef("lesson.mp4"));
    expect(resolved).toBe(path.join(env.protectedUploadDir, "lesson.mp4"));
    expect(resolved?.startsWith(env.uploadDir + path.sep)).toBe(false);
    expect(uploadPath(protectedRef("certificates/BC-1.pdf"))).toBe(
      path.join(env.protectedUploadDir, "certificates", "BC-1.pdf")
    );
  });

  it("refuses a protected reference that climbs out of its own root", () => {
    expect(uploadPath(protectedRef("../uploads/lesson.mp4"))).toBeNull();
    expect(uploadPath(protectedRef("../../etc/passwd"))).toBeNull();
    expect(uploadPath(protectedRef(""))).toBeNull();
    expect(uploadPath("protected:   ")).toBeNull();
  });
});

describe("protected references", () => {
  it("round-trips, and reads back only its own form", () => {
    expect(protectedRef("lesson.mp4")).toBe("protected:lesson.mp4");
    expect(isProtectedRef(protectedRef("lesson.mp4"))).toBe(true);
    // Everything else a media column can hold is either already public or
    // somebody else's, and signing either would be nonsense.
    expect(isProtectedRef("/uploads/cover.png")).toBe(false);
    expect(isProtectedRef("https://player.vimeo.com/video/1")).toBe(false);
    expect(isProtectedRef("")).toBe(false);
    expect(isProtectedRef("protected:")).toBe(false);
  });
});

describe("resolveStoredFile", () => {
  it("returns the absolute path of a file that is really there", async () => {
    const absolute = scratchFile(".test-download.txt", "bytes");
    await expect(resolveStoredFile(".test-download.txt")).resolves.toBe(absolute);
  });

  it("returns null for a file that is not", async () => {
    await expect(resolveStoredFile(".test-missing.txt")).resolves.toBeNull();
  });

  it("returns null for a symlink pointing out of the upload root", async () => {
    // The textual check above passes for this path; only realpath catches it.
    const link = path.join(env.uploadDir, ".test-escape");
    fs.rmSync(link, { force: true });
    fs.symlinkSync("/etc/passwd", link);
    scratch.push(link);
    await expect(resolveStoredFile(".test-escape")).resolves.toBeNull();
  });

  it("returns null for a directory", async () => {
    await expect(resolveStoredFile(".")).resolves.toBeNull();
  });

  it("reads a protected file from the protected root and nowhere else", async () => {
    const absolute = scratchFile(".test-lesson.mp4", "bytes", env.protectedUploadDir);
    await expect(resolveStoredFile(protectedRef(".test-lesson.mp4"))).resolves.toBe(absolute);

    // The same key without the prefix is a different file in a different
    // directory, and there is no file there.
    await expect(resolveStoredFile(".test-lesson.mp4")).resolves.toBeNull();
  });

  it("returns null for a symlink out of the protected root", async () => {
    const link = path.join(env.protectedUploadDir, ".test-escape");
    fs.mkdirSync(env.protectedUploadDir, { recursive: true });
    fs.rmSync(link, { force: true });
    fs.symlinkSync("/etc/passwd", link);
    scratch.push(link);
    await expect(resolveStoredFile(protectedRef(".test-escape"))).resolves.toBeNull();
  });
});
