import type { OutlineModule } from "@/lib/libraryApi";

export interface CourseSearchResult {
  id: number;
  slug: string;
  title: string;
  moduleTitle: string;
  unlocked: boolean;
  unlockLabel: string;
  snippet: string;
}

export interface CourseSearchResponse { results: CourseSearchResult[]; total: number }

/** Completion can release a prerequisite before the local outline's unlocked
 * flag refreshes. Ignore playback position so heartbeats do not repeat searches.
 */
export function courseSearchAccessKey(modules: OutlineModule[]): string {
  return JSON.stringify(modules.map((module) => [module.id, module.unlocked,
    module.lessons.map((lesson) => [lesson.id, lesson.unlocked, lesson.completed]) ]));
}

/** Admin preview has its own auth boundary. Search its already-loaded outline
 * locally instead of accidentally calling a member endpoint with an admin token.
 */
export function searchPreviewOutline(modules: OutlineModule[], query: string): CourseSearchResponse {
  const fold = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  const terms = fold(query.trim()).split(/\s+/).filter(Boolean);
  if (!terms.length) return { results: [], total: 0 };
  const results = modules.flatMap((module) => module.lessons
    .filter((lesson) => terms.every((term) => fold(`${lesson.title} ${module.title}`).includes(term)))
    .map((lesson) => ({ id: lesson.id, slug: lesson.slug, title: lesson.title, moduleTitle: module.title,
      unlocked: module.unlocked && lesson.unlocked, unlockLabel: lesson.unlockLabel || module.unlockLabel, snippet: "",
    })));
  return { results: results.slice(0, 100), total: results.length };
}
