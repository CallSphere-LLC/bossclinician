import type { PoolClient } from "pg";
import { z } from "zod";
import { env, voiceEnabled } from "../config/env";
import { pool } from "../db/pool";
import { lessonSlug, nextLessonSlug } from "../routes/admin/curriculum";
import { backendModel } from "./voice/liveConfig";

/**
 * "Build with AI" on the Courses screen — Kajabi's course outline generator.
 *
 * She types a course name (and, if she likes, who it is for and what it should
 * cover); the model drafts sections with summaries and lessons with a short
 * starter body; she edits that preview; and only then is anything written. What
 * is written is a draft: the course is not live and, unless she says otherwise,
 * neither is any lesson in it, so a half-finished AI outline can never reach a
 * member by accident.
 *
 * Generation talks to OpenAI from Node, like the concierge's typed turns in
 * services/voice/liveSession.ts, and on the same key and base URL — the backend
 * pod already holds both. It deliberately does not read `OPENAI_MODEL` (that is
 * the Python service's chat model; see config/env.ts): the model is
 * `COURSE_AI_MODEL` when set, otherwise the Node side's one text brain,
 * `backendModel()`. `store: false` keeps the request and its output out of
 * OpenAI's stored responses, so nothing here relies on server-side state.
 */

/* ================================ limits ================================= */

/** What she can ask for. A bigger course is built a section at a time afterwards. */
export const MAX_MODULES = 8;
export const MAX_LESSONS_PER_MODULE = 6;
/**
 * The whole course has to come back inside one request the proxy will wait for
 * (nginx gives the admin API 120s). Thirty short lessons is comfortably inside
 * that; a 48-lesson ask is where generation started to brush the ceiling.
 */
export const MAX_GENERATED_LESSONS = 30;

/** What an edited outline may hold when it is saved — looser, since she can add rows. */
const MAX_SAVED_MODULES = 30;
const MAX_SAVED_LESSONS_PER_MODULE = 40;
const MAX_SAVED_LESSONS = 300;

const TITLE_MAX = 300;
const SUMMARY_MAX = 2000;
const BODY_MAX = 20_000;

/**
 * One generation, bounded below the 120s nginx gives the admin API and below a
 * CDN's 100s origin wait, so a slow model ends in our own sentence ("try fewer
 * sections") rather than a proxy's error page.
 */
export const GENERATE_TIMEOUT_MS = 90_000;

/* ================================ schemas ================================ */

export const courseOutlineRequestSchema = z
  .object({
    title: z.string().trim().min(1, "Give the course a name.").max(TITLE_MAX),
    audience: z.string().trim().max(500).default(""),
    description: z.string().trim().max(SUMMARY_MAX).default(""),
    moduleCount: z.number().int().min(1).max(MAX_MODULES).default(4),
    lessonsPerModule: z.number().int().min(1).max(MAX_LESSONS_PER_MODULE).default(3),
  })
  .refine((value) => value.moduleCount * value.lessonsPerModule <= MAX_GENERATED_LESSONS, {
    message: `That's more than ${MAX_GENERATED_LESSONS} lessons in one go. Ask for fewer sections or fewer lessons per section — you can add more afterwards.`,
    path: ["lessonsPerModule"],
  });
export type CourseOutlineRequest = z.infer<typeof courseOutlineRequestSchema>;

export const outlineLessonSchema = z.object({
  title: z.string().trim().min(1, "Every lesson needs a title.").max(TITLE_MAX),
  bodyMd: z.string().max(BODY_MAX).default(""),
});

export const outlineModuleSchema = z.object({
  title: z.string().trim().min(1, "Every section needs a title.").max(TITLE_MAX),
  summary: z.string().trim().max(SUMMARY_MAX).default(""),
  lessons: z.array(outlineLessonSchema).max(MAX_SAVED_LESSONS_PER_MODULE).default([]),
});

export const courseOutlineSchema = z
  .object({
    title: z.string().trim().min(1, "Give the course a name.").max(TITLE_MAX),
    subtitle: z.string().trim().max(TITLE_MAX).default(""),
    description: z.string().trim().max(SUMMARY_MAX).default(""),
    modules: z.array(outlineModuleSchema).min(1, "Keep at least one section.").max(MAX_SAVED_MODULES),
  })
  .refine(
    (value) => value.modules.reduce((sum, mod) => sum + mod.lessons.length, 0) <= MAX_SAVED_LESSONS,
    { message: `A course can be created with up to ${MAX_SAVED_LESSONS} lessons at once.`, path: ["modules"] },
  );
