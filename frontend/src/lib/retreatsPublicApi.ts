import { ApiError } from "@/lib/api";

/**
 * Public retreat listing and the announcement sign-up
 * (backend routes/public/retreatsPublic.ts). No account involved.
 */

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "/api";

export interface PublicRetreat {
  slug: string;
  title: string;
  location: string;
  /** YYYY-MM-DD calendar dates; format with content/retreatInterest formatRetreatDates. */
  startDate: string;
  endDate: string;
  summary: string;
  image: string;
  href: string;
  upcoming: boolean;
}

export interface RetreatInterestPayload {
  email: string;
  firstName?: string;
  consent: true;
  retreat?: string;
  company: string;
  elapsedMs: number;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers, credentials: "same-origin" });
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
  return (await res.json()) as T;
}

export const retreatsPublicApi = {
  upcoming: async (): Promise<PublicRetreat[]> =>
    (await request<{ retreats: PublicRetreat[] }>("/upcoming-retreats")).retreats,
  bySlug: async (slug: string): Promise<PublicRetreat> =>
    (await request<{ retreat: PublicRetreat }>(`/upcoming-retreats/${encodeURIComponent(slug)}`)).retreat,
  signUp: (payload: RetreatInterestPayload) =>
    request<{ ok: true }>("/retreat-interest", { method: "POST", body: JSON.stringify(payload) }),
};
