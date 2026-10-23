import { sessionFetch } from "@/lib/adminTransport";
import { ApiError } from "@/lib/api";

/**
 * "Build with AI" on the Courses screen (routes/admin/ai.ts →
 * services/courseOutline.ts): draft an outline from a course name, then save
 * the reviewed outline as a draft course with its sections and lessons.
 */

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "/api";

async function call<T>(path: string, body: unknown): Promise<T> {
  const res = await sessionFetch(`${API_BASE}/admin/ai${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let message = "Something went wrong. Please try again in a moment.";
    try {
      const parsed = (await res.json()) as { error?: string; message?: string };
      message = parsed.error ?? parsed.message ?? message;
    } catch {
      // A non-JSON body (a proxy's timeout page) tells us nothing worth showing.
      if (res.status === 504 || res.status === 524) {
        message = "The AI took too long. Try fewer sections or lessons, then add more afterwards.";
      }
    }
    throw new ApiError(message, res.status, {}, false);
  }
  return (await res.json()) as T;
}

/** The limits the server enforces (services/courseOutline.ts). */
export const COURSE_AI_LIMITS = {
  maxModules: 8,
  maxLessonsPerModule: 6,
  maxGeneratedLessons: 30,
} as const;

export interface OutlineLesson {
  title: string;
  bodyMd: string;
}

export interface OutlineModule {
  title: string;
  summary: string;
  lessons: OutlineLesson[];
}

export interface CourseOutline {
  title: string;
  subtitle: string;
  description: string;
  modules: OutlineModule[];
}

export interface CourseOutlineRequest {
  title: string;
  audience?: string;
  description?: string;
  moduleCount: number;
  lessonsPerModule: number;
}

export interface CreatedCourse {
  courseId: number;
  slug: string;
  moduleCount: number;
  lessonCount: number;
}

export const courseAiApi = {
  generateOutline: (request: CourseOutlineRequest) =>
    call<{ outline: CourseOutline }>("/course-outline", request).then((r) => r.outline),
  createFromOutline: (outline: CourseOutline, publishLessons: boolean) =>
    call<CreatedCourse>("/course-outline/create", { outline, publishLessons }),
};

/**
 * Drops what the server would refuse — blank rows and stray whitespace — so a
 * section she cleared out by mistake doesn't block the whole save. Exported
 * for its test.
 */
export function cleanOutline(outline: CourseOutline): CourseOutline {
  return {
    title: outline.title.trim(),
    subtitle: outline.subtitle.trim(),
    description: outline.description.trim(),
    modules: outline.modules
      .map((mod) => ({
        title: mod.title.trim(),
        summary: mod.summary.trim(),
        lessons: mod.lessons
          .map((lesson) => ({ title: lesson.title.trim(), bodyMd: lesson.bodyMd }))
          .filter((lesson) => lesson.title !== ""),
      }))
      .filter((mod) => mod.title !== "" || mod.lessons.length > 0),
  };
}

/** The first thing she still has to fix before saving, or null when it's ready. */
export function outlineProblem(outline: CourseOutline): string | null {
  if (!outline.title.trim()) return "Give the course a name.";
  if (outline.modules.length === 0) return "Keep at least one section.";
  if (outline.modules.some((mod) => !mod.title.trim())) return "Every section needs a title.";
  return null;
}
