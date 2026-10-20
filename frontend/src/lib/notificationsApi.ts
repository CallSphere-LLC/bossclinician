import { memberRequest } from "@/lib/memberApi";
import type {
  CommunityNotification,
  MarkReadResult,
  NotificationPage,
} from "@/lib/communityApi";

/**
 * The member area's inbox: `/api/member/notifications`.
 *
 * The same rows the community bell always showed — community replies and
 * mentions, and now "you now have access to …" when something is bought — read
 * from a path that belongs to the whole member area rather than to a community.
 */

export type MemberNotification = CommunityNotification;
export type { MarkReadResult, NotificationPage };

/** Written by the server when a purchase (or gift, or admin grant) lands. */
export const PURCHASE_NOTIFICATION_KIND = "purchase_access";

function query(params: Record<string, string | number | boolean | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  const encoded = search.toString();
  return encoded ? `?${encoded}` : "";
}

export const notificationsApi = {
  list: (input: { page?: number; perPage?: number; unread?: boolean; kind?: string } = {}) =>
    memberRequest<NotificationPage>(`/member/notifications${query({ ...input })}`),

  markRead: (input: { ids: number[] } | { all: true }) =>
    memberRequest<MarkReadResult>("/member/notifications/read", {
      method: "POST",
      body: JSON.stringify(input),
    }),
};

/**
 * A notification's link as a route, or "" when it is not one.
 *
 * `link` arrives from the API as an in-app path. It is routed, never opened as
 * a URL, and anything that is not a single-leading-slash path is dropped — a
 * protocol-relative `//evil.example` would otherwise leave the site from what
 * looks like an internal link.
 */
export function inAppPath(link: string): string {
  return link.startsWith("/") && !link.startsWith("//") && !link.startsWith("/\\") ? link : "";
}
