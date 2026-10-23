import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";

// config/env reads the key at import time; generation is refused without one.
vi.hoisted(() => {
  process.env.OPENAI_API_KEY = "test-key";
});

import {
  MAX_GENERATED_LESSONS,
  OUTLINE_JSON_SCHEMA,
  buildOutlineInput,
  courseOutlineRequestSchema,
  courseOutlineSchema,
  courseSlugBase,
  createCourseFromOutline,
  createCourseFromOutlineSchema,
  generateCourseOutline,
  normalizeOutline,
  outputTextOf,
  type CourseOutlineRequest,
} from "./courseOutline";

const REQUEST: CourseOutlineRequest = courseOutlineRequestSchema.parse({
  title: "Leaving Insurance Panels",
  moduleCount: 2,
  lessonsPerModule: 2,
});

const MODEL_OUTLINE = {
  title: "Leaving Insurance Panels",
  subtitle: "Go private pay without losing your caseload",
  description: "For therapists ready to leave panels.",
  modules: [
    {
      title: "Know your numbers",
      summary: "What you need to earn.",
      lessons: [
        { title: "Your real hourly rate", bodyMd: "Why it matters.\n\n- one\n- two" },
        { title: "Your break-even", bodyMd: "Body" },
        { title: "An extra lesson nobody asked for", bodyMd: "Body" },
      ],
    },
    { title: "  ", summary: "blank title is dropped", lessons: [] },
    { title: "Tell your clients", summary: "Scripts.", lessons: [{ title: "The conversation", bodyMd: "" }] },
    { title: "A third section", summary: "", lessons: [] },
  ],
};

function responsesBody(payload: unknown, extra: Record<string, unknown> = {}) {
  return {
    status: "completed",
    output: [
      { type: "reasoning", summary: [] },
      { type: "message", content: [{ type: "output_text", text: JSON.stringify(payload) }] },
    ],
    usage: { input_tokens: 10, output_tokens: 20 },
    ...extra,
  };
}

function fakeFetch(body: unknown, status = 200) {
  return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }),
  );
}

describe("what she can ask for", () => {
  it("defaults to four sections of three lessons", () => {
    const parsed = courseOutlineRequestSchema.parse({ title: "  Pricing  " });
    expect(parsed).toEqual({ title: "Pricing", audience: "", description: "", moduleCount: 4, lessonsPerModule: 3 });
  });

  it("refuses a blank name and an oversized course with a sentence she can act on", () => {
    expect(courseOutlineRequestSchema.safeParse({ title: "   " }).success).toBe(false);
    const big = courseOutlineRequestSchema.safeParse({ title: "x", moduleCount: 8, lessonsPerModule: 6 });
    expect(big.success).toBe(false);
    expect(big.error?.issues[0]?.message).toContain(String(MAX_GENERATED_LESSONS));
    expect(courseOutlineRequestSchema.safeParse({ title: "x", moduleCount: 9 }).success).toBe(false);
    expect(courseOutlineRequestSchema.safeParse({ title: "x", moduleCount: 5, lessonsPerModule: 6 }).success).toBe(true);
  });

  it("puts the optional details into the prompt only when given", () => {
    expect(buildOutlineInput(REQUEST)).not.toContain("Who it is for");
    const input = buildOutlineInput({ ...REQUEST, audience: "New grads", description: "Credentialing" });
    expect(input).toContain("Who it is for: New grads");
    expect(input).toContain("What it should cover: Credentialing");
    expect(input).toContain("Sections: 2");
  });
});

describe("the structured-output schema", () => {
  it("is strict-mode shaped: every property required, no extras, at every level", () => {
    const check = (node: Record<string, unknown>): void => {
      if (node.type === "object") {
        expect(node.additionalProperties).toBe(false);
        expect([...(node.required as string[])].sort()).toEqual(
          Object.keys(node.properties as object).sort(),
        );
        for (const child of Object.values(node.properties as Record<string, Record<string, unknown>>)) check(child);
      }
      if (node.type === "array") check(node.items as Record<string, unknown>);
    };
    check(OUTLINE_JSON_SCHEMA as unknown as Record<string, unknown>);
  });
});

describe("reading the model's outline", () => {
  it("drops blank rows and cuts the counts to what she asked for", () => {
    const outline = normalizeOutline(MODEL_OUTLINE, REQUEST);
    expect(outline?.modules.map((m) => m.title)).toEqual(["Know your numbers", "Tell your clients"]);
    expect(outline?.modules[0].lessons.map((l) => l.title)).toEqual(["Your real hourly rate", "Your break-even"]);
    expect(outline?.modules[1].lessons).toHaveLength(1);
  });

  it("falls back to her title and refuses an outline with no sections", () => {
    expect(normalizeOutline({ ...MODEL_OUTLINE, title: "" }, REQUEST)?.title).toBe(REQUEST.title);
    expect(normalizeOutline({ ...MODEL_OUTLINE, modules: [] }, REQUEST)).toBeNull();
    expect(normalizeOutline("nonsense", REQUEST)).toBeNull();
  });

  it("reads output_text and notices a refusal", () => {
    expect(outputTextOf(responsesBody({ a: 1 }).output)).toEqual({ text: '{"a":1}', refusal: null });
    expect(
      outputTextOf([{ type: "message", content: [{ type: "refusal", refusal: "no" }] }]).refusal,
    ).toBe("no");
    expect(outputTextOf(undefined)).toEqual({ text: "", refusal: null });
  });
});

