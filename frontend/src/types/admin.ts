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
  coverImage?: string;
  /** The tier this channel is limited to; null means the whole community. */
  accessGroupId?: Id | null;
  accessGroupName?: string | null;
  /** How many people have been invited, for an invite-only channel. */
  invitedCount?: number;
  /** Kajabi's available view modes, and the one the channel opens in. */
  viewModes?: string[];
  defaultViewMode?: string;
  /** The layout the member side renders the channel in (`view_mode`). */
  viewMode?: "feed" | "forum" | "gallery" | string;
}

/** An offer that sells a community, and the tier (if any) buying it grants. */
export interface AdminCommunityOffer {
  id: Id;
  title: string;
  status: string;
  accessGroupId: Id | null;
  accessGroupName: string | null;
}

/** Somebody let into an invite-only channel. */
export interface AdminChannelInvite {
  memberId: Id;
  name: string;
  email: string;
  addedAt: string;
}

export interface CommunityDetail extends Omit<Community, "channelCount" | "memberCount" | "postCount"> {
  /** Long-form markdown members must accept before posting. */
  guidelinesMd?: string;
  channels: CommunityChannel[];
  /**
   * The always-open video room. Members see it at the top of their channel
   * list under whatever it is called — Yvette's is "Office Hours" — so the
   * admin has to be able to see and change it in the same place.
   */
  liveRoomEnabled?: boolean;
  liveRoomAccess?: "always" | "hosted" | string;
  liveRoomAlias?: string;
  liveRoomCapacity?: number;
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
  /** Set when they have been banned from this community, not deleted from it. */
  bannedAt?: string | null;
  /** The tiers they are in by hand. Purchased tiers are derived, not listed. */
  groups?: { id: Id; name: string }[];
}

export interface LeaderboardEntry {
  memberId?: Id;
  name: string;
  email: string;
  points: number;
  badge: string | null;
  /** Standard competition rank, so a tie shares a number. */
  rank?: number;
  /** True when somebody else holds the same rank. */
  tied?: boolean;
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
  /** 'stripe' for an invoice Stripe raised, 'order' for a one-off purchase. */
  origin?: string;
  number?: string | null;
  paidAt?: string | null;
  orderId?: number | null;
  memberName?: string | null;
  description?: string | null;
  /** "One-off purchase" or "Subscription", as the list column prints it. */
  kindLabel?: string | null;
  /** Our own copy of the receipt the member holds. */
  receiptUrl?: string | null;
  receiptPdfUrl?: string | null;
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
  /**
   * How the send time is worked out. "absolute" is a wall-clock time in
   * `scheduledAt`; the other two are resolved against an event when the
   * scheduler runs, so a rescheduled event carries its emails with it.
   */
  anchorKind: "absolute" | "event_start" | "event_registration" | string;
  anchorEventId: number | null;
  /** Signed: negative is before the event, positive is after. */
  anchorOffsetMinutes: number;
  /** When the anchor was switched on. Stamped server-side; the backlog guard. */
  anchorArmedAt: string | null;
  /** Why an anchored send was passed over, in words, or "". */
  anchorSkipReason: string;
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

/* ------------------------------------------------- community, deepened (2.x) */

export interface AdminPointRule {
  action: string;
  /** Kajabi's own wording, so the table reads the same as the one it replaces. */
  label: string;
  points: number;
  /** Null is uncapped — right for a once-per-thing rule like an RSVP. */
  maxPerPeriod: number | null;
  period: "day" | "week" | "month" | "all";
}

export interface AdminAccessGroup {
  id: Id;
  name: string;
  description: string;
  sort: number;
  memberCount: number;
  channelCount: number;
  createdAt: string;
}

/** What sells a tier: everything that names it. */
export interface AdminAccessGroupGrants {
  offers: { id: Id; title: string; slug: string; status: string }[];
  products: { id: Id; title: string; slug: string; status: string }[];
  plans: { id: Id; name: string; slug: string }[];
}

/** The tier an offer grants, read and written on its own endpoint. */
export interface AdminOfferAccessGroup {
  offerId: Id;
  offerTitle?: string;
  accessGroupId: Id | null;
  accessGroupName?: string | null;
  communityId?: Id | null;
}

export interface AdminAccessGroupMember {
  memberId: Id;
  name: string;
  email: string;
  /** 'manual' only — purchase-based tiers are derived from a live grant. */
  source: string;
  addedAt: string;
}

export interface AdminCommunityReport {
  id: Id;
  reason: string;
  status: string;
  createdAt: string;
  resolvedAt: string | null;
  postId: Id | null;
  commentId: Id | null;
  reporterName: string;
  content: string;
  contentStatus: string;
  authorName: string;
  channelName: string;
}

export interface AdminScheduledPost {
  id: Id;
  title: string;
  body: string;
  kind: string;
  mediaUrl: string;
  mediaLabel: string;
  publishAt: string;
  createdAt: string;
  authorName: string;
  channelName: string;
  channelSlug: string;
}

export interface AdminLiveVisit {
  id: Id;
  memberId: Id;
  memberName: string;
  email: string;
  joinedAt: string;
  leftAt: string | null;
  /** Null while they are still in the room. */
  seconds: number | null;
}

/* ---------------------------------------------------- email, section 3 */

export interface SavedEmailTemplate {
  id: Id;
  name: string;
  subject: string;
  bodyMd: string;
  createdAt: string;
  updatedAt: string;
}

export interface MergeTag {
  token: string;
  label: string;
  /** What it becomes, so the picker is self-explaining. */
  example: string;
  /** `transactional` tokens only mean something in an email about one purchase. */
  scope?: "all" | "transactional";
}

export interface SendingDomainCheck {
  name: string;
  purpose: string;
  status: "pass" | "warn" | "fail";
  detail: string;
  found: string[];
  expected: string;
}

export interface SendingDomainReport {
  domain: string;
  configuredDomain: string;
  isCurrent: boolean;
  /** True when nothing is failing. A warn is worth doing, not blocking. */
  ready: boolean;
  summary: string;
  checks: SendingDomainCheck[];
}

/* ---- merge tags by kind of email, and the sequence editor's extras ---- */

/** Which kind of email a composer is writing, so the picker offers only what that kind can fill in. */
export type MergeTagSource = "broadcast" | "sequence" | "transactional";

export interface SequenceEmailStat {
  id: Id;
  position: number;
  subject: string;
  sent: number;
  opened: number;
  clicked: number;
  bounced: number;
}

export interface SequenceSubscriberStats {
  /** Everybody who has ever been put on the sequence. */
  subscribed: number;
  active: number;
  paused: number;
  completed: number;
  /** Left before the end, for any of the reasons below. */
  exited: number;
  /** On this sequence and since opted out of marketing email altogether. */
  unsubscribed: number;
  exitReasons: { reason: string; count: number }[];
}

export interface SequenceStatsReport {
  emails: SequenceEmailStat[];
  subscribers: SequenceSubscriberStats;
}
