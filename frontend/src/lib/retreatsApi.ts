import { sessionFetch } from "@/lib/adminTransport";
import { API_BASE } from "@/lib/api";
import { getAccessToken, memberFetch, memberRequest, MemberApiError } from "@/lib/memberApi";

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
  | "access-help"
  | "memories"
  | "feedback"
  | "interest"
  | "join-us-again";

export interface ChecklistItem {
  /** A fixed task, or "questionnaire:<key>" for one of the retreat's questionnaires. */
  key: TaskKey | `questionnaire:${string}`;
  label: string;
  status: TaskStatus;
  /** One plain sentence under the label, e.g. "Signed November 3, 2026". */
  detail: string;
  /** The organizer's note when she asked for a correction. */
  reviewNote: string | null;
  updatedAt: string | null;
  /** Where the guest goes to work on it (an anchor on the dashboard). */
  section: RetreatSectionId | `questionnaire-${string}`;
}

/* ───────────────────────────── questionnaires ──────────────────────────── */

export const QUESTION_TYPES = [
  "short_text",
  "long_text",
  "single_choice",
  "multiple_choice",
  "dropdown",
  "date",
  "time",
  "file",
  "yes_no",
  "checkbox",
] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export const QUESTION_TYPE_LABEL: Record<QuestionType, string> = {
  short_text: "Short answer",
  long_text: "Long answer",
  single_choice: "Single choice",
  multiple_choice: "Multiple choice (select all that apply)",
  dropdown: "Dropdown",
  date: "Date",
  time: "Time",
  file: "File or photo upload",
  yes_no: "Yes / No",
  checkbox: "Checkbox (permission or acknowledgement)",
};

export const CHOICE_TYPES: readonly QuestionType[] = ["single_choice", "multiple_choice", "dropdown"];

export type QuestionAudience = "all" | "shared_room" | "private_room";

export const AUDIENCE_LABEL: Record<QuestionAudience, string> = {
  all: "Every guest",
  shared_room: "Shared-room guests only",
  private_room: "Private-room guests only",
};

export interface QuestionDefinition {
  id: string;
  type: QuestionType;
  label: string;
  help: string;
  required: boolean;
  options: string[];
  showTo: QuestionAudience;
  /** Shown only when another question's answer is one of anyOf (empty = has any answer). */
  showIf: { questionId: string; anyOf: string[] } | null;
  /** Health or similar: organizer-only and left out of exports unless asked for. */
  sensitive: boolean;
}

export interface SectionDefinition {
  id: string;
  title: string;
  description: string;
  questions: QuestionDefinition[];
}

export interface QuestionnaireDefinition {
  intro: string;
  sections: SectionDefinition[];
}

/** What a guest is shown: her audience only, tokens already filled in, no "sensitive" flag. */
export interface GuestQuestion extends Omit<QuestionDefinition, "sensitive"> {}

export interface GuestQuestionnaire {
  id: number;
  key: string;
  title: string;
  dueDate: string | null;
  version: number;
  definition: { intro: string; sections: (Omit<SectionDefinition, "questions"> & { questions: GuestQuestion[] })[] };
  status: TaskStatus;
  reviewNote: string | null;
  response: {
    state: "none" | "draft" | "submitted";
    answers: Record<string, unknown>;
    revision: number;
    updatedAt: string | null;
    submittedAt: string | null;
  };
  files: QuestionnaireFile[];
}

export interface QuestionnaireFile {
  id: number;
  questionId: string;
  name: string;
  mime: string;
}

