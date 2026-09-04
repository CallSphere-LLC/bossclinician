/**
 * Admin-only domain types (media library, curriculum, community, sales).
 * Kept separate from `@/types` so the public marketing bundle never pulls
 * these in.
 */

export type Id = number;

/* ------------------------------------------------------------------- Media */

export type MediaKind = "image" | "video" | "audio" | "document" | "file";

/**
 * Which storage root a file lives in, and therefore who can reach it.
 *
 * `public` is served at /uploads to anyone — blog covers, testimonial photos,
 * avatars. `protected` is reachable only through a signed, expiring,
 * member-bound link, and is where anything a customer paid for belongs. The
 * same mp4 can legitimately be either, so it is chosen at upload rather than
 * inferred.
 */
export type MediaVisibility = "public" | "protected";

export interface MediaAsset {
  id: Id;
  visibility?: MediaVisibility;
  filename: string;
  originalName: string;
  url: string;
  /**
   * The address that actually loads in an <img>, <video> or <audio>.
   *
   * `url` is a storage reference: for a file only buyers can open it reads
   * `protected:abc.mp4`, which is not a URL and shows nothing. Always render
   * from this.
   */
  previewUrl: string;
  mime: string;
  kind: MediaKind;
  sizeBytes: number;
  title: string;
  folder: string;
  createdAt: string;
}

/* -------------------------------------------------------------- Curriculum */

export interface CourseLesson {
  id: Id;
  moduleId: Id;
  title: string;
  bodyMd: string;
  videoUrl: string;
  audioUrl: string;
  attachmentUrl: string;
  thumbnailUrl: string;
  requiresPreviousLesson: boolean;
  durationMinutes: number;
  preview: boolean;
  published: boolean;
  sort: number;
}

export interface LessonFile {
  id: Id;
  lessonId: Id;
  mediaId: Id | null;
  title: string;
  storagePath: string;
  filename: string;
  mime: string;
  sizeBytes: string | number;
  sort: number;
}

export interface CourseModule {
  id: Id;
  courseId: Id;
  title: string;
  summary: string;
  sort: number;
  lessons: CourseLesson[];
}

/* ----------------------------------------------------------------- Members */

export interface Member {
  id: Id;
  email: string;
  name: string;
  status: "active" | "invited" | "suspended" | "cancelled" | string;
  createdAt: string;
  enrollmentCount: number;
  firstName?: string | null;
  lastName?: string | null;
  avatarUrl?: string | null;
  timezone?: string | null;
  /** Null until they've clicked the link in their sign-up email. */
  emailVerifiedAt?: string | null;
  /** Null for someone who has an account but has never signed in. */
  lastLoginAt?: string | null;
}

export interface Enrollment {
  id: Id;
  memberId: Id;
  courseId: Id;
  courseTitle: string;
  progress: number;
  createdAt: string;
}

/* --------------------------------------------------------------- Community */

export interface Community {
  id: Id;
  slug: string;
  name: string;
  description: string;
  coverImage: string;
  access: "free" | "paid" | string;
  published: boolean;
  createdAt: string;
  channelCount: number;
  memberCount: number;
  postCount: number;
}

export interface CommunityChannel {
  id: Id;
  communityId: Id;
  slug: string;
  name: string;
  description: string;
  format: "feed" | "chat" | string;
  visibility: "public" | "private" | string;
  sort: number;
  postCount?: number;
}

export interface CommunityDetail extends Omit<Community, "channelCount" | "memberCount" | "postCount"> {
  channels: CommunityChannel[];
}

export interface CommunityPost {
  id: Id;
  channelId: Id;
  memberId: Id | null;
  authorName: string;
  title: string;
  body: string;
  mediaUrl: string;
  pinned: boolean;
  status: "visible" | "hidden" | string;
  createdAt: string;
  commentCount: number;
  reactionCount: number;
}

export interface CommunityComment {
  id: Id;
  postId: Id;
  authorName: string;
  body: string;
  status: string;
  createdAt: string;
}

export interface CommunityMembership {
  id: Id;
  memberId: Id;
  role: "member" | "moderator" | "admin" | string;
  points: number;
  joinedAt: string;
  email: string;
  name: string;
  status: string;
}

export interface LeaderboardEntry {
  name: string;
  email: string;
  points: number;
  badge: string | null;
}

export interface Challenge {
  id: Id;
  communityId: Id;
  title: string;
  description: string;
  coverImage: string;
  startsAt: string | null;
  endsAt: string | null;
  points: number;
  published: boolean;
  createdAt: string;
  entryCount: number;
  approvedCount: number;
}

export interface ChallengeEntry {
  id: Id;
  challengeId: Id;
  memberId: Id;
  proofUrl: string;
  note: string;
  approved: boolean;
  createdAt: string;
  name: string;
  email: string;
}

export interface CommunityEvent {
  id: Id;
  communityId: Id;
  title: string;
  description: string;
  startsAt: string | null;
  durationMinutes: number;
  locationUrl: string;
  published: boolean;
}

export interface CommunityBadge {
  id: Id;
  communityId: Id;
  name: string;
  emoji: string;
  threshold: number;
}

