import { ApiError, getToken } from "@/lib/api";

/**
 * Contacts, tags and groups — the admin client for the one list of people.
 *
 * Kept off `lib/api.ts` because that file is shared by every other screen in
 * the console; this one carries only the audience shapes and the vocabulary the
 * four contact screens speak.
 *
 * That vocabulary is the other reason this file exists. The database keeps
 * `email_marketing_status`, slugs, offer ids and integers of cents; the owner
 * reads "Happy to hear from you", a tag's name, an offer's title and a dollar
 * amount. Every translation between the two lives here, so the list, the
 * profile, the tag screen and the group builder cannot drift into saying the
 * same thing three different ways.
 */

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "/api";

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers = new Headers(options.headers);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });

  if (!res.ok) {
    // The status travels on the error and the screens turn it into something
    // she can act on; this default is the last resort, so it says what to do
    // rather than what broke.
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

/* ── Shapes ─────────────────────────────────────────────────────────────── */

export interface ContactTag {
  slug: string;
  name: string;
  colour: string;
}

export type EmailStatus =
  | "subscribed"
  | "opted_out"
  | "bounced"
  | "complained"
  | "unconfirmed";

export interface Contact {
  id: number;
  email: string;
  name: string;
  firstName: string;
  lastName: string;
  phone: string;
  timezone: string;
  emailMarketingStatus: EmailStatus;
  optedInAt: string | null;
  optedOutAt: string | null;
  consentSource: string;
  lifetimeValueCents: number;
  orderCount: number;
  lastActivityAt: string | null;
  lastOrderedAt: string | null;
  source: string;
  customFields: Record<string, unknown>;
  notes: string;
  createdAt: string;
  updatedAt: string;
  tags: ContactTag[];
}

export interface ContactActivity {
  id: string;
  kind: string;
  title: string;
  body: string;
  subjectType: string;
  subjectId: string;
  meta: Record<string, unknown>;
  occurredAt: string;
}

export interface ContactOrder {
  id: number;
  status: string;
  currency: string;
  createdAt: string;
  totalCents: number;
  refundedCents: number;
  title: string;
}

export interface ContactDetail extends Contact {
  activity: ContactActivity[];
  orders: ContactOrder[];
  memberId: number | null;
  leadCount: number;
  subscribed: boolean;
}

export interface ContactPage {
  items: Contact[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ContactInsights {
  contacts: number;
  newContacts: number;
  subscribed: number;
  newSubscribers: number;
  customers: number;
  newCustomers: number;
  manuallyUnsubscribed: number;
  optedOut: number;
  bounced: number;
  complained: number;
  neverSubscribed: number;
  engagement: { healthy: number; passive: number; unengaged: number; inactive: number };
}

export interface Tag {
  id: number;
  name: string;
  slug: string;
  colour: string;
  description: string;
  contactCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface SegmentRule {
  field: string;
  op: string;
  value: string | number;
}

export interface SegmentDefinition {
  match: "all" | "any";
  rules: SegmentRule[];
}

export interface Segment {
  id: number;
  name: string;
  slug: string;
  description: string;
  definition: SegmentDefinition;
  contactCount: number;
  countedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SegmentPerson {
  id: number;
  email: string;
  name: string;
  emailMarketingStatus: EmailStatus;
  lifetimeValueCents: number;
  orderCount: number;
  lastActivityAt: string | null;
}

export interface SegmentOptions {
  tags: { slug: string; name: string }[];
  offers: { id: number; title: string }[];
  sequences: { id: number; name: string }[];
}

export interface ImportOutcome {
  created: number;
  updated: number;
  skipped: number;
  errors: { row: number; email?: string; message: string }[];
}

export interface ContactFilters {
  q?: string;
  tag?: string;
  status?: EmailStatus;
  untagged?: boolean;
  audience?: "new" | "subscribed" | "new_subscriber" | "customer" | "new_customer";
  optOut?: "manual" | "self";
  engagement?: "healthy" | "passive" | "unengaged" | "inactive";
  sort?: "recent" | "newest" | "oldest" | "name" | "value" | "orders";
  page?: number;
  limit?: number;
}

function toQuery(filters: ContactFilters): string {
  const qs = new URLSearchParams();
  if (filters.q) qs.set("q", filters.q);
  if (filters.tag) qs.set("tag", filters.tag);
  if (filters.status) qs.set("status", filters.status);
  if (filters.untagged) qs.set("untagged", "true");
  if (filters.audience) qs.set("audience", filters.audience);
  if (filters.optOut) qs.set("optOut", filters.optOut);
  if (filters.engagement) qs.set("engagement", filters.engagement);
  if (filters.sort) qs.set("sort", filters.sort);
  if (filters.page) qs.set("page", String(filters.page));
  if (filters.limit) qs.set("limit", String(filters.limit));
  const query = qs.toString();
  return query ? `?${query}` : "";
}

/* ── Calls ──────────────────────────────────────────────────────────────── */

export const contactsApi = {
  insights: () => request<ContactInsights>("/admin/contacts/insights"),
  list: (filters: ContactFilters = {}) =>
    request<ContactPage>(`/admin/contacts${toQuery(filters)}`),
  get: (id: number) => request<ContactDetail>(`/admin/contacts/${id}`),
  export: (id: number) => request<Record<string, unknown>>(`/admin/contacts/${id}/export`),
  create: (data: {
    email: string;
    firstName?: string;
    lastName?: string;
    phone?: string;
    notes?: string;
    tagSlugs?: string[];
  }) => request<Contact>("/admin/contacts", { method: "POST", body: JSON.stringify(data) }),
  update: (
    id: number,
    data: {
      firstName?: string;
      lastName?: string;
      name?: string;
      phone?: string;
      notes?: string;
      emailMarketingStatus?: EmailStatus;
    },
  ) => request<Contact>(`/admin/contacts/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  remove: (id: number) => request<void>(`/admin/contacts/${id}`, { method: "DELETE" }),

  addTags: (id: number, tagSlugs: string[]) =>
    request<Contact>(`/admin/contacts/${id}/tags`, {
      method: "POST",
      body: JSON.stringify({ tagSlugs }),
    }),
  removeTag: (id: number, slug: string) =>
    request<Contact>(`/admin/contacts/${id}/tags/${encodeURIComponent(slug)}`, {
      method: "DELETE",
    }),
  bulkTags: (contactIds: number[], tagSlugs: string[], action: "add" | "remove") =>
    request<{ changed: number; contacts: number }>("/admin/contacts/bulk/tags", {
      method: "POST",
      body: JSON.stringify({ contactIds, tagSlugs, action }),
    }),
  bulkSequence: (contactIds: number[], sequenceId: number) =>
    request<{ enrolled: number; alreadyEnrolled: number; blocked: { contactId: number; reason: string }[] }>(
      "/admin/contacts/bulk/sequence",
      { method: "POST", body: JSON.stringify({ contactIds, sequenceId }) },
    ),
  bulkOffer: (contactIds: number[], offerId: number) =>
    request<{ granted: number }>("/admin/contacts/bulk/offer", {
      method: "POST",
      body: JSON.stringify({ contactIds, offerId }),
    }),
  bulkDelete: (contactIds: number[]) =>
    request<{ deleted: number }>("/admin/contacts/bulk/delete", {
      method: "POST",
      body: JSON.stringify({ contactIds }),
    }),
  bulkExport: async (contactIds: number[]) => {
    const token = getToken();
    const res = await fetch(`${API_BASE}/admin/contacts/bulk/export.csv`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ contactIds }),
    });
    if (!res.ok) throw new ApiError("That download didn't finish. Please try again.", res.status);
    return res.blob();
  },

  addNote: (id: number, body: string) =>
    request<{ ok: true }>(`/admin/contacts/${id}/notes`, {
      method: "POST",
      body: JSON.stringify({ body }),
    }),

  merge: (keepId: number, mergeId: number) =>
    request<Contact>("/admin/contacts/merge", {
      method: "POST",
      body: JSON.stringify({ keepId, mergeId }),
    }),

  importPeople: (rows: Record<string, string>[], tagSlugs: string[] = []) =>
    request<ImportOutcome>("/admin/contacts/import", {
      method: "POST",
      body: JSON.stringify({ rows, tagSlugs }),
    }),

  /**
   * Bypasses `request` because the answer is a spreadsheet, not JSON — the
   * shared helper would try to parse it and throw the file away.
   */
  exportCsv: async (filters: ContactFilters = {}) => {
    const token = getToken();
    const res = await fetch(`${API_BASE}/admin/contacts/export.csv${toQuery(filters)}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    if (!res.ok) {
      throw new ApiError("That download didn't finish. Please try again in a moment.", res.status);
    }
    return res.blob();
  },

  tags: () => request<Tag[]>("/admin/tags"),
  tagCreate: (data: { name: string; colour?: string; description?: string }) =>
    request<Tag>("/admin/tags", { method: "POST", body: JSON.stringify(data) }),
  tagUpdate: (id: number, data: { name?: string; colour?: string; description?: string }) =>
    request<Tag>(`/admin/tags/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  tagDelete: (id: number) => request<void>(`/admin/tags/${id}`, { method: "DELETE" }),
  tagContacts: (id: number) =>
    request<{ tag: Tag; items: SegmentPerson[]; total: number }>(`/admin/tags/${id}/contacts`),

  segments: () => request<Segment[]>("/admin/segments"),
  segmentOptions: () => request<SegmentOptions>("/admin/segments/options"),
  segmentPreview: (definition: SegmentDefinition) =>
    request<{ count: number; items: SegmentPerson[] }>("/admin/segments/preview", {
      method: "POST",
      body: JSON.stringify({ definition }),
    }),
  segmentCreate: (data: { name: string; description?: string; definition: SegmentDefinition }) =>
    request<Segment>("/admin/segments", { method: "POST", body: JSON.stringify(data) }),
  segmentUpdate: (
    id: number,
    data: { name?: string; description?: string; definition?: SegmentDefinition },
  ) => request<Segment>(`/admin/segments/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  segmentDelete: (id: number) => request<void>(`/admin/segments/${id}`, { method: "DELETE" }),
  segmentContacts: (id: number) =>
    request<{ segment: Segment; items: SegmentPerson[]; total: number }>(
      `/admin/segments/${id}/contacts`,
    ),
};

/* ── The words on screen ────────────────────────────────────────────────── */

/**
 * Whether we may email somebody, in her words.
 *
 * The stored values are the sending rules' vocabulary. "Bounced" and
 * "complained" in particular are things that happened *to* the address, and the
 * only thing she needs from them is whether mail is still going out.
 */
export const EMAIL_STATUS_LABEL: Record<EmailStatus, string> = {
  subscribed: "Happy to hear from you",
  opted_out: "Asked to stop",
  bounced: "Emails aren't arriving",
  complained: "Marked you as spam",
  unconfirmed: "Hasn't confirmed yet",
};

export const EMAIL_STATUS_TONE: Record<EmailStatus, "green" | "slate" | "red" | "gold"> = {
  subscribed: "green",
  opted_out: "slate",
  bounced: "red",
  complained: "red",
  unconfirmed: "gold",
};

/** The two statuses she can set herself. The rest are set by what the inbox did. */
export const SETTABLE_STATUSES: EmailStatus[] = ["subscribed", "opted_out"];

export function emailStatusLabel(status: string): string {
  return EMAIL_STATUS_LABEL[status as EmailStatus] ?? "Not known";
}

/**
 * A timeline entry's type → the sentence above it.
 *
 * Entries carry their own title, so this is only the heading that groups them;
 * an entry whose type we have never seen still reads as "Something happened"
 * rather than showing the raw word.
 */
export const ACTIVITY_LABEL: Record<string, string> = {
  "lead.created": "Enquiry",
  subscribed: "Mailing list",
  "account.created": "Account",
  purchase: "Purchase",
  note: "Your note",
  imported: "Added",
  created: "Added",
  merged: "Records combined",
  email_preference: "Email settings",
  "email.sent": "Email",
  "email.opened": "Email",
  "email.clicked": "Email",
};

export function activityLabel(kind: string): string {
  return ACTIVITY_LABEL[kind] ?? "Activity";
}

/** Where somebody first came from → words. Falls back to whatever was recorded. */
export function sourceLabel(source: string): string {
  const value = source.trim();
  if (!value) return "Not recorded";
  const [head, tail] = value.split(":").map((part) => part.trim());
  if (head === "lead") return tail ? `Enquiry form (${tail})` : "Enquiry form";
  if (head === "newsletter") return tail ? `Mailing list (${tail})` : "Mailing list";
  if (value === "member") return "Signed up for an account";
  if (value === "customer") return "Bought something";
  if (value === "import") return "A spreadsheet you imported";
  if (value === "subscriber") return "Mailing list";
  return value;
}

/** Cents → what she reads. Never shows a fractional cent, never shows the integer. */
export function money(cents: number, currency = "usd"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

/** What she typed in dollars → the integer the server stores. */
export function dollarsToCents(raw: string): number | null {
  const cleaned = raw.replace(/[^0-9.]/g, "").trim();
  if (!cleaned) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}
