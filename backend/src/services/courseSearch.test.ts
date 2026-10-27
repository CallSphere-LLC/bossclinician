import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../db/pool", () => ({ pool: { query: vi.fn() } }));
import { pool } from "../db/pool";
import type { MemberCourseView } from "./curriculum";
import { searchMemberCourse, searchableText } from "./courseSearch";

const course = { courseId: 65, modules: [
  { title: "Finances", unlocked: true, lessons: [
    { id: 1, slug: "cash", title: "Cash planning", unlocked: true },
    { id: 2, slug: "cash--lesson-2", title: "Locked cash planning", unlocked: false, unlockLabel: "Pass exam" },
  ] },
] } as MemberCourseView;

describe("gated course search", () => {
  beforeEach(() => { vi.mocked(pool.query).mockReset(); });
  it("only selects open IDs and never searches or emits locked body text even if accidentally supplied", async () => {
    vi.mocked(pool.query).mockResolvedValue({ rows: [
      { id: 1, body_md: "Keep a café reserve", transcript: "Weekly cash runway" },
      { id: 2, body_md: "secretkeyword", transcript: "hidden transcript" },
    ] } as never);
    const response = await searchMemberCourse(course, "cafe finances");
    expect(response.results).toHaveLength(1);
    expect(response.results[0].snippet).toContain("café reserve");
    expect(vi.mocked(pool.query).mock.calls[0][1]).toEqual([65, [1]]);
    expect((await searchMemberCourse(course, "secretkeyword")).total).toBe(0);
    expect((await searchMemberCourse(course, "cash")).results[1]).toMatchObject({ slug: "cash--lesson-2", snippet: "", unlocked: false });
  });
  it("searches transcript text without revealing markup or destinations", async () => {
    vi.mocked(pool.query).mockResolvedValue({ rows: [{ id: 1, body_md: "[Guide](https://private.invalid/secret)", transcript: "Diversify income" }] } as never);
    expect((await searchMemberCourse(course, "diversify")).results[0].snippet).toContain("Diversify income");
    expect((await searchMemberCourse(course, "secret")).total).toBe(0);
    expect(searchableText('<script>secret</script><p>Visible</p>')).toBe("Visible");
    expect(searchableText("Income &amp; expenses &#233;")).toBe("Income & expenses é");
  });
  it("does no content query for empty searches or a fully locked course", async () => {
    expect((await searchMemberCourse(course, " ")).total).toBe(0);
    const locked = { ...course, modules: course.modules.map((module) => ({ ...module, unlocked: false, unlockLabel: "Opens later" })) };
    expect((await searchMemberCourse(locked, "cash")).results.every((result) => !result.unlocked && !result.snippet)).toBe(true);
    expect(pool.query).not.toHaveBeenCalled();
  });
});
