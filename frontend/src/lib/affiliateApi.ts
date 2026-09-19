import { sessionFetch } from "@/lib/adminTransport";
import { saveCsv } from "@/lib/formsApi";
import { memberRequest } from "@/lib/memberApi";

/**
 * The partner program's client, across all three surfaces it touches.
 *
 * One file rather than three because the types are shared — a commission means
 * the same thing to the partner reading their statement and to the owner
 * approving the payout — and a second copy of that shape is how the two screens
 * end up disagreeing about what "earned" includes.
 *
 * The three helpers differ only in who they authenticate as: the partner portal
 * rides the member session, the application form is anonymous, and the console
 * uses the admin session cookie. None of them re-implements refresh or error parsing;
 * the member side delegates to `memberRequest` for exactly that reason.
 *
 * Every money field is cents, and every `percent` is a real percentage (30, not
 * 3000): the server converts basis points at its own boundary so no screen has
 * to know they exist.
 */

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "/api";

export class AffiliateApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function parseError(res: Response): Promise<AffiliateApiError> {
  let message = "Something went wrong. Please try again in a moment.";
  try {
    const body = (await res.json()) as { error?: string; message?: string };
    message = body.error ?? body.message ?? message;
  } catch {
    // A non-JSON error page keeps the readable default.
  }
  return new AffiliateApiError(message, res.status);
}

/** Anonymous — the public application form and the program's own pitch. */
async function publicRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type") && !(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  const res = await sessionFetch(`${API_BASE}${path}`, { ...init, headers });
  if (!res.ok) throw await parseError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Admin requests share cookie transport with the rest of the console. */
async function adminRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type") && !(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  const res = await sessionFetch(`${API_BASE}${path}`, { ...init, headers });
  if (!res.ok) throw await parseError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/* ------------------------------------------------------------------ types */

/**
 * A commission described rather than encoded.
 *
 * `label` is the server's own wording ("30% of each sale"), and screens render
 * it instead of assembling their own from `kind` and the number — two places
 * spelling the same fact is how one of them drifts.
 */
export interface CommissionDescription {
  kind: "percent" | "fixed" | "none";
  percent?: number;
  amountCents?: number;
  label: string;
}

export interface ProgramSummary {
  pitchMd: string;
  termsMd: string;
  commission: { kind: "percent" | "fixed"; percent?: number; amountCents?: number };
  cookieWindowDays: number;
  recurring: boolean;
}

export interface PartnerOverview {
  partner: {
    name: string;
    email: string;
    status: string;
    code: string;
    shareLink: string;
    payoutMethod: string;
    payoutDetails: string;
  } | null;
  program?: {
    commission: { kind: "percent" | "fixed"; percent?: number; amountCents?: number };
    cookieWindowDays: number;
    termsMd: string;
  };
  commission?: { kind: "percent" | "fixed"; percent?: number; amountCents?: number };
  recurring?: boolean;
  cookieWindowDays?: number;
  holdDays?: number;
  termsMd?: string;
  stats?: {
    clicks: number;
    referred: number;
    earnedCents: number;
    paidCents: number;
    payableCents: number;
    pendingCents: number;
  };
}

export interface PartnerLink {
  id: number;
  label: string;
  destinationPath: string;
  offerTitle?: string | null;
  clicks: number;
  createdAt: string;
  url: string;
}

export interface PartnerAsset {
  id: number;
  title: string;
  kind: string;
  url: string;
  bodyMd: string;
  offerTitle: string | null;
}

export interface PartnerAnnouncement {
  id: number;
  title: string;
  bodyMd: string;
  publishedAt: string | null;
}

export interface CommissionRow {
  id: string;
  kind: string;
  status: string;
  amountCents: number;
  basisCents: number;
  currency: string;
  payableAt: string | null;
  createdAt: string;
  offerTitle: string | null;
}

export interface PayoutRow {
  id: number;
  amountCents: number;
  currency: string;
  method: string;
  reference: string;
  status: string;
  periodStart: string | null;
  periodEnd: string | null;
  paidAt: string | null;
  createdAt: string;
}

/* ------------------------------------------------------------ public API */

export const publicAffiliateApi = {
  program: () => publicRequest<ProgramSummary>("/affiliates/program"),

  apply: (input: {
    name: string;
    email: string;
    audience?: string;
    website?: string;
    payoutMethod?: string;
    payoutDetails?: string;
    acceptedTerms: boolean;
  }) =>
    publicRequest<{ status: string; message: string; autoApproved: boolean }>(
      "/affiliates/apply",
      { method: "POST", body: JSON.stringify(input) }
    ),
};

/* ------------------------------------------------------------ member API */

