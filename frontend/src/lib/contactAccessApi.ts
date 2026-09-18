import { sessionFetch } from "@/lib/adminTransport";
import { ApiError } from "@/lib/api";

/**
 * What one person can get into, and the two things an admin can do about it.
 *
 * Granting and revoking go through the offers endpoints that have existed since
 * the offers screen was built — so access given from a person's page expands
 * bundles, honours expiry and is written to the activity log exactly as it
 * would be from anywhere else.
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

  return (await res.json()) as T;
}

export interface AccessGrant {
  id: number;
  memberId: number;
  productId: number;
  productTitle: string;
  /** Null when the offer has since been deleted, or the product was given on its own. */
  offerId: number | null;
  offerTitle: string | null;
  /** purchase, manual, automation, bundle, affiliate or import. */
  source: string;
  /** active, revoked or expired. */
  status: string;
  grantedAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  revokeReason: string;
}

export interface ContactAccess {
  /** The accounts behind this person. Usually one; none until they buy or are given something. */
  members: { id: number; email: string; status: string }[];
  grants: AccessGrant[];
}

/** Name the account by id when there is one; an address creates the account if it is missing. */
export type MemberRef = { memberId: number } | { email: string };

export interface GrantOutcome {
  memberId: number;
  email: string;
  memberCreated: boolean;
  productIds: number[];
  productCount: number;
  /** Whether the welcome email really went — the transport's answer, not a guess. */
  welcomeSent: boolean;
}

export interface RevokeOutcome {
  memberId: number;
  email: string;
  revokedCount: number;
}

export const contactAccessApi = {
  get: (contactId: number) => request<ContactAccess>(`/admin/contact-access/${contactId}`),
  grant: (offerId: number, who: MemberRef) =>
    request<GrantOutcome>(`/admin/offers/${offerId}/grant`, {
      method: "POST",
      body: JSON.stringify(who),
    }),
  revoke: (offerId: number, who: MemberRef, reason = "") =>
    request<RevokeOutcome>(`/admin/offers/${offerId}/revoke`, {
      method: "POST",
      body: JSON.stringify({ ...who, reason }),
    }),
};
