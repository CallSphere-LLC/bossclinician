import { sessionFetch } from "@/lib/adminTransport";
import { API_BASE } from "@/lib/api";
import { AdminApiError } from "@/lib/retreatsApi";

/**
 * Admin client for retreat balance plans: a card on file plus automatic monthly
 * charges for a guest who still owes part of her retreat price.
 *
 * Server: backend/src/routes/admin/retreatBalancePlans.ts. Kept apart from
 * retreatsApi.ts because that file is shared with the guest dashboard.
 */

export type BalancePlanState = "draft" | "open" | "card_on_file" | "billing" | "past_due" | "completed" | "canceled";

export type BalancePlanStoredStatus = "draft" | "open" | "card_on_file" | "billing" | "completed" | "canceled";

export interface BalancePlanScheduleRow {
  sequence: number;
  amountCents: number;
  /** YYYY-MM-DD */
  dueDate: string;
  status: "scheduled" | "paid" | "failed" | "skipped";
}

export interface AdminBalancePlan {
  id: number;
  retreatId: number;
  memberId: number;
  memberName: string;
  memberEmail: string;
  /** Room price after any discount. */
  agreedTotalCents: number;
  /** Display only: already taken off `agreedTotalCents`. */
  discountCents: number;
  discountNote: string;
  /** Paid before this plan, outside this site (Kajabi). */
  priorPaidCents: number;
  installmentCents: number;
  installmentCount: number;
  /** YYYY-MM-DD */
  firstChargeOn: string;
  /** YYYY-MM-DD */
  finalDueOn: string | null;
  currency: string;
  /** The stored column. Screens read `state`, which also knows about a failed charge. */
  status: BalancePlanStoredStatus;
  state: BalancePlanState;
  isTest: boolean;
  cardBrand: string | null;
  cardLast4: string | null;
  authorizedAt: string | null;
  authorizationText: string;
  cardAddedAt: string | null;
  billingStartedAt: string | null;
  ownerNotifiedAt: string | null;
  requestEmailSentAt: string | null;
  lastError: string;
  paidHereCents: number;
  remainingCents: number;
  schedule: BalancePlanScheduleRow[];
  stripeSubscriptionId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Body of the create-or-update call. Money in cents, dates as YYYY-MM-DD. */
export interface BalancePlanInput {
  agreedTotalCents: number;
  discountCents: number;
  discountNote: string;
  priorPaidCents: number;
  installmentCents: number;
  installmentCount: number;
  firstChargeOn: string;
  finalDueOn: string | null;
  isTest: boolean;
}

/** The "add your card" email exactly as the server would send it now. */
export interface BalancePlanEmailPreview {
  subject: string;
  html: string;
  text: string;
  /** The address it goes to: the guest's account email, as the server reads it. */
  to: string;
  /** Where her reply goes (the retreat's support address). "" when none is set. */
  replyTo: string;
  /** Why it cannot be sent yet, one sentence each. Empty when it can. The server refuses the send while any exist. */
  blockers: string[];
}

/**
 * Same transport and error shape as the retreat admin client. The write routes'
 * response bodies are not relied on (the screen reloads the list after every
 * action), so an empty or non-JSON success body is accepted.
 */
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type") && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
  const response = await sessionFetch(`${API_BASE}${path}`, { ...init, headers });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string; details?: Record<string, unknown> };
    throw new AdminApiError(body.error || "Something went wrong. Please try again in a moment.", response.status, body.details ?? null);
  }
  const text = await response.text().catch(() => "");
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined as T;
  }
}

const base = (retreatId: number) => `/admin/retreats/${retreatId}/balance-plans`;
const one = (retreatId: number, memberId: number) => `${base(retreatId)}/${memberId}`;

export const retreatBalancePlansAdminApi = {
  list: async (retreatId: number): Promise<AdminBalancePlan[]> => {
    const body = await request<{ plans?: AdminBalancePlan[] } | undefined>(base(retreatId));
    // Never read an unexpected answer as "nobody has a plan": a guest who is being charged would show "No plan".
    if (!body || !Array.isArray(body.plans)) throw new Error("The payment plans did not load properly. Please refresh the page.");
    return body.plans;
  },
  /** Creates or updates. The server allows it only while no card is on file; saving a cancelled plan returns it to draft. */
  save: (retreatId: number, memberId: number, input: BalancePlanInput) =>
    request<unknown>(one(retreatId, memberId), { method: "PUT", body: JSON.stringify(input) }),
  /** Draft to open: the guest now sees the card form. */
  open: (retreatId: number, memberId: number) => request<unknown>(`${one(retreatId, memberId)}/open`, { method: "POST" }),
  /** Open back to draft: hidden from the guest again. */
  close: (retreatId: number, memberId: number) => request<unknown>(`${one(retreatId, memberId)}/close`, { method: "POST" }),
  /** Stops future charges. Never refunds. */
  cancel: (retreatId: number, memberId: number) => request<unknown>(`${one(retreatId, memberId)}/cancel`, { method: "POST" }),
  requestEmailPreview: async (retreatId: number, memberId: number): Promise<BalancePlanEmailPreview> => {
    const body = await request<Partial<BalancePlanEmailPreview> | undefined>(`${one(retreatId, memberId)}/request-email`);
    // An empty answer must not read as "nothing is stopping the send".
    if (!body || typeof body.subject !== "string") throw new Error("The email preview did not load properly. Please try again.");
    return {
      subject: body.subject,
      html: typeof body.html === "string" ? body.html : "",
      text: typeof body.text === "string" ? body.text : "",
      to: typeof body.to === "string" ? body.to : "",
      replyTo: typeof body.replyTo === "string" ? body.replyTo : "",
      blockers: Array.isArray(body.blockers) ? body.blockers.filter((item): item is string => typeof item === "string") : [],
    };
  },
  sendRequestEmail: (retreatId: number, memberId: number) =>
    request<unknown>(`${one(retreatId, memberId)}/request-email`, { method: "POST" }),
};
