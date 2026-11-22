import { sessionFetch } from "@/lib/adminTransport";
import { API_BASE } from "@/lib/api";
import { getAccessToken, memberRequest, MemberApiError } from "@/lib/memberApi";

/**
 * FlourisHealer Retreat Dashboard (sheet row 248, Yvette's item 11; migrations
 * 218 + 219, routes/member/retreats.ts, routes/admin/retreats.ts).
 *
 * One retreat instance per row in `retreats`. A guest reaches her dashboard
 * only when the retreat is published AND she holds an active grant on the
 * retreat's own dashboard product. Every status below is computed on the
 * server from real records (contract signatures, form submissions, admin
 * reviews, orders); nothing the browser sends can mark a task Verified.
 */

/* ───────────────────────────── shared shapes ───────────────────────────── */

export type TaskStatus = "not_started" | "in_progress" | "submitted" | "verified" | "needs_attention";

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  submitted: "Submitted",
  verified: "Verified",
  needs_attention: "Needs attention",
};

export type TaskKey =
  | "agreement"
  | "guest_profile"
  | "flight_preferences"
  | "travel_insurance"
  | "flight_details"
  | "passport"
  | "payments"
  | "group_call";

/** The dashboard sections, in the order of the owner's brief. Used as URL anchors. */
export type RetreatSectionId =
  | "start-here"
  | "agreement"
  | "guest-profile"
  | "travel-flights"
  | "travel-insurance"
  | "passport-preparation"
  | "details-itinerary"
  | "payments"
  | "guest-connection"
  | "messages"
  | "memories"
  | "feedback"
  | "interest"
  | "join-us-again";

export interface ChecklistItem {
  key: TaskKey;
  label: string;
  status: TaskStatus;
  /** One plain sentence under the label, e.g. "Signed November 3, 2026". */
  detail: string;
  /** The organizer's note when she asked for a correction. */
  reviewNote: string | null;
  updatedAt: string | null;
  /** Where the guest goes to work on it (an anchor on the dashboard). */
  section: RetreatSectionId;
}

export interface ImportantDate {
  label: string;
  /** YYYY-MM-DD, or null while it is still to be confirmed. */
  date: string | null;
  note: string;
}

export type FormKey = "flight_preferences" | "travel_insurance";

export interface FormResponseView {
  /** "draft" = Save & Finish Later; "submitted" = validated submission. */
  state: "none" | "draft" | "submitted";
  data: Record<string, unknown>;
  updatedAt: string | null;
  submittedAt: string | null;
  revision: number;
}

export type InsuranceCoverage = "not_purchased" | "researching" | "purchased" | "decline_or_support";

export interface FlightPreferencesData {
  departureAirport?: string;
  outboundDate?: string;
  returnDate?: string;
  budgetRange?: string;
  connections?: "nonstop_preferred" | "one_stop_ok" | "multiple_ok" | "no_preference";
  layoverComfort?: string;
  groupTravel?: "yes" | "maybe" | "no";
  pointsMiles?: string;
  extension?: "none" | "before" | "after" | "both" | "not_sure";
  considerations?: string;
  questions?: string;
}

export interface TravelInsuranceData {
  acknowledged?: boolean;
  coverageStatus?: InsuranceCoverage;
  provider?: string;
  purchaseDate?: string;
  confirmation?: string;
}

export interface PaymentsSummary {
  /**
   * "complete": an order on this site (and its plan, if any) accounts for the booking.
   * "incomplete": no reliable record here (e.g. billed in Kajabi) — the guest sees
   * "Contact us about your payment schedule" and no figures.
   */
  status: "complete" | "incomplete";
  currency: string;
  agreedCents: number | null;
  paidCents: number | null;
  balanceCents: number | null;
  /** Generic arrangement wording (never a promotional month label). */
  arrangement: string;
  nextPayment: { amountCents: number; dueDate: string } | null;
  /** YYYY-MM-DD from the booking's pricing option, else null. */
  finalPaymentDue: string | null;
  installments: { sequence: number; amountCents: number; dueDate: string | null; paid: boolean }[];
  roomLabel: string | null;
}

