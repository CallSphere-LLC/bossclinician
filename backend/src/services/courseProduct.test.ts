import { describe, expect, it } from "vitest";
import { courseProductSlug } from "./courseProduct";

/**
 * `products.slug` is UNIQUE, and a download or a retired product can already
 * hold a course's slug. A clash used to be a failed insert, which is a course
 * that still can't be sold.
 */
describe("courseProductSlug", () => {
  it("uses the course's own slug when nobody has it", () => {
    expect(courseProductSlug("the-board-room", [])).toBe("the-board-room");
  });

  it("steps aside from a slug another product holds", () => {
    expect(courseProductSlug("the-board-room", ["the-board-room"])).toBe("the-board-room-course");
    expect(courseProductSlug("the-board-room", ["the-board-room", "the-board-room-course"])).toBe(
      "the-board-room-course-2",
    );
    expect(
      courseProductSlug("x", ["x", "x-course", "x-course-2", "x-course-3"]),
    ).toBe("x-course-4");
  });

  it("never answers with an empty address", () => {
    expect(courseProductSlug("  ", [])).toBe("course");
  });
});
