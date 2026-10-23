import { sessionFetch } from "@/lib/adminTransport";
import { ApiError } from "@/lib/api";

/**
 * Analytics → Engagement (QA row 171): who watched which lesson video, who came
 * to which live session, and the two follow-up emails.
 *
 * Its own small client, like `marketingApi.ts`, because only this page (and the
 * automation builder's lesson picker) reads these shapes.
 */

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "/api";

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  const res = await sessionFetch(`${API_BASE}${path}`, { ...options, headers });

  if (!res.ok) {
    let message = "";
    try {
      const body = (await res.json()) as { error?: string; message?: string };
      message = body.error ?? body.message ?? "";
    } catch {
      // The status is what `friendlyError` reads.
    }
    throw new ApiError(message, res.status);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

function query(params: Record<string, string | number | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

/* ── Lesson videos ──────────────────────────────────────────────────────── */

export type WatchStatus = "not_started" | "partial" | "completed";
export type StatusFilter = "all" | WatchStatus | "not_completed";

export interface EngagementCourse {
  id: number;
  title: string;
  videoLessons: number;
  members: number;
}

export interface EngagementLesson {
  id: number;
  title: string;
  moduleTitle: string;
  durationSeconds: number;
  members: number;
  notStarted: number;
  partial: number;
  completed: number;
}

export interface ProgressRow {
  memberId: number;
  name: string;
  email: string;
  courseId: number;
  courseTitle: string;
  lessonId: number;
  lessonTitle: string;
  moduleTitle: string;
  status: WatchStatus;
  watchedPercent: number;
  completedAt: string | null;
  firstViewedAt: string | null;
  lastViewedAt: string | null;
  grantedAt: string;
  lastRemindedAt: string | null;
  lessonUrl: string;
}

export interface EmailCopy {
  subject: string;
  bodyMd: string;
}

export interface ProgressResponse {
  rows: ProgressRow[];
  totals: { notStarted: number; partial: number; completed: number };
  truncated: boolean;
  defaults: EmailCopy;
}

export interface ProgressFilters {
  courseId?: number | null;
  lessonId?: number | null;
  memberId?: number | null;
  status?: StatusFilter;
  q?: string;
}

export interface SendResult {
  queued: number;
  alreadySent: number;
  noContact: number;
  notEligible: number;
}

/* ── Live sessions ──────────────────────────────────────────────────────── */

export interface LiveSessionSummary {
  key: string;
  source: "community" | "event";
  eventId: number;
  communityId: number | null;
  communityName: string;
  title: string;
  startsAt: string;
  endsAt: string;
  dateLabel: string;
  replayUrl: string;
  attendanceTracked: boolean;
  recurring: boolean;
  ended?: boolean;
  invited?: number;
  attended?: number;
  missed?: number;
}

export interface SessionPerson {
  memberId: number | null;
  contactId: number | null;
  email: string;
  name: string;
  invitedAs: "going" | "maybe" | "member" | "registered" | "walk_in";
  invited: boolean;
  attended: boolean | null;
  minutesAttended: number;
  replaySentAt: string | null;
}

export interface EngagementSendRow {
  id: number;
  kind: "lesson_reminder" | "replay";
  email: string;
  subject: string;
  status: "queued" | "sending" | "sent" | "suppressed" | "failed";
  error: string;
  createdAt: string;
  sentAt: string | null;
  about: string;
  sessionStartsAt: string | null;
}

/** How a person is named in "Email the replay": `m<memberId>`, or their email. */
export function personKey(person: Pick<SessionPerson, "memberId" | "email">): string {
  return person.memberId !== null ? `m${person.memberId}` : person.email.toLowerCase();
}

export const engagementApi = {
  courses: () => request<EngagementCourse[]>("/admin/engagement/courses"),

  lessons: (courseId: number) =>
    request<EngagementLesson[]>(`/admin/engagement/courses/${courseId}/lessons`),

  progress: (filters: ProgressFilters) =>
    request<ProgressResponse>(
      `/admin/engagement/progress${query({
        courseId: filters.courseId,
        lessonId: filters.lessonId,
        memberId: filters.memberId,
        status: filters.status,
        q: filters.q?.trim(),
      })}`
    ),

  /** The CSV as a Blob; `saveCsv` (formsApi) hands it to the browser. */
  progressCsv: async (filters: ProgressFilters): Promise<Blob> => {
    const res = await sessionFetch(
      `${API_BASE}/admin/engagement/progress.csv${query({
        courseId: filters.courseId,
        lessonId: filters.lessonId,
        memberId: filters.memberId,
        status: filters.status,
        q: filters.q?.trim(),
      })}`
    );
    if (!res.ok) {
      throw new ApiError("That download didn't finish. Please try again in a moment.", res.status);
    }
    return res.blob();
  },

  remind: (input: { lessonId: number; memberIds: number[] } & EmailCopy) =>
    request<SendResult>("/admin/engagement/remind", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  sessions: (days = 60) =>
    request<{ sessions: LiveSessionSummary[]; defaults: EmailCopy }>(
      `/admin/engagement/sessions${query({ days })}`
    ),

  sessionPeople: (key: string, audience: "registered" | "members") =>
    request<{ session: LiveSessionSummary; people: SessionPerson[]; defaults: EmailCopy }>(
      `/admin/engagement/sessions/people${query({ key, audience })}`
    ),

  setReplay: (key: string, replayUrl: string) =>
    request<LiveSessionSummary>("/admin/engagement/sessions/replay", {
      method: "PUT",
      body: JSON.stringify({ key, replayUrl }),
    }),

  sendReplay: (input: { key: string; audience: "registered" | "members"; people: string[] } & EmailCopy) =>
    request<SendResult>("/admin/engagement/sessions/send-replay", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  sends: (limit = 50) => request<EngagementSendRow[]>(`/admin/engagement/sends${query({ limit })}`),
};