export type CourseOutline = z.infer<typeof courseOutlineSchema>;

/** POST /admin/ai/course-outline/create — the reviewed outline, plus one choice. */
export const createCourseFromOutlineSchema = z.object({
  outline: courseOutlineSchema,
  /** Off by default: lessons arrive as drafts, like the course itself. */
  publishLessons: z.boolean().default(false),
});

/**
 * The shape the model must answer in, as OpenAI structured outputs take it.
 *
 * Strict mode needs every property listed in `required` and no extra keys, so
 * there are no optional fields here; counts are asked for in the prompt and
 * enforced after parsing (`normalizeOutline`), not in the schema.
 */
export const OUTLINE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "subtitle", "description", "modules"],
  properties: {
    title: { type: "string", description: "The course name, kept close to what the owner typed." },
    subtitle: { type: "string", description: "One-line promise of the course, under 120 characters." },
    description: { type: "string", description: "2-3 sentences: who it is for and what changes by the end." },
    modules: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "summary", "lessons"],
        properties: {
          title: { type: "string" },
          summary: { type: "string", description: "1-2 sentences on what this section achieves." },
          lessons: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["title", "bodyMd"],
              properties: {
                title: { type: "string" },
                bodyMd: {
                  type: "string",
                  description: "A short markdown starter draft for the lesson (80-150 words).",
                },
              },
            },
          },
        },
      },
    },
  },
} as const;

/* ================================ prompt ================================= */

export const OUTLINE_INSTRUCTIONS = [
  "You design online courses for Boss Clinician, the business-coaching platform of Yvette Howard, LCSW. Her students are therapists and clinicians building and growing private practices (leaving insurance panels and platforms, pricing, marketing, systems, hiring, audit-readiness, mindset).",
  "",
  "Given a course name and optional details, draft a complete course outline: sections (modules) in a logical teaching order, each with a short summary, and lessons inside each section.",
  "",
  "Voice: warm, direct, peer-to-peer — a licensed clinician talking to fellow clinician business owners. Practical and actionable over theoretical.",
  "",
  "Each lesson's bodyMd is a STARTER DRAFT the owner will rewrite, 80-150 words of markdown: one opening sentence on why the lesson matters, then 3-5 bullet points of what it covers or the steps involved, then one line starting with '**Action step:**'. No top-level heading (the lesson title is shown separately). Do not invent video links, downloads, statistics, studies, quotes or named clients.",
  "",
  "Rules:",
  "- Use exactly the number of sections and lessons per section requested.",
  "- Keep the course title close to what the owner typed; fix only obvious typos or casing.",
  "- Titles are specific and plain (no numbering like 'Module 1:' or 'Lesson 2:' — the platform numbers them).",
  "- Never promise specific income or outcomes; this is business education, not clinical, legal or financial advice.",
].join("\n");

export function buildOutlineInput(request: CourseOutlineRequest): string {
  const lines = [
    `Course name: ${request.title}`,
    `Sections: ${request.moduleCount}`,
    `Lessons per section: ${request.lessonsPerModule}`,
  ];
  if (request.audience) lines.push(`Who it is for: ${request.audience}`);
  if (request.description) lines.push(`What it should cover: ${request.description}`);
  return lines.join("\n");
}

/* ============================ reading the reply ============================ */

const clip = (value: unknown, max: number): string =>
  (typeof value === "string" ? value : "").trim().slice(0, max);

/**
 * The model's parsed JSON → an outline the screen can show and the create route
 * will accept.
 *
 * Structured outputs guarantee the shape, not the sizes: a section can come
 * back with seven lessons when five were asked for, or a title can be blank. So
 * everything is trimmed to the column limits, blank rows are dropped and the
 * counts are cut to what she asked for. Too FEW rows are kept as they are — an
 * outline one lesson short is still a useful outline.
 */