export interface GroupCallView {
  confirmed: boolean;
  /** ISO instant, only when confirmed. */
  startsAt: string | null;
  timezone: string | null;
  joinUrl: string | null;
  notes: string;
  rsvp: "yes" | "no" | "maybe" | null;
}

export interface AnnouncementView {
  id: number;
  title: string;
  bodyMd: string;
  publishedAt: string;
}

export type OfferCardStatus = "draft" | "interest_list" | "registration_open" | "sold_out";

export interface OfferCardView {
  id: number;
  title: string;
  kind: "international" | "domestic_business";
  destination: string;
  datesText: string;
  description: string;
  imageUrl: string;
  status: OfferCardStatus;
  ctaLabel: string;
  /** Present for registration_open (verified URL) or an interest-list link. */
  ctaUrl: string;
  /** True when the guest already holds the booking product this card names. */
  booked: boolean;
}

export type InterestChoice = "international" | "domestic_business" | "both" | "not_now";

export interface InterestView {
  interest: InterestChoice | null;
  destinations: string;
  marketingOptIn: boolean;
  updatedAt: string | null;
}

export type TestimonialConsent = "no" | "first_name" | "first_name_role" | "full_name";

export interface FeedbackAnswers {
  rating?: number;
  ratingWhy?: string;
  favoriteMoment?: string;
  appreciated?: string;
  expectations?: string;
  improve?: string;
  attendAgain?: "yes" | "maybe" | "no";
  attendAgainWhere?: string;
  recommend?: "yes" | "maybe" | "no";
  recommendWhy?: string;
}

export interface FeedbackView {
  state: "none" | "draft" | "submitted";
  answers: FeedbackAnswers;
  testimonialText: string;
  testimonialConsent: TestimonialConsent;
  testimonialRole: string;
  updatedAt: string | null;
  submittedAt: string | null;
}

/** Owner-editable wording for the reflection questions (keys match FeedbackAnswers). */
export interface FeedbackLabels {
  rating: string;
  favoriteMoment: string;
  appreciated: string;
  expectations: string;
  improve: string;
  attendAgain: string;
  recommend: string;
  testimonialText: string;
  testimonialConsent: string;
}

export type OpenMode = "auto" | "open" | "closed";

export interface RetreatDashboardData {
  /** True for the owner's preview: nothing can be saved, no guest is named. */
  preview: boolean;
  retreat: {
    slug: string;
    title: string;
    location: string;
    /** YYYY-MM-DD (date-only; never parse with new Date() — use the helpers below). */
    startDate: string;
    endDate: string;
    timezone: string;
    airport: string;
    phase: "upcoming" | "in_progress" | "ended";
    /** Whole days until the start date in the retreat's time zone; 0 on the day, null after. */
    daysUntilStart: number | null;
  };
  guest: { firstName: string } | null;
  dashboardTitle: string;
  welcomeMessage: string;
  supportEmail: string;
  checklist: ChecklistItem[];
  progress: { completed: number; total: number };
  importantDates: ImportantDate[];
  agreement: {
    status: TaskStatus;
    signedAt: string | null;
    /** True when an agreement is waiting in /contracts for her signature. */
    awaitingSignature: boolean;
  };
  guestProfile: { url: string; status: TaskStatus };
  flightTracker: { url: string; status: TaskStatus };
  flightPreferences: FormResponseView;
  flightGuidance: { status: "researching" | "recommendations_available" | "booking_encouraged"; note: string };
  travelInsurance: FormResponseView;
  passport: { status: TaskStatus };
  details: {
    inclusions: string[];
    transportNote: string;
    shuttle: { confirmed: boolean; details: string };
    itineraryMd: string;
  };
  preparationMd: string;
  payments: PaymentsSummary;
  groupCall: GroupCallView;
  announcements: AnnouncementView[];
  memories: { available: boolean; uploadsOpen: boolean };
  feedback: { available: boolean; labels: FeedbackLabels; current: FeedbackView };
  interest: { available: boolean; current: InterestView };
  joinUsAgain: { available: boolean; intro: string; cards: OfferCardView[] };
}

