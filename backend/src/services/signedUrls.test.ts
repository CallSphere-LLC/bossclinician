import fs from "fs";
import path from "path";
import { afterAll, describe, expect, it } from "vitest";
import { env } from "../config/env";
import {
  DOWNLOAD_TTL_SECONDS,
  resolveStoredFile,
  signDownload,
  uploadPath,
  verifyDownload,
} from "./signedUrls";

/**
 * The two things in this module that must never quietly regress: a download
 * token that works for somebody it was not minted for, and a storage path that
 * reaches outside the upload directory. Both are silent in production until the
 * day they are not.
 */

const scratch: string[] = [];

function scratchFile(name: string, body: string): string {
  fs.mkdirSync(env.uploadDir, { recursive: true });
  const absolute = path.join(env.uploadDir, name);
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
});
