import { describe, expect, it } from "vitest";
import { assertPaidMedia, lessonSlug } from "./curriculum";

/**
 * A lesson's video and attachment are the thing somebody paid $297 for, and the
 * only two references worth holding are one into the protected directory and
 * one on somebody else's host. A bare `/uploads/...` path is a permanent,
 * unexpiring, forwardable address on the open web.
 *
 * The guard has to answer for whatever `buildUpdate` will actually write, and
 * that is decided by `toSnake(key)` — so the snake_case spelling of each column
 * has to be refused exactly as the camelCase one is.
 */
describe("assertPaidMedia", () => {
  it("accepts a protected reference, an external link, or nothing at all", () => {
    expect(() => assertPaidMedia({ videoUrl: "protected:abc.mp4" })).not.toThrow();
    expect(() => assertPaidMedia({ videoUrl: "https://vimeo.com/12345" })).not.toThrow();
    expect(() => assertPaidMedia({ videoUrl: "" })).not.toThrow();
    expect(() => assertPaidMedia({ title: "Lesson 3" })).not.toThrow();
  });

  it("refuses a public path however the field is spelled", () => {
    expect(() => assertPaidMedia({ videoUrl: "/uploads/course.mp4" })).toThrow();
    expect(() => assertPaidMedia({ attachmentUrl: "/uploads/workbook.pdf" })).toThrow();
    // The spelling buildUpdate writes just the same, which used to walk past
    // the check entirely and publish the course.
    expect(() => assertPaidMedia({ video_url: "/uploads/course.mp4" })).toThrow();
    expect(() => assertPaidMedia({ attachment_url: "/uploads/workbook.pdf" })).toThrow();
  });
});

/**
 * `course_lessons.slug` is NOT NULL DEFAULT '' under a UNIQUE (module_id, slug)
 * index, and the member player reaches a lesson by slug. A lesson inserted
 * without one is unreachable, and the second such lesson in a section fails on
 * the index — which is every course built through this screen.
 */
describe("lessonSlug", () => {
  it("produces a slug the player's own parameter accepts", () => {
    const shape = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
    expect(lessonSlug("Introduction")).toBe("introduction");
    expect(lessonSlug("Module 1: What to say — first")).toMatch(shape);
    expect(lessonSlug("Módulo #2!")).toMatch(shape);
  });

  it("never returns empty, whatever the title is made of", () => {
    expect(lessonSlug("!!!")).toBe("lesson");
    expect(lessonSlug("   ")).toBe("lesson");
    expect(lessonSlug("——")).toBe("lesson");
  });

  it("stays inside the column's practical length with no trailing hyphen", () => {
    const long = lessonSlug("a ".repeat(200));
    expect(long.length).toBeLessThanOrEqual(80);
    expect(long.endsWith("-")).toBe(false);
  });
});
