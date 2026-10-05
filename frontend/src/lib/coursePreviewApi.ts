import { sessionFetch } from "@/lib/adminTransport";
import { MemberApiError } from "@/lib/memberApi";
import type { DownloadLink, LessonResponse, LibraryProduct } from "@/lib/libraryApi";
import type { Quiz, QuizOutcome } from "@/lib/quizApi";
import type { PlayerApi, PlayerQuizApi } from "@/components/player/playerSource";

/**
 * The admin's "Preview as student" — the data half.
 *
 * Reads come from `/api/admin/courses/:id/preview/*`, which answer in the member
 * API's shapes behind the admin session (routes/admin/coursePreview.ts). Every
 * write the member player can make is answered here, in the browser, without a
 * request: there is no endpoint behind them to call, which is what "nothing is
 * saved" rests on rather than on each component remembering to check.
 *
 * Failures are raised as `MemberApiError`, because that is the class the player
 * components test for when they decide whether a message is fit to show.
 */

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "/api";

const NOT_SAVED = "Preview only — nothing is saved.";

/** The preview's own address in the admin app; the server builds the same strings. */
export function coursePreviewPath(courseId: number | string, lessonSlug?: string): string {
  const base = `/admin/courses/${encodeURIComponent(String(courseId))}/preview`;
  return lessonSlug === undefined ? base : `${base}/lessons/${encodeURIComponent(lessonSlug)}`;
}

/** The course builder the preview was opened from. */
export function courseEditorPath(courseId: number | string): string {
  return `/admin/courses/${encodeURIComponent(String(courseId))}/curriculum`;
}

/** The course product as the preview endpoint sends it. */
export type PreviewProduct = LibraryProduct & { courseDraft?: boolean };

async function previewRequest<T>(
  courseId: number | string,
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  const res = await sessionFetch(
    `${API_BASE}/admin/courses/${encodeURIComponent(String(courseId))}/preview${path}`,
    { ...options, headers },
  );

  if (!res.ok) {
    let message = "Something went wrong. Please try again in a moment.";
    let details: unknown;
    try {
      const body = (await res.json()) as { error?: string; message?: string; details?: unknown };
      message = body.error ?? body.message ?? message;
      details = body.details;
    } catch {
      // A non-JSON body tells us nothing worth showing.
    }
    throw new MemberApiError(message, res.status, details);
  }

  return (await res.json()) as T;
}

function refuse<T>(): Promise<T> {
  return Promise.reject(new MemberApiError(NOT_SAVED, 403));
}

/**
 * The player's data source for one course, read as an administrator.
 *
 * `onProduct` hands the course response back to the page, which is how the
 * banner learns the course itself is still a draft.
 */
export function createCoursePreviewApi(
  courseId: number | string,
  onProduct?: (product: PreviewProduct) => void,
): { api: PlayerApi; quiz: PlayerQuizApi } {
  const api: PlayerApi = {
    // The player passes its "product slug", which in a preview is the course id
    // already bound here.
    getProduct: async () => {
      const product = await previewRequest<PreviewProduct>(courseId, "");
      onProduct?.(product);
      return product;
    },
    getLesson: (_productSlug, lessonSlug) =>
      previewRequest<LessonResponse>(courseId, `/lessons/${encodeURIComponent(lessonSlug)}`),

    // Everything a student would write. None of these reaches the network.
    saveProgress: () => refuse(),
    toggleComplete: () => refuse(),
    saveNote: () => refuse(),
    postComment: () => refuse(),
    editComment: () => refuse(),
    deleteComment: () => refuse(),

    // A new student's notebook and discussion: empty. Other students' comments
    // are not the admin's to read through a preview, and there are no notes.
    getNote: (lessonId) =>
      Promise.resolve({ lessonId, notesEnabled: true, body: "", updatedAt: null }),
    getComments: (lessonId) => Promise.resolve({ lessonId, commentsEnabled: true, comments: [] }),

    downloadLink: (kind, fileId) =>
      kind === "lesson"
        ? previewRequest<DownloadLink>(courseId, `/files/${fileId}/link`)
        : refuse<DownloadLink>(),
  };

  const quiz: PlayerQuizApi = {
    get: (slug) => previewRequest<Quiz>(courseId, `/assessments/${encodeURIComponent(slug)}`),
    // No attempt is ever stored for a preview, so there is no history to list.
    results: () => Promise.resolve([]),
    // Marked by the same scorer a student's answers go through; not recorded.
    submit: (slug, answers) =>
      previewRequest<QuizOutcome>(courseId, `/assessments/${encodeURIComponent(slug)}/score`, {
        method: "POST",
        body: JSON.stringify({ responses: answers.responses }),
      }),
  };

  return { api, quiz };
}
