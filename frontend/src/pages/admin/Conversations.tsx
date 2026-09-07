import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { Bot, MessagesSquare, Mic, Trash2, User } from "lucide-react";
import { toast } from "sonner";
import { adminApi } from "@/lib/api";
import type { ChatSessionDetail, ChatSessionSummary } from "@/types/admin";
import { cn } from "@/lib/cn";
import { formatDateTime, formatRelative } from "@/lib/format";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorNotice,
  PageHeader,
  Skeleton,
} from "@/pages/admin/ui/primitives";
import { friendlyError, pluralize } from "@/pages/admin/ui/friendly";
import { useConfirm } from "@/pages/admin/ui/Dialog";

/** The cap the list request pages at; the count below says so rather than implying a total. */
const LIST_LIMIT = 200;

/** Set by the voice transcript endpoint — a spoken session, or one of each. */
function isVoice(session: ChatSessionSummary): boolean {
  return session.meta.voice === true;
}

/**
 * Who said a line. The stored value is a one-word role; the two people in the
 * room are the visitor on her website and the assistant answering them, and
 * that's what the transcript calls them.
 */
function speaker(role: string): string {
  return role === "user" ? "Visitor" : "AI assistant";
}

/** What a chat with nothing in it is called, everywhere it's named. */
const EMPTY_PREVIEW = "Nothing was said";

export default function Conversations() {
  const [sessions, setSessions] = useState<ChatSessionSummary[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ChatSessionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [confirm, confirmDialog] = useConfirm();

  const load = useCallback(() => {
    adminApi
      .chatSessions()
      .then((list) => {
        setSessions(list);
        // Keep the open transcript open across reloads; fall back to the newest.
        setActiveId((prev) =>
          prev && list.some((s) => s.id === prev) ? prev : (list[0]?.id ?? null),
        );
      })
      .catch(() => setError("We couldn't load your conversations. Try refreshing the page."));
  }, []);

  useEffect(load, [load]);

  useEffect(() => {
    setDetail(null);
    setDetailError(null);
    if (!activeId) return;

    // Clicking through the list faster than the network answers would
    // otherwise let a stale transcript overwrite the one now selected.
    let current = true;
    adminApi
      .chatSession(activeId)
      .then((data) => {
        if (current) setDetail(data);
      })
      .catch(() => {
        if (current) setDetailError("We couldn't open that conversation. Try clicking it again.");
      });
    return () => {
      current = false;
    };
  }, [activeId]);

  const active = useMemo(
    () => sessions?.find((s) => s.id === activeId) ?? null,
    [sessions, activeId],
  );

  const remove = useCallback(
    async (session: ChatSessionSummary) => {
      const ok = await confirm({
        title: "Delete this conversation?",
        description: "Everything that was said goes with it, and you won't be able to get it back.",
        confirmLabel: "Yes, delete it",
        destructive: true,
      });
      if (!ok) return;
      try {
        await adminApi.chatSessionDelete(session.id);
        toast.success("Conversation deleted");
        setActiveId(null);
        load();
      } catch (err) {
        toast.error(friendlyError(err, "conversation"));
      }
    },
    [confirm, load],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="People"
        title="Inbox"
        description="One-to-one conversations with the people who contact you."
      />

      {error && <ErrorNotice message={error} />}

      {sessions === null ? (
        <Skeleton className="h-64 w-full" />
      ) : sessions.length === 0 ? (
        <Card>
          <EmptyState
            icon={<MessagesSquare />}
            title="No conversations yet"
            description="When someone chats with the assistant on your website — by typing or by talking — the whole conversation shows up here."
          />
        </Card>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[20rem_minmax(0,1fr)]">
          <Card className="h-fit">
            <CardHeader
              title="Recent chats"
              subtitle={
                sessions.length === LIST_LIMIT
                  ? `Your ${LIST_LIMIT} most recent`
                  : pluralize(sessions.length, "conversation")
              }
            />
            <ul className="max-h-[34rem] space-y-0.5 overflow-y-auto p-2">
              {sessions.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => setActiveId(s.id)}
                    className={cn(
                      "w-full rounded-lg px-3 py-2.5 text-left transition-colors",
                      activeId === s.id
                        ? "bg-lilac-tint text-plum-deep"
                        : "text-ink-soft hover:bg-cream",
                    )}
                  >
                    <span className="line-clamp-2 text-sm font-medium">
                      {s.preview ?? EMPTY_PREVIEW}
                    </span>
                    <span className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                      <span className="opacity-70">
                        {formatRelative(s.lastMessageAt ?? s.startedAt)}
                      </span>
                      <span aria-hidden className="opacity-70">
                        ·
                      </span>
                      <span className="opacity-70">{pluralize(s.messageCount, "message")}</span>
                      {isVoice(s) && (
                        <Badge tone="gold" className="px-2 py-0.5 text-[0.6rem]">
                          <Mic className="size-3" />
                          Voice
                        </Badge>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Card>

          {active && (
            <Card>
              <CardHeader
                title={active.preview ?? EMPTY_PREVIEW}
                subtitle={`${isVoice(active) ? "Voice chat" : "Typed chat"} · started ${formatDateTime(
                  active.startedAt,
                )}`}
                icon={<MessagesSquare className="size-4" />}
                action={
                  <Button
                    variant="dangerGhost"
                    size="iconSm"
                    aria-label="Delete this conversation"
                    onClick={() => remove(active)}
                  >
                    <Trash2 />
                  </Button>
                }
              />

              <div className="space-y-4 p-5">
                {detailError ? (
                  <ErrorNotice message={detailError} />
                ) : detail === null ? (
                  <>
                    <Skeleton className="h-16 w-2/3" />
                    <Skeleton className="ml-auto h-16 w-2/3" />
                    <Skeleton className="h-16 w-1/2" />
                  </>
                ) : detail.messages.length === 0 ? (
                  <EmptyState
                    icon={<MessagesSquare />}
                    title={EMPTY_PREVIEW}
                    description="Someone opened the chat on your website but never sent a message."
                  />
                ) : (
                  detail.messages.map((m) => {
                    const fromVisitor = m.role === "user";
                    return (
                      <motion.div
                        key={m.id}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        className={cn("flex gap-3", fromVisitor && "flex-row-reverse")}
                      >
                        <span
                          className={cn(
                            "grid size-8 shrink-0 place-items-center rounded-full [&_svg]:size-4",
                            fromVisitor
                              ? "bg-plum-bright/[0.18] text-lilac"
                              : "bg-gold/[0.12] text-gold",
                          )}
                        >
                          {fromVisitor ? <User /> : <Bot />}
                        </span>
                        <div className="min-w-0 max-w-[42rem]">
                          <p
                            className={cn(
                              "whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-relaxed",
                              fromVisitor
                                ? "rounded-tr-sm border border-plum-bright/30 bg-plum-bright/[0.14] text-ink"
                                : "rounded-tl-sm border border-hairline bg-raise text-ink-soft",
                            )}
                          >
                            {m.content}
                          </p>
                          <p
                            className={cn(
                              "mt-1 text-[0.7rem] text-ink-soft/70",
                              fromVisitor && "text-right",
                            )}
                          >
                            {speaker(m.role)} · {formatDateTime(m.createdAt)}
                          </p>
                        </div>
                      </motion.div>
                    );
                  })
                )}
              </div>
            </Card>
          )}
        </div>
      )}

      {confirmDialog}
    </div>
  );
}
