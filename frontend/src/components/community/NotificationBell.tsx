import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Bell, CheckCheck, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { MemberAvatar } from "@/components/member/MemberShell";
import { MemberApiError } from "@/lib/memberApi";
import { communityApi, type CommunityNotification } from "@/lib/communityApi";
import { formatRelative } from "@/lib/format";
import { NOTIFICATIONS_CHANGED_EVENT } from "@/lib/notificationSignal";
import { cn } from "@/lib/cn";

/**
 * The bell.
 *
 * The count is refetched on a slow interval and again whenever the dropdown is
 * opened. A socket would be the obvious answer and is the wrong one here: this
 * is a coaching community where the interesting event is somebody replying to
 * you an hour later, and a persistent connection per reader is a lot of
 * machinery for a number that is allowed to be a minute stale.
 *
 * `link` arrives from the API as an in-app path. It is routed, never opened as
 * a URL, and anything that is not a single-leading-slash path is dropped — a
 * protocol-relative `//evil.example` would otherwise leave the site from what
 * looks like an internal link.
 */

const POLL_MS = 90_000;

/** Same-origin paths only. `//host` is a URL wearing a path's clothes. */
function inAppPath(link: string): string {
  return link.startsWith("/") && !link.startsWith("//") ? link : "";
}

export function NotificationBell() {
  const navigate = useNavigate();
  const [items, setItems] = useState<CommunityNotification[] | null>(null);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const page = await communityApi.notifications({ perPage: 12 });
      setItems(page.notifications);
      setUnread(page.unreadCount);
      setError("");
    } catch (err) {
      // The bell sits in the page chrome, where a red banner about a missing
      // endpoint would be the loudest thing on a page it has nothing to do with.
      // A 404 here means no notification route answered; it stays quiet instead.
      if (err instanceof MemberApiError && err.status === 404) {
        setItems([]);
        setUnread(0);
        return;
      }
      setError(
        err instanceof MemberApiError
          ? err.message
          : "We could not load your notifications just now.",
      );
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    // A screen that just changed the count (opening a DM reads its entries)
    // says so, rather than leaving the bell stale until the next poll.
    const onChanged = () => void load();
    window.addEventListener(NOTIFICATIONS_CHANGED_EVENT, onChanged);
    return () => {
      clearInterval(timer);
      window.removeEventListener(NOTIFICATIONS_CHANGED_EVENT, onChanged);
    };
  }, [load]);

  const markRead = async (ids: number[]) => {
    const before = items ?? [];
    setItems(before.map((n) => (ids.includes(n.id) ? { ...n, read: true } : n)));
    setUnread((count) => Math.max(0, count - ids.length));
    try {
      const result = await communityApi.markRead({ ids });
      setUnread(result.unreadCount);
    } catch {
      setItems(before);
      void load();
    }
  };

  const markAll = async () => {
    const before = items ?? [];
    setItems(before.map((n) => ({ ...n, read: true })));
    setUnread(0);
    try {
      const result = await communityApi.markRead({ all: true });
      setUnread(result.unreadCount);
    } catch (err) {
      setItems(before);
      void load();
      toast.error(
        err instanceof MemberApiError ? err.message : "That did not save. Please try again.",
      );
    }
  };

  const openNotification = (notification: CommunityNotification) => {
    if (!notification.read) void markRead([notification.id]);
    const path = inAppPath(notification.link);
    if (path) navigate(path);
    setOpen(false);
  };

  return (
    <DropdownMenu.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) void load();
      }}
    >
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className={cn(
            "relative grid size-11 place-items-center rounded-full border border-white/12",
            "bg-white/[0.03] text-orchid transition-colors duration-300",
            "hover:border-gold/40 hover:bg-white/[0.07] hover:text-gold",
            "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold",
          )}
          aria-label={
            unread === 0
              ? "Notifications"
              : `Notifications — ${unread} unread`
          }
        >
          <Bell aria-hidden className="size-[1.05rem]" />
          {unread > 0 && (
            <span
              aria-hidden
              className="absolute -right-0.5 -top-0.5 grid min-w-[1.15rem] place-items-center rounded-full bg-gold px-1 text-[0.62rem] font-bold leading-[1.15rem] text-night-deep"
            >
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        {/* Colours named outright: the portal renders outside `.theme-luxe`,
            where the themeable tokens resolve to the light palette. */}
        <DropdownMenu.Content
          align="end"
          sideOffset={10}
          className="z-50 flex max-h-[75vh] w-[min(22rem,calc(100vw-1.5rem))] flex-col rounded-2xl border border-white/10 bg-night-raised shadow-[0_28px_60px_-20px_rgba(0,0,0,0.9)]"
        >
          <div className="flex items-center justify-between gap-3 border-b border-white/[0.08] px-4 py-3">
            <p className="font-display text-base text-white">Notifications</p>
            {unread > 0 && (
              <button
                type="button"
                onClick={() => void markAll()}
                className={cn(
                  "inline-flex min-h-[2.75rem] items-center gap-1.5 rounded-full px-2.5",
                  "text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-orchid-dim",
                  "transition-colors duration-300 hover:text-gold",
                  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold",
                )}
              >
                <CheckCheck aria-hidden className="size-3.5" />
                Mark all read
              </button>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-1.5" aria-live="polite">
            {error && (
              <p role="alert" className="px-3 py-4 text-sm font-medium text-red-400">
                {error}
              </p>
            )}

            {!error && items === null && (
              <p className="flex items-center gap-2 px-3 py-5 text-sm text-orchid-dim">
                <Loader2 aria-hidden className="size-4 animate-spin" />
                Loading…
              </p>
            )}

            {!error && items?.length === 0 && (
              <p className="px-3 py-6 text-center text-sm leading-relaxed text-orchid-dim">
                Nothing yet. Replies, mentions and badges land here.
              </p>
            )}

            {items?.map((notification) => (
              <DropdownMenu.Item
                key={notification.id}
                onSelect={() => openNotification(notification)}
                className={cn(
                  "flex cursor-pointer gap-3 rounded-xl px-3 py-3 outline-none",
                  "data-[highlighted]:bg-white/[0.07]",
                  !notification.read && "bg-gold/[0.06]",
                )}
              >
                {notification.actor ? (
                  <MemberAvatar
                    src={notification.actor.avatarUrl}
                    name={notification.actor.name}
                    email=""
                    className="size-8"
                  />
                ) : (
                  <span
                    aria-hidden
                    className="grid size-8 shrink-0 place-items-center rounded-full bg-white/[0.07]"
                  >
                    <Bell className="size-3.5 text-gold" />
                  </span>
                )}

                <span className="min-w-0 flex-1">
                  <span className="block text-[0.82rem] font-semibold leading-snug text-white">
                    {notification.title}
                  </span>
                  {notification.body && (
                    <span className="mt-0.5 line-clamp-2 block text-xs leading-relaxed text-orchid-dim">
                      {notification.body}
                    </span>
                  )}
                  <span className="mt-1 block text-[0.68rem] text-orchid-faint">
                    {formatRelative(notification.createdAt)}
                  </span>
                </span>

                {!notification.read && (
                  <span aria-hidden className="mt-1.5 size-2 shrink-0 rounded-full bg-gold" />
                )}
              </DropdownMenu.Item>
            ))}
          </div>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
