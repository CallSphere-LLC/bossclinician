import { describe, expect, it } from "vitest";
import {
  FORM_UPLOAD_HARD_CAP_MB,
  detectMime,
  fileRuleFor,
  officeKind,
  sanitizeFilename,
  sniffFamily,
} from "./formUploads";

/**
 * G2: the checks a file from a stranger has to pass before it is kept. The
 * streaming half (size counted while bytes arrive, temp files removed) is in
 * routes/public/formUploads.integration.test.ts.
 */

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
const GIF = Buffer.from("GIF89a\x01\x00\x01\x00\x00\x00", "latin1");
const WEBP = Buffer.from("RIFF\x24\x00\x00\x00WEBPVP8 ", "latin1");
const PDF = Buffer.from("%PDF-1.7\n%\xe2\xe3\xcf\xd3\n", "latin1");

function zip(...names: string[]): Buffer {
  // Local file headers are all the detector reads: the signature, then each
  // entry's name in plain text.
  return Buffer.concat(
    names.map((name) => Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(26), Buffer.from(name)])),
  );
}

const DOCX = zip("[Content_Types].xml", "_rels/.rels", "word/document.xml");
const XLSX = zip("[Content_Types].xml", "_rels/.rels", "xl/workbook.xml");

describe("sniffFamily", () => {
  it("recognises every accepted format by its first bytes", () => {
    expect(sniffFamily(PNG)).toBe("png");
    expect(sniffFamily(JPEG)).toBe("jpeg");
    expect(sniffFamily(GIF)).toBe("gif");
    expect(sniffFamily(WEBP)).toBe("webp");
    expect(sniffFamily(PDF)).toBe("pdf");
    expect(sniffFamily(DOCX)).toBe("zip");
  });

  it("does not recognise markup, whatever it is called", () => {
    expect(sniffFamily(Buffer.from("<html><script>alert(1)</script>"))).toBeNull();
    expect(sniffFamily(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg">'))).toBeNull();
    expect(sniffFamily(Buffer.from("MZ\x90\x00\x03\x00\x00\x00", "latin1"))).toBeNull();
    expect(sniffFamily(Buffer.alloc(0))).toBeNull();
  });
});

describe("detectMime", () => {
  it("names the type only when the question accepts it", () => {
    expect(detectMime(PNG, ["image"])).toBe("image/png");
    expect(detectMime(PNG, ["pdf"])).toBeNull();
    expect(detectMime(PDF, ["pdf"])).toBe("application/pdf");
    expect(detectMime(DOCX, ["word"])).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(detectMime(XLSX, ["word"])).toBeNull();
    expect(detectMime(XLSX, ["spreadsheet"])).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
  });

  it("refuses a zip that isn't an Office document, and one carrying macros", () => {
    expect(officeKind(zip("evil.html", "readme.txt"))).toBeNull();
    expect(detectMime(zip("evil.html"), ["word", "spreadsheet"])).toBeNull();
    expect(officeKind(zip("[Content_Types].xml", "word/document.xml", "word/vbaProject.bin"))).toBeNull();
  });
});

describe("sanitizeFilename", () => {
  it("keeps only the last path part, and the extension of the real type", () => {
    expect(sanitizeFilename("../../etc/passwd.png", ".png")).toBe("passwd.png");
    expect(sanitizeFilename("C:\\Users\\me\\photo.html", ".jpg")).toBe("photo.jpg");
    expect(sanitizeFilename("invoice.pdf.exe", ".pdf")).toBe("invoice.pdf.pdf");
  });

  it("removes control characters, direction overrides and header-special characters", () => {
    expect(sanitizeFilename("a\u0000b\u001fc\u007f.png", ".png")).toBe("abc.png");
    expect(sanitizeFilename("report\u202Efdp.exe", ".pdf")).toBe("reportfdp.pdf");
    expect(sanitizeFilename('my "cv"; <b>.pdf', ".pdf")).toBe("my cv b.pdf");
  });

  it("never returns an empty or dot name", () => {
    expect(sanitizeFilename("", ".pdf")).toBe("upload.pdf");
    expect(sanitizeFilename("....", ".png")).toBe("upload.png");
    expect(sanitizeFilename(".htaccess", ".png")).toBe("htaccess.png");
  });

  it("reads a UTF-8 name that the parser decoded as latin1", () => {
    const mangled = Buffer.from("Résumé.pdf", "utf8").toString("latin1");
    expect(sanitizeFilename(mangled, ".pdf")).toBe("Résumé.pdf");
  });

  it("bounds the length", () => {
    expect(sanitizeFilename(`${"x".repeat(500)}.png`, ".png").length).toBe(104);
  });
});

describe("fileRuleFor", () => {
  it("fills in defaults for a question saved without limits", () => {
    const rule = fileRuleFor({ key: "cv", label: "Your CV" });
    expect(rule.categories).toEqual(["image", "pdf"]);
    expect(rule.maxBytes).toBe(5 * 1024 * 1024);
  });

  it("never lets a stored limit exceed the hard cap", () => {
    expect(fileRuleFor({ key: "cv", maxSizeMb: 500 }).maxBytes).toBe(FORM_UPLOAD_HARD_CAP_MB * 1024 * 1024);
  });

  it("ignores kinds of file it doesn't know", () => {
    expect(fileRuleFor({ key: "cv", fileTypes: ["pdf", "exe", "svg"] }).categories).toEqual(["pdf"]);
  });
});