export interface RetreatDeadline {
  label: string;
  date: string | null;
  note: string;
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

export type BalancePlanState = "open" | "card_on_file" | "billing" | "past_due" | "completed";

export interface BalancePlanScheduleRow {
  sequence: number;
  amountCents: number;
  /** YYYY-MM-DD. */
  dueDate: string;
  status: "scheduled" | "paid" | "failed" | "skipped";
}

/**
 * A guest's balance plan (migration 230): the owner sets the numbers, the guest
 * adds a card and agrees to the schedule, and the balance is then charged
 * monthly. Absent or null when the owner has not opened one for this guest.
 */
export interface BalancePlanView {
  state: BalancePlanState;
  currency: string;
  /** The room price after any discount. */
  agreedTotalCents: number;
  /** Display only; already subtracted from agreedTotalCents. */
  discountCents: number;
  discountNote: string;
  /** Paid before this plan (for example through Kajabi). */
  priorPaidCents: number;
  paidHereCents: number;
  remainingCents: number;
  /** The regular monthly amount. Amounts shown to the guest come from `schedule`, never from this times a count. */
  installmentCents: number;
  installmentCount: number;
  /** The amount of each of the LAST `stepUpCount` payments; 0 or absent (an older server) when every payment is the same. */
  stepUpCents?: number;
  /** How many final payments use `stepUpCents`; 0 or absent when every payment is the same. */
  stepUpCount?: number;
  /** Real instalments once billing; before that a projection from the first charge date. */
  schedule: BalancePlanScheduleRow[];
  firstChargeDate: string;
  finalDueDate: string | null;
  /** True when confirming now would charge the first payment immediately. */
  chargesToday: boolean;
  card: { brand: string; last4: string } | null;
  /** The exact consent sentence the guest must tick, built by the server from the numbers. */
  authorizationText: string;
  /** The last card problem while the plan is open, else "". */
  problem: string;
}

export interface GroupCallView {
  /** False when this retreat has no pre-trip call. */
  enabled: boolean;
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
  /** "all" in the owner's blank preview: every question, each marked with who sees it. */
  audience: "all" | "private" | "shared" | "unknown";
  questionnaires: GuestQuestionnaire[];
  flightGuidance: { status: "researching" | "recommendations_available" | "booking_encouraged"; note: string };
  /** Travel insurance guidance (strongly recommended, not required). */
  insurance: { show: boolean };
  passport: { enabled: boolean; status: TaskStatus };
  details: {
    inclusions: string[];
    activities: string[];
    transportNote: string;
    shuttle: { confirmed: boolean; details: string };
    itineraryMd: string;
  };
  preparationMd: string;
  payments: PaymentsSummary;
  /** Null or absent: no balance plan is open for this guest, so the summary above is shown as before. */
  balancePlan?: BalancePlanView | null;
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
  questionnaire: (slug: string, key: string) =>
    memberRequest<GuestQuestionnaire>(`${base(slug)}/questionnaires/${encodeURIComponent(key)}`),
  /** Save progress (submit=false) or submit (required questions checked on the server too). */
  saveQuestionnaire: (slug: string, key: string, answers: Record<string, unknown>, submit: boolean, revision: number) =>
    memberRequest<GuestQuestionnaire & { fieldErrors?: Record<string, string> }>(`${base(slug)}/questionnaires/${encodeURIComponent(key)}`, {
      method: "PUT",
      body: JSON.stringify({ answers, submit, revision }),
    }),
  /** Guest self-report for her passport check. Never sets Verified. */
  reportTask: (slug: string, taskKey: "passport", done: boolean) =>
    memberRequest<{ status: TaskStatus }>(`${base(slug)}/tasks/${taskKey}`, {
      method: "POST",
      body: JSON.stringify({ done }),
    }),
  rsvp: (slug: string, rsvp: "yes" | "no" | "maybe") =>
    memberRequest<{ rsvp: string }>(`${base(slug)}/group-call/rsvp`, { method: "POST", body: JSON.stringify({ rsvp }) }),
  /**
   * Starts card collection for an open balance plan. Each call makes a new
   * Stripe SetupIntent. `balancePlan` is the plan as it stands at that moment:
   * the card form, the schedule and the consent sentence are shown from it,
   * not from the earlier dashboard load.
   */
  balancePlanSetupIntent: (slug: string) =>
    memberRequest<{ clientSecret: string; balancePlan: BalancePlanView }>(`${base(slug)}/balance-plan/setup-intent`, {
      method: "POST",
      body: JSON.stringify({}),
    }),
  /**
   * Saves the card from a succeeded SetupIntent and records the guest's agreement
   * to the schedule. `authorizationText` is the consent sentence exactly as it
   * was displayed to her. Charges the first payment now when it is already due
   * (`charged`). A declined card answers 402 with a sentence for the guest.
   * 409 carries `details.code`: "schedule_changed" (the sentence shown is no
   * longer the plan's; start again) or "setup_pending" (the bank has not
   * finished; send the same SetupIntent again).
   */
  balancePlanConfirm: (slug: string, setupIntentId: string, authorizationText: string) =>
    memberRequest<{ balancePlan: BalancePlanView; charged: boolean }>(`${base(slug)}/balance-plan/confirm`, {
      method: "POST",
      body: JSON.stringify({ setupIntentId, agreed: true, authorizationText }),
    }),
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
  activities: string[];
  deadlines: RetreatDeadline[];
  checklist: { passport: boolean; groupCall: boolean };
  insurance: { show: boolean };
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

export type RoomType = "private" | "shared";

export interface AdminGuestRow {
  memberId: number;
  contactId: number | null;
  name: string;
  email: string;
  /** True: has the dashboard grant. False: holds only the booking product (not yet given the dashboard). */
  hasDashboardAccess: boolean;
  holdsBooking: boolean;
  hasPassword: boolean;
  /** Effective room: the organizer's setting, else her paid order's room; "unknown" sees no room-specific question. */
  roomType: RoomType | "unknown";
  roomTypeSetByOrganizer: RoomType | null;
  bookingEmail: string;
  emailMismatchAccepted: boolean;
  accessGrantedAt: string | null;
  accessRemovedAt: string | null;
  welcomeSentAt: string | null;
  welcomeSendCount: number;
  checklist: { key: ChecklistItem["key"]; label: string; status: TaskStatus }[];
  paymentsStatus: "complete" | "incomplete";
  feedbackSubmitted: boolean;
  interest: InterestChoice | null;
  marketingOptIn: boolean | null;
}

export interface AdminAnswerRow {
  questionId: string;
  /** The wording she was shown when she answered (from the stored snapshot). */
  label: string;
  section: string;
  type: QuestionType;
  sensitive: boolean;
  askedInVersion: number | null;
  removedFromQuestionnaire: boolean;
  value: unknown;
}

export interface AdminGuestQuestionnaire {
  id: number;
  key: string;
  title: string;
  archived: boolean;
  currentVersion: number;
  status: TaskStatus;
  state: "none" | "draft" | "submitted";
  version: number | null;
  updatedAt: string | null;
  submittedAt: string | null;
  reviewNote: string;
  answers: AdminAnswerRow[];
  history: { version: number; submittedAt: string; answers: AdminAnswerRow[] }[];
  files: QuestionnaireFile[];
}

export interface AdminGuestAccess {
  roomType: RoomType | null;
  bookingEmail: string;
  emailMismatchAccepted: boolean;
  accessGrantedAt: string | null;
  accessRemovedAt: string | null;
  welcomeSentAt: string | null;
  welcomeSendCount: number;
}

export interface AdminGuestDetail {
  memberId: number;
  contactId: number | null;
  name: string;
  email: string;
  hasDashboardAccess: boolean;
  roomType: RoomType | "unknown";
  access: AdminGuestAccess | null;
  checklist: ChecklistItem[];
  questionnaires: AdminGuestQuestionnaire[];
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

export interface AdminQuestionnaire {
  id: number;
  key: string;
  title: string;
  inChecklist: boolean;
  dueDate: string | null;
  sort: number;
  archived: boolean;
  version: number;
  definition: QuestionnaireDefinition;
  updatedAt: string;
  responses: { drafts: number; submitted: number };
}

export interface AccountMatch {
  memberId: number;
  email: string;
  name: string;
  status: string;
  hasPassword: boolean;
  googleLinked: boolean;
  holdsBooking: boolean;
  holdsDashboard: boolean;
}

export interface AccessEmailPreview {
  to: string;
  replyTo: string;
  subject: string;
  text: string;
  html: string;
  includesPasswordSetup: boolean;
  /** Reasons it can't be sent yet; empty = ready. */
  blockers: string[];
}

/** An admin API error, with the server's `details` (e.g. the email-mismatch facts). */
export class AdminApiError extends Error {
  constructor(message: string, public readonly status: number, public readonly details: Record<string, unknown> | null) {
    super(message);
  }
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
    const body = (await response.json().catch(() => ({}))) as { error?: string; details?: Record<string, unknown> };
    throw new AdminApiError(body.error || "Something went wrong. Please try again in a moment.", response.status, body.details ?? null);
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
  /**
   * The guest dashboard as a brand-new guest sees it, or (memberId) as that guest sees it — read-only.
   * `audience` (blank preview only): "all" questions, or as a private- or shared-room guest.
   */
  preview: (id: number, memberId?: number, audience?: "all" | "private" | "shared") =>
    adminRequest<RetreatDashboardData>(
      `${adminBase(id)}/preview${memberId ? `?memberId=${memberId}` : audience ? `?audience=${audience}` : ""}`,
    ),
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

