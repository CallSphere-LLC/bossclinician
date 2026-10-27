import { sessionFetch } from "@/lib/adminTransport";
import { ApiError } from "@/lib/api";
import type { Course } from "@/types";

/**
 * The course's Offers, Customers and Settings tabs (routes/admin/courseHub.ts),
 * mounted at /api/admin/courses/:id/hub. Attaching offers, creating them and
 * scheduling community events go through `adminCommerceApi` and `adminApi`, the
 * same calls the offer editor and community screens make.
 */

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "/api";

async function call<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const res = await sessionFetch(`${API_BASE}/admin/courses${path}`, { ...options, headers });
  if (!res.ok) {
    let message = "Something went wrong. Please try again in a moment.";
    try {
      const body = (await res.json()) as { error?: string; message?: string };
      message = body.error ?? body.message ?? message;
    } catch {
      // A non-JSON body tells us nothing worth showing.
    }
    throw new ApiError(message, res.status, {}, false);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** A product whose grants open the course: its own, or a coaching programme's. */
export interface CourseProduct {
  id: number;
  title: string;
  kind: string;
  status: string;
}

export interface CourseOffer {
  id: number;
  title: string;
  internalTitle: string;
  slug: string;
  status: "draft" | "published" | "archived";
  pricingType: "one_time" | "subscription" | "payment_plan" | "free" | "pwyw";
  amountCents: number;
  currency: string;
  interval: string | null;
  intervalCount: number;
  installmentCount: number | null;
  /** The course product the offer holds (directly, or inside `viaBundle`). */
  productId: number;
  /** Set when the offer sells a bundle that contains the course. */
  viaBundle: string | null;
  purchaseCount: number;
}

export interface CourseCustomer {
  memberId: number;
  contactId: number | null;
  email: string;
  name: string;
  source: "purchase" | "plan" | "manual" | "automation" | "bundle" | "affiliate" | "import";
  offerId: number | null;
  offerTitle: string | null;
  grantedAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  status: "active" | "revoked" | "expired";
  lessonsCompleted: number;
  lastActiveAt: string | null;
  watchExempt?: boolean;
}

export interface CourseCommunityOption {
  id: number;
  name: string;
  slug: string;
  access: string;
  published: boolean;
  liveRoomEnabled: boolean;
  archived: boolean;
  /** Something sells the room, so a student needs access to walk in. */
  sold: boolean;
}

export interface CourseSettingsOffer {
  id: number;
  title: string;
  internalTitle: string;
  status: string;
  /** On a community offer: the course product it also holds, or null. */
  courseProductId?: number | null;
  /** On a course offer: the community product it also holds, or null. */
  communityProductId?: number | null;
}

export interface CourseSettings {
  courseId: number;
  published: boolean;
  communityId: number | null;
  courseProductId: number | null;
  communities: CourseCommunityOption[];
  community: (CourseCommunityOption & { products: CourseProduct[] }) | null;
  /** Offers that sell the community; a `courseProductId` = the course is behind its paywall. */
  communityOffers: CourseSettingsOffer[];
  /** Offers that sell the course; a `communityProductId` = buyers get into the community too. */
  courseOffers: CourseSettingsOffer[];
}

export interface CourseLiveSession {
  id: number;
  communityEventId: number | null;
  lessonId: number | null;
  createdAt: string;
  title: string;
  startsAt: string | null;
  durationMinutes: number | null;
  communityId: number | null;
  communityName: string | null;
  communitySlug: string | null;
  eventExists: boolean;
  lessonTitle: string | null;
  lessonPublished: boolean | null;
  lessonModuleId: number | null;
  lessonHasRecording: boolean | null;
}

const hub = (courseId: number, path: string) => `/${courseId}/hub${path}`;

export const courseHubApi = {
  setWatchExemption: (courseId: number, memberId: number, exempt: boolean, reason: string) =>
    call<{ exempt: boolean }>(`/${courseId}/watch-exemptions/${memberId}`, {
      method: "PUT", body: JSON.stringify({ exempt, reason }),
    }),
  /** The course row itself — unlike the list, this finds a coaching workbook too. */
  course: (courseId: number) => call<Course>(`/${courseId}`),
  offers: (courseId: number) =>
    call<{ products: CourseProduct[]; offers: CourseOffer[] }>(hub(courseId, "/offers")),
  /** The course's product, made if it has none. Safe to call every time. */
  ensureProduct: (courseId: number) =>
    call<CourseProduct & { created: boolean }>(hub(courseId, "/product"), { method: "POST" }),
  customers: (courseId: number) =>
    call<{ lessonsTotal: number; customers: CourseCustomer[] }>(hub(courseId, "/customers")),
  settings: (courseId: number) => call<CourseSettings>(hub(courseId, "/settings")),
  settingsSave: (courseId: number, data: { communityId: number | null }) =>
    call<{ courseId: number; communityId: number | null }>(hub(courseId, "/settings"), {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  liveSessions: (courseId: number) => call<CourseLiveSession[]>(hub(courseId, "/live-sessions")),
  liveSessionAdd: (courseId: number, data: { communityEventId: number; lessonId: number | null }) =>
    call<{ id: number }>(hub(courseId, "/live-sessions"), { method: "POST", body: JSON.stringify(data) }),
  liveSessionRemove: (courseId: number, sessionId: number) =>
    call<void>(hub(courseId, `/live-sessions/${sessionId}`), { method: "DELETE" }),
};
