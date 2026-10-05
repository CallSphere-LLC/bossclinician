import { sessionFetch } from "@/lib/adminTransport";
import { ApiError } from "@/lib/api";
import type { CatalogStatus, Offer, OfferPricingOption } from "@/lib/adminCommerceApi";
import type { CoachingRosterClient } from "@/lib/coachingRoster";

/**
 * The admin side of coaching: a session's files, and the Clients tab's roster.
 *
 * `lib/coachingApi.ts` is the member's client; this is the coach's. Kept off
 * `lib/api.ts` because that file is shared by every other screen in the
 * console, and these carry a couple of small shapes. The roster's shape lives
 * in `lib/coachingRoster.ts`, beside the pure code that turns it into rows.
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

/**
 * An offer that includes a coaching program: the columns the offers list shows
 * for it, and nothing the program's Offers tab doesn't draw.
 */
export type CoachingProgramOffer = Pick<
  Offer,
  | "id"
  | "title"
  | "slug"
  | "currency"
  | "pricingType"
  | "amountCents"
  | "minAmountCents"
  | "interval"
  | "intervalCount"
  | "installmentCount"
  | "trialDays"
  | "purchaseCount"
> & {
  /** Kajabi's "Internal Title"; '' when she hasn't set one. */
  internalTitle: string;
  status: CatalogStatus;
  /** The other ways to pay on the same checkout — a payment plan beside the full price. */
  pricingOptions: Pick<
    OfferPricingOption,
    | "id"
    | "label"
    | "pricingType"
    | "amountCents"
    | "minAmountCents"
    | "currency"
    | "interval"
    | "intervalCount"
    | "installmentCount"
    | "trialDays"
    | "recommended"
  >[];
  /** The bundle the program comes inside, or null when the offer includes it directly. */
  bundleTitle: string | null;
};

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
  /** The Clients tab: everyone in a coaching program, one entry per person. */
  roster: () => request<{ clients: CoachingRosterClient[] }>(`/admin/growth/coaching/roster`),
  /** A program's Offers tab: every offer that includes it, live ones first. */
  programOffers: (programId: number) =>
    request<CoachingProgramOffer[]>(`/admin/coaching/programs/${programId}/offers`),
};
