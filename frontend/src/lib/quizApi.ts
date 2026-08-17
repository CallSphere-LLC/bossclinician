import { ApiError, getToken } from "@/lib/api";

/**
 * The quiz client — the public player and the admin editor.
 *
 * Both halves live together because they describe one thing from two sides: the
 * player sees a question with its answers, the editor sees the same question
 * with the weight on each answer and the band each score lands in. Keeping them
 * in one file is what stops the two drifting into two different vocabularies
 * for the same quiz.
 */

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "/api";

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers = new Headers(options.headers);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  // The public endpoints ignore it; sending it on both keeps one request
  // function rather than two that differ by a header.
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });

  if (!res.ok) {
    let message = "Something went wrong. Please try again in a moment.";
    try {
      const parsed = (await res.json()) as { error?: string; message?: string };
      message = parsed.error ?? parsed.message ?? message;
    } catch {
      // A non-JSON body tells us nothing worth showing.
    }
    throw new ApiError(message, res.status);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const body = (data: unknown): RequestInit["body"] => JSON.stringify(data);

/* ── The player ─────────────────────────────────────────────────────────── */

export type QuestionKind = "single" | "multiple" | "scale" | "text";
export type QuizKind = "quiz" | "graded";

export interface QuizAnswer {
  id: number;
  label: string;
}

export interface QuizQuestion {
  id: number;
  prompt: string;
  helpText: string;
  kind: QuestionKind;
  required: boolean;
  answers: QuizAnswer[];
}

export interface Quiz {
  id: number;
  slug: string;
  title: string;
  introMd: string;
  kind: QuizKind;
  /** When true the player asks for an email address before the result. */
  requireEmail: boolean;
  questions: QuizQuestion[];
}

export interface QuizResultPage {
  slug: string;
  title: string;
  bodyMd: string;
  imageUrl: string;
  ctaLabel: string;
  ctaUrl: string;
}

export interface QuizOutcome {
  score: number;
  maxScore: number;
  percent: number;
  /** null on a lead-gen quiz, which has no pass mark. */
  passed: boolean | null;
  feedback: { questionId: number; correct: boolean; text: string }[];
  /** null when the score fell outside every band the owner set up. */
  result: QuizResultPage | null;
}

export interface QuizSubmission {
  responses: { questionId: number; answerIds?: number[]; text?: string }[];
  email?: string;
  name?: string;
  timezone?: string;
  /** The honeypot pair, from `useHoneypot`. */
  company?: string;
  elapsedMs?: number;
}

export const quizApi = {
  get: (slug: string) => request<Quiz>(`/assessments/${encodeURIComponent(slug)}`),
  submit: (slug: string, submission: QuizSubmission) =>
    request<QuizOutcome>(`/assessments/${encodeURIComponent(slug)}/submit`, {
      method: "POST",
      body: body(submission),
    }),
};

/* ── The editor ─────────────────────────────────────────────────────────── */

export interface AssessmentSummary {
  id: number;
  slug: string;
  title: string;
  kind: QuizKind;
  published: boolean;
  requireEmail: boolean;
  passMark: number | null;
  questionCount: number;
  resultCount: number;
  attemptCount: number;
  updatedAt: string;
}

export interface EditableAnswer {
  id: number;
  questionId: number;
  position: number;
  label: string;
  /** What choosing this answer adds to the score. */
  weight: number;
  isCorrect: boolean;
  feedback: string;
}

export interface EditableQuestion {
  id: number;
  position: number;
  prompt: string;
  helpText: string;
  kind: QuestionKind;
  required: boolean;
  answers: EditableAnswer[];
}

export interface EditableResult {
  id: number;
  position: number;
  slug: string;
  title: string;
  bodyMd: string;
  imageUrl: string;
  minScore: number;
  maxScore: number;
  applyTagId: number | null;
  subscribeSequenceId: number | null;
  ctaLabel: string;
  ctaUrl: string;
  /** Resolved names, so a row reads as a sentence without a second fetch. */
  tagName: string | null;
  sequenceName: string | null;
  attemptCount: number;
}

export interface AssessmentDetail extends AssessmentSummary {
  introMd: string;
  showFeedback: boolean;
  maxAttempts: number | null;
  lessonId: number | null;
  questions: EditableQuestion[];
  results: EditableResult[];
}

export interface AssessmentDraft {
  title?: string;
  introMd?: string;
  kind?: QuizKind;
  passMark?: number | null;
  maxAttempts?: number | null;
  showFeedback?: boolean;
  requireEmail?: boolean;
  published?: boolean;
}

export interface QuestionDraft {
  prompt?: string;
  helpText?: string;
  kind?: QuestionKind;
  required?: boolean;
}

export interface AnswerDraft {
  label?: string;
  weight?: number;
  isCorrect?: boolean;
  feedback?: string;
}

export interface ResultDraft {
  title?: string;
  bodyMd?: string;
  imageUrl?: string;
  minScore?: number;
  maxScore?: number;
  applyTagId?: number | null;
  subscribeSequenceId?: number | null;
  ctaLabel?: string;
  ctaUrl?: string;
}

export interface QuizAttempt {
  id: number;
  email: string;
  score: number;
  maxScore: number;
  percent: number;
  passed: boolean | null;
  completedAt: string;
  resultTitle: string | null;
  contactName: string | null;
  contactId: number | null;
}

export interface QuizReport {
  attempts: number;
  /** People whose score matched none of the bands — they saw no result at all. */
  unmatched: number;
  averagePercent: number;
  passed: number;
  results: {
    id: number;
    title: string;
    minScore: number;
    maxScore: number;
    tagName: string | null;
    attemptCount: number;
  }[];
}

/**
 * What a write actually returns.
 *
 * The write endpoints answer with the stored row and nothing else — no counts,
 * no joined tag or sequence name, no nested answers, because assembling those
 * costs three more queries on every keystroke-sized save. Saying so in the type
 * is the point: a screen that merged one of these into its state believing it
 * was the full shape would blank the very fields the editor is built around.
 * Re-read with `get` after a structural change.
 */
export type SavedAssessment = Omit<
  AssessmentSummary,
  "questionCount" | "resultCount" | "attemptCount"
>;
export type SavedQuestion = Omit<EditableQuestion, "answers">;
export type SavedResult = Omit<EditableResult, "tagName" | "sequenceName" | "attemptCount">;

export const assessmentsApi = {
  list: () => request<AssessmentSummary[]>("/admin/assessments"),
  get: (id: number) => request<AssessmentDetail>(`/admin/assessments/${id}`),
  create: (draft: AssessmentDraft & { title: string }) =>
    request<SavedAssessment>("/admin/assessments", { method: "POST", body: body(draft) }),
  update: (id: number, draft: AssessmentDraft) =>
    request<SavedAssessment>(`/admin/assessments/${id}`, { method: "PATCH", body: body(draft) }),
  remove: (id: number) => request<void>(`/admin/assessments/${id}`, { method: "DELETE" }),

  addQuestion: (id: number, draft: QuestionDraft) =>
    request<SavedQuestion>(`/admin/assessments/${id}/questions`, {
      method: "POST",
      body: body(draft),
    }),
  updateQuestion: (questionId: number, draft: QuestionDraft) =>
    request<SavedQuestion>(`/admin/assessments/questions/${questionId}`, {
      method: "PATCH",
      body: body(draft),
    }),
  removeQuestion: (questionId: number) =>
    request<void>(`/admin/assessments/questions/${questionId}`, { method: "DELETE" }),
  reorderQuestions: (id: number, ids: number[]) =>
    request<void>(`/admin/assessments/${id}/questions/reorder`, {
      method: "POST",
      body: body({ ids }),
    }),

  addAnswer: (questionId: number, draft: AnswerDraft) =>
    request<EditableAnswer>(`/admin/assessments/questions/${questionId}/answers`, {
      method: "POST",
      body: body(draft),
    }),
  updateAnswer: (answerId: number, draft: AnswerDraft) =>
    request<EditableAnswer>(`/admin/assessments/answers/${answerId}`, {
      method: "PATCH",
      body: body(draft),
    }),
  removeAnswer: (answerId: number) =>
    request<void>(`/admin/assessments/answers/${answerId}`, { method: "DELETE" }),

  addResult: (id: number, draft: ResultDraft) =>
    request<SavedResult>(`/admin/assessments/${id}/results`, {
      method: "POST",
      body: body(draft),
    }),
  updateResult: (resultId: number, draft: ResultDraft) =>
    request<SavedResult>(`/admin/assessments/results/${resultId}`, {
      method: "PATCH",
      body: body(draft),
    }),
  removeResult: (resultId: number) =>
    request<void>(`/admin/assessments/results/${resultId}`, { method: "DELETE" }),
  reorderResults: (id: number, ids: number[]) =>
    request<void>(`/admin/assessments/${id}/results/reorder`, {
      method: "POST",
      body: body({ ids }),
    }),

  attempts: (id: number) => request<QuizAttempt[]>(`/admin/assessments/${id}/attempts`),
  report: (id: number) => request<QuizReport>(`/admin/assessments/${id}/report`),
};

/* ── Wording ────────────────────────────────────────────────────────────── */

/** The top of the INT range, which is how "and anything above" is stored. */
export const OPEN_ENDED = 2147483647;

/** "8–14" / "22 and above" — the band, said the way she wrote it. */
export function describeBand(minScore: number, maxScore: number): string {
  if (maxScore >= OPEN_ENDED) return `${minScore} and above`;
  if (minScore === maxScore) return `exactly ${minScore}`;
  return `${minScore}–${maxScore}`;
}

export const QUESTION_KIND_LABEL: Record<QuestionKind, string> = {
  single: "Pick one",
  multiple: "Pick any that apply",
  scale: "A scale",
  text: "Type an answer",
};
