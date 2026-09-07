import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Bell } from "lucide-react";
import { formatRelative } from "@/lib/format";
import {
  consoleApi,
  markNotificationsSeen,
  unseenCount,
  type ConsoleNotification,
  type NotificationCategory,
} from "@/lib/consoleApi";
import { cn } from "@/lib/cn";

/**
 * The header notification dropdown — Part II §42.
 *
 * The dedicated page lives at /admin/notifications; this is the glance
 * version. Both read the same derived feed (see `console.ts` on the server),
 * so what is counted here is exactly what the page lists.
 *
 * The badge counts what arrived since the list was last opened, and opening
 * the dropdown is what marks it seen — the count is a prompt to look, and it
 * has done its job once she has.
 */

/** Chip styling for a category, shared with the Notifications page. */
export const CATEGORY_TONE: Record<NotificationCategory, string> = {
  sales: "bg-pos-soft text-pos",
  payments: "bg-neg-soft text-neg",
  customers: "bg-accent-soft text-accent",
  coaching: "bg-accent-soft text-accent",
  community: "bg-warn-soft text-warn",
  marketing: "bg-warn-soft text-warn",
  system: "bg-raise text-ink-soft",
};

/**
 * The 8px dot beside a row. Written out per category rather than derived from
 * the chip classes above: Tailwind scans source text, so a class assembled at
 * runtime is a class that never gets generated.
 */
const CATEGORY_DOT: Record<NotificationCategory, string> = {
  sales: "bg-pos",
  payments: "bg-neg",
  customers: "bg-accent",
  coaching: "bg-accent",
  community: "bg-warn",
  marketing: "bg-warn",
  system: "bg-ink-soft",
};

export function useNotifications(pollKey: unknown) {
  const [notifications, setNotifications] = useState<ConsoleNotification[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    consoleApi
      .notifications(30)
      .then((result) => !cancelled && setNotifications(result.notifications))
      // A role with no visible sources gets an empty feed rather than an
      // error; the bell simply has nothing under it.
      .catch(() => !cancelled && setNotifications([]));
    return () => {
      cancelled = true;
    };
  }, [pollKey]);

  return notifications;
}

export function NotificationsMenu({ notifications }: { notifications: ConsoleNotification[] | null }) {
  const [unseen, setUnseen] = useState(0);

  useEffect(() => {
    setUnseen(notifications ? unseenCount(notifications) : 0);
  }, [notifications]);

  const onOpenChange = useCallback((open: boolean) => {
    if (!open) return;
    markNotificationsSeen();
    setUnseen(0);
  }, []);

  const list = notifications ?? [];

  return (
    <DropdownMenu.Root onOpenChange={onOpenChange}>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label={unseen > 0 ? `Notifications, ${unseen} new` : "Notifications"}
          title={unseen > 0 ? `${unseen} new` : "Notifications"}
          className="relative grid size-9 place-items-center rounded-xl border border-hairline text-ink-soft transition-colors hover:border-accent/45 hover:text-accent"
        >
          <Bell aria-hidden className="size-4" />
          {unseen > 0 && (
            <span className="absolute -right-1 -top-1 grid min-w-[1.15rem] place-items-center rounded-full bg-accent-solid px-1 font-numeric text-[0.62rem] font-bold text-accent-on">
              {unseen > 99 ? "99+" : unseen}
            </span>
          )}
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          className="z-50 w-[22rem] max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-xl border border-hairline bg-surface-raised shadow-console-pop"
        >
          <div className="flex items-center justify-between border-b border-hairline/60 px-4 py-2.5">
            <p className="text-[0.8rem] font-semibold text-ink">Notifications</p>
            <DropdownMenu.Item asChild>
              <Link
                to="/admin/notifications"
                className="cursor-pointer rounded-md text-[0.74rem] font-semibold text-accent outline-none hover:underline"
              >
                See all
              </Link>
            </DropdownMenu.Item>
          </div>

          {notifications === null ? (
            <p className="px-4 py-6 text-center text-sm text-ink-soft">Loading…</p>
          ) : list.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-ink-soft">
              Nothing has happened yet. Sales, payments and bookings will show up here.
            </p>
          ) : (
            <ul className="max-h-[24rem] divide-y divide-hairline/50 overflow-y-auto">
              {list.slice(0, 10).map((item) => (
                <li key={item.id}>
                  <DropdownMenu.Item asChild>
                    <Link
                      to={item.to}
                      className="flex cursor-pointer items-start gap-3 px-4 py-2.5 outline-none data-[highlighted]:bg-raise"
                    >
                      <span
                        aria-hidden
                        className={cn(
                          "mt-1 size-2 shrink-0 rounded-full",
                          CATEGORY_DOT[item.category],
                        )}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[0.83rem] font-medium text-ink">
                          {item.title}
                        </span>
                        <span className="block truncate text-[0.74rem] text-ink-soft">
                          {item.detail}
                        </span>
                      </span>
                      <time
                        dateTime={item.at}
                        className="shrink-0 font-numeric text-[0.7rem] tabular-nums text-ink-soft"
                      >
                        {formatRelative(item.at)}
                      </time>
                    </Link>
                  </DropdownMenu.Item>
                </li>
              ))}
            </ul>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