export function normalizeOutline(raw: unknown, request: CourseOutlineRequest): CourseOutline | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Record<string, unknown>;
  const modules = (Array.isArray(data.modules) ? data.modules : [])
    .map((mod: unknown) => {
      const m = (mod && typeof mod === "object" ? mod : {}) as Record<string, unknown>;
      const lessons = (Array.isArray(m.lessons) ? m.lessons : [])
        .map((lesson: unknown) => {
          const l = (lesson && typeof lesson === "object" ? lesson : {}) as Record<string, unknown>;
          return { title: clip(l.title, TITLE_MAX), bodyMd: clip(l.bodyMd, BODY_MAX) };
        })
        .filter((lesson) => lesson.title !== "")
        .slice(0, request.lessonsPerModule);
      return { title: clip(m.title, TITLE_MAX), summary: clip(m.summary, SUMMARY_MAX), lessons };
    })
    .filter((mod) => mod.title !== "")
    .slice(0, request.moduleCount);

  const parsed = courseOutlineSchema.safeParse({
    title: clip(data.title, TITLE_MAX) || request.title,
    subtitle: clip(data.subtitle, TITLE_MAX),
    description: clip(data.description, SUMMARY_MAX),
    modules,
  });
  return parsed.success ? parsed.data : null;
}

/** The text of a finished Responses API reply, and whether the model refused. */
export function outputTextOf(output: unknown): { text: string; refusal: string | null } {
  let text = "";
  let refusal: string | null = null;
  for (const item of Array.isArray(output) ? output : []) {
    if (!item || typeof item !== "object" || (item as { type?: string }).type !== "message") continue;
    for (const part of (item as { content?: unknown[] }).content ?? []) {
      const p = part as { type?: string; text?: string; refusal?: string };
      if (p?.type === "output_text" && typeof p.text === "string") text += p.text;
      if (p?.type === "refusal") refusal = p.refusal ?? "refused";
    }
  }
  return { text, refusal };
}

/* ================================ generate ================================ */

export type GenerateResult =
  | { ok: true; outline: CourseOutline }
  | { ok: false; status: number; error: string };

export const courseAiModel = (): string => process.env.COURSE_AI_MODEL?.trim() || backendModel();

const LOG = "[course-ai]";

export async function generateCourseOutline(
  request: CourseOutlineRequest,
  deps: { fetch?: typeof fetch; signal?: AbortSignal } = {},
): Promise<GenerateResult> {
  if (!voiceEnabled()) {
    return { ok: false, status: 503, error: "AI course building isn't set up on this server yet." };
  }
  const doFetch = deps.fetch ?? fetch;
  const timeout = AbortSignal.timeout(GENERATE_TIMEOUT_MS);
  const signal = deps.signal ? AbortSignal.any([deps.signal, timeout]) : timeout;
  const model = courseAiModel();
  const started = Date.now();

  let response: Response;
  try {
    response = await doFetch(`${env.openai.baseUrl}/responses`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.openai.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        instructions: OUTLINE_INSTRUCTIONS,
        input: buildOutlineInput(request),
        text: {
          format: { type: "json_schema", name: "course_outline", strict: true, schema: OUTLINE_JSON_SCHEMA },
        },
        // Reasoning tokens come out of max_output_tokens before any visible one
        // does (liveSession.ts), so the ceiling is generous and the effort low.
        reasoning: { effort: "low" },
        max_output_tokens: 16_000,
        store: false,
      }),
      redirect: "error",
      signal,
    });
  } catch (error) {
    if (timeout.aborted) {
      return {
        ok: false,
        status: 504,
        error: "The AI took too long. Try fewer sections or lessons, then add more afterwards.",
      };
    }
    if (deps.signal?.aborted) return { ok: false, status: 499, error: "Cancelled." };
    console.error(`${LOG} request failed: ${error instanceof Error ? error.message : String(error)}`);
    return { ok: false, status: 502, error: "We couldn't reach the AI just now. Please try again in a moment." };
  }

  const requestId = response.headers.get("x-request-id") ?? "none";
  const body = (await response.json().catch(() => null)) as {
    output?: unknown;
    status?: string;
    incomplete_details?: { reason?: string };
    error?: { message?: string };
    usage?: { input_tokens?: number; output_tokens?: number };
  } | null;

  if (!response.ok) {
    console.error(
      `${LOG} refused status=${response.status} request_id=${requestId}: ${body?.error?.message ?? "no detail"}`,
    );
    return { ok: false, status: 502, error: "The AI couldn't build that outline just now. Please try again." };
  }

  console.info(
    `${LOG} model=${model} request_id=${requestId} status=${body?.status ?? "?"} ` +
      `input_tokens=${body?.usage?.input_tokens ?? "?"} output_tokens=${body?.usage?.output_tokens ?? "?"} ` +
      `latency_ms=${Date.now() - started}`,
  );

  if (body?.status === "incomplete") {
    return {
      ok: false,
      status: 502,
      error: "The outline was cut short. Try fewer sections or lessons, then add more afterwards.",
    };
  }

  const { text, refusal } = outputTextOf(body?.output);
  if (refusal) {
    return { ok: false, status: 422, error: "The AI wouldn't write an outline for that title. Try rewording it." };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    console.error(`${LOG} unparseable output request_id=${requestId} length=${text.length}`);
    return { ok: false, status: 502, error: "The AI's answer came back garbled. Please try again." };
  }
  const outline = normalizeOutline(raw, request);
  if (!outline) {
    return { ok: false, status: 502, error: "The AI's outline was empty. Please try again." };
  }
  return { ok: true, outline };
}

