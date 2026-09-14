/**
 * A nudge for the notification bell.
 *
 * The bell polls slowly (see NotificationBell). Some screens change its count
 * as a side effect — opening a direct message marks that conversation's bell
 * entries read on the server — and a badge beside the thread that clears at
 * once while the bell keeps the old number for up to a minute and a half reads
 * as a bug. Those screens announce the change; the bell refetches.
 */
export const NOTIFICATIONS_CHANGED_EVENT = "bc:notifications-changed";

export function announceNotificationsChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED_EVENT));
}
