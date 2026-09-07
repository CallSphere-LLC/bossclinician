import { ApiError, getToken } from "@/lib/api";

/**
 * Console-wide services — the header's global search and notification feed
 * (Part II §10, §42).
 */

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "/api";

async function request<T>(path: string, signal?: AbortSignal): Promise<T> {
  const token = getToken();
  const headers = new Headers({ "Content-Type": "application/json" });
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(`${API_BASE}${path}`, { headers, signal });
  if (!res.ok) {
    let message = "Something went wrong. Please try again in a moment.";
    try {
      const body = (await res.json()) as { error?: string; message?: string };
      message = body.error ?? body.message ?? message;
    } catch {
      // A non-JSON body tells us nothing worth showing.
    }
    throw new ApiError(message, res.status);
  }
  return (await res.json()) as T;
}

export interface SearchHit {
  kind: "contact" | "order" | "product" | "offer";
  id: number;
  title: string;
  subtitle: string;
  to: string;
}

export type NotificationCategory =
  | "sales"
  | "payments"
  | "customers"
  | "coaching"
  | "community"
  | "marketing"
  | "system";

export interface ConsoleNotification {
  id: string;
  category: NotificationCategory;
  title: string;
  detail: string;
  at: string;
  to: string;
}

export const consoleApi = {
  search: (q: string, signal?: AbortSignal) =>
    request<{ query: string; hits: SearchHit[] }>(
      `/admin/search?q=${encodeURIComponent(q)}`,
      signal,
    ),

  notifications: (limit = 30) =>
    request<{ notifications: ConsoleNotification[] }>(`/admin/notifications?limit=${limit}`),
};

/* ── Read state ─────────────────────────────────────────────────────────── */

const SEEN_KEY = "bc_admin_notifications_seen";

/**
 * When this operator last opened the notification list.
 *
 * Deliberately per-browser rather than per-account on the server: "have I read
 * this" is a preference, not a fact about the business, and storing it server-
 * side would mean a table, a write on every dropdown open, and a shared
 * read-state between two people signed in as the same owner account.
 */
export function lastSeenNotificationsAt(): string | null {
  try {
    return window.localStorage.getItem(SEEN_KEY);
  } catch {
    return null;
  }
}

export function markNotificationsSeen(): void {
  try {
    window.localStorage.setItem(SEEN_KEY, new Date().toISOString());
  } catch {
    // Storage disabled. The badge simply keeps showing — annoying, not broken.
  }
}

/** How many arrived since the list was last opened. */
export function unseenCount(notifications: ConsoleNotification[]): number {
  const seen = lastSeenNotificationsAt();
  if (!seen) return notifications.length;
  return notifications.filter((n) => n.at > seen).length;
}

export const NOTIFICATION_CATEGORIES: { key: NotificationCategory; label: string }[] = [
  { key: "sales", label: "Sales" },
  { key: "payments", label: "Payments" },
  { key: "customers", label: "Customers" },
  { key: "coaching", label: "Coaching" },
  { key: "community", label: "Community" },
  { key: "marketing", label: "Marketing" },
  { key: "system", label: "System" },
];
