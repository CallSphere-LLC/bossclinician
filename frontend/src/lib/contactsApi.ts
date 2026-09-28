import { sessionFetch } from "@/lib/adminTransport";
import { ApiError } from "@/lib/api";
import type { ImportRow } from "@/lib/peopleSpreadsheet";

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
  const headers = new Headers(options.headers);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  const res = await sessionFetch(`${API_BASE}${path}`, { ...options, headers });

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

/**
 * The five states a saved segment's rule can name (services/segments.ts), and
 * the ones an administrator can move somebody between.
 */
export type EmailStatus =
  | "subscribed"
  | "opted_out"
  | "bounced"
  | "complained"
  | "unconfirmed";

/**
 * Every state a contact can be in: the five above, plus Kajabi's "Never
 * subscribed" (migration 075) — never agreed to marketing, which is not the
 * same as having opted out. No sending gate mails it. Kept a separate type so
 * the saved-segment rule menu (Segments.tsx), which the server doesn't accept
 * it in yet, doesn't start offering it.
 */
export type MarketingStatus = EmailStatus | "never_subscribed";

export interface ContactCommunity {
  id: number;
  communityId: number;
  name: string;
  role: string;
  joinedAt: string;
  banned: boolean;
  memberActive: boolean;
}

export interface Contact {
  id: number;
  email: string;
  name: string;
  firstName: string;
  lastName: string;
  phone: string;
  timezone: string;
  emailMarketingStatus: MarketingStatus;
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
  communities: ContactCommunity[];
  /**
   * The account behind this person, on every contact read.
   *
   * Here because the mailing-list status alone was misleading: a member who has
   * never confirmed their email is blocked from posting, commenting and earning
   * points, while their consent row happily says "subscribed" — which is how a
   * contact card came to read "Happy to hear from you" about somebody locked out
   * of the community. Two stores, one question; see
   * backend/src/services/emailConfirmation.ts.
   */
  accountMemberId: number | null;
  accountEmailVerifiedAt: string | null;
  /**
   * A team or test account (migration 075). Left out of the list, its count,
   * the segments and Insights, and badged on its own card.
   */
  isInternal: boolean;
  /**
   * Kajabi's "Opt-in status": when they confirmed the email-marketing double
   * opt-in. Not the account's email verification — that is
   * `accountEmailVerifiedAt`, and the two used to be confused (QA rows 26/27).
   */
  optInConfirmedAt: string | null;
}

export type ConfirmationState = "confirmed" | "unconfirmed" | "list_unconfirmed" | "no_account";

/** Both confirmation stores, reconciled by the server into one answer. */
export interface ContactConfirmation {
  state: ConfirmationState;
  confirmed: boolean;
  /** Whether they can post, comment and earn points right now. */
  canPost: boolean;
  label: string;
  detail: string;
  contactStatus: string;
  memberId: number | null;
  accountConfirmedAt: string | null;
}

export interface ContactActivity {
  /** An activity row's number, or `email-83`, `tag-4`… for moments read from their own tables. */
  id: string;
  kind: string;
  title: string;
  body: string;
  subjectType: string;
  subjectId: string;
  meta: Record<string, unknown>;
  occurredAt: string;
  /** Kajabi's event type, for "Filter by event type"; null for moments Kajabi has no type for. */
  eventType: LifecycleEventType | null;
  /** The sentence Kajabi would print: "Purchased …", "Opted Into …", "Was broadcasted by …". */
  headline: string;
}

/** Kajabi's Lifecycle "Filter by event type" menu, in its order. The server files every moment under one. */
export const LIFECYCLE_EVENT_TYPES = [
  "Form Submission",
  "Email Delivery",
  "Email Sequence Subscription",
  "Offer Purchase",
  "Offer Grant",
  "Event Registration",
  "Assessment Result",
  "Expert Agent Chat",
  "Contact Created",
  "Tag Added",
  "Automation Enrollment",
] as const;

export type LifecycleEventType = (typeof LIFECYCLE_EVENT_TYPES)[number];

export interface ContactOrder {
  id: number;
  status: string;
  currency: string;
  createdAt: string;
  totalCents: number;
  refundedCents: number;
  amountCents: number;
  title: string;
  offerId: number | null;
  /** "checkout", "manual", "kajabi", … */
  source: string;
  notes: string;
  /** Imported Kajabi payments carry their Kajabi order number here. */
  customFieldData: Record<string, unknown> | null;
}