export interface MemoryItem {
  id: number;
  kind: "photo" | "video";
  /** Short-lived signed URL (/api/retreat-media/:token). */
  url: string;
  caption: string;
  mine: boolean;
  /** Guests only ever see their own non-approved items. */
  status: "pending" | "approved" | "hidden";
  uploadedBy: string;
  createdAt: string;
}

export interface MemoriesView {
  available: boolean;
  uploadsOpen: boolean;
  requireReview: boolean;
  maxPhotoMb: number;
  maxVideoMb: number;
  items: MemoryItem[];
}

export interface MyRetreat {
  slug: string;
  title: string;
  location: string;
  startDate: string;
  endDate: string;
}

/* ─────────────────────────────── date helpers ─────────────────────────── */

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

/** "2027-06-15" → "June 15, 2027", without a time-zone shift. */
export function formatRetreatDate(isoDate: string | null | undefined): string {
  if (!isoDate) return "To be confirmed";
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate);
  if (!match) return isoDate;
  return `${MONTHS[Number(match[2]) - 1]} ${Number(match[3])}, ${match[1]}`;
}

/** "June 15–20, 2027" for a same-month range. */
export function formatRetreatRange(start: string, end: string): string {
  const a = /^(\d{4})-(\d{2})-(\d{2})/.exec(start);
  const b = /^(\d{4})-(\d{2})-(\d{2})/.exec(end);
  if (!a || !b) return `${start} – ${end}`;
  if (a[1] === b[1] && a[2] === b[2]) return `${MONTHS[Number(a[2]) - 1]} ${Number(a[3])}–${Number(b[3])}, ${a[1]}`;
  return `${formatRetreatDate(start)} – ${formatRetreatDate(end)}`;
}

export function formatCents(cents: number | null | undefined, currency = "usd"): string {
  if (cents === null || cents === undefined) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);
}

/* ─────────────────────────────── member client ────────────────────────── */

const base = (slug: string) => `/member/retreats/${encodeURIComponent(slug)}`;

export const memberRetreatsApi = {
  mine: () => memberRequest<{ retreats: MyRetreat[] }>("/member/retreats"),
  dashboard: (slug: string) => memberRequest<RetreatDashboardData>(base(slug)),
  /** Save & Finish Later (submit=false) or a validated submission (submit=true). */
  saveForm: (slug: string, formKey: FormKey, data: Record<string, unknown>, submit: boolean, revision: number) =>
    memberRequest<{ response: FormResponseView; fieldErrors?: Record<string, string> }>(
      `${base(slug)}/forms/${formKey}`,
      { method: "PUT", body: JSON.stringify({ data, submit, revision }) },
    ),
  /** Guest self-report for the Jotform-backed and preparation tasks. Never sets Verified. */
  reportTask: (slug: string, taskKey: "guest_profile" | "flight_details" | "passport", done: boolean) =>
    memberRequest<{ status: TaskStatus }>(`${base(slug)}/tasks/${taskKey}`, {
      method: "POST",
      body: JSON.stringify({ done }),
    }),
  rsvp: (slug: string, rsvp: "yes" | "no" | "maybe") =>
    memberRequest<{ rsvp: string }>(`${base(slug)}/group-call/rsvp`, { method: "POST", body: JSON.stringify({ rsvp }) }),
  memories: (slug: string) => memberRequest<MemoriesView>(`${base(slug)}/memories`),
  deleteMemory: (slug: string, id: number) =>
    memberRequest<{ ok: true }>(`${base(slug)}/memories/${id}`, { method: "DELETE" }),
  reportMemory: (slug: string, id: number, reason: string) =>
    memberRequest<{ ok: true }>(`${base(slug)}/memories/${id}/report`, { method: "POST", body: JSON.stringify({ reason }) }),
  feedback: (slug: string) => memberRequest<{ labels: FeedbackLabels; current: FeedbackView; available: boolean }>(`${base(slug)}/feedback`),
  saveFeedback: (
    slug: string,
    body: { answers: FeedbackAnswers; testimonialText: string; testimonialConsent: TestimonialConsent; testimonialRole: string; submit: boolean },
  ) => memberRequest<{ current: FeedbackView; fieldErrors?: Record<string, string> }>(`${base(slug)}/feedback`, { method: "PUT", body: JSON.stringify(body) }),
  interest: (slug: string) => memberRequest<{ current: InterestView; available: boolean }>(`${base(slug)}/interest`),
  saveInterest: (slug: string, body: { interest: InterestChoice; destinations: string; marketingOptIn: boolean }) =>
    memberRequest<{ current: InterestView }>(`${base(slug)}/interest`, { method: "PUT", body: JSON.stringify(body) }),
};