/* ------------------------------------------------------------------- Sales */

export interface Plan {
  id: Id;
  slug: string;
  name: string;
  description: string;
  priceCents: number;
  currency: string;
  interval: "month" | "year" | string;
  stripePriceId: string | null;
  features: string[];
  communityId: Id | null;
  productIds: Id[];
  trialDays: number;
  published: boolean;
  sort: number;
  activeSubscribers: number;
}

export interface PaymentItem {
  title: string;
  quantity: number;
  amountCents: number;
}

export interface Payment {
  id: Id;
  courseSlug: string;
  /** The offer's name, the legacy course's, or the first order line — in that order. */
  courseTitle: string;
  offerSlug: string | null;
  email: string;
  amountCents: number;
  /** What the order was worth before a discount took it to `amountCents`. */
  totalCents: number;
  subtotalCents: number;
  discountCents: number;
  couponCode: string;
  currency: string;
  status: "pending" | "paid" | "failed" | "expired" | string;
  stripeSessionId: string;
  createdAt: string;
  /** Everything the order granted, bumps included. */
  items: PaymentItem[];
}

export interface Subscription {
  id: Id;
  memberId: Id | null;
  planId: Id | null;
  planName: string | null;
  email: string;
  status: string;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  amountCents: number;
  currency: string;
  createdAt: string;
}

export interface Invoice {
  id: Id;
  stripeInvoiceId: string;
  email: string;
  amountPaidCents: number;
  currency: string;
  status: string;
  hostedInvoiceUrl: string;
  createdAt: string;
}

export interface Coupon {
  id: Id;
  code: string;
  percentOff: number | null;
  amountOffCents: number | null;
  currency: string;
  maxRedemptions: number | null;
  redeemed: number;
  expiresAt: string | null;
  scope: "global" | "offers";
  duration: "first" | "forever";
  offerIds: Id[];
  active: boolean;
  createdAt: string;
}

export interface RevenueSummary {
  grossCents: number;
  last30Cents: number;
  prev30Cents: number;
  ordersPaid: number;
  mrrCents: number;
  series: { date: string; oneTimeCents: number; subscriptionCents: number }[];
}

export interface StripeStatus {
  configured: boolean;
  accountId?: string | null;
  chargesEnabled?: boolean;
  payoutsEnabled?: boolean;
}

/* --------------------------------------------------------------- Dashboard */

export interface OverviewSeriesPoint {
  date: string;
  leads: number;
  subscribers: number;
  revenueCents: number;
}

export interface DashboardOverview {
  totals: {
    leads: number;
    newLeads: number;
    subscribers: number;
    posts: number;
    chats: number;
    courses: number;
    members: number;
    enrollments: number;
    lessons: number;
    media: number;
    storageBytes: number;
  };
  revenue: { totalCents: number; last30Cents: number; paidOrders: number };
  series: OverviewSeriesPoint[];
  leadsByStatus: { status: string; count: number }[];
  recentLeads: {
    id: Id;
    name: string;
    email: string;
    source: string;
    status: string;
    createdAt: string;
  }[];
  topCourses: { id: Id; title: string; enrollments: number }[];
}

/* ------------------------------------------------------------ Growth suite */

export interface CoachingOffer {
  id: Id;
  slug: string;
  title: string;
  description: string;
  sessionCount: number;
  durationMinutes: number;
  priceCents: number;
  currency: string;
  stripePriceId: string | null;
  format: "individual" | "group" | string;
  bookingUrl: string;
  published: boolean;
  sort: number;
}

export interface CoachingSession {
  id: Id;
  offerId: Id | null;
  memberId: Id | null;
  contactId: Id | null;
  scheduledAt: string | null;
  durationMinutes: number;
  status: "scheduled" | "completed" | "cancelled" | "no_show" | string;
  meetingUrl: string;
  agenda: string;
  privateNotes: string;
  memberName?: string;
  memberEmail?: string;
  offerTitle?: string;
}

export interface Podcast {
  id: Id;
  slug: string;
  title: string;
  description: string;
  coverImage: string;
  author: string;
  category: string;
  language: string;
  explicit: boolean;
  visibility: "public" | "private" | string;
  published: boolean;
}

export interface PodcastEpisode {
  id: Id;
  podcastId: Id;
  title: string;
  slug: string;
  description: string;
  showNotesMd: string;
  audioUrl: string;
  audioBytes: number;
  durationSeconds: number;
  episodeNumber: number | null;
  season: number;
  published: boolean;
  publishedAt: string | null;
}

export interface FeedToken {
  id: Id;
  podcastId: Id;
  memberId: Id | null;
  token: string;
  revoked: boolean;
  createdAt: string;
  memberEmail?: string | null;
}

export interface Newsletter {
  id: Id;
  slug: string;
  name: string;
  description: string;
  access: "free" | "paid" | string;
  planId: Id | null;
  published: boolean;
}

export interface NewsletterIssue {
  id: Id;
  newsletterId: Id;
  subject: string;
  previewText: string;
  bodyMd: string;
  status: "draft" | "scheduled" | "sent" | string;
  scheduledAt: string | null;
  sentAt: string | null;
  recipientCount: number;
  createdAt: string;
}

