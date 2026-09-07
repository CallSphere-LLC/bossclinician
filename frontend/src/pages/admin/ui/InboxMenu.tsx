import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Inbox } from "lucide-react";
import { ApiError, getToken } from "@/lib/api";
import { formatRelative } from "@/lib/format";

/**
 * The top-right Inbox — Final Sidebar & Page UX Requirements §3.
 *
 * §3 asks for an inbox in the global header, available from every admin page,
 * with an unread badge, sitting beside the notification / help / theme /
 * profile controls rather than becoming another sidebar item.
 *
 * **What this is, honestly.** §3 describes the Inbox as "actual one-to-one
 * conversations and replies". This platform has no two-way messaging: there is
 * no inbound mailbox, no message threads, and no reply path. What it does have
 * is the conversations people start on the website, which the assistant
 * answers — real exchanges with real people, which the owner reads and follows
 * up on. That is what this shows.
 *
 * So the badge counts conversations that have arrived since she last opened
 * the list, and each one opens the transcript with a route through to the
 * person. Replying still happens by email from the contact record, because
 * that is the only reply channel that exists. Building true inbound threads
 * needs a mailbox, a thread model and a send-as identity — none of which is
 * here, and none of which should be faked behind a button that looks like it
 * sends.
 */

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "/api";
const SEEN_KEY = "bc_admin_inbox_seen";

export interface InboxConversation {
  id: number;
  startedAt: string;
  preview: string;
  messageCount: number;
}

async function fetchConversations(): Promise<InboxConversation[]> {
  const token = getToken();
  const headers = new Headers({ "Content-Type": "application/json" });
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(`${API_BASE}/admin/chats`, { headers });
  if (!res.ok) throw new ApiError("Could not load the inbox.", res.status);
  // The endpoint answers with a bare array, camelCased — not an envelope.
  const body = (await res.json()) as
    | { id: number; startedAt: string; preview?: string | null; messageCount?: number }[]
    | null;
  return (Array.isArray(body) ? body : []).map((s) => ({
    id: s.id,
    startedAt: s.startedAt,
    preview: s.preview?.trim() || "Nothing was said",
    messageCount: s.messageCount ?? 0,
  }));
}

/** When this operator last opened the inbox. Per-browser, like the bell. */
function lastSeen(): string | null {
  try {
    return window.localStorage.getItem(SEEN_KEY);
  } catch {
    return null;
  }
}

function markSeen(): void {
  try {
    window.localStorage.setItem(SEEN_KEY, new Date().toISOString());
  } catch {
    // Storage disabled. The badge keeps showing — annoying, not broken.
  }
}

export function useInbox(pollKey: unknown) {
  const [conversations, setConversations] = useState<InboxConversation[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchConversations()
      .then((list) => !cancelled && setConversations(list))
      // A role without `contacts.view` gets a 403; an empty inbox is the right
      // rendering for that, not an error in the header of every page.
      .catch(() => !cancelled && setConversations([]));
    return () => {
      cancelled = true;
    };
  }, [pollKey]);

  return conversations;
}

export function InboxMenu({ conversations }: { conversations: InboxConversation[] | null }) {
  const [unseen, setUnseen] = useState(0);

  useEffect(() => {
    if (!conversations) return setUnseen(0);
    const seen = lastSeen();
    setUnseen(seen ? conversations.filter((c) => c.startedAt > seen).length : conversations.length);
  }, [conversations]);

  const onOpenChange = useCallback((open: boolean) => {
    if (!open) return;
    markSeen();
    setUnseen(0);
  }, []);

  const list = conversations ?? [];

  return (
    <DropdownMenu.Root onOpenChange={onOpenChange}>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label={unseen > 0 ? `Inbox, ${unseen} new` : "Inbox"}
          title={unseen > 0 ? `${unseen} new` : "Inbox"}
          className="relative grid size-9 place-items-center rounded-xl border border-hairline text-ink-soft transition-colors hover:border-accent/45 hover:text-accent"
        >
          <Inbox aria-hidden className="size-4" />
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
            <p className="text-[0.8rem] font-semibold text-ink">Inbox</p>
            <DropdownMenu.Item asChild>
              <Link
                to="/admin/conversations"
                className="cursor-pointer rounded-md text-[0.74rem] font-semibold text-accent outline-none hover:underline"
              >
                See all
              </Link>
            </DropdownMenu.Item>
          </div>

          {conversations === null ? (
            <p className="px-4 py-6 text-center text-sm text-ink-soft">Loading…</p>
          ) : list.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-ink-soft">
              No conversations yet. Messages people start on your website will appear here.
            </p>
          ) : (
            <ul className="max-h-[24rem] divide-y divide-hairline/50 overflow-y-auto">
              {list.slice(0, 8).map((conversation) => (
                <li key={conversation.id}>
                  <DropdownMenu.Item asChild>
                    <Link
                      to="/admin/conversations"
                      className="flex cursor-pointer items-start gap-3 px-4 py-2.5 outline-none data-[highlighted]:bg-raise"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[0.83rem] text-ink">
                          {conversation.preview}
                        </span>
                        <span className="block text-[0.72rem] text-ink-soft">
                          {conversation.messageCount === 1
                            ? "1 message"
                            : `${conversation.messageCount} messages`}
                        </span>
                      </span>
                      <time
                        dateTime={conversation.startedAt}
                        className="shrink-0 font-numeric text-[0.7rem] tabular-nums text-ink-soft"
                      >
                        {formatRelative(conversation.startedAt)}
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
