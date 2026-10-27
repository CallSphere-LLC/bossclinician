import sanitizeHtml from "sanitize-html";
import { pool } from "../db/pool";
import type { MemberCourseView } from "./curriculum";

export interface CourseSearchResult {
  id: number;
  slug: string;
  title: string;
  moduleTitle: string;
  unlocked: boolean;
  unlockLabel: string;
  snippet: string;
}

/** Search plain visible text, never link destinations, embeds, or assessment answers. */
export function searchableText(value: string): string {
  return sanitizeHtml(value, { allowedTags: [], allowedAttributes: {} })
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s*\[[^\]]+\]:\s*\S+.*$/gm, "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[#*_`~>|]/g, " ")
    .replace(/&(?:amp|lt|gt|quot|apos|nbsp|#\d+|#x[\da-f]+);/gi, (entity) => {
      const named: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'", "&nbsp;": " " };
      if (named[entity.toLowerCase()]) return named[entity.toLowerCase()];
      const code = entity[2].toLowerCase() === "x" ? parseInt(entity.slice(3, -1), 16) : Number(entity.slice(2, -1));
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : " ";
    })
    .replace(/\s+/g, " ").trim();
}

export const searchFold = (value: string): string => value.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("en-US");

export function searchExcerpt(text: string, terms: string[]): string {
  const folded = searchFold(text);
  const first = Math.min(...terms.map((term) => folded.indexOf(term)).filter((index) => index >= 0));
  const start = Number.isFinite(first) ? Math.max(0, first - 55) : 0;
  return `${start ? "…" : ""}${text.slice(start, start + 220)}${text.length > start + 220 ? "…" : ""}`;
}

/** Caller has checked product ownership and obtained this member's gated outline.
 * Only unlocked IDs are ever selected. There are no progress or cache writes.
 */
export async function searchMemberCourse(course: MemberCourseView, query: string) {
  const terms = searchFold(query.trim()).split(/\s+/).filter(Boolean);
  if (!terms.length) return { results: [] as CourseSearchResult[], total: 0 };
  const entries = course.modules.flatMap((module) => module.lessons.map((lesson) => ({
    lesson, module, unlocked: module.unlocked && lesson.unlocked,
  })));
  const unlockedIds = entries.filter((entry) => entry.unlocked).map(({ lesson }) => lesson.id);
  const content = unlockedIds.length ? await pool.query<{ id: number; body_md: string; transcript: string }>(
    `SELECT l.id, l.body_md, l.transcript FROM course_lessons l
       JOIN course_modules m ON m.id = l.module_id
      WHERE m.course_id = $1 AND l.id = ANY($2::int[]) AND l.published`,
    [course.courseId, unlockedIds],
  ) : { rows: [] };
  const textById = new Map(content.rows.map((row) => [row.id, searchableText(`${row.body_md ?? ""}\n${row.transcript ?? ""}`)]));
  const results: CourseSearchResult[] = [];
  for (const { lesson, module, unlocked } of entries) {
    const text = unlocked ? textById.get(lesson.id) ?? "" : "";
    const haystack = searchFold(`${lesson.title} ${module.title} ${text}`);
    if (!terms.every((term) => haystack.includes(term))) continue;
    results.push({ id: lesson.id, slug: lesson.slug, title: lesson.title, moduleTitle: module.title,
      unlocked, unlockLabel: unlocked ? "" : lesson.unlockLabel || module.unlockLabel,
      snippet: unlocked && terms.some((term) => searchFold(text).includes(term)) ? searchExcerpt(text, terms) : "",
    });
  }
  return { results: results.slice(0, 100), total: results.length };
}