describe("generateCourseOutline", () => {
  it("asks for strict JSON with nothing stored at OpenAI, and returns the trimmed outline", async () => {
    const fetchMock = fakeFetch(responsesBody(MODEL_OUTLINE));
    const result = await generateCourseOutline(REQUEST, { fetch: fetchMock as unknown as typeof fetch });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.outline.modules).toHaveLength(2);

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/responses$/);
    const sent = JSON.parse(String(init?.body));
    expect(sent.store).toBe(false);
    expect(sent.previous_response_id).toBeUndefined();
    expect(sent.text.format).toMatchObject({ type: "json_schema", strict: true, name: "course_outline" });
    expect(sent.input).toContain("Leaving Insurance Panels");
  });

  it("says so when the reply was cut short, refused, garbled or rejected", async () => {
    const cut = await generateCourseOutline(REQUEST, {
      fetch: fakeFetch(responsesBody(MODEL_OUTLINE, { status: "incomplete", incomplete_details: { reason: "max_output_tokens" } })) as unknown as typeof fetch,
    });
    expect(cut).toMatchObject({ ok: false, status: 502 });

    const refused = await generateCourseOutline(REQUEST, {
      fetch: fakeFetch({ status: "completed", output: [{ type: "message", content: [{ type: "refusal", refusal: "no" }] }] }) as unknown as typeof fetch,
    });
    expect(refused).toMatchObject({ ok: false, status: 422 });

    const garbled = await generateCourseOutline(REQUEST, {
      fetch: fakeFetch({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: "{not json" }] }] }) as unknown as typeof fetch,
    });
    expect(garbled).toMatchObject({ ok: false, status: 502 });

    const upstream = await generateCourseOutline(REQUEST, {
      fetch: fakeFetch({ error: { message: "bad key" } }, 401) as unknown as typeof fetch,
    });
    expect(upstream).toMatchObject({ ok: false, status: 502 });
    // The upstream's own words (which can name the key or the account) stay in the log.
    if (!upstream.ok) expect(upstream.error).not.toContain("bad key");
  });
});

describe("the saved outline", () => {
  it("is re-validated with the same limits after her edits", () => {
    expect(courseOutlineSchema.safeParse({ title: "x", modules: [] }).success).toBe(false);
    expect(
      courseOutlineSchema.safeParse({ title: "x", modules: [{ title: "s", lessons: [{ title: " " }] }] }).success,
    ).toBe(false);
    const ok = createCourseFromOutlineSchema.parse({ outline: { title: "x", modules: [{ title: "s" }] } });
    expect(ok.publishLessons).toBe(false);
    expect(ok.outline.modules[0]).toEqual({ title: "s", summary: "", lessons: [] });
  });

  it("gets the same address the Add a course form would give it", () => {
    expect(courseSlugBase("Café Notes: Pricing 101!")).toBe("cafe-notes-pricing-101");
    expect(courseSlugBase("!!!")).toBe("course");
  });
});

describe("createCourseFromOutline", () => {
  function fakeClient(takenSlugs: string[]) {
    const calls: { sql: string; params: unknown[] }[] = [];
    let id = 100;
    const client = {
      query: vi.fn(async (sql: string, params: unknown[] = []) => {
        calls.push({ sql, params });
        if (sql.startsWith("SELECT slug FROM courses")) return { rows: takenSlugs.map((slug) => ({ slug })) };
        if (sql.includes("RETURNING id")) return { rows: [{ id: ++id }] };
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    return { client: client as unknown as PoolClient, calls };
  }

  const outline = courseOutlineSchema.parse({
    title: "Leaving Insurance Panels",
    modules: [
      { title: "One", lessons: [{ title: "Intro" }, { title: "Intro" }] },
      { title: "Two", lessons: [{ title: "Intro" }] },
    ],
  });

  it("writes one draft course, its sections and draft lessons in a single transaction", async () => {
    const { client, calls } = fakeClient(["leaving-insurance-panels"]);
    const created = await createCourseFromOutline(outline, { client });

    expect(calls[0].sql).toBe("BEGIN");
    expect(calls.at(-1)?.sql).toBe("COMMIT");
    expect(created).toMatchObject({ slug: "leaving-insurance-panels-2", moduleCount: 2, lessonCount: 3 });

    const courseInsert = calls.find((c) => c.sql.includes("INSERT INTO courses"));
    expect(courseInsert?.sql).toMatch(/false\)\s+RETURNING id/);

    const lessons = calls.filter((c) => c.sql.includes("INSERT INTO course_lessons"));
    // Two "Intro" lessons in one section get distinct slugs; the next section starts over.
    expect(lessons.map((c) => c.params[1])).toEqual(["intro", "intro-2", "intro"]);
    // published = false unless she asked otherwise.
    expect(lessons.every((c) => c.params[4] === false)).toBe(true);
    // A borrowed client is not released here.
    expect((client as unknown as { release: ReturnType<typeof vi.fn> }).release).not.toHaveBeenCalled();
  });

  it("publishes the lessons only when asked, and rolls back on failure", async () => {
    const { client, calls } = fakeClient([]);
    await createCourseFromOutline(outline, { client, publishLessons: true });
    expect(calls.filter((c) => c.sql.includes("INSERT INTO course_lessons")).every((c) => c.params[4] === true)).toBe(true);

    const failing = fakeClient([]);
    (failing.client.query as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (sql: string) => {
      failing.calls.push({ sql, params: [] });
      if (sql.includes("INSERT INTO course_modules")) throw new Error("boom");
      if (sql.includes("RETURNING id")) return { rows: [{ id: 1 }] };
      return { rows: [] };
    });
    await expect(createCourseFromOutline(outline, { client: failing.client })).rejects.toThrow("boom");
    expect(failing.calls.at(-1)?.sql).toBe("ROLLBACK");
  });
});
