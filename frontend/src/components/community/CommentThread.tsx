import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Flag, Loader2, Reply, Send } from "lucide-react";
import { toast } from "sonner";
import { LuxeButton } from "@/components/luxe/LuxeButton";
import { luxeControlClass } from "@/components/luxe/LuxeField";
import { MemberChip } from "@/components/community/MemberChip";
import { PostBody } from "@/components/community/PostBody";
import { ReportDialog } from "@/components/community/ReportDialog";
import { MemberApiError } from "@/lib/memberApi";
import { communityApi, type CommunityComment } from "@/lib/communityApi";
import { formatRelative } from "@/lib/format";
import { cn } from "@/lib/cn";

/**
 * The conversation under a post.
 *
 * Fetched when the thread is opened rather than with the feed: a page of twenty
 * posts carrying every comment on each of them is most of a phone's data budget
 * spent on text nobody has asked to read yet.
 *
 * A new comment appears the moment it is submitted and is replaced by the
 * server's copy when that lands. If the post has been locked in the seconds
 * since the page was drawn, the optimistic one is taken back out and the words
 * are put back in the box — losing what somebody just typed because of a race
 * they could not see is the worst outcome available here.
 */

interface CommentThreadProps {
  postId: number;
  communitySlug: string;
  locked: boolean;
  /** False for an unverified member: they can read the thread, not add to it. */
  canWrite: boolean;
  onCountChange: (delta: number) => void;
}

/** Walks the tree once, replacing or removing the node with `id`. */
function editTree(
  list: CommunityComment[],
  id: number,
  fn: (comment: CommunityComment) => CommunityComment | null,
): CommunityComment[] {
  const out: CommunityComment[] = [];
  for (const comment of list) {
    if (comment.id === id) {
      const next = fn(comment);
      if (next) out.push(next);
      continue;
    }
    out.push({ ...comment, replies: editTree(comment.replies, id, fn) });
  }
  return out;
}

function insertInto(
  list: CommunityComment[],
  parentId: number | null,
  comment: CommunityComment,
): CommunityComment[] {
  if (parentId === null) return [...list, comment];
  return list.map((node) =>
    node.id === parentId
      ? { ...node, replies: [...node.replies, comment] }
      : { ...node, replies: insertInto(node.replies, parentId, comment) },
  );
}

export function CommentThread({
  postId,
  communitySlug,
  locked,
  canWrite,
  onCountChange,
}: CommentThreadProps) {
  const [comments, setComments] = useState<CommunityComment[] | null>(null);
  const [error, setError] = useState("");
  const [replyingTo, setReplyingTo] = useState<number | null>(null);
  const [reporting, setReporting] = useState<{ id: number; authorName: string } | null>(null);

  // Optimistic comments need an id the tree helpers can find them by, and it has
  // to be one the server will never mint. Negative and falling does both.
  const tempId = useRef(-1);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const thread = await communityApi.comments(postId);
        if (!cancelled) {
          setComments(thread.comments);
          setError("");
        }
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof MemberApiError
            ? err.message
            : "We could not load the replies just now. Please try again.",
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [postId]);

  const submit = useCallback(
    async (body: string, parentId: number | null): Promise<boolean> => {
      const optimisticId = tempId.current--;
      const optimistic: CommunityComment = {
        id: optimisticId,
        parentId,
        memberId: null,
        authorName: "You",
        authorAvatarUrl: "",
        authorIsHost: false,
        body,
        mine: true,
        createdAt: new Date().toISOString(),
        updatedAt: null,
        replies: [],
      };

      setComments((current) => insertInto(current ?? [], parentId, optimistic));
      onCountChange(1);

      try {
        const saved = await communityApi.addComment(
          postId,
          body,
          parentId === null ? undefined : parentId,
        );
        setComments((current) => editTree(current ?? [], optimisticId, () => saved));
        return true;
      } catch (err) {
        setComments((current) => editTree(current ?? [], optimisticId, () => null));
        onCountChange(-1);
        toast.error(
          err instanceof MemberApiError
            ? err.message
            : "Your reply did not send. Please try again.",
        );
        return false;
      }
    },
    [postId, onCountChange],
  );

  if (error) {
    return (
      <p role="alert" className="mt-4 text-sm font-medium text-red-400">
        {error}
      </p>
    );
  }

  if (comments === null) {
    return (
      <p className="mt-4 flex items-center gap-2 text-sm text-orchid-dim">
        <Loader2 aria-hidden className="size-4 animate-spin" />
        Loading replies…
      </p>
    );
  }

  return (
    <div className="mt-4 border-t border-white/[0.07] pt-4">
      {comments.length === 0 ? (
        <p className="text-sm text-orchid-dim">No replies yet.</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {comments.map((comment) => (
            <CommentNode
              key={comment.id}
              comment={comment}
              depth={0}
              communitySlug={communitySlug}
              locked={locked}
              canWrite={canWrite}
              replyingTo={replyingTo}
              setReplyingTo={setReplyingTo}
              onReport={setReporting}
              onSubmit={submit}
            />
          ))}
        </ul>
      )}

      {locked ? (
        <p className="mt-4 text-sm text-orchid-dim">Replies are closed on this post.</p>
      ) : canWrite ? (
        <CommentBox
          className="mt-4"
          placeholder="Write a reply…"
          submitLabel="Reply"
          onSubmit={(body) => submit(body, null)}
        />
      ) : (
        <p className="mt-4 text-sm text-orchid-dim">
          Confirm your email address to join the conversation.
        </p>
      )}

      {reporting && (
        <ReportDialog
          open
          onOpenChange={(open) => {
            if (!open) setReporting(null);
          }}
          target={{ kind: "comment", id: reporting.id }}
          authorName={reporting.authorName}
        />
      )}
    </div>
  );
}

