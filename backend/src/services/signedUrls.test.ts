import fs from "fs";
import path from "path";
import { afterAll, describe, expect, it } from "vitest";
import { env } from "../config/env";
import {
  deliverableUrl,
  DOWNLOAD_TTL_SECONDS,
  isExternalRef,
  isProtectedRef,
  isStreamKind,
  protectedRef,
  resolveStoredFile,
  adminPreviewUrl,
  ADMIN_PREVIEW_TTL_SECONDS,
  signDownload,
  signedFileUrl,
  verifyAdminPreview,
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

/**
 * `fs.rmSync` follows the link before deleting, so it cannot remove a
 * *dangling* symlink — and the two escape tests below deliberately create one
 * pointing at /etc/passwd, which does not exist on Windows. With `force: true`
 * the resulting ENOENT is swallowed and the link is left on disk, so the very
 * next `npm test` fails at `symlinkSync` with EEXIST. The suite passed once
 * and then failed forever.
 *
 * `lstatSync` + `unlinkSync` acts on the link itself rather than its target.
 */
function removeScratch(file: string): void {
  try {
    if (fs.lstatSync(file).isSymbolicLink()) fs.unlinkSync(file);
    else fs.rmSync(file, { force: true });
  } catch {
    // Already gone, which is the outcome this wanted anyway.
  }
}

afterAll(() => {
  for (const file of scratch) removeScratch(file);
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
    removeScratch(link);
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
    removeScratch(link);
    fs.symlinkSync("/etc/passwd", link);
    scratch.push(link);
    await expect(resolveStoredFile(protectedRef(".test-escape"))).resolves.toBeNull();
  });
});

/**
 * The shape every customer-facing surface has to get right.
 *
 * There are three kinds of thing in a media column and only one of them is ours
 * to sign. Getting it wrong in one direction publishes a paid file; getting it
 * wrong in the other emits `https://site/protected:lesson-4.mp4`, which is a 404
 * wearing the shape of a URL and reads to the customer as a broken player.
 */
describe("deliverableUrl", () => {
  const forMember = { kind: "lesson-video" as const, fileId: 41, memberId: 7 };

  it("signs a protected reference into a link the delivery route accepts", () => {
    const { url, expiresAt } = deliverableUrl({ reference: protectedRef("l4.mp4"), ...forMember });

    expect(url.startsWith("/api/files/")).toBe(true);
    // The stored key must not survive into anything a browser is handed.
    expect(url).not.toContain("l4.mp4");
    expect(url).not.toContain("protected:");
    expect(expiresAt).toBeInstanceOf(Date);

    const payload = verifyDownload(url.slice("/api/files/".length));
    expect(payload).toMatchObject({ kind: "lesson-video", fileId: 41, memberId: 7 });
  });

  it("passes a public upload path through untouched and unsigned", () => {
    for (const reference of ["/uploads/cover.jpg", "cover.jpg"]) {
      expect(deliverableUrl({ reference, ...forMember })).toEqual({
        url: reference,
        expiresAt: null,
      });
    }
  });

  it("passes somebody else's host through untouched", () => {
    const reference = "https://player.vimeo.com/video/12345";
    expect(deliverableUrl({ reference, ...forMember })).toEqual({ url: reference, expiresAt: null });
  });

  it("never returns a protected reference as a URL, whatever the kind", () => {
    const kinds = [
      "lesson-video",
      "lesson-audio",
      "lesson-captions",
      "lesson-attachment",
      "coaching-file",
      "podcast-episode",
      "community-media",
    ] as const;

    for (const kind of kinds) {
      const { url } = deliverableUrl({
        reference: protectedRef("paid/file.mp3"),
        kind,
        fileId: 3,
        memberId: 9,
      });
      expect(url).not.toContain("protected:");
      expect(verifyDownload(url.slice("/api/files/".length))?.kind).toBe(kind);
    }
  });

  it("mints a link for the member it names and nobody else", () => {
    const mine = deliverableUrl({ reference: protectedRef("l4.mp4"), ...forMember });
    const theirs = deliverableUrl({
      reference: protectedRef("l4.mp4"),
      ...forMember,
      memberId: 8,
    });
    expect(mine.url).not.toBe(theirs.url);
  });
});

/** Which references belong to somebody else, and are therefore theirs to gate. */
describe("isExternalRef", () => {
  it("recognises an absolute link and nothing else", () => {
    expect(isExternalRef("https://player.vimeo.com/video/1")).toBe(true);
    expect(isExternalRef("http://example.com/a.mp4")).toBe(true);
    expect(isExternalRef("  https://example.com/a.mp4  ")).toBe(true);

    expect(isExternalRef("/uploads/a.mp4")).toBe(false);
    expect(isExternalRef("a.mp4")).toBe(false);
    expect(isExternalRef(protectedRef("a.mp4"))).toBe(false);
    expect(isExternalRef("")).toBe(false);
  });
});

/**
 * The admin's preview link.
 *
 * It exists so course video can be played back on the screen it was uploaded
 * from, and it is the one link in the system that is not bound to a paying
 * member. That makes two things worth holding still: it must not be reachable
 * by anything a member is handed, and a member's link must not be redeemable
 * here. Both directions, because "they use different keys" is a sentence that
 * survives a refactor exactly as long as nothing checks it.
 */
describe("admin preview links", () => {
  const forAdmin = { assetId: 12, adminUserId: 3 };

  it("round-trips the asset and the administrator it names", () => {
    const { url } = adminPreviewUrl(forAdmin);
    expect(url.startsWith("/api/admin-files/")).toBe(true);

    const payload = verifyAdminPreview(url.slice("/api/admin-files/".length));
    expect(payload?.assetId).toBe(12);
    expect(payload?.adminUserId).toBe(3);
  });

  it("dies on its own clock", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const { url, expiresAt } = adminPreviewUrl({ ...forAdmin, now });
    const token = url.slice("/api/admin-files/".length);

    expect(Math.round((expiresAt.getTime() - now.getTime()) / 1000)).toBe(
      ADMIN_PREVIEW_TTL_SECONDS
    );
    expect(verifyAdminPreview(token, new Date(expiresAt.getTime() - 1000))).not.toBeNull();
    expect(verifyAdminPreview(token, new Date(expiresAt.getTime() + 1000))).toBeNull();
  });

  it("refuses a token whose body was edited", () => {
    const { url } = adminPreviewUrl(forAdmin);
    const [body, signature] = url.slice("/api/admin-files/".length).split(".");

    // Same signature, a different asset named underneath it.
    const forged = Buffer.from(
      Buffer.from(String(body), "base64url").toString("utf8").replace(".12.", ".99."),
      "utf8"
    ).toString("base64url");

    expect(verifyAdminPreview(`${forged}.${signature}`)).toBeNull();
  });

  it("is not interchangeable with a member's download token", () => {
    const memberToken = signDownload({
      kind: "lesson-video",
      fileId: 12,
      memberId: 3,
    }).token;
    const adminToken = adminPreviewUrl(forAdmin).url.slice("/api/admin-files/".length);

    expect(verifyAdminPreview(memberToken)).toBeNull();
    expect(verifyDownload(adminToken)).toBeNull();
  });
});