/* ================================= create ================================ */

/**
 * A course address from its name. The same folding as the Courses screen's own
 * `slugify` (frontend/src/pages/admin/ui/friendly.ts), so a course built here
 * gets the address "Add a course" would have given it.
 */
export function courseSlugBase(title: string): string {
  return (
    title
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80)
      .replace(/-+$/, "") || "course"
  );
}

export interface CreatedCourse {
  courseId: number;
  slug: string;
  moduleCount: number;
  lessonCount: number;
}

/**
 * Writes the reviewed outline as one draft course, in one transaction: a
 * failure on lesson twenty leaves no half-built course behind.
 *
 * Mirrors the inserts in routes/admin/courses.ts (the CRUD factory) and
 * routes/admin/curriculum.ts — the same columns, the same "/apply" default the
 * Add a course form sends, `content_type` 'text', and lesson slugs from the
 * curriculum route's own `lessonSlug`/`nextLessonSlug`, so the UNIQUE
 * (module_id, slug) index is satisfied when two lessons share a title.
 */
export async function createCourseFromOutline(
  outline: CourseOutline,
  options: { publishLessons?: boolean; client?: PoolClient } = {},
): Promise<CreatedCourse> {
  const client = options.client ?? (await pool.connect());
  const owned = !options.client;
  try {
    await client.query("BEGIN");

    // courses.slug is UNIQUE; the screen's own list is not trusted to be current.
    const base = courseSlugBase(outline.title);
    const taken = await client.query<{ slug: string }>(
      `SELECT slug FROM courses WHERE slug = $1::text OR slug LIKE $1::text || '-%'`,
      [base],
    );
    const slug = nextLessonSlug(base, taken.rows.map((row) => row.slug));

    const course = await client.query<{ id: number }>(
      `INSERT INTO courses (slug, title, subtitle, description, url, features, sort, published)
       VALUES ($1, $2, $3, $4, '/apply', '[]'::jsonb, 0, false)
       RETURNING id`,
      [slug, outline.title, outline.subtitle, outline.description],
    );
    const courseId = course.rows[0].id;

    let lessonCount = 0;
    for (const [moduleIndex, mod] of outline.modules.entries()) {
      const inserted = await client.query<{ id: number }>(
        `INSERT INTO course_modules (course_id, title, summary, sort) VALUES ($1, $2, $3, $4) RETURNING id`,
        [courseId, mod.title, mod.summary, moduleIndex],
      );
      const moduleId = inserted.rows[0].id;
      const slugs: string[] = [];
      for (const [lessonIndex, lesson] of mod.lessons.entries()) {
        const lessonSlugValue = nextLessonSlug(lessonSlug(lesson.title), slugs);
        slugs.push(lessonSlugValue);
        await client.query(
          `INSERT INTO course_lessons (module_id, slug, title, body_md, content_type, published, sort)
           VALUES ($1, $2, $3, $4, 'text', $5, $6)`,
          [moduleId, lessonSlugValue, lesson.title, lesson.bodyMd, options.publishLessons === true, lessonIndex],
        );
        lessonCount += 1;
      }
    }

    await client.query("COMMIT");
    return { courseId, slug, moduleCount: outline.modules.length, lessonCount };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    if (owned) client.release();
  }
}
