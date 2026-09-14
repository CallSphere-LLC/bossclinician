import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router";
import { Loader2, MessageSquare, Send } from "lucide-react";
import { CommunityLayout } from "@/components/community/CommunityLayout";
import { GlassCard } from "@/components/luxe/GlassCard";
import { MemberApiError } from "@/lib/memberApi";
import {
  communityApi,
  type DmMessage,
  type DmThread,
  type DmThreadSummary,
} from "@/lib/communityApi";
import { conversationList, conversationPane } from "@/lib/dmConversations";
import { formatRelative } from "@/lib/format";
import { announceNotificationsChanged } from "@/lib/notificationSignal";
import { cn } from "@/lib/cn";

/**
 * Direct messages inside a community.
 *
 * Scoped to the room rather than being a site-wide inbox, which is the same
 * decision the server makes: a DM is between two people who are in the same
 * community, and losing access to the room ends the ability to write into it.
 *
 * Two panes on desktop, one at a time on a phone — a conversation list beside a
 * thread is unreadable at 380px, and the URL carries which thread is open so
 * back does the obvious thing.
 */
export default function MemberCommunityMessages() {
  const { slug = "", memberId } = useParams();
  return (
    <CommunityLayout slug={slug} noChannel showSidebar={false}>
      {() => <Messages slug={slug} openWith={memberId ? Number(memberId) : null} />}
    </CommunityLayout>
  );
}

