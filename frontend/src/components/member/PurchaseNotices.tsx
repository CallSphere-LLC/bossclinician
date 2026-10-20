import { useCallback, useEffect, useState } from "react";
import { ShoppingBag, X } from "lucide-react";
import { GlassCard } from "@/components/luxe/GlassCard";
import { LuxeButton } from "@/components/luxe/LuxeButton";
import {
  PURCHASE_NOTIFICATION_KIND,
  inAppPath,
  notificationsApi,
  type MemberNotification,
} from "@/lib/notificationsApi";
import {
  NOTIFICATIONS_CHANGED_EVENT,
  announceNotificationsChanged,
} from "@/lib/notificationSignal";

/**
 * "New purchase" — the unread purchase notices, at the top of the library.
 *
 * The library is where a member lands after signing in and after checkout, so
 * this is the first thing they see after buying: what they bought and one
 * button that goes straight to it. Opening or dismissing a notice marks it read,
 * which also clears it from the bell.
 */
export function PurchaseNotices() {
  const [items, setItems] = useState<MemberNotification[]>([]);

  const load = useCallback(async () => {
    try {
      const page = await notificationsApi.list({
        unread: true,
        kind: PURCHASE_NOTIFICATION_KIND,
        perPage: 5,
      });
      setItems(page.notifications.filter((n) => !n.read && inAppPath(n.link)));
    } catch {
      // A nicety above the shelf: if it cannot load, the shelf is still there.
      setItems([]);
    }
  }, []);

  useEffect(() => {
    void load();
    const onChanged = () => void load();
    window.addEventListener(NOTIFICATIONS_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(NOTIFICATIONS_CHANGED_EVENT, onChanged);
  }, [load]);

  const markRead = (id: number) => {
    setItems((current) => current.filter((n) => n.id !== id));
    void notificationsApi
      .markRead({ ids: [id] })
      .then(() => announceNotificationsChanged())
      .catch(() => undefined);
  };

  if (items.length === 0) return null;

  return (
    <section aria-labelledby="purchase-notices-heading" className="flex flex-col gap-3">
      <h2
        id="purchase-notices-heading"
        className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-gold"
      >
        {items.length === 1 ? "New purchase" : "New purchases"}
      </h2>
      <ul className="flex flex-col gap-3">
        {items.map((notice) => (
          <li key={notice.id}>
            <GlassCard accent="gold" spotlight={false} interactive={false} className="p-4 sm:p-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-6">
                <span
                  aria-hidden
                  className="hidden size-11 shrink-0 place-items-center rounded-full border border-gold/25 bg-gold/[0.08] sm:grid"
                >
                  <ShoppingBag className="size-5 text-gold" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-balance font-display text-[1.1rem] leading-snug text-white">
                    {notice.title}
                  </p>
                  {notice.body && (
                    <p className="mt-1 text-sm leading-relaxed text-orchid-dim">{notice.body}</p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <LuxeButton
                    size="sm"
                    to={inAppPath(notice.link)}
                    onClick={() => markRead(notice.id)}
                  >
                    Open
                  </LuxeButton>
                  <button
                    type="button"
                    onClick={() => markRead(notice.id)}
                    aria-label={`Dismiss: ${notice.title}`}
                    className="grid size-11 place-items-center rounded-full text-orchid-dim transition-colors duration-300 hover:bg-white/[0.06] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
                  >
                    <X aria-hidden className="size-4" />
                  </button>
                </div>
              </div>
            </GlassCard>
          </li>
        ))}
      </ul>
    </section>
  );
}
