import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadReceiptLogo, MAX_RECEIPT_LOGO_BYTES, sniffLogoMime } from "./receiptLogo";

const TINY_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("receipt logo", () => {
  let root: string;
  let uploads: string;

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "bc-logo-"));
    uploads = path.join(root, "uploads");
    fs.mkdirSync(uploads);
    fs.writeFileSync(path.join(uploads, "logo.png"), Buffer.from(TINY_PNG, "base64"));
    fs.writeFileSync(path.join(uploads, "photo.jpg"), Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]));
    fs.writeFileSync(path.join(uploads, "fake.png"), "<svg onload=alert(1)>");
    fs.writeFileSync(path.join(uploads, "huge.png"), Buffer.alloc(MAX_RECEIPT_LOGO_BYTES + 1, 0x89));
    // Outside the upload directory, where no reference may reach.
    fs.writeFileSync(path.join(root, "secret.png"), Buffer.from(TINY_PNG, "base64"));
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("recognises PNG and JPEG by their bytes, and nothing else", () => {
    expect(sniffLogoMime(Buffer.from(TINY_PNG, "base64"))).toBe("image/png");
    expect(sniffLogoMime(Buffer.from([0xff, 0xd8, 0xff, 0xdb]))).toBe("image/jpeg");
    expect(sniffLogoMime(Buffer.from("GIF89a"))).toBeNull();
    expect(sniffLogoMime(Buffer.from("<svg/>"))).toBeNull();
  });

  it("loads an uploaded PNG as bytes and as an inline image", async () => {
    const logo = await loadReceiptLogo("/uploads/logo.png", uploads);
    expect(logo?.mime).toBe("image/png");
    expect(logo?.dataUri).toBe(`data:image/png;base64,${TINY_PNG}`);
  });

  it("loads a JPEG too", async () => {
    expect((await loadReceiptLogo("/uploads/photo.jpg", uploads))?.mime).toBe("image/jpeg");
  });

  it("refuses anything that is not a real, small PNG or JPEG in the upload directory", async () => {
    for (const reference of [
      "",
      undefined,
      "/uploads/fake.png",
      "/uploads/huge.png",
      "/uploads/missing.png",
      "/uploads/../secret.png",
      "/uploads/%2e%2e/secret.png",
      "https://example.com/logo.png",
      "/etc/passwd",
      "uploads/logo.png",
    ]) {
      expect(await loadReceiptLogo(reference, uploads)).toBeNull();
    }
  });
});
