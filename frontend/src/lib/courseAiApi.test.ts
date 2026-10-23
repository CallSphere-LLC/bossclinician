import { beforeEach, describe, expect, it, vi } from "vitest";

const sessionFetch = vi.fn();
vi.mock("@/lib/adminTransport", () => ({ sessionFetch: (...args: unknown[]) => sessionFetch(...args) }));

const { cleanOutline, courseAiApi, outlineProblem } = await import("@/lib/courseAiApi");

const outline = {
  title: "  Leaving Panels ",
  subtitle: "",
  description: "",
  modules: [
    { title: "Numbers", summary: " s ", lessons: [{ title: " Rate ", bodyMd: "b" }, { title: "  ", bodyMd: "" }] },
    { title: "  ", summary: "", lessons: [] },
  ],
};

describe("cleanOutline / outlineProblem", () => {
  it("drops blank lessons and empty sections before saving", () => {
    expect(cleanOutline(outline)).toEqual({
      title: "Leaving Panels",
      subtitle: "",
      description: "",
      modules: [{ title: "Numbers", summary: "s", lessons: [{ title: "Rate", bodyMd: "b" }] }],
    });
  });

  it("names what still has to be fixed", () => {
    expect(outlineProblem(cleanOutline(outline))).toBeNull();
    expect(outlineProblem({ ...outline, title: " " })).toBe("Give the course a name.");
    expect(outlineProblem({ ...outline, modules: [] })).toBe("Keep at least one section.");
    expect(
      outlineProblem({ ...outline, modules: [{ title: "", summary: "", lessons: [{ title: "x", bodyMd: "" }] }] }),
    ).toBe("Every section needs a title.");
  });
});

describe("courseAiApi", () => {
  beforeEach(() => sessionFetch.mockReset());

  it("posts to the admin AI routes and surfaces the server's sentence on failure", async () => {
    sessionFetch.mockResolvedValueOnce(new Response(JSON.stringify({ outline }), { status: 200 }));
    await expect(
      courseAiApi.generateOutline({ title: "x", moduleCount: 2, lessonsPerModule: 2 }),
    ).resolves.toEqual(outline);
    expect(String(sessionFetch.mock.calls[0][0])).toMatch(/\/admin\/ai\/course-outline$/);

    sessionFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Give the course a name." }), { status: 400 }),
    );
    await expect(courseAiApi.createFromOutline(outline, false)).rejects.toThrow("Give the course a name.");
    expect(String(sessionFetch.mock.calls[1][0])).toMatch(/\/admin\/ai\/course-outline\/create$/);
    expect(JSON.parse(String(sessionFetch.mock.calls[1][1].body))).toMatchObject({ publishLessons: false });
  });

  it("explains a proxy timeout page instead of a generic error", async () => {
    sessionFetch.mockResolvedValueOnce(new Response("<html>504</html>", { status: 504 }));
    await expect(
      courseAiApi.generateOutline({ title: "x", moduleCount: 2, lessonsPerModule: 2 }),
    ).rejects.toThrow(/took too long/);
  });
});
