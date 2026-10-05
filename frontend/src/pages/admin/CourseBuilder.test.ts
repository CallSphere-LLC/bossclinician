import { describe, expect, it } from "vitest";
import { dripError, embedCodeFor } from "./CourseBuilder";
import { courseEditorPath, coursePreviewPath } from "@/lib/coursePreviewApi";

/**
 * A blank or zero day count used to save as "open as soon as they buy", so a
 * section she meant to hold back for a week went out on day one.
 */
describe("dripError", () => {
  it("refuses a day-count schedule with no usable number", () => {
    expect(dripError({ mode: "days", days: "", date: "" })).not.toBeNull();
    expect(dripError({ mode: "days", days: "0", date: "" })).not.toBeNull();
    expect(dripError({ mode: "days", days: "2.5", date: "" })).not.toBeNull();
    expect(dripError({ mode: "days", days: "-3", date: "" })).not.toBeNull();
  });

  it("refuses a date schedule with no date", () => {
    expect(dripError({ mode: "date", days: "", date: "" })).not.toBeNull();
  });

  it("accepts every schedule the engine can honour", () => {
    expect(dripError({ mode: "immediately", days: "", date: "" })).toBeNull();
    expect(dripError({ mode: "days", days: "7", date: "" })).toBeNull();
    expect(dripError({ mode: "date", days: "", date: "2026-03-01" })).toBeNull();
  });
});

describe("embedCodeFor", () => {
  it("keeps pasted embed code exactly as written", () => {
    const code = '<iframe src="https://form.typeform.com/to/abc"></iframe>';
    expect(embedCodeFor(code)).toBe(code);
  });

  it("wraps a bare link in an iframe", () => {
    expect(embedCodeFor(" https://docs.google.com/presentation/d/x/embed?a=1&b=2 ")).toBe(
      '<iframe src="https://docs.google.com/presentation/d/x/embed?a=1&amp;b=2" width="100%" height="100%" frameborder="0" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe>',
    );
  });

  it("turns YouTube, Vimeo and Loom share links into their embed players", () => {
    expect(embedCodeFor("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=5")).toContain('src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"');
    expect(embedCodeFor("https://youtu.be/dQw4w9WgXcQ")).toContain('src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"');
    expect(embedCodeFor("https://vimeo.com/123456/abcdef")).toContain('src="https://player.vimeo.com/video/123456?h=abcdef"');
    expect(embedCodeFor("https://www.loom.com/share/0123abcd")).toContain('src="https://www.loom.com/embed/0123abcd"');
  });

  it("leaves an empty value empty", () => {
    expect(embedCodeFor("")).toBe("");
  });
});

/**
 * "Preview as student" opens these in a new tab, and the server builds the same
 * strings into every link the preview's outline carries. A path the admin router
 * does not mount is a button that opens the console's 404.
 */
describe("coursePreviewPath", () => {
  it("points at the preview routes the admin app mounts", () => {
    expect(coursePreviewPath(12)).toBe("/admin/courses/12/preview");
    expect(coursePreviewPath("12", "welcome")).toBe("/admin/courses/12/preview/lessons/welcome");
  });

  it("keeps a lesson slug to one path segment", () => {
    expect(coursePreviewPath(12, "a/b")).toBe("/admin/courses/12/preview/lessons/a%2Fb");
  });

  it("returns to the builder the preview was opened from", () => {
    expect(courseEditorPath(12)).toBe("/admin/courses/12/curriculum");
  });
});
