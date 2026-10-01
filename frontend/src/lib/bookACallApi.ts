import { sessionFetch } from "@/lib/adminTransport";
import { ApiError } from "@/lib/api";
import type { CoachingSlot } from "@/lib/coachingApi";

/**
 * The public booking client — `/api/book-a-call` (routes/public/bookACall.ts).
 *
 * No account is involved: a visitor picks a time, answers the intake questions
 * and is booked. The booking comes back with a secret `token`, which is what
 * the "manage your booking" link in their email carries.
 */

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "/api";

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  const res = await sessionFetch(`${API_BASE}${path}`, { ...options, headers });

  if (!res.ok) {
    let message = "Something went wrong. Please try again in a moment.";
    const fieldErrors: Record<string, string> = {};
    try {
      const parsed = (await res.json()) as {
        error?: string;
        message?: string;
        details?: { fieldErrors?: Record<string, string[] | undefined> };
      };
      message = parsed.error ?? parsed.message ?? message;
      for (const [field, messages] of Object.entries(parsed.details?.fieldErrors ?? {})) {
        const first = messages?.[0];
        if (first) fieldErrors[field] = first;
      }
    } catch {
      // A non-JSON body tells us nothing worth showing.
    }
    throw new ApiError(message, res.status, fieldErrors);
  }

  return (await res.json()) as T;
}

export type CallQuestionType = "text" | "textarea" | "radio" | "checkbox";

export interface CallQuestion {
  id: string;
  label: string;
  type: CallQuestionType;
  required: boolean;
  options: string[];
}

export interface CallSummary {
  slug: string;
  title: string;
  summary: string;
  durationMinutes: number;
  priceCents: number;
  /** "Complimentary" or "$650". */
  priceLabel: string;
  free: boolean;
  locationLabel: string;
  featured: boolean;
  listed: boolean;
  /** False for a paid session that cannot be booked online yet. */
  bookable: boolean;
  /** The zone Yvette keeps her calendar in. */
  hostTimezone: string;
  horizonDays: number;
}

export interface CallDetail extends CallSummary {
  descriptionMd: string;
  questions: CallQuestion[];
  minimumNoticeMinutes: number;
}

export interface CallSlots {
  timezone: string;
  from: string;
  to: string;
  horizonDays: number;
  slots: CoachingSlot[];
}

export interface CallAnswer {
  id: string;
  label: string;
  answer: string | string[];
}

export interface CallBooking {
  callSlug: string;
  callTitle: string;
  startsAt: string;
  durationMinutes: number;
  status: string;
  cancelled: boolean;
  canCancel: boolean;
  timezone: string;
  hostTimezone: string;
  meetingUrl: string;
  locationLabel: string;
  name: string;
  email: string;
  answers: CallAnswer[];
  token: string;
  icsUrl: string;
  manageUrl: string;
}

export interface BookCallInput {
  startsAt: string;
  name: string;
  email: string;
  timezone: string;
  answers: Record<string, string | string[]>;
  company: string;
  elapsedMs: number;
}

const enc = encodeURIComponent;

export const bookACallApi = {
  list: () => request<{ calls: CallSummary[] }>("/book-a-call"),
  get: (slug: string) => request<{ call: CallDetail }>(`/book-a-call/types/${enc(slug)}`),
  slots: (slug: string, params: { from: string; to: string; timezone: string }) =>
    request<CallSlots>(
      `/book-a-call/types/${enc(slug)}/slots?from=${enc(params.from)}&to=${enc(params.to)}&timezone=${enc(
        params.timezone,
      )}`,
    ),
  book: (slug: string, input: BookCallInput) =>
    request<{ booking: CallBooking | null; message: string }>(`/book-a-call/types/${enc(slug)}/book`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  booking: (token: string) => request<{ booking: CallBooking }>(`/book-a-call/bookings/${enc(token)}`),
  cancel: (token: string, reason: string) =>
    request<{ booking: CallBooking; message: string }>(`/book-a-call/bookings/${enc(token)}/cancel`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    }),
};
