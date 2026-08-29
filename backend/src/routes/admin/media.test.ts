import { describe, expect, it } from "vitest";
import { resolveMime, storedExtension } from "./media";

/**
 * The upload name is the one piece of an upload the server writes into a path
 * that a browser later reads a Content-Type from. `/uploads` is handed to
 * express.static, which types a response by its extension and never by the
 * `mime` column, so an extension the whitelist has not heard of is the SVG
 * exclusion being walked around with a filename.
 */
describe("storedExtension", () => {
  it("keeps an extension the whitelist already knows", () => {
    expect(storedExtension("video/mp4", "lesson-3.MP4")).toBe(".mp4");
    expect(storedExtension("audio/webm", "clip.webm")).toBe(".webm");
    expect(storedExtension("application/pdf", "workbook.pdf")).toBe(".pdf");
  });

  it("refuses to store markup extensions, whatever the declared type", () => {
    // text/plain is on the allowlist, so this upload is accepted — and without
    // the rewrite it would land at /uploads/<hex>.html and be served as live
    // HTML on the site's own origin.
    expect(storedExtension("text/plain", "notes.html")).toBe(".txt");
    expect(storedExtension("text/plain", "payload.xhtml")).toBe(".txt");
    expect(storedExtension("image/png", "logo.svg")).toBe(".png");
    expect(storedExtension("image/png", "shell.php")).toBe(".png");
  });

  it("supplies an extension when the uploaded name carries none", () => {
    expect(storedExtension("image/jpeg", "scan")).toBe(".jpg");
    expect(storedExtension("application/octet-stream", "trailer.mov")).toBe(".mov");
  });

  it("stores no extension for a type it cannot place", () => {
    expect(storedExtension("audio/mp4", "voice")).toBe(".m4a");
    expect(resolveMime("text/html", "notes.html")).toBeNull();
    expect(storedExtension("text/html", "notes.html")).toBe("");
  });
});
