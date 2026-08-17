import type {
  AdminStats,
  AdminUser,
  BlogCard,
  BlogPost,
  ChatResponse,
  CheckoutOrder,
  Course,
  Lead,
  LeadPayload,
  Page,
  PublicForm,
  PublicFunnel,
  Resource,
  Subscriber,
  Testimonial,
} from "@/types";
import type {
  Challenge,
  ChallengeEntry,
  ChatSessionDetail,
  ChatSessionSummary,
  Community,
  CommunityBadge,
  CommunityChannel,
  CommunityComment,
  CommunityDetail,
  CommunityEvent,
  CommunityMembership,
  CommunityPost,
  CourseModule,
  Coupon,
  DashboardOverview,
  Enrollment,
  Invoice,
  LeaderboardEntry,
  MediaAsset,
  Member,
  Payment,
  Plan,
  RevenueSummary,
  StripeStatus,
  Subscription,
} from "@/types/admin";

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "/api";
const TOKEN_KEY = "bc_admin_token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = getToken();
  const headers = new Headers(options.headers);
  if (!headers.has("Content-Type") && !(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });

  if (!res.ok) {
    // The status travels on the error; screens turn it into something the
    // business owner can act on (see pages/admin/ui/friendly.ts). This default
    // is the last resort, so it says what to do rather than what broke.
    let message = "Something went wrong. Please try again in a moment.";
    try {
      const body = (await res.json()) as { error?: string; message?: string };
      message = body.error ?? body.message ?? message;
    } catch {
      // ignore parse errors
    }
    throw new ApiError(message, res.status);
  }

  if (res.status === 204) {
    return undefined as T;
  }

  return (await res.json()) as T;
}

// ---- Public collections ----

