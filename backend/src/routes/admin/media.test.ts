import { describe, expect, it } from "vitest";
import {
  buildMediaListQuery,
  mediaPatchSchema,
  normaliseFolder,
  normaliseTags,
  resolveMime,
  storedExtension,
} from "./media";

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

describe("normaliseTags", () => {
  it("lower-cases, trims and drops a leading hash", () => {
    expect(normaliseTags(["  Workbook ", "#Intake", "new   clients"])).toEqual([
      "workbook",
      "intake",
      "new clients",
    ]);
  });

  it("keeps one of each and nothing empty", () => {
    expect(normaliseTags(["intake", "Intake", "", "   ", "#"])).toEqual(["intake"]);
  });

  it("caps how many and how long", () => {
    const many = Array.from({ length: 60 }, (_, index) => `tag-${index}`);
    expect(normaliseTags(many)).toHaveLength(20);
    expect(normaliseTags(["x".repeat(200)])[0]).toHaveLength(40);
  });
});

describe("normaliseFolder", () => {
  it("is a single name, never a path", () => {
    expect(normaliseFolder("  Course / Module 1  ")).toBe("Course Module 1");
    expect(normaliseFolder("..\\secrets")).toBe(".. secrets");
    expect(normaliseFolder("   ")).toBe("");
  });
});

describe("mediaPatchSchema", () => {
  it("accepts any one of the four fields", () => {
    expect(mediaPatchSchema.parse({ title: " Logo " })).toEqual({ title: "Logo" });
    expect(mediaPatchSchema.parse({ folder: " Brand " })).toEqual({ folder: "Brand" });
    expect(mediaPatchSchema.parse({ altText: "Yvette at her desk" })).toEqual({
      altText: "Yvette at her desk",
    });
    expect(mediaPatchSchema.parse({ tags: ["Brand", "brand", "#Logo"] })).toEqual({
      tags: ["brand", "logo"],
    });
  });

  it("lets a folder and the tags be cleared", () => {
    expect(mediaPatchSchema.parse({ folder: "", tags: [] })).toEqual({ folder: "", tags: [] });
  });

  it("refuses a body that changes nothing, and tags that are not a list", () => {
    expect(mediaPatchSchema.safeParse({}).success).toBe(false);
    expect(mediaPatchSchema.safeParse({ visibility: "public" }).success).toBe(false);
    expect(mediaPatchSchema.safeParse({ tags: "brand, logo" }).success).toBe(false);
  });
});

describe("buildMediaListQuery", () => {
  it("lists everything when nothing is asked for", () => {
    expect(buildMediaListQuery({})).toEqual({
      text: "SELECT * FROM media_assets ORDER BY created_at DESC",
      values: [],
    });
    expect(buildMediaListQuery({ kind: "all" }).values).toEqual([]);
  });

  it("binds every filter rather than splicing it into the SQL", () => {
    const query = buildMediaListQuery({ kind: "image", folder: "Brand", tag: "#Logo" });
    expect(query.values).toEqual(["image", "Brand", "logo"]);
    expect(query.text).toContain("kind = $1 AND folder = $2 AND $3 = ANY(tags)");
    expect(query.text).not.toContain("Brand");
  });

  it("reads an empty folder as 'not in a folder', and an absent one as no filter", () => {
    expect(buildMediaListQuery({ folder: "" }).values).toEqual([""]);
    expect(buildMediaListQuery({ folder: undefined }).values).toEqual([]);
  });

  it("searches tags and alt text too, with LIKE wildcards escaped", () => {
    const query = buildMediaListQuery({ q: " 50%_off " });
    expect(query.values).toEqual(["%50\\%\\_off%"]);
    expect(query.text).toContain("alt_text ILIKE $1");
    expect(query.text).toContain("unnest(tags)");
  });

  it("ignores a tag that normalises to nothing", () => {
    expect(buildMediaListQuery({ tag: " # " }).values).toEqual([]);
  });
});