  /* ── questionnaires (migration 224) ── */
  questionnaires: (id: number) => adminRequest<{ questionnaires: AdminQuestionnaire[] }>(`${adminBase(id)}/questionnaires`),
  createQuestionnaire: (id: number, title: string) =>
    adminRequest<{ questionnaires: AdminQuestionnaire[]; id: number }>(`${adminBase(id)}/questionnaires`, {
      method: "POST",
      body: JSON.stringify({ title }),
    }),
  /** A changed `definition` is saved as a new version; answers already given keep their wording. */
  updateQuestionnaire: (
    id: number,
    questionnaireId: number,
    body: { title?: string; inChecklist?: boolean; dueDate?: string | null; archived?: boolean; definition?: QuestionnaireDefinition },
  ) =>
    adminRequest<{ questionnaires: AdminQuestionnaire[]; version: number; newVersion: boolean }>(`${adminBase(id)}/questionnaires/${questionnaireId}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  reorderQuestionnaires: (id: number, ids: number[]) =>
    adminRequest<{ questionnaires: AdminQuestionnaire[] }>(`${adminBase(id)}/questionnaires/reorder`, { method: "POST", body: JSON.stringify({ ids }) }),
  /** Only a questionnaire nobody has answered; otherwise archive it. */
  deleteQuestionnaire: (id: number, questionnaireId: number) =>
    adminRequest<{ questionnaires: AdminQuestionnaire[] }>(`${adminBase(id)}/questionnaires/${questionnaireId}`, { method: "DELETE" }),
  questionnaireVersions: (id: number, questionnaireId: number) =>
    adminRequest<{ versions: { version: number; definition: QuestionnaireDefinition; createdAt: string; createdBy: string | null }[] }>(
      `${adminBase(id)}/questionnaires/${questionnaireId}/versions`,
    ),
  /** CSV of every guest's answers. Health/sensitive questions only with `sensitive`. */
  questionnaireCsvUrl: (id: number, questionnaireId: number, sensitive = false) =>
    `${API_BASE}${adminBase(id)}/questionnaires/${questionnaireId}/responses.csv${sensitive ? "?sensitive=1" : ""}`,
  reviewQuestionnaire: (id: number, memberId: number, questionnaireId: number, status: "verified" | "needs_attention" | "clear", note: string) =>
    adminRequest<{ ok: true }>(`${adminBase(id)}/guests/${memberId}/questionnaires/${questionnaireId}/review`, {
      method: "PUT",
      body: JSON.stringify({ status, note }),
    }),
  questionnaireFileUrl: (id: number, fileId: number) => `${API_BASE}${adminBase(id)}/questionnaire-files/${fileId}`,

  /* ── duplicate ── */
  duplicate: (
    id: number,
    body: { title: string; slug: string; location: string; startDate: string; endDate: string; timezone?: string; airport: string },
  ) => adminRequest<{ id: number; slug: string }>(`${adminBase(id)}/duplicate`, { method: "POST", body: JSON.stringify(body) }),

  /* ── access ── */
  lookupAccount: (id: number, email: string) =>
    adminRequest<{ account: AccountMatch | null }>(`${adminBase(id)}/access/lookup?email=${encodeURIComponent(email)}`),
  /** Gives the dashboard only: no charge, no payment change, no email, no automation. */
  grantAccess: (
    id: number,
    body: { memberId?: number; email?: string; name?: string; bookingEmail?: string; acceptEmailMismatch?: boolean; roomType?: RoomType | null },
  ) => adminRequest<{ memberId: number; created: boolean; alreadyHadAccess: boolean }>(`${adminBase(id)}/access`, { method: "POST", body: JSON.stringify(body) }),
  removeAccess: (id: number, memberId: number) => adminRequest<{ revoked: boolean }>(`${adminBase(id)}/access/${memberId}`, { method: "DELETE" }),
  setRoomType: (id: number, memberId: number, roomType: RoomType | null) =>
    adminRequest<{ roomType: RoomType | null }>(`${adminBase(id)}/guests/${memberId}/room-type`, { method: "PUT", body: JSON.stringify({ roomType }) }),
  accessEmailPreview: (id: number, memberId: number) => adminRequest<AccessEmailPreview>(`${adminBase(id)}/guests/${memberId}/access-email`),
  sendAccessEmail: (id: number, memberId: number) =>
    adminRequest<{ sent: boolean; includesPasswordSetup: boolean }>(`${adminBase(id)}/guests/${memberId}/access-email`, {
      method: "POST",
      body: JSON.stringify({ confirm: true }),
    }),
};

/**
 * Opens a protected questionnaire file (a guest's photo or PDF) for the
 * signed-in guest: fetched with her token, shown from a local blob URL.
 */
export async function memberQuestionnaireFileUrl(slug: string, key: string, fileId: number): Promise<string> {
  const response = await memberFetch(`${base(slug)}/questionnaires/${encodeURIComponent(key)}/files/${fileId}`);
  return URL.createObjectURL(await response.blob());
}

/** The organizer opening a guest's file (admin session cookie). */
export async function adminQuestionnaireFileUrl(retreatId: number, fileId: number): Promise<string> {
  const response = await sessionFetch(adminRetreatsApi.questionnaireFileUrl(retreatId, fileId));
  if (!response.ok) throw new Error("That file couldn't be opened.");
  return URL.createObjectURL(await response.blob());
}

/** Upload one photo or PDF for a "file / photo" question. Returns the file to put in the answers. */
export async function uploadQuestionnaireFile(slug: string, key: string, questionId: string, file: File): Promise<QuestionnaireFile> {
  const form = new FormData();
  form.append("questionId", questionId);
  form.append("file", file);
  const response = await memberFetch(`${base(slug)}/questionnaires/${encodeURIComponent(key)}/files`, { method: "POST", body: form });
  return (await response.json()) as QuestionnaireFile;
}