interface CommentNodeProps {
  comment: CommunityComment;
  depth: number;
  communitySlug: string;
  locked: boolean;
  canWrite: boolean;
  replyingTo: number | null;
  setReplyingTo: (id: number | null) => void;
  onReport: (target: { id: number; authorName: string }) => void;
  onSubmit: (body: string, parentId: number | null) => Promise<boolean>;
}

/** Indentation stops at two levels; past that a phone has no column left. */
const MAX_INDENT = 2;

function CommentNode({
  comment,
  depth,
  communitySlug,
  locked,
  canWrite,
  replyingTo,
  setReplyingTo,
  onReport,
  onSubmit,
}: CommentNodeProps) {
  const open = replyingTo === comment.id;
  // A comment that has not reached the server yet has no id to reply to.
  const settled = comment.id > 0;

  return (
    <li>
      <div className="flex flex-col gap-2">
        <MemberChip
          name={comment.authorName}
          avatarUrl={comment.authorAvatarUrl}
          size="sm"
          to={
            comment.memberId === null
              ? undefined
              : `/community/${communitySlug}/members/${comment.memberId}`
          }
          meta={
            <>
              {comment.authorIsHost && (
                <span className="mr-2 rounded-full bg-gold/[0.14] px-2 py-0.5 text-[0.6rem] font-bold uppercase tracking-[0.12em] text-gold">
                  Host
                </span>
              )}
              <time dateTime={comment.createdAt ?? undefined}>
                {formatRelative(comment.createdAt)}
              </time>
            </>
          }
        />

        <PostBody text={comment.body} className="pl-11 text-[0.9rem]" />

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pl-11">
          {!locked && canWrite && settled && (
            <button
              type="button"
              onClick={() => setReplyingTo(open ? null : comment.id)}
              aria-expanded={open}
              className={cn(
                "inline-flex min-h-[2.25rem] items-center gap-1.5 text-xs font-semibold",
                "uppercase tracking-[0.12em] text-orchid-dim transition-colors duration-300",
                "hover:text-gold focus-visible:outline focus-visible:outline-2",
                "focus-visible:outline-offset-2 focus-visible:outline-gold",
              )}
            >
              <Reply aria-hidden className="size-3.5" />
              Reply
            </button>
          )}
          {!comment.mine && settled && (
            <button
              type="button"
              onClick={() => onReport({ id: comment.id, authorName: comment.authorName })}
              className={cn(
                "inline-flex min-h-[2.25rem] items-center gap-1.5 text-xs font-semibold",
                "uppercase tracking-[0.12em] text-orchid-faint transition-colors duration-300",
                "hover:text-red-400 focus-visible:outline focus-visible:outline-2",
                "focus-visible:outline-offset-2 focus-visible:outline-gold",
              )}
            >
              <Flag aria-hidden className="size-3.5" />
              Report
            </button>
          )}
        </div>

        {open && (
          <CommentBox
            className="pl-11"
            autoFocus
            placeholder={`Reply to ${comment.authorName}…`}
            submitLabel="Send"
            onSubmit={async (body) => {
              const ok = await onSubmit(body, comment.id);
              if (ok) setReplyingTo(null);
              return ok;
            }}
          />
        )}
      </div>

      {comment.replies.length > 0 && (
        <ul
          className={cn(
            "mt-4 flex flex-col gap-4 border-l border-white/[0.07]",
            depth < MAX_INDENT ? "ml-4 pl-4 sm:ml-5 sm:pl-5" : "pl-4",
          )}
        >
          {comment.replies.map((reply) => (
            <CommentNode
              key={reply.id}
              comment={reply}
              depth={depth + 1}
              communitySlug={communitySlug}
              locked={locked}
              canWrite={canWrite}
              replyingTo={replyingTo}
              setReplyingTo={setReplyingTo}
              onReport={onReport}
              onSubmit={onSubmit}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

interface CommentBoxProps {
  placeholder: string;
  submitLabel: string;
  onSubmit: (body: string) => Promise<boolean>;
  autoFocus?: boolean;
  className?: string;
}

function CommentBox({
  placeholder,
  submitLabel,
  onSubmit,
  autoFocus = false,
  className,
}: CommentBoxProps) {
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const fieldId = useId();

  const send = async () => {
    const trimmed = body.trim();
    if (!trimmed || sending) return;
    setSending(true);
    // The box is cleared first so the optimistic comment does not appear next to
    // a copy of itself, and refilled from `trimmed` if the send comes back bad.
    setBody("");
    const ok = await onSubmit(trimmed);
    if (!ok) setBody(trimmed);
    setSending(false);
  };

  return (
    <form
      className={cn("flex items-end gap-2", className)}
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      <label className="sr-only" htmlFor={fieldId}>
        {placeholder}
      </label>
      <textarea
        id={fieldId}
        rows={1}
        autoFocus={autoFocus}
        value={body}
        maxLength={10_000}
        placeholder={placeholder}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          // Enter sends, Shift+Enter breaks the line. On a phone the on-screen
          // keyboard's return key inserts a newline, which is why the button
          // beside it is not optional.
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void send();
          }
        }}
        className={cn(luxeControlClass, "min-h-[2.75rem] resize-y py-2.5 text-[0.9rem]")}
      />
      <LuxeButton
        type="submit"
        variant="glass"
        size="sm"
        disabled={sending || body.trim().length === 0}
        className="shrink-0 px-4"
        aria-label={submitLabel}
      >
        {sending ? (
          <Loader2 aria-hidden className="size-4 animate-spin" />
        ) : (
          <Send aria-hidden className="size-4" />
        )}
      </LuxeButton>
    </form>
  );
}