export interface ManualPurchaseInput {
  title: string;
  amountCents: number;
  currency?: string;
  paidAt?: string;
  note?: string;
}

export interface ContactDetail extends Contact {
  activity: ContactActivity[];
  orders: ContactOrder[];
  memberId: number | null;
  leadCount: number;
  subscribed: boolean;
  confirmation: ContactConfirmation;
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
  /**
   * People who haven't confirmed their email, counted across BOTH stores —
   * the mailing list's double opt-in and the account's own confirmation. The
   * People filter this number links to uses the same predicate, so the tile and
   * the list it opens cannot disagree.
   */
  neverSubscribed: number;
  /** Kajabi's "Never subscribed" status — never agreed to marketing at all. */
  neverOptedIn: number;
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
  emailMarketingStatus: MarketingStatus;
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

/** Kajabi's sort menu, by the keys the server knows (services/contactFilters.ts). */
export type ContactSort =
  | "name_asc"
  | "name_desc"
  | "email_asc"
  | "email_desc"
  | "value_desc"
  | "value_asc"
  | "added_asc"
  | "added_desc"
  | "activity_asc"
  | "activity_desc";

/** One "Filtering by:" row: [Category][Conditional][Value] (+ text for the field comparisons). */
export interface ContactFilterRow {
  category: string;
  op: string;
  value: string;
  text: string;
}

export interface ContactFilters {
  q?: string;
  tag?: string;
  status?: MarketingStatus;
  untagged?: boolean;
  community?: boolean;
  audience?: "new" | "subscribed" | "new_subscriber" | "customer" | "new_customer";
  optOut?: "manual" | "self";
  engagement?: "healthy" | "passive" | "unengaged" | "inactive";
  /** A built-in segment key, `saved-<id>`, or `team`. */
  segment?: string;
  /** Kajabi-style filter rows; they AND together. */
  filters?: ContactFilterRow[];
  /** Kajabi's ten sorts. The old words ("recent", "newest"…) are still understood by the server. */
  sort?: ContactSort | "recent" | "newest" | "oldest" | "name" | "value" | "orders";
  page?: number;
  limit?: number;
}

/** One choice in a filter's value box, as the server lists it. */
export interface FilterChoice {
  value: string;
  label: string;
  hint?: string;
}

export type FilterValueKind =
  | "none"
  | "choice"
  | "days"
  | "engagement_days"
  | "date_range"
  | "money"
  | "field"
  | "field_text";

export interface FilterConditional {
  key: string;
  label: string;
  value: FilterValueKind;
  /** Which of `options` the value box draws from. */
  options: string | null;
  /** Set when Kajabi has it and this site can't answer it; shown, never sent. */
  unavailable: string;
}

export interface FilterCategory {
  key: string;
  label: string;
  note: string;
  conditionals: FilterConditional[];
}

/** Everything the Segments menu, the Filters panel and the Sort menu need. */
export interface ContactFilterOptions {
  segments: { key: string; label: string; kind: "built_in" | "saved" | "team" }[];
  sorts: { key: ContactSort; label: string }[];
  defaultSort: ContactSort;
  categories: FilterCategory[];
  options: Record<string, FilterChoice[]>;
  days: number[];
  engagementDays: number[];
  datePresets: { key: string; label: string }[];
  eventTypes: LifecycleEventType[];
}

function toQuery(filters: ContactFilters): string {
  const qs = new URLSearchParams();
  if (filters.q) qs.set("q", filters.q);
  if (filters.segment && filters.segment !== "all") qs.set("segment", filters.segment);
  if (filters.filters && filters.filters.length > 0) qs.set("filters", JSON.stringify(filters.filters));
  if (filters.tag) qs.set("tag", filters.tag);
  if (filters.status) qs.set("status", filters.status);
  if (filters.community) qs.set("community", "true");
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
  filterOptions: () => request<ContactFilterOptions>("/admin/contacts/filter-options"),
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
  /**
   * Confirm somebody's email address on their behalf.
   *
   * The unblock. Confirmation gates posting, commenting and every point a member
   * can earn, and the only key was a link in an email — so while mail is not
   * arriving, nobody can use the social half of the product and nobody can help
   * them. Audited on the server, because it lets an account post under a name
   * whose owner has not proved they hold the inbox.
   */
  confirmEmail: (id: number) =>
    request<{ changed: boolean; confirmation: ContactConfirmation }>(
      `/admin/contacts/${id}/confirm-email`,
      { method: "POST" },
    ),

  /** Send the confirmation email again, and wait to find out what happened to it. */
  resendConfirmation: (id: number) =>
    request<{
      state: "sent" | "throttled" | "failed";
      to: string;
      error: string;
      confirmation: ContactConfirmation;
    }>(`/admin/contacts/${id}/resend-confirmation`, { method: "POST" }),

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
    const res = await sessionFetch(`${API_BASE}/admin/contacts/bulk/export.csv`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ contactIds }),
    });
    if (!res.ok) throw new ApiError("That download didn't finish. Please try again.", res.status);
    return res.blob();
  },

  addPurchase: (id: number, data: ManualPurchaseInput) =>
    request<{ id: number }>(`/admin/contacts/${id}/purchases`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

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

  importPeople: (rows: ImportRow[], tagSlugs: string[] = []) =>
    request<ImportOutcome>("/admin/contacts/import", {
      method: "POST",
      body: JSON.stringify({ rows, tagSlugs }),
    }),

  /**
   * Bypasses `request` because the answer is a spreadsheet, not JSON — the
   * shared helper would try to parse it and throw the file away.
   */
  exportCsv: async (filters: ContactFilters = {}) => {
    const res = await sessionFetch(`${API_BASE}/admin/contacts/export.csv${toQuery(filters)}`);
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
/**
 * Keyed on the five states a saved segment's rule may name. `never_subscribed`
 * is deliberately absent: Segments.tsx builds its rule menu from these keys,
 * and services/segments.ts does not accept that state in a saved rule yet, so
 * listing it here would offer a choice that fails on save. Its words are in
 * `emailStatusLabel` and `MARKETING_STATUS_WORDS`.
 */
export const EMAIL_STATUS_LABEL: Record<MarketingStatus, string> = {
  subscribed: "Happy to hear from you",
  opted_out: "Asked to stop",
  bounced: "Emails aren't arriving",
  complained: "Marked you as spam",
  unconfirmed: "Hasn't confirmed yet",
  never_subscribed: "Never subscribed",
};

export const EMAIL_STATUS_TONE: Record<MarketingStatus, "green" | "slate" | "red" | "gold"> = {
  subscribed: "green",
  opted_out: "slate",
  bounced: "red",
  complained: "red",
  unconfirmed: "gold",
  never_subscribed: "slate",
};

/**
 * The words Kajabi's Email Marketing column uses, which is what the tester
 * reads down it side by side with Kajabi (QA rows 22–27). The People list, the
 * quick view, the profile and the filters all use these.
 */
export const MARKETING_STATUS_WORDS: Record<MarketingStatus, string> = {
  subscribed: "Subscribed",
  opted_out: "Opted out",
  bounced: "Hard bounced",
  complained: "Marked as spam",
  unconfirmed: "Unconfirmed",
  never_subscribed: "Never subscribed",
};

export function marketingStatusWords(status: string): string {
  return MARKETING_STATUS_WORDS[status as MarketingStatus] ?? "Not known";
}

/** The two statuses she can set herself. The rest are set by what the inbox did. */
export const SETTABLE_STATUSES: EmailStatus[] = ["subscribed", "opted_out"];

export function emailStatusLabel(status: string): string {
  if (status === "never_subscribed") return "Never signed up for your emails";
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
  "email.confirmed": "Email confirmed",
  "event.registered": "Event",
  "assessment.completed": "Quiz",
  sequence_started: "Email sequence",
  sequence_completed: "Email sequence",
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

/**
 * Whether anything has happened since they were added, which is when Kajabi's
 * "Last activity" column shows a date rather than "—". Being added bumps the
 * activity clock too, so that moment alone doesn't count; a purchase always does.
 */
export function hasActivity(person: {
  lastActivityAt: string | null;
  createdAt: string;
  lastOrderedAt?: string | null;
}): boolean {
  if (!person.lastActivityAt) return false;
  if (person.lastOrderedAt) return true;
  return new Date(person.lastActivityAt).getTime() - new Date(person.createdAt).getTime() > 60_000;
}
