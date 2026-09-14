import { describe, expect, it } from "vitest";
import { resolveMime, storedExtension } from "./mediaStorage";

/**
 * The stored-XSS surface. /uploads is served from the site's own origin and
 * express.static derives Content-Type from the *extension*, not from the
 * `mime` column — so the only thing standing between an uploaded SVG and
 * script execution on our own origin is the extension the file is stored
 * under. These cases are the ones a person cannot easily click through in the
 * admin, which is exactly why they belong here.
 */
describe("upload type resolution", () => {
  it("rejects an SVG that declares itself honestly", () => {
    expect(resolveMime("image/svg+xml", "logo.svg")).toBeNull();
  });

  it("rejects an SVG hidden behind an uninformative MIME type", () => {
    // octet-stream is the one case that falls back to the extension, and .svg
    // is deliberately absent from that whitelist.
    expect(resolveMime("application/octet-stream", "logo.svg")).toBeNull();
    expect(resolveMime("", "logo.svg")).toBeNull();
  });

  it("never stores SVG bytes under an .svg extension, even when the declared type is allowed", () => {
    // The dangerous case: content is SVG, the client claims image/png. The
    // upload is accepted — we do not sniff bytes — but it must land as .png
    // so it is served as image/png, which no browser executes.
    expect(resolveMime("image/png", "payload.svg")).toBe("image/png");
    expect(storedExtension("image/png", "payload.svg")).toBe(".png");
  });

  it("does not let a text/plain declaration smuggle live markup onto the origin", () => {
    for (const name of ["payload.svg", "payload.html", "payload.xhtml", "payload.js"]) {
      expect(storedExtension("text/plain", name)).toBe(".txt");
    }
  });

  it("keeps a legitimate extension the whitelist already knows", () => {
    expect(storedExtension("audio/mp4", "voice.m4a")).toBe(".m4a");
    expect(storedExtension("image/jpeg", "cover.jpeg")).toBe(".jpeg");
  });

  it("stays deny-by-default for an extension nobody whitelisted", () => {
    expect(resolveMime("application/octet-stream", "run.sh")).toBeNull();
    expect(resolveMime("application/octet-stream", "app.exe")).toBeNull();
    expect(resolveMime("application/x-httpd-php", "shell.php")).toBeNull();
  });

  it("rejects a disallowed type that declares itself explicitly, rather than falling back", () => {
    // A client that names a disallowed type is refused outright: the
    // extension fallback exists for missing information, not to be argued with.
    expect(resolveMime("text/html", "notes.txt")).toBeNull();
  });
});