/**
 * Upload one photo/video to the retreat's private gallery, with progress.
 *
 * XMLHttpRequest because fetch reports no upload progress. The member access
 * token is short-lived, so a 401 triggers one refresh (through memberRequest)
 * and one retry.
 */
export function uploadMemory(
  slug: string,
  input: { file: File; caption: string; sharingConsent: boolean },
  onProgress?: (fraction: number) => void,
): Promise<MemoryItem> {
  const send = () =>
    new Promise<{ status: number; body: unknown }>((resolve, reject) => {
      const form = new FormData();
      form.append("file", input.file);
      form.append("caption", input.caption);
      form.append("sharingConsent", input.sharingConsent ? "true" : "false");
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${API_BASE}${base(slug)}/memories`);
      xhr.withCredentials = true;
      const token = getAccessToken();
      if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && onProgress) onProgress(event.loaded / event.total);
      };
      xhr.onload = () => {
        let body: unknown = null;
        try { body = JSON.parse(xhr.responseText); } catch { body = null; }
        resolve({ status: xhr.status, body });
      };
      xhr.onerror = () => reject(new MemberApiError("The upload was interrupted. Check your connection and try again.", 0));
      xhr.send(form);
    });

  return (async () => {
    let result = await send();
    if (result.status === 401) {
      // Any member call refreshes the access token on a 401.
      await memberRetreatsApi.mine().catch(() => undefined);
      result = await send();
    }
    if (result.status >= 200 && result.status < 300) return result.body as MemoryItem;
    const message = (result.body as { error?: string } | null)?.error ?? "That upload didn't go through. Please try again.";
    throw new MemberApiError(message, result.status);
  })();
}

/* ─────────────────────────────── admin client ─────────────────────────── */

export interface AdminRetreatSummary {
  id: number;
  slug: string;
  title: string;
  location: string;
  startDate: string;
  endDate: string;
  published: boolean;
  productId: number | null;
  courseId: number | null;
  guestCount: number;
  bookingHolderCount: number;
}

/** Everything owner-editable about a retreat (stored in retreats.settings). */
export interface RetreatSettings {
  dashboardTitle: string;
  welcomeMessage: string;
  supportEmail: string;
  airport: string;
  guestProfileUrl: string;
  flightTrackerUrl: string;
  transportNote: string;
  shuttle: { confirmed: boolean; details: string };
  groupCall: { confirmed: boolean; startsAt: string | null; timezone: string; joinUrl: string; notes: string };
  flightGuidance: { status: "researching" | "recommendations_available" | "booking_encouraged"; note: string };
  inclusions: string[];
  itineraryMd: string;
  preparationMd: string;
  passportValidThrough: string | null;
  gallery: { mode: OpenMode; uploadsMode: OpenMode; requireReview: boolean; maxPhotoMb: number; maxVideoMb: number };
  feedback: { mode: OpenMode; labels: FeedbackLabels };
  interest: { mode: OpenMode };
  joinUsAgain: { mode: OpenMode; intro: string };
}

export interface AdminRetreatDetail extends AdminRetreatSummary {
  timezone: string;
  bookingProductId: number | null;
  settings: RetreatSettings;
  offers: { id: number; title: string; slug: string; status: string }[];
  contracts: { id: number; title: string }[];
  courseSlug: string | null;
  productSlug: string | null;
  productStatus: string | null;
}

export interface AdminGuestRow {
  memberId: number;
  contactId: number | null;
  name: string;
  email: string;
  /** True: has the dashboard grant. False: holds only the booking product (not yet given the dashboard). */
  hasDashboardAccess: boolean;
  checklist: { key: TaskKey; status: TaskStatus }[];
  coverageStatus: InsuranceCoverage | null;
  paymentsStatus: "complete" | "incomplete";
  feedbackSubmitted: boolean;
  interest: InterestChoice | null;
  marketingOptIn: boolean | null;
}

export interface AdminGuestDetail {
  memberId: number;
  contactId: number | null;
  name: string;
  email: string;
  hasDashboardAccess: boolean;
  checklist: ChecklistItem[];
  forms: Record<FormKey, FormResponseView & { history: { data: Record<string, unknown>; submittedAt: string }[] }>;
  agreement: RetreatDashboardData["agreement"] & { assignments: { id: number; status: string; signedAt: string | null }[] };
  payments: PaymentsSummary;
  groupCallRsvp: string | null;
  feedback: FeedbackView & { id: number | null; approvedForPublicationAt: string | null };
  interest: InterestView;
  media: AdminMemoryItem[];
}

export interface AdminMemoryItem {
  id: number;
  kind: "photo" | "video";
  url: string;
  caption: string;
  status: "pending" | "approved" | "hidden" | "removed";
  sharingConsent: boolean;
  uploadedBy: string;
  memberId: number | null;
  sizeBytes: number;
  createdAt: string;
  reports: { id: number; reason: string; reportedBy: string; createdAt: string; resolvedAt: string | null }[];
}

export interface AdminFeedbackRow {
  id: number;
  memberId: number;
  name: string;
  email: string;
  state: "draft" | "submitted";
  rating: number | null;
  submittedAt: string | null;
  updatedAt: string;
  answers: FeedbackAnswers;
  testimonialText: string;
  testimonialConsent: TestimonialConsent;
  testimonialRole: string;
  approvedForPublicationAt: string | null;
}

export interface AdminInterestRow {
  memberId: number;
  name: string;
  email: string;
  interest: InterestChoice;
  destinations: string;
  marketingOptIn: boolean;
  updatedAt: string;
}

export interface AdminOfferCard extends Omit<OfferCardView, "booked"> {
  visible: boolean;
  displayFrom: string | null;
  displayUntil: string | null;
  bookedProductId: number | null;
  sort: number;
}

export interface AdminAnnouncement extends AnnouncementView {
  published: boolean;
  updatedAt: string;
}

async function adminRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type") && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
  const response = await sessionFetch(`${API_BASE}${path}`, { ...init, headers });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || "Something went wrong. Please try again in a moment.");
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

const adminBase = (id: number) => `/admin/retreats/${id}`;

export const adminRetreatsApi = {
  list: () => adminRequest<{ retreats: AdminRetreatSummary[] }>("/admin/retreats"),
  get: (id: number) => adminRequest<AdminRetreatDetail>(adminBase(id)),
  update: (
    id: number,
    body: { title?: string; location?: string; startDate?: string; endDate?: string; timezone?: string; settings?: Partial<RetreatSettings> },
  ) => adminRequest<AdminRetreatDetail>(adminBase(id), { method: "PUT", body: JSON.stringify(body) }),
  setPublished: (id: number, published: boolean) =>
    adminRequest<AdminRetreatDetail>(`${adminBase(id)}/publish`, { method: "POST", body: JSON.stringify({ published }) }),
  /** The guest dashboard as a brand-new guest sees it, or (memberId) as that guest sees it — read-only. */
  preview: (id: number, memberId?: number) =>
    adminRequest<RetreatDashboardData>(`${adminBase(id)}/preview${memberId ? `?memberId=${memberId}` : ""}`),
  previewBySlug: (slug: string) =>
    adminRequest<RetreatDashboardData>(`/admin/retreats/by-slug/${encodeURIComponent(slug)}/preview`),
  previewMemories: (id: number) => adminRequest<MemoriesView>(`${adminBase(id)}/preview/memories`),
  guests: (id: number) => adminRequest<{ guests: AdminGuestRow[] }>(`${adminBase(id)}/guests`),
  guest: (id: number, memberId: number) => adminRequest<AdminGuestDetail>(`${adminBase(id)}/guests/${memberId}`),
  reviewTask: (id: number, memberId: number, taskKey: TaskKey, status: "verified" | "needs_attention" | "clear", note: string) =>
    adminRequest<AdminGuestDetail>(`${adminBase(id)}/guests/${memberId}/tasks/${taskKey}`, {
      method: "PUT",
      body: JSON.stringify({ status, note }),
    }),
  announcements: (id: number) => adminRequest<{ announcements: AdminAnnouncement[] }>(`${adminBase(id)}/announcements`),
  saveAnnouncement: (id: number, body: { id?: number; title: string; bodyMd: string; published: boolean }) =>
    adminRequest<AdminAnnouncement>(
      body.id ? `${adminBase(id)}/announcements/${body.id}` : `${adminBase(id)}/announcements`,
      { method: body.id ? "PUT" : "POST", body: JSON.stringify(body) },
    ),
  deleteAnnouncement: (id: number, announcementId: number) =>
    adminRequest<{ ok: true }>(`${adminBase(id)}/announcements/${announcementId}`, { method: "DELETE" }),
  media: (id: number) => adminRequest<{ items: AdminMemoryItem[]; storageBytes: number }>(`${adminBase(id)}/media`),
  moderateMedia: (id: number, mediaId: number, status: "approved" | "hidden" | "removed") =>
    adminRequest<AdminMemoryItem>(`${adminBase(id)}/media/${mediaId}`, { method: "PUT", body: JSON.stringify({ status }) }),
  resolveReport: (id: number, reportId: number) =>
    adminRequest<{ ok: true }>(`${adminBase(id)}/media-reports/${reportId}/resolve`, { method: "POST" }),
  uploadMedia: (id: number, file: File, caption: string) => {
    const form = new FormData();
    form.append("file", file);
    form.append("caption", caption);
    return adminRequest<AdminMemoryItem>(`${adminBase(id)}/media`, { method: "POST", body: form });
  },
  feedback: (id: number) => adminRequest<{ feedback: AdminFeedbackRow[] }>(`${adminBase(id)}/feedback`),
  setPublication: (id: number, feedbackId: number, approved: boolean) =>
    adminRequest<AdminFeedbackRow>(`${adminBase(id)}/feedback/${feedbackId}/publication`, {
      method: "PUT",
      body: JSON.stringify({ approved }),
    }),
  interest: (id: number) => adminRequest<{ interest: AdminInterestRow[] }>(`${adminBase(id)}/interest`),
  /** CSV of the alumni preferences/consent/feedback status (no free-text answers). */
  alumniCsvUrl: (id: number) => `${API_BASE}${adminBase(id)}/alumni.csv`,
  cards: (id: number) => adminRequest<{ cards: AdminOfferCard[] }>(`${adminBase(id)}/cards`),
  saveCard: (id: number, card: Partial<AdminOfferCard> & { title: string }) =>
    adminRequest<AdminOfferCard>(card.id ? `${adminBase(id)}/cards/${card.id}` : `${adminBase(id)}/cards`, {
      method: card.id ? "PUT" : "POST",
      body: JSON.stringify(card),
    }),
  deleteCard: (id: number, cardId: number) => adminRequest<{ ok: true }>(`${adminBase(id)}/cards/${cardId}`, { method: "DELETE" }),
};