export interface Campaign {
  id: Id;
  name: string;
  folder: string;
  subject: string;
  subjectB: string;
  abSplitPercent: number;
  previewText: string;
  bodyMd: string;
  audience: string;
  segmentId: number | null;
  includeTagIds: number[];
  excludeSegmentIds: number[];
  excludeTagIds: number[];
  status: "draft" | "scheduled" | "sending" | "sent" | "failed" | string;
  scheduledAt: string | null;
  timezone: string;
  sentAt: string | null;
  recipientCount: number;
  deliveredCount: number;
  failedCount: number;
  openedCount: number;
  clickedCount: number;
  createdAt: string;
}

export interface AvailabilityRule {
  id: Id;
  timezone: string;
  weekday: number;
  weekdayLabel: string;
  startMinute: number;
  endMinute: number;
  label: string;
  active: boolean;
  createdAt: string;
}

export interface AvailabilityOverride {
  id: Id;
  startsAt: string;
  endsAt: string;
  available: boolean;
  note: string;
  label: string;
  kind: "extra" | "blocked";
}

export interface AvailabilityPreview {
  timezone: string;
  from: string;
  to: string;
  durationMinutes: number;
  policy: {
    minimumNoticeHours: number;
    cancellationWindowHours: number;
    slotIntervalMinutes: number;
    bookingHorizonDays: number;
  };
  slots: Array<{
    startsAt: string;
    endsAt: string;
    day: string;
    dayLabel: string;
    timeLabel: string;
    label: string;
  }>;
  booked: Array<{
    sessionId: number;
    startsAt: string;
    durationMinutes: number;
    label: string;
  }>;
}

export interface Funnel {
  id: Id;
  slug: string;
  name: string;
  description: string;
  kind: string;
  published: boolean;
  formId: number | null;
  tagId: number | null;
  sequenceId: number | null;
  offerId: number | null;
}

export interface FunnelStep {
  id: Id;
  funnelId: Id;
  name: string;
  slug: string;
  stepType: "landing" | "opt_in" | "offer" | "upsell" | "thank_you" | string;
  headline: string;
  bodyMd: string;
  ctaLabel: string;
  ctaUrl: string;
  sort: number;
  views: number;
  conversions: number;
}

export interface Automation {
  id: Id;
  name: string;
  description: string;
  triggerType: string;
  conditions: Record<string, unknown>;
  status: "active" | "paused" | string;
  runCount: number;
  lastRunAt: string | null;
}

export interface AutomationAction {
  id: Id;
  automationId: Id;
  actionType: string;
  config: Record<string, unknown>;
  sort: number;
}

export interface AutomationRun {
  id: Id;
  automationId: Id;
  status: string;
  subjectEmail: string;
  log: string[];
  createdAt: string;
}

export interface FormField {
  key: string;
  label: string;
  type: "text" | "email" | "textarea" | "select" | "checkbox" | string;
  required?: boolean;
  options?: string[];
}

export interface AdminForm {
  id: Id;
  slug: string;
  name: string;
  description: string;
  fields: FormField[];
  submitLabel: string;
  successMessage: string;
  createLead: boolean;
  published: boolean;
  views: number;
}

export interface FormSubmission {
  id: Id;
  formId: Id;
  data: Record<string, unknown>;
  email: string;
  createdAt: string;
}

/* --------------------------------------------------------- Chat inbox */

export interface ChatSessionSummary {
  id: string;
  startedAt: string;
  meta: Record<string, unknown>;
  messageCount: number;
  lastMessageAt: string | null;
  /** Opening visitor question, truncated server-side; null for empty sessions. */
  preview: string | null;
}

export interface ChatMessage {
  id: Id;
  sessionId: string;
  role: "user" | "assistant" | string;
  content: string;
  createdAt: string;
}

export interface ChatSessionDetail {
  /**
   * The session row only. The summary's other three fields are aggregates the
   * list query computes, so the detail endpoint does not return them — the
   * screen already has them from the list row it opened.
   */
  session: Pick<ChatSessionSummary, "id" | "startedAt" | "meta">;
  messages: ChatMessage[];
}

export interface SitePage {
  slug: string;
  title: string;
  description: string;
  sections: Record<string, unknown>;
}

export interface SubscriptionReport {
  activeCount: number;
  mrrCents: number;
  arpuCents: number;
  churned30d: number;
  new30d: number;
  pendingCancel: number;
  churnRate: number;
}

export interface AudienceReport {
  totals: {
    subscribers: number;
    members: number;
    leads: number;
    formSubmissions: number;
    communityMembers: number;
  };
  series: { date: string; subscribers: number; members: number }[];
}

export interface FunnelReport {
  id: Id;
  name: string;
  kind: string;
  views: number;
  conversions: number;
  stepCount: number;
}

export interface ContentReport {
  posts: number;
  lessons: number;
  episodes: number;
  issuesSent: number;
  communityPosts: number;
  mediaAssets: number;
}
