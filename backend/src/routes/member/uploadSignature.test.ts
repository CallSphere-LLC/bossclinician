import { describe, expect, it } from "vitest";
import { signatureMatches } from "./communityUploads";

/**
 * The declared content type and the filename are both claims by the uploader.
 * An SVG renamed `photo.png` and posted as `image/png` passes every check that
 * reads either of them — and an SVG is a script container. The bytes are the
 * one part of an upload that cannot be lied about.
 */

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]);
const gif = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
const pdf = Buffer.from("%PDF-1.7\n");
const webp = Buffer.concat([
  Buffer.from("RIFF"),
  Buffer.from([0x1a, 0x00, 0x00, 0x00]),
  Buffer.from("WEBP"),
]);
const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

describe("upload signatures", () => {
  it("accepts each type it claims to support", () => {
    expect(signatureMatches("image/png", png)).toBe(true);
    expect(signatureMatches("image/jpeg", jpeg)).toBe(true);
    expect(signatureMatches("image/gif", gif)).toBe(true);
    expect(signatureMatches("image/webp", webp)).toBe(true);
    expect(signatureMatches("application/pdf", pdf)).toBe(true);
  });

  it("refuses an SVG dressed as a PNG", () => {
    // The actual case this exists for.
    expect(signatureMatches("image/png", svg)).toBe(false);
  });

  it("refuses one image type declared as another", () => {
    expect(signatureMatches("image/png", jpeg)).toBe(false);
    expect(signatureMatches("image/jpeg", png)).toBe(false);
  });

  it("refuses RIFF that is not WebP", () => {
    // A .wav is also RIFF, so the four bytes at offset 8 are what decide.
    const wav = Buffer.concat([
      Buffer.from("RIFF"),
      Buffer.from([0x1a, 0x00, 0x00, 0x00]),
      Buffer.from("WAVE"),
    ]);
    expect(signatureMatches("image/webp", wav)).toBe(false);
  });

  it("refuses a buffer too short to carry a signature", () => {
    expect(signatureMatches("image/png", Buffer.from([0x89]))).toBe(false);
    expect(signatureMatches("image/webp", Buffer.from("RIFF"))).toBe(false);
  });

  it("refuses a type it does not know", () => {
    expect(signatureMatches("image/svg+xml", svg)).toBe(false);
    expect(signatureMatches("text/html", Buffer.from("<html>"))).toBe(false);
  });
});