export const memberAffiliateApi = {
  overview: () => memberRequest<PartnerOverview>("/member/affiliate"),

  links: () => memberRequest<{ links: PartnerLink[] }>("/member/affiliate/links"),

  createLink: (input: { label?: string; destinationPath: string }) =>
    memberRequest<PartnerLink>("/member/affiliate/links", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  deleteLink: (id: number) =>
    memberRequest<void>(`/member/affiliate/links/${id}`, { method: "DELETE" }),

  assets: () => memberRequest<{ assets: PartnerAsset[] }>("/member/affiliate/assets"),

  announcements: () =>
    memberRequest<{ announcements: PartnerAnnouncement[] }>("/member/affiliate/announcements"),

  transactions: (params: { limit?: number; offset?: number } = {}) => {
    const qs = new URLSearchParams();
    if (params.limit) qs.set("limit", String(params.limit));
    if (params.offset) qs.set("offset", String(params.offset));
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return memberRequest<{ transactions: CommissionRow[]; total: number }>(
      `/member/affiliate/transactions${suffix}`
    );
  },

  payouts: () => memberRequest<{ payouts: PayoutRow[] }>("/member/affiliate/payouts"),

  savePayoutDetails: (input: { payoutMethod: string; payoutDetails: string }) =>
    memberRequest<{ payoutMethod: string; payoutDetails: string }>(
      "/member/affiliate/payout-details",
      { method: "PUT", body: JSON.stringify(input) }
    ),
};

/* ------------------------------------------------------------- admin API */

export interface AdminPartner {
  id: number;
  name: string;
  email: string;
  code: string;
  status: string;
  commission: CommissionDescription;
  clicks: number;
  sales: number;
  earnedCents: number;
  paidCents: number;
  owedCents: number;
  shareLink: string;
  appliedAt: string;
}

export interface AdminPartnerDetail {
  partner: AdminPartner & {
    rejectedReason: string;
    commissionKind: "percent" | "fixed";
    commissionPercent: number;
    commissionAmountCents: number;
    payOnEveryRenewal: boolean;
    cookieWindowDays: number;
    payoutMethod: string;
    payoutDetails: string;
    notes: string;
    approvedAt: string | null;
  };
  rules: {
    id: number;
    offerId: number | null;
    offerTitle: string | null;
    appliesTo: string;
    commission: CommissionDescription;
    commissionKind: "percent" | "fixed" | "none";
    commissionPercent: number;
    commissionAmountCents: number;
    payOnEveryRenewal: boolean;
  }[];
  orders: {
    id: number;
    customerEmail: string;
    status: string;
    totalCents: number;
    offerTitle: string | null;
    createdAt: string;
  }[];
}

export interface ProgramSettings {
  whoGetsCredit: "last_click" | "first_click";
  cookieWindowDays: number;
  holdDays: number;
  commissionKind: "percent" | "fixed";
  commissionPercent: number;
  commissionAmountCents: number;
  payOnEveryRenewal: boolean;
  autoApprove: boolean;
  landingPath: string;
  termsMd: string;
  pitchMd: string;
}

export interface AdminCommissionRow extends CommissionRow {
  affiliateId: number;
  partnerName: string;
  orderId: number | null;
  customerEmail: string | null;
}

export interface PayoutDue {
  affiliateId: number;
  name: string;
  email: string;
  payoutMethod: string;
  payoutDetails: string;
  amountCents: number;
  currency: string;
  commissionCount: number;
}

export const adminAffiliateApi = {
  list: (params: { status?: string; q?: string } = {}) => {
    const qs = new URLSearchParams();
    if (params.status) qs.set("status", params.status);
    if (params.q) qs.set("q", params.q);
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return adminRequest<{ partners: AdminPartner[] }>(`/admin/affiliates${suffix}`);
  },

  detail: (id: number) => adminRequest<AdminPartnerDetail>(`/admin/affiliates/${id}`),

  update: (
    id: number,
    input: Partial<{
      name: string;
      commissionKind: "percent" | "fixed";
      commissionPercent: number;
      commissionAmountCents: number;
      payOnEveryRenewal: boolean;
      cookieWindowDays: number;
      payoutMethod: string;
      payoutDetails: string;
      notes: string;
    }>
  ) =>
    adminRequest<{ id: number }>(`/admin/affiliates/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),

  approve: (id: number) =>
    adminRequest<{ id: number; status: string; shareLink: string }>(
      `/admin/affiliates/${id}/approve`,
      { method: "POST" }
    ),

  reject: (id: number, input: { reason?: string; suspend?: boolean } = {}) =>
    adminRequest<{ id: number; status: string }>(`/admin/affiliates/${id}/reject`, {
      method: "POST",
      body: JSON.stringify(input),
    }),

  settings: () => adminRequest<ProgramSettings>("/admin/affiliates/settings"),

  saveSettings: (input: Partial<ProgramSettings>) =>
    adminRequest<ProgramSettings>("/admin/affiliates/settings", {
      method: "PUT",
      body: JSON.stringify(input),
    }),

  leaderboard: () =>
    adminRequest<{
      partners: {
        id: number;
        name: string;
        email: string;
        clicks: number;
        sales: number;
        earnedCents: number;
        revenueCents: number;
      }[];
    }>("/admin/affiliates/leaderboard"),

  transactions: (params: { affiliateId?: number; status?: string; limit?: number } = {}) => {
    const qs = new URLSearchParams();
    if (params.affiliateId) qs.set("affiliateId", String(params.affiliateId));
    if (params.status) qs.set("status", params.status);
    if (params.limit) qs.set("limit", String(params.limit));
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return adminRequest<{ transactions: AdminCommissionRow[]; total: number }>(
      `/admin/affiliates/transactions${suffix}`
    );
  },

  payoutsDue: () =>
    adminRequest<{ due: PayoutDue[]; totalCents: number }>("/admin/affiliates/payouts/due"),

  payouts: () =>
    adminRequest<{
      payouts: (PayoutRow & { affiliateId: number; name: string; email: string })[];
    }>("/admin/affiliates/payouts"),

  createPayout: (input: { affiliateId: number; method?: string; reference?: string }) =>
    adminRequest<{ id: number; amountCents: number; commissionCount: number }>(
      "/admin/affiliates/payouts",
      { method: "POST", body: JSON.stringify(input) }
    ),

  markPayoutPaid: (id: number, input: { reference?: string; method?: string } = {}) =>
    adminRequest<{ id: number; status: string }>(`/admin/affiliates/payouts/${id}/paid`, {
      method: "POST",
      body: JSON.stringify(input),
    }),

  /**
   * The payment file.
   *
   * Cookie transport refreshes before fetching the spreadsheet bytes.
   */
  exportPayments: async (): Promise<void> => {
    const res = await sessionFetch(`${API_BASE}/admin/affiliates/payouts/export.csv`);
    if (!res.ok) throw await parseError(res);

    const blob = await res.blob();
    saveCsv(blob, `partner-payments-${new Date().toISOString().slice(0, 10)}.csv`);
  },

  announcements: () =>
    adminRequest<{
      announcements: {
        id: number;
        title: string;
        bodyMd: string;
        published: boolean;
        publishedAt: string | null;
        createdAt: string;
      }[];
    }>("/admin/affiliates/announcements"),

  createAnnouncement: (input: { title: string; bodyMd: string; published: boolean }) =>
    adminRequest<{ id: number }>("/admin/affiliates/announcements", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  updateAnnouncement: (
    id: number,
    input: Partial<{ title: string; bodyMd: string; published: boolean }>
  ) =>
    adminRequest<{ id: number }>(`/admin/affiliates/announcements/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),

  deleteAnnouncement: (id: number) =>
    adminRequest<void>(`/admin/affiliates/announcements/${id}`, { method: "DELETE" }),

  assets: () =>
    adminRequest<{
      assets: {
        id: number;
        title: string;
        kind: string;
        url: string;
        bodyMd: string;
        offerId: number | null;
        offerTitle: string | null;
        sort: number;
      }[];
    }>("/admin/affiliates/assets"),

  createAsset: (input: {
    title: string;
    kind: string;
    url: string;
    bodyMd: string;
    offerId: number | null;
    sort: number;
  }) =>
    adminRequest<{ id: number }>("/admin/affiliates/assets", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  updateAsset: (
    id: number,
    input: Partial<{
      title: string;
      kind: string;
      url: string;
      bodyMd: string;
      offerId: number | null;
      sort: number;
    }>
  ) =>
    adminRequest<{ id: number }>(`/admin/affiliates/assets/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),

  deleteAsset: (id: number) =>
    adminRequest<void>(`/admin/affiliates/assets/${id}`, { method: "DELETE" }),

  saveRule: (input: {
    affiliateId: number | null;
    offerId: number | null;
    kind: "percent" | "fixed" | "none";
    percent?: number;
    amountCents?: number;
    payOnEveryRenewal?: boolean;
  }) =>
    adminRequest<{ id: number }>("/admin/affiliates/rules", {
      method: "PUT",
      body: JSON.stringify(input),
    }),

  deleteRule: (id: number) =>
    adminRequest<void>(`/admin/affiliates/rules/${id}`, { method: "DELETE" }),
};