function Messages({ slug, openWith }: { slug: string; openWith: number | null }) {
  const navigate = useNavigate();
  const [threads, setThreads] = useState<DmThreadSummary[] | null>(null);
  const [thread, setThread] = useState<DmThread | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [openFailed, setOpenFailed] = useState(false);

  const loadThreads = useCallback(async () => {
    try {
      const res = await communityApi.dmThreads(slug);
      setThreads(res.threads);
    } catch (err) {
      setError(
        err instanceof MemberApiError ? err.message : "We couldn't load your messages.",
      );
    }
  }, [slug]);

  useEffect(() => {
    void loadThreads();
  }, [loadThreads]);

  useEffect(() => {
    if (openWith === null) {
      setThread(null);
      return;
    }
    let cancelled = false;
    setOpenFailed(false);
    (async () => {
      try {
        const res = await communityApi.dmThread(slug, openWith);
        if (!cancelled) {
          setThread(res);
          // Opening a thread marks it read on the server, so the badge in the
          // list beside it has to be refreshed or it lies until a reload —
          // and so does the bell, which counted the same messages.
          void loadThreads();
          announceNotificationsChanged();
        }
      } catch (err) {
        if (!cancelled) {
          setOpenFailed(true);
          setError(
            err instanceof MemberApiError
              ? err.message
              : "We couldn't open that conversation.",
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug, openWith, loadThreads]);

  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [thread?.messages.length]);

  const send = async () => {
    if (openWith === null || draft.trim() === "") return;
    setSending(true);
    try {
      const sent: DmMessage = await communityApi.sendDm(slug, openWith, draft);
      setThread((prev) => (prev ? { ...prev, messages: [...prev.messages, sent] } : prev));
      setDraft("");
      void loadThreads();
    } catch (err) {
      setError(
        err instanceof MemberApiError ? err.message : "That message didn't send.",
      );
    } finally {
      setSending(false);
    }
  };

  if (threads === null) {
    return (
      <div className="grid place-items-center py-20">
        <Loader2 aria-hidden className="size-6 animate-spin text-gold" />
        <span className="sr-only">Loading your messages</span>
      </div>
    );
  }

  // The server lists only conversations somebody has written in; the one open
  // on the right is listed here too, even before its first message, so the
  // list never says "No conversations yet" beside a conversation.
  const rows = conversationList(threads, openWith, thread);
  const pane = conversationPane(rows, openWith, thread, openFailed);

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl text-white">Messages</h1>
      {error && <p className="text-sm text-red-300">{error}</p>}

      <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <GlassCard
          accent="plum"
          spotlight={false}
          interactive={false}
          className={cn("p-2", openWith !== null && "hidden lg:block")}
        >
          {pane === "opening" ? (
            <div className="grid place-items-center py-6">
              <Loader2 aria-hidden className="size-5 animate-spin text-gold" />
              <span className="sr-only">Opening the conversation</span>
            </div>
          ) : pane === "empty" ? (
            <p className="px-3 py-4 text-sm text-white/55">
              No conversations yet. Open somebody's profile from the members list
              to start one.
            </p>
          ) : (
            <ul className="space-y-0.5">
              {rows.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => navigate(`/community/${slug}/messages/${t.otherMemberId}`)}
                    aria-current={t.otherMemberId === openWith ? "page" : undefined}
                    className={cn(
                      "flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors",
                      t.otherMemberId === openWith
                        ? "bg-gold/[0.12]"
                        : "hover:bg-white/[0.05]",
                    )}
                  >
                    {t.otherAvatarUrl ? (
                      <img src={t.otherAvatarUrl} alt="" className="size-8 shrink-0 rounded-full object-cover" />
                    ) : (
                      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-white/10 text-xs font-bold text-white/70">
                        {t.otherName.charAt(0).toUpperCase()}
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-white">
                        {t.otherName}
                      </span>
                      <span className="block truncate text-xs text-white/50">
                        {t.preview || (t.lastMessageAt === null ? "No messages yet" : "")}
                      </span>
                    </span>
                    {t.unread > 0 && (
                      <span className="grid min-w-[1.15rem] shrink-0 place-items-center rounded-full bg-gold px-1 text-[0.6rem] font-bold leading-[1.15rem] text-night-deep">
                        {t.unread > 99 ? "99+" : t.unread}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </GlassCard>

        {openWith === null ? (
          <GlassCard
            accent="gold"
            spotlight={false}
            interactive={false}
            className="hidden place-items-center p-10 text-center lg:grid"
          >
            <div>
              <MessageSquare aria-hidden className="mx-auto size-6 text-white/40" />
              <p className="copy-luxe mt-3 text-sm">
                Pick a conversation, or start one from someone's profile.
              </p>
            </div>
          </GlassCard>
        ) : (
          <GlassCard
            accent="plum"
            spotlight={false}
            interactive={false}
            className="flex max-h-[36rem] flex-col p-4"
          >
            <div className="flex items-center gap-3 border-b border-white/10 pb-3">
              <button
                type="button"
                onClick={() => navigate(`/community/${slug}/messages`)}
                className="min-h-11 text-xs font-semibold uppercase tracking-[0.12em] text-orchid-dim lg:hidden"
              >
                ← All
              </button>
              <p className="font-display text-lg text-white">{thread?.other.name ?? "…"}</p>
            </div>

            <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto py-4">
              {thread === null ? (
                <Loader2 aria-hidden className="mx-auto size-5 animate-spin text-gold" />
              ) : thread.messages.length === 0 ? (
                <p className="text-sm text-white/50">
                  Nothing here yet. Say hello.
                </p>
              ) : (
                thread.messages.map((m) => (
                  <div
                    key={m.id}
                    className={cn("flex", m.mine ? "justify-end" : "justify-start")}
                  >
                    <div
                      className={cn(
                        "max-w-[80%] rounded-2xl px-3.5 py-2.5",
                        m.mine ? "bg-gold/15 text-white" : "bg-white/[0.06] text-white/85",
                      )}
                    >
                      <p className="whitespace-pre-wrap break-words text-sm">{m.body}</p>
                      <p className="mt-1 text-[0.65rem] text-white/40">
                        {formatRelative(m.at)}
                      </p>
                    </div>
                  </div>
                ))
              )}
              <div ref={endRef} />
            </div>

            <form
              className="flex gap-2 border-t border-white/10 pt-3"
              onSubmit={(event) => {
                event.preventDefault();
                void send();
              }}
            >
              <input
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="Write a message…"
                aria-label="Write a message"
                maxLength={4000}
                className="h-11 min-w-0 flex-1 rounded-xl border border-white/12 bg-white/[0.04] px-3 text-sm text-white placeholder:text-white/35"
              />
              <button
                type="submit"
                disabled={sending || draft.trim() === ""}
                aria-label="Send"
                className="grid size-11 shrink-0 place-items-center rounded-xl border border-white/12 text-white/80 disabled:opacity-40"
              >
                <Send aria-hidden className="size-4" />
              </button>
            </form>
          </GlassCard>
        )}
      </div>
    </div>
  );
}
