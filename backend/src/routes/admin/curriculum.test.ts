import { describe, expect, it } from "vitest";
import {
  LESSON_CONTENT_TYPES,
  LESSON_FIELDS,
  MODULE_FIELDS,
  assertContentType,
  assertPaidMedia,
  dripDateLocal,
  lessonSlug,
  normalizeDrip,
} from "./curriculum";
import { buildUpdate } from "../../utils/sqlUpdate";
import { unlockAt } from "../../services/drip";

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
    // audio_url only became writable when the allowlist was widened, and the
    // member player signs it exactly as it signs the video.
    expect(() => assertPaidMedia({ audioUrl: "/uploads/call.mp3" })).toThrow();
    expect(() => assertPaidMedia({ audio_url: "/uploads/call.mp3" })).toThrow();
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

/**
 * The field whitelists are the entire admin write path: `buildUpdate` drops
 * every key that is not on them, so a column left off is a column the course
 * builder cannot set — silently, with a 200 and an unchanged row. That is how
 * `drip_days` and `drip_date` sat at NULL on every module and lesson in
 * production while a finished, tested drip engine read them on every page load.
 */
describe("field whitelists", () => {
  it("lets the drip columns through, in either spelling", () => {
    const lesson = buildUpdate({ dripDays: 7 }, LESSON_FIELDS);
    expect(lesson?.clause).toBe("drip_days = $1");
    expect(lesson?.values).toEqual([7]);

    const mod = buildUpdate({ drip_date: "2026-03-01" }, MODULE_FIELDS);
    expect(mod?.clause).toBe("drip_date = $1");
  });

  it("lets through the lesson columns the member player already renders", () => {
    for (const key of ["contentType", "audioUrl", "commentsEnabled"]) {
      expect(buildUpdate({ [key]: "x" }, LESSON_FIELDS)).not.toBeNull();
    }
  });

  it("still drops anything not on the list", () => {
    // `id` and `module_id` would let a lesson be moved or overwritten by id, and
    // `slug` is the address a member bookmarked.
    const body = { id: 9, moduleId: 4, slug: "x", createdAt: "now" };
    expect(buildUpdate(body, LESSON_FIELDS)).toBeNull();
    expect(buildUpdate({ courseId: 2, id: 9 }, MODULE_FIELDS)).toBeNull();
  });

  it("keeps section reorder writable, which is what the up/down arrows send", () => {
    expect(buildUpdate({ sort: 2 }, MODULE_FIELDS)?.clause).toBe("sort = $1");
  });
});

/**
 * `unlockAt` lets `drip_date` win over `drip_days`, so a row holding both has a
 * dead value in it and a screen that reads the row shows a schedule its members
 * are not on. The two are one choice and the API stores them as one.
 */
describe("normalizeDrip", () => {
  const settings = { releaseMinute: 6 * 60, timezone: "America/New_York" };

  it("leaves a body that says nothing about the schedule alone", () => {
    // A rename or a reorder must not quietly clear a release date.
    expect(normalizeDrip({ title: "Week one" })).toEqual({ title: "Week one" });
    expect(normalizeDrip({ sort: 3 })).toEqual({ sort: 3 });
  });

  it("writes both columns whenever either is mentioned", () => {
    expect(normalizeDrip({ dripDays: 7 }, settings)).toEqual({
      drip_days: 7,
      drip_date: null,
    });
    const dated = normalizeDrip({ dripDate: "2026-03-01" }, settings);
    expect(dated.drip_days).toBeNull();
    expect(dated.drip_date).toBeInstanceOf(Date);
  });

  it("assigns each column once however the caller spelled it", () => {
    // `SET drip_days = $1, drip_days = $2` is an error Postgres refuses
    // outright, and both spellings reach the same column through `toSnake`.
    const body = normalizeDrip({ dripDays: 7, drip_days: 7 }, settings);
    expect(Object.keys(body).filter((k) => k.startsWith("drip"))).toEqual([
      "drip_days",
      "drip_date",
    ]);
    expect(buildUpdate(body, LESSON_FIELDS)?.clause).toBe("drip_days = $1, drip_date = $2");
  });

  it("refuses a schedule the engine could only half honour", () => {
    expect(() => normalizeDrip({ dripDays: 7, dripDate: "2026-03-01" }, settings)).toThrow();
  });

  it("refuses a day count that is not a whole number of days from zero up", () => {
    expect(() => normalizeDrip({ dripDays: -1 }, settings)).toThrow();
    expect(() => normalizeDrip({ dripDays: 2.5 }, settings)).toThrow();
    expect(() => normalizeDrip({ dripDays: "soon" }, settings)).toThrow();
    // 0 is what the CHECK constraint allows and what the engine reads as open.
    expect(normalizeDrip({ dripDays: 0 }, settings).drip_days).toBe(0);
  });

  it("reads an empty box as release immediately, not as an error", () => {
    expect(normalizeDrip({ dripDays: "", dripDate: "" }, settings)).toEqual({
      drip_days: null,
      drip_date: null,
    });
    expect(normalizeDrip({ dripDays: null, dripDate: null }, settings)).toEqual({
      drip_days: null,
      drip_date: null,
    });
  });

  it("refuses a date that does not exist", () => {
    // Date would roll 30 February forward into March and open the course on a
    // day nobody picked.
    expect(() => normalizeDrip({ dripDate: "2026-02-30" }, settings)).toThrow();
    expect(() => normalizeDrip({ dripDate: "next tuesday" }, settings)).toThrow();
  });

  /**
   * The stored instant has to be the one `unlockAt` computes back out of it.
   * Pinned at midnight UTC instead, the day she picked reads as the day before
   * in New York and the day after in Auckland — a launch that opens on the
   * wrong date for everybody, from a date picker that looked right.
   */
  it("stores a picked day as the instant the engine resolves it to", () => {
    for (const timezone of ["America/New_York", "Pacific/Auckland", "Pacific/Honolulu"]) {
      const zoned = { releaseMinute: 6 * 60, timezone };
      const stored = normalizeDrip({ dripDate: "2026-03-01" }, zoned).drip_date as Date;

      expect(dripDateLocal(stored, timezone)).toBe("2026-03-01");
      expect(
        unlockAt({ dripDays: null, dripDate: stored }, new Date("2026-01-01T00:00:00Z"), zoned),
      ).toEqual(stored);
    }
  });
});

/**
 * `content_type` is a CHECK-constrained enum the member player switches on. A
 * value the constraint refuses comes back as a 500 with a raw Postgres message
 * behind "something went wrong", and one it accepts but the player does not
 * know draws an empty lesson.
 */
describe("assertContentType", () => {
  it("accepts every kind the column allows, and says nothing about other fields", () => {
    for (const kind of LESSON_CONTENT_TYPES) {
      expect(() => assertContentType({ contentType: kind })).not.toThrow();
    }
    expect(() => assertContentType({ title: "Lesson 3" })).not.toThrow();
  });

  it("refuses anything else, however the field is spelled", () => {
    expect(() => assertContentType({ contentType: "webinar" })).toThrow();
    expect(() => assertContentType({ content_type: "webinar" })).toThrow();
    expect(() => assertContentType({ contentType: "" })).toThrow();
    expect(() => assertContentType({ contentType: null })).toThrow();
  });
});
