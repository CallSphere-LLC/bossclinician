import { sessionFetch } from "@/lib/adminTransport";
import { ApiError } from "@/lib/api";

/**
 * The admin side of a coaching session's files.
 *
 * `lib/coachingApi.ts` is the member's client; this is the coach's. Kept off
 * `lib/api.ts` because that file is shared by every other screen in the
 * console, and this carries one small shape.
 */

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "/api";

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  const res = await sessionFetch(`${API_BASE}${path}`, { ...options, headers });

  if (!res.ok) {
    let message = "Something went wrong. Please try again in a moment.";
    try {
      const body = (await res.json()) as { error?: string; message?: string };
      message = body.error ?? body.message ?? message;
    } catch {
      // A non-JSON body tells us nothing worth showing.
    }
    throw new ApiError(message, res.status);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export interface CoachingSessionFile {
  id: number;
  sessionId: number;
  mediaId: number | null;
  title: string;
  /** A storage reference (`protected:…`) or an absolute link. Never render it as an href. */
  url: string;
  createdAt: string;
}

export interface NewCoachingSessionFile {
  mediaId?: number | null;
  title: string;
  url: string;
}

export const coachingAdminApi = {
  sessionFiles: (sessionId: number) =>
    request<CoachingSessionFile[]>(`/admin/coaching/sessions/${sessionId}/files`),
  sessionFileAdd: (sessionId: number, data: NewCoachingSessionFile) =>
    request<CoachingSessionFile>(`/admin/coaching/sessions/${sessionId}/files`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  sessionFileDelete: (sessionId: number, fileId: number) =>
    request<void>(`/admin/coaching/sessions/${sessionId}/files/${fileId}`, { method: "DELETE" }),
};