export const api = {
  courses: () => request<Course[]>("/courses"),
  /**
   * One course with its curriculum outline and the offers it is sold through.
   * The route every legacy product URL redirects to — see the `redirects` table.
   */
  courseDetail: (slug: string) => request<Course>(`/courses/${encodeURIComponent(slug)}`),
  resources: () => request<Resource[]>("/resources"),
  testimonials: () => request<Testimonial[]>("/testimonials"),
  blogList: (params?: { tag?: string; page?: number; limit?: number }) => {
    const qs = new URLSearchParams();
    if (params?.tag) qs.set("tag", params.tag);
    if (params?.page) qs.set("page", String(params.page));
    if (params?.limit) qs.set("limit", String(params.limit));
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return request<{ items: BlogCard[]; total: number; page: number; pageSize: number }>(
      `/blog${suffix}`,
    );
  },
  blogPost: (slug: string) => request<BlogPost>(`/blog/${slug}`),
  page: (slug: string) => request<Page>(`/pages/${slug}`),
  settings: () => request<Record<string, unknown>>("/settings"),
  /** `id` is absent when the endpoint answered a bot without storing the row. */
  submitLead: (payload: LeadPayload) =>
    request<{ ok: true; id?: number }>("/leads", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  subscribe: (email: string, source: string) =>
    request<{ ok: true }>("/subscribe", {
      method: "POST",
      body: JSON.stringify({ email, source }),
    }),
  /** Reading a form counts as a view server-side; that is what the opt-in rate is measured against. */
  publicForm: (slug: string) => request<PublicForm>(`/forms/${encodeURIComponent(slug)}`),
  /**
   * The endpoint takes the answers under a `data` envelope — the keys are
   * whatever the admin named their fields, so they cannot sit at the top level
   * next to the schema's own properties.
   *
   * `email` is that envelope's one named field, and it is worth filling: left
   * out, the server falls back to a field literally *keyed* `email`, and a
   * form whose email field is keyed anything else creates no lead at all.
   */
  submitForm: (slug: string, data: Record<string, unknown>, email?: string) =>
    request<{ ok: true; message: string }>(`/forms/${encodeURIComponent(slug)}/submit`, {
      method: "POST",
      body: JSON.stringify(email ? { data, email } : { data }),
    }),
  /** Reading a funnel does not count a view — the step counters do, below. */
  publicFunnel: (slug: string) => request<PublicFunnel>(`/funnels/${encodeURIComponent(slug)}`),
  /** Step counters behind the funnel report. Fire-and-forget: 204, no body. */
  funnelStepEvent: (stepId: number, event: "view" | "convert") =>
    request<void>(`/funnels/steps/${stepId}/${event}`, { method: "POST" }),
  chat: (sessionId: string | null, message: string) =>
    request<ChatResponse>("/chat", {
      method: "POST",
      body: JSON.stringify({ sessionId, message }),
    }),
  /**
   * Voice lines, posted a turn at a time. Speech never reaches our server on
   * its own — see hooks/useVoiceAgent — so this is what puts a spoken
   * conversation in the same inbox as a typed one.
   */
  chatTranscript: (sessionId: string, lines: { role: "user" | "assistant"; content: string }[]) =>
    request<{ ok: true }>("/chat/transcript", {
      method: "POST",
      body: JSON.stringify({ sessionId, lines }),
    }),
  /** Creates a Stripe Checkout Session; returns the hosted-checkout URL. */
  createCheckoutSession: (slug: string, email?: string) =>
    request<{ url: string }>("/checkout/session", {
      method: "POST",
      body: JSON.stringify({ slug, ...(email ? { email } : {}) }),
    }),
  /** Reads back an order by Stripe session id (webhook-confirmed status only). */
  checkoutOrder: (sessionId: string) =>
    request<CheckoutOrder>(`/checkout/session/${encodeURIComponent(sessionId)}`),
};

// ---- Admin ----

export const adminApi = {
  login: (email: string, password: string) =>
    request<{ token: string; user: AdminUser }>("/admin/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  me: () => request<AdminUser>("/admin/me"),
  stats: () => request<AdminStats>("/admin/stats"),

  blogList: () => request<BlogPost[]>("/admin/blog"),
  blogCreate: (data: Partial<BlogPost>) =>
    request<BlogPost>("/admin/blog", { method: "POST", body: JSON.stringify(data) }),
  blogUpdate: (id: string, data: Partial<BlogPost>) =>
    request<BlogPost>(`/admin/blog/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  blogDelete: (id: string) => request<void>(`/admin/blog/${id}`, { method: "DELETE" }),

  coursesList: () => request<Course[]>("/admin/courses"),
  courseCreate: (data: Partial<Course>) =>
    request<Course>("/admin/courses", { method: "POST", body: JSON.stringify(data) }),
  courseUpdate: (id: string, data: Partial<Course>) =>
    request<Course>(`/admin/courses/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  courseDelete: (id: string) => request<void>(`/admin/courses/${id}`, { method: "DELETE" }),

  testimonialsList: () => request<Testimonial[]>("/admin/testimonials"),
  testimonialCreate: (data: Partial<Testimonial>) =>
    request<Testimonial>("/admin/testimonials", { method: "POST", body: JSON.stringify(data) }),
  testimonialUpdate: (id: string, data: Partial<Testimonial>) =>
    request<Testimonial>(`/admin/testimonials/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  testimonialDelete: (id: string) =>
    request<void>(`/admin/testimonials/${id}`, { method: "DELETE" }),

  resourcesList: () => request<Resource[]>("/admin/resources"),
  resourceCreate: (data: Partial<Resource>) =>
    request<Resource>("/admin/resources", { method: "POST", body: JSON.stringify(data) }),
  resourceUpdate: (id: string, data: Partial<Resource>) =>
    request<Resource>(`/admin/resources/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  resourceDelete: (id: string) => request<void>(`/admin/resources/${id}`, { method: "DELETE" }),

  pagesList: () =>
    request<{ slug: string; title: string; description: string; updatedAt: string }[]>(
      "/admin/pages",
    ),
  pageGet: (slug: string) => request<Page>(`/admin/pages/${slug}`),
  pageUpdate: (slug: string, data: Partial<Page>) =>
    request<Page>(`/admin/pages/${slug}`, { method: "PUT", body: JSON.stringify(data) }),

  leadsList: () => request<Lead[]>("/admin/leads"),
  leadUpdate: (id: string, status: string) =>
    request<Lead>(`/admin/leads/${id}`, { method: "PUT", body: JSON.stringify({ status }) }),

  subscribersList: () => request<Subscriber[]>("/admin/subscribers"),

  // Session ids are client-generated UUIDs, but they still travel in the path —
  // encode them rather than trusting their shape.
  chatSessions: () => request<ChatSessionSummary[]>("/admin/chats"),
  chatSession: (id: string) =>
    request<ChatSessionDetail>(`/admin/chats/${encodeURIComponent(id)}`),
  chatSessionDelete: (id: string) =>
    request<{ ok: true }>(`/admin/chats/${encodeURIComponent(id)}`, { method: "DELETE" }),

  settingsGet: () => request<Record<string, unknown>>("/admin/settings"),
  settingsUpdate: (data: Record<string, unknown>) =>
    request<Record<string, unknown>>("/admin/settings", {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  generateBlog: (topic: string, tone?: string, keywords?: string[]) =>
    request<{ title: string; excerpt: string; bodyMd: string; tags: string[] }>(
      "/admin/ai/generate-blog",
      { method: "POST", body: JSON.stringify({ topic, tone, keywords }) },
    ),

  uploadMedia: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<MediaAsset>("/admin/media", { method: "POST", body: form });
  },

  // ---- Dashboard ----
  overview: () => request<DashboardOverview>("/admin/stats/overview"),

  // ---- Media library ----
  mediaList: (kind?: string) =>
    request<MediaAsset[]>(`/admin/media${kind && kind !== "all" ? `?kind=${kind}` : ""}`),
  mediaRename: (id: number, title: string) =>
    request<MediaAsset>(`/admin/media/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ title }),
    }),
  mediaDelete: (id: number) => request<void>(`/admin/media/${id}`, { method: "DELETE" }),

  // ---- Curriculum ----
  curriculum: (courseId: number) => request<CourseModule[]>(`/admin/curriculum/${courseId}`),
  moduleCreate: (courseId: number, data: { title: string; summary?: string }) =>
    request<CourseModule>(`/admin/curriculum/${courseId}/modules`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  moduleUpdate: (id: number, data: Record<string, unknown>) =>
    request<CourseModule>(`/admin/curriculum/modules/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  moduleDelete: (id: number) =>
    request<void>(`/admin/curriculum/modules/${id}`, { method: "DELETE" }),
  lessonCreate: (moduleId: number, data: Record<string, unknown>) =>
    request<CourseModule["lessons"][number]>(`/admin/curriculum/modules/${moduleId}/lessons`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  lessonUpdate: (id: number, data: Record<string, unknown>) =>
    request<CourseModule["lessons"][number]>(`/admin/curriculum/lessons/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  lessonDelete: (id: number) =>
    request<void>(`/admin/curriculum/lessons/${id}`, { method: "DELETE" }),

  // ---- Members ----
  membersList: () => request<Member[]>("/admin/members"),
  /**
   * The filtered view of the same list. Paging is always sent, which is what
   * makes the endpoint answer with a counted page rather than a bare array —
   * the total is what tells the screen its results were cut short.
   */
  membersSearch: (params: {
    q?: string;
    status?: string;
    courseId?: number;
    page?: number;
    limit?: number;
  }) => {
    const qs = new URLSearchParams();
    if (params.q) qs.set("q", params.q);
    if (params.status) qs.set("status", params.status);
    if (params.courseId) qs.set("courseId", String(params.courseId));
    qs.set("page", String(params.page ?? 1));
    qs.set("limit", String(params.limit ?? 200));
    return request<{ items: Member[]; total: number; page: number; pageSize: number }>(
      `/admin/members?${qs.toString()}`,
    );
  },
  memberImpersonate: (id: number) =>
    request<{ accessToken: string; member: Member }>(`/admin/members/${id}/impersonate`, {
      method: "POST",
    }),
  memberResetPassword: (id: number) =>
    request<{ ok: true }>(`/admin/members/${id}/reset-password`, { method: "POST" }),
  memberSuspend: (id: number) => request<void>(`/admin/members/${id}/suspend`, { method: "POST" }),
  memberReactivate: (id: number) =>
    request<void>(`/admin/members/${id}/reactivate`, { method: "POST" }),
  memberExport: (id: number) => request<Record<string, unknown>>(`/admin/members/${id}/export`),
  /**
   * Bypasses `request` because the answer is a spreadsheet, not JSON — the
   * shared helper would try to parse it and throw away the file.
   */
  membersExportCsv: async () => {
    const token = getToken();
    const res = await fetch(`${API_BASE}/admin/members/export.csv`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    if (!res.ok) {
      throw new ApiError("That download didn't finish. Please try again in a moment.", res.status);
    }
    return res.blob();
  },
  membersImport: (rows: Record<string, string>[]) =>
    request<{
      created: number;
      updated: number;
      skipped: number;
      // A rejected line comes back either as a finished sentence or as the
      // pieces to build one from, so the screen can always show a reason.
      errors: (string | { row?: number; email?: string; message?: string })[];
    }>("/admin/members/import", { method: "POST", body: JSON.stringify({ rows }) }),
  memberCreate: (data: { email: string; name?: string; status?: string }) =>
    request<Member>("/admin/members", { method: "POST", body: JSON.stringify(data) }),
  memberUpdate: (id: number, data: { name?: string; status?: string }) =>
    request<Member>(`/admin/members/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  memberDelete: (id: number) => request<void>(`/admin/members/${id}`, { method: "DELETE" }),
  memberEnrollments: (id: number) => request<Enrollment[]>(`/admin/members/${id}/enrollments`),
  memberEnroll: (id: number, courseId: number) =>
    request<Enrollment>(`/admin/members/${id}/enrollments`, {
      method: "POST",
      body: JSON.stringify({ courseId }),
    }),
  memberUnenroll: (id: number, courseId: number) =>
    request<void>(`/admin/members/${id}/enrollments/${courseId}`, { method: "DELETE" }),

  // ---- Community ----
  communities: () => request<Community[]>("/admin/community"),
  communityCreate: (data: Record<string, unknown>) =>
    request<Community>("/admin/community", { method: "POST", body: JSON.stringify(data) }),
  community: (id: number) => request<CommunityDetail>(`/admin/community/${id}`),
  communityUpdate: (id: number, data: Record<string, unknown>) =>
    request<Community>(`/admin/community/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  communityDelete: (id: number) => request<void>(`/admin/community/${id}`, { method: "DELETE" }),

  channelCreate: (communityId: number, data: Record<string, unknown>) =>
    request<CommunityChannel>(`/admin/community/${communityId}/channels`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  channelUpdate: (id: number, data: Record<string, unknown>) =>
    request<CommunityChannel>(`/admin/community/channels/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  channelDelete: (id: number) =>
    request<void>(`/admin/community/channels/${id}`, { method: "DELETE" }),

  channelPosts: (channelId: number) =>
    request<CommunityPost[]>(`/admin/community/channels/${channelId}/posts`),
  postCreate: (channelId: number, data: Record<string, unknown>) =>
    request<CommunityPost>(`/admin/community/channels/${channelId}/posts`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  postUpdate: (id: number, data: Record<string, unknown>) =>
    request<CommunityPost>(`/admin/community/posts/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  postDelete: (id: number) => request<void>(`/admin/community/posts/${id}`, { method: "DELETE" }),
  postComments: (postId: number) =>
    request<CommunityComment[]>(`/admin/community/posts/${postId}/comments`),
  commentDelete: (id: number) =>
    request<void>(`/admin/community/comments/${id}`, { method: "DELETE" }),

  communityMembers: (id: number) =>
    request<CommunityMembership[]>(`/admin/community/${id}/members`),
  communityAddMember: (id: number, memberId: number, role?: string) =>
    request<CommunityMembership>(`/admin/community/${id}/members`, {
      method: "POST",
      body: JSON.stringify({ memberId, role }),
    }),
  membershipUpdate: (id: number, data: { role?: string; points?: number }) =>
    request<CommunityMembership>(`/admin/community/memberships/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  membershipDelete: (id: number) =>
    request<void>(`/admin/community/memberships/${id}`, { method: "DELETE" }),
  leaderboard: (id: number) => request<LeaderboardEntry[]>(`/admin/community/${id}/leaderboard`),

  challenges: (communityId: number) =>
    request<Challenge[]>(`/admin/community/${communityId}/challenges`),
  challengeCreate: (communityId: number, data: Record<string, unknown>) =>
    request<Challenge>(`/admin/community/${communityId}/challenges`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  challengeUpdate: (id: number, data: Record<string, unknown>) =>
    request<Challenge>(`/admin/community/challenges/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  challengeDelete: (id: number) =>
    request<void>(`/admin/community/challenges/${id}`, { method: "DELETE" }),
  challengeEntries: (id: number) =>
    request<ChallengeEntry[]>(`/admin/community/challenges/${id}/entries`),
  entryApprove: (id: number) =>
    request<{ ok: true }>(`/admin/community/entries/${id}/approve`, { method: "PUT" }),

  communityEvents: (communityId: number) =>
    request<CommunityEvent[]>(`/admin/community/${communityId}/events`),
  eventCreate: (communityId: number, data: Record<string, unknown>) =>
    request<CommunityEvent>(`/admin/community/${communityId}/events`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  eventDelete: (id: number) =>
    request<void>(`/admin/community/events/${id}`, { method: "DELETE" }),

  badges: (communityId: number) =>
    request<CommunityBadge[]>(`/admin/community/${communityId}/badges`),
  badgeCreate: (communityId: number, data: Record<string, unknown>) =>
    request<CommunityBadge>(`/admin/community/${communityId}/badges`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  badgeDelete: (id: number) =>
    request<void>(`/admin/community/badges/${id}`, { method: "DELETE" }),

  // ---- Sales ----
  plans: () => request<Plan[]>("/admin/sales/plans"),
  planCreate: (data: Record<string, unknown>) =>
    request<Plan>("/admin/sales/plans", { method: "POST", body: JSON.stringify(data) }),
  planUpdate: (id: number, data: Record<string, unknown>) =>
    request<Plan>(`/admin/sales/plans/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  planDelete: (id: number) => request<void>(`/admin/sales/plans/${id}`, { method: "DELETE" }),

  payments: () => request<Payment[]>("/admin/sales/payments"),
  subscriptions: () => request<Subscription[]>("/admin/sales/subscriptions"),
  invoices: () => request<Invoice[]>("/admin/sales/invoices"),
  revenue: () => request<RevenueSummary>("/admin/sales/revenue"),
  stripeStatus: () => request<StripeStatus>("/admin/sales/stripe-status"),

  coupons: () => request<Coupon[]>("/admin/sales/coupons"),
  couponCreate: (data: Record<string, unknown>) =>
    request<Coupon>("/admin/sales/coupons", { method: "POST", body: JSON.stringify(data) }),
  couponToggle: (id: number, active: boolean) =>
    request<Coupon>(`/admin/sales/coupons/${id}`, {
      method: "PUT",
      body: JSON.stringify({ active }),
    }),
  couponDelete: (id: number) => request<void>(`/admin/sales/coupons/${id}`, { method: "DELETE" }),

  // ---- Growth suite ----
  // The backend exposes uniform CRUD for these resources, so one generic
  // helper per verb keeps this section from ballooning into 60 near-identical
  // methods.
  growthList: <T>(resource: string) => request<T[]>(`/admin/growth/${resource}`),
  growthGet: <T>(resource: string, id: number) =>
    request<T>(`/admin/growth/${resource}/${id}`),
  growthCreate: <T>(resource: string, data: Record<string, unknown>) =>
    request<T>(`/admin/growth/${resource}`, { method: "POST", body: JSON.stringify(data) }),
  growthUpdate: <T>(resource: string, id: number, data: Record<string, unknown>) =>
    request<T>(`/admin/growth/${resource}/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  growthDelete: (resource: string, id: number) =>
    request<{ ok: true }>(`/admin/growth/${resource}/${id}`, { method: "DELETE" }),

  // Nested / action endpoints that aren't plain CRUD
  podcastEpisodes: (podcastId: number) =>
    request<import("@/types/admin").PodcastEpisode[]>(
      `/admin/growth/podcasts/${podcastId}/episodes`,
    ),
  feedTokens: (podcastId: number) =>
    request<import("@/types/admin").FeedToken[]>(`/admin/growth/podcasts/${podcastId}/tokens`),
  feedTokenCreate: (podcastId: number, memberId?: number) =>
    request<import("@/types/admin").FeedToken>(`/admin/growth/podcasts/${podcastId}/tokens`, {
      method: "POST",
      body: JSON.stringify({ memberId }),
    }),
  feedTokenRevoke: (id: number) =>
    request<void>(`/admin/growth/tokens/${id}`, { method: "DELETE" }),

  newsletterIssues: (newsletterId: number) =>
    request<import("@/types/admin").NewsletterIssue[]>(
      `/admin/growth/newsletters/${newsletterId}/issues`,
    ),
  issueSend: (id: number) =>
    request<{ ok: true; recipients: number }>(`/admin/growth/issues/${id}/send`, {
      method: "POST",
    }),

  audienceCount: (audience: string) =>
    request<{ audience: string; count: number }>(`/admin/growth/campaigns/audience/${audience}`),
  campaignSend: (id: number) =>
    request<{ ok: true; queued: number }>(`/admin/growth/campaigns/${id}/send`, {
      method: "POST",
    }),

  funnelSteps: (funnelId: number) =>
    request<import("@/types/admin").FunnelStep[]>(`/admin/growth/funnels/${funnelId}/steps`),

  automationActions: (id: number) =>
    request<import("@/types/admin").AutomationAction[]>(
      `/admin/growth/automations/${id}/actions`,
    ),
  automationRuns: (id: number) =>
    request<import("@/types/admin").AutomationRun[]>(`/admin/growth/automations/${id}/runs`),
  automationTest: (id: number, payload: Record<string, unknown>) =>
    request<{ ok: true; note: string }>(`/admin/growth/automations/${id}/test`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  coachingSessions: (offerId?: number) =>
    request<import("@/types/admin").CoachingSession[]>(
      `/admin/growth/coaching/sessions${offerId ? `?offerId=${offerId}` : ""}`,
    ),

  formSubmissions: (formId: number) =>
    request<import("@/types/admin").FormSubmission[]>(`/admin/growth/forms/${formId}/submissions`),

  // ---- Reports ----
  reportSubscriptions: () =>
    request<import("@/types/admin").SubscriptionReport>("/admin/growth/reports/subscriptions"),
  reportAudience: () =>
    request<import("@/types/admin").AudienceReport>("/admin/growth/reports/audience"),
  reportFunnels: () =>
    request<import("@/types/admin").FunnelReport[]>("/admin/growth/reports/funnels"),
  reportContent: () =>
    request<import("@/types/admin").ContentReport>("/admin/growth/reports/content"),
};

/**
 * Uploads a file with progress reporting.
 *
 * Uses XMLHttpRequest rather than fetch: fetch still has no upload-progress
 * event, and a multi-hundred-megabyte course video with no progress bar reads
 * as a frozen page.
 */
export function uploadMediaWithProgress(
  file: File,
  onProgress: (percent: number) => void,
  signal?: AbortSignal,
): Promise<MediaAsset> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("file", file);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_BASE}/admin/media`);

    const token = getToken();
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);

    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    });

    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as MediaAsset);
        } catch {
          reject(new ApiError("That file didn't finish uploading. Please try again.", xhr.status));
        }
        return;
      }
      let message = "That file didn't upload. Please try again.";
      try {
        const body = JSON.parse(xhr.responseText) as { error?: string };
        if (body.error) message = body.error;
      } catch {
        // A 413 from nginx is HTML, not JSON — say so in plain words instead.
        if (xhr.status === 413) message = "That file is too large.";
      }
      reject(new ApiError(message, xhr.status));
    });

    xhr.addEventListener("error", () =>
      reject(new ApiError("The upload was interrupted. Check your connection and try again.", 0)),
    );
    xhr.addEventListener("abort", () => reject(new ApiError("You stopped this upload.", 0)));

    signal?.addEventListener("abort", () => xhr.abort());
    xhr.send(form);
  });
}

export { ApiError };
