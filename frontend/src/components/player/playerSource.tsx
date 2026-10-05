import { createContext, useContext, type ReactNode } from "react";
import { Link } from "react-router";
import { Eye } from "lucide-react";
import { memberRequest } from "@/lib/memberApi";
import { lessonPath, libraryApi, productPath } from "@/lib/libraryApi";
import type { Quiz, QuizOutcome } from "@/lib/quizApi";

/**
 * Where the course player gets its data, and where its links point.
 *
 * The player has exactly one consumer that is not a member: the admin's
 * "Preview as student". That preview has to draw the very components a student
 * gets — a lookalike would drift from them the first week — but it must not
 * read through a member session, because the admin has none and is not given
 * one, and it must not write anything at all.
 *
 * So the components ask this context instead of importing `libraryApi`
 * directly. With no provider mounted the value is `memberSource`: the real
 * `libraryApi`, the real `/library/...` paths and `preview: null`, which is the
 * member app exactly as it was. The admin preview mounts a provider whose reads
 * go to admin-authenticated endpoints and whose writes go nowhere (see
 * lib/coursePreviewApi.ts).
 */

/** One past attempt, as `/assessments/:slug/my-results` lists it. */
export interface QuizAttempt {
  id: number;
  percent: number;
  passed: boolean | null;
  completedAt: string;
  responses: { questionId: number; answerIds?: number[]; text?: string }[];
}

export interface QuizAnswers {
  responses: { questionId: number; answerIds: number[]; text: string }[];
  elapsedMs: number;
}

/** The lesson-assessment calls, by the assessment's slug. */
export interface PlayerQuizApi {
  get: (slug: string) => Promise<Quiz>;
  results: (slug: string) => Promise<QuizAttempt[]>;
  submit: (slug: string, answers: QuizAnswers) => Promise<QuizOutcome>;
}

/** The part of `libraryApi` the player and its panels call. */
export type PlayerApi = Pick<
  typeof libraryApi,
  | "getProduct"
  | "getLesson"
  | "saveProgress"
  | "toggleComplete"
  | "getNote"
  | "saveNote"
  | "getComments"
  | "postComment"
  | "editComment"
  | "deleteComment"
  | "downloadLink"
>;

export interface PlayerPreview {
  /** Where "Back to editor" goes. */
  editorPath: string;
  /** The course itself is unpublished. */
  courseDraft: boolean;
}

export interface PlayerSource {
  /** null for a member. Set only by the admin's read-only preview. */
  preview: PlayerPreview | null;
  api: PlayerApi;
  quiz: PlayerQuizApi;
  productPath: (productSlug: string) => string;
  lessonPath: (productSlug: string, lessonSlug: string) => string;
}

const assessmentPath = (slug: string): string => `/assessments/${encodeURIComponent(slug)}`;

/** What a signed-in member gets: the calls the player has always made. */
export const memberSource: PlayerSource = {
  preview: null,
  api: libraryApi,
  quiz: {
    get: (slug) => memberRequest<Quiz>(assessmentPath(slug)),
    results: (slug) => memberRequest<QuizAttempt[]>(`${assessmentPath(slug)}/my-results`),
    submit: (slug, answers) =>
      memberRequest<QuizOutcome>(`${assessmentPath(slug)}/submit`, {
        method: "POST",
        body: JSON.stringify(answers),
      }),
  },
  productPath,
  lessonPath,
};

const PlayerSourceContext = createContext<PlayerSource>(memberSource);

export function PlayerSourceProvider({
  value,
  children,
}: {
  value: PlayerSource;
  children: ReactNode;
}) {
  return <PlayerSourceContext.Provider value={value}>{children}</PlayerSourceContext.Provider>;
}

export function usePlayerSource(): PlayerSource {
  return useContext(PlayerSourceContext);
}

/**
 * The strip across the top of an admin preview. Renders nothing for a member.
 *
 * Lives in MemberShell's sticky block, beside the impersonation banner, so it
 * stays on screen however far the lesson is scrolled — the one thing on the
 * page that is not what a student sees, and so the one thing that says so.
 */
export function PlayerPreviewBanner() {
  const { preview } = usePlayerSource();
  if (!preview) return null;

  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 bg-amber-400 px-5 py-2 text-center"
    >
      <p className="flex items-center gap-2 text-[0.78rem] font-semibold text-amber-950">
        <Eye aria-hidden className="size-4 shrink-0" />
        Preview — this is how students see this course. Nothing is saved.
      </p>
      {preview.courseDraft && (
        <span className="rounded-full border border-amber-950/40 px-2 py-0.5 text-[0.62rem] font-bold uppercase tracking-[0.14em] text-amber-950">
          Draft course
        </span>
      )}
      <Link
        to={preview.editorPath}
        className="text-[0.78rem] font-bold text-amber-950 underline underline-offset-2 hover:no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-950"
      >
        Back to editor
      </Link>
    </div>
  );
}
