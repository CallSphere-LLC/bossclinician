import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Loader2, MessageCircle, Pencil, Reply, Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatRelative } from "@/lib/format";
import { MemberApiError } from "@/lib/memberApi";
import { libraryApi, type LessonComment } from "@/lib/libraryApi";
import { LuxeButton, LuxePill } from "@/components/luxe/LuxeButton";
import { MemberAvatar } from "@/components/member/MemberShell";
import { luxeControlClass } from "@/components/luxe/LuxeField";

/**
 * The discussion under a lesson.
 *
 * Threaded one level deep on screen, however deep the data goes. A reply to a
 * reply is nested by the server and rendered flat here, because the third
 * indent on a 360px phone leaves roughly twenty characters of line — at which
 * point the thread structure is costing more than it conveys.
 *
 * Every write re-reads the thread rather than splicing the response into local
 * state. Placement, ordering and moderation status are the server's to decide,
 * and a client that guesses them ends up showing a comment in a position it
 * will not be in after the next refresh.
 */
export function LessonComments({ lessonId }: { lessonId: number }) {
  const [comments, setComments] = useState<LessonComment[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [replyTo, setReplyTo] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await libraryApi.getComments(lessonId);
      setComments(data.comments);
      setEnabled(data.commentsEnabled);
      setError("");
    } catch (err) {
      setError(
        err instanceof MemberApiError
          ? err.message
          : "We could not load the discussion just now. Please try again.",
      );
    } finally {
      setLoading(false);
    }
  }, [lessonId]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  const post = useCallback(
    async (body: string, parentId: number | null) => {
      await libraryApi.postComment(lessonId, { body, parentId });
      setReplyTo(null);
      await load();
    },
    [lessonId, load],
  );

  const remove = useCallback(
    async (commentId: number) => {
      try {
        await libraryApi.deleteComment(commentId);
        toast.success("Your comment was removed.");
        await load();
      } catch (err) {
        toast.error(
          err instanceof MemberApiError ? err.message : "We could not remove that comment.",
        );
      }
    },
    [load],
  );

  const edit = useCallback(
    async (commentId: number, body: string) => {
      await libraryApi.editComment(commentId, body);
      await load();
    },
    [load],
  );

  if (!enabled && !loading) {
    return null;
  }

  const total = countComments(comments);

  return (
    <section
      aria-labelledby={`discussion-heading-${lessonId}`}
      className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5"
    >
      <h2
        id={`discussion-heading-${lessonId}`}
        className="flex items-center gap-2.5 font-display text-base text-white"
      >
        <MessageCircle aria-hidden className="size-4 text-gold" />
        Discussion
        {total > 0 && <span className="text-sm font-normal text-orchid-faint">({total})</span>}
      </h2>

      <div aria-live="polite" className="mt-3">
        {loading && (
          <p className="flex items-center gap-2.5 text-sm text-orchid-dim">
            <Loader2 aria-hidden className="size-4 animate-spin" />
            Loading the discussion…
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm font-medium text-red-400">
            {error}
          </p>
        )}
      </div>

      {!loading && !error && (
        <>
          <Composer
            label="Add to the discussion"
            placeholder="Ask a question, or share what landed for you."
            submitLabel="Post comment"
            onSubmit={(body) => post(body, null)}
            className="mt-4"
          />

          {comments.length === 0 ? (
            <p className="mt-5 text-sm text-orchid-dim">
              Nothing here yet. Be the first — the questions asked here are the ones Yvette answers.
            </p>
          ) : (
            <ol className="mt-6 flex flex-col gap-5">
              {comments.map((comment) => (
                <li key={comment.id}>
                  <CommentNode
                    comment={comment}
                    depth={0}
                    replyTo={replyTo}
                    onReplyTo={setReplyTo}
                    onReply={post}
                    onEdit={edit}
                    onDelete={remove}
                  />
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </section>
  );
}

function countComments(comments: LessonComment[]): number {
  return comments.reduce((total, comment) => total + 1 + countComments(comment.replies), 0);
}

interface CommentNodeProps {
  comment: LessonComment;
  depth: number;
  replyTo: number | null;
  onReplyTo: (id: number | null) => void;
  onReply: (body: string, parentId: number | null) => Promise<void>;
  onEdit: (commentId: number, body: string) => Promise<void>;
  onDelete: (commentId: number) => Promise<void>;
}

function CommentNode({
  comment,
  depth,
  replyTo,
  onReplyTo,
  onReply,
  onEdit,
  onDelete,
}: CommentNodeProps) {
  const [editing, setEditing] = useState(false);
  const replying = replyTo === comment.id;

  return (
    <article className={cn(depth > 0 && "border-l border-white/[0.08] pl-4 sm:pl-5")}>
      <div className="flex items-start gap-3">
        <MemberAvatar
          src={comment.authorAvatarUrl || undefined}
          name={comment.authorName}
          email=""
          className="size-9"
        />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <p className="text-sm font-semibold text-white">{comment.authorName}</p>
            {comment.authorIsHost && (
              <LuxePill accent="gold" className="px-2.5 py-0.5 text-[0.58rem]">
                Yvette
              </LuxePill>
            )}
            <p className="text-xs text-orchid-faint">{formatRelative(comment.createdAt)}</p>
            {comment.pending && (
              <span className="text-xs text-gold/80">Awaiting review — only you can see this</span>
            )}
          </div>

          {editing ? (
            <Composer
              label="Edit your comment"
              submitLabel="Save changes"
              initialValue={comment.body}
              onSubmit={async (body) => {
                await onEdit(comment.id, body);
                setEditing(false);
              }}
              onCancel={() => setEditing(false)}
              className="mt-2.5"
            />
          ) : (
            <p className="mt-1.5 whitespace-pre-wrap break-words text-[0.92rem] leading-[1.75] text-orchid-dim">
              {comment.body}
            </p>
          )}

          {!editing && (
            <div className="mt-2 flex flex-wrap items-center gap-1">
              <RowAction
                icon={Reply}
                label="Reply"
                onClick={() => onReplyTo(replying ? null : comment.id)}
                pressed={replying}
              />
              {comment.mine && (
                <>
                  <RowAction icon={Pencil} label="Edit" onClick={() => setEditing(true)} />
                  <RowAction
                    icon={Trash2}
                    label="Delete"
                    onClick={() => void onDelete(comment.id)}
                  />
                </>
              )}
            </div>
          )}

          {replying && (
            <Composer
              label={`Reply to ${comment.authorName}`}
              submitLabel="Post reply"
              autoFocus
              onSubmit={(body) => onReply(body, comment.id)}
              onCancel={() => onReplyTo(null)}
              className="mt-3"
            />
          )}
        </div>
      </div>

      {comment.replies.length > 0 && (
        <ol className="mt-4 flex flex-col gap-4 pl-12">
          {comment.replies.map((reply) => (
            <li key={reply.id}>
              <CommentNode
                comment={reply}
                // Capped at one: deeper replies render at the same indent as
                // their siblings rather than marching off the right of a phone.
                depth={Math.min(depth + 1, 1)}
                replyTo={replyTo}
                onReplyTo={onReplyTo}
                onReply={onReply}
                onEdit={onEdit}
                onDelete={onDelete}
              />
            </li>
          ))}
        </ol>
      )}
    </article>
  );
}

function RowAction({
  icon: Icon,
  label,
  onClick,
  pressed,
}: {
  icon: typeof Reply;
  label: string;
  onClick: () => void;
  pressed?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={pressed}
      className={cn(
        "inline-flex min-h-[2.75rem] items-center gap-1.5 rounded-full px-3",
        "text-xs font-semibold uppercase tracking-[0.12em] transition-colors duration-300",
        pressed ? "text-gold" : "text-orchid-dim hover:text-white",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold",
      )}
    >
      <Icon aria-hidden className="size-3.5" />
      {label}
    </button>
  );
}

interface ComposerProps {
  label: string;
  submitLabel: string;
  placeholder?: string;
  initialValue?: string;
  autoFocus?: boolean;
  onSubmit: (body: string) => Promise<void>;
  onCancel?: () => void;
  className?: string;
}

/**
 * One composer for posting, replying and editing.
 *
 * It owns its own busy and error state so a failed reply reports next to the
 * box it was typed in — a toast alone leaves someone staring at a form that
 * looks like it worked. The text is kept on failure, always.
 */
function Composer({
  label,
  submitLabel,
  placeholder,
  initialValue = "",
  autoFocus,
  onSubmit,
  onCancel,
  className,
}: ComposerProps) {
  const [body, setBody] = useState(initialValue);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fieldRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (autoFocus) fieldRef.current?.focus();
  }, [autoFocus]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = body.trim();
    if (!trimmed || busy) return;

    setBusy(true);
    setError("");
    try {
      await onSubmit(trimmed);
      setBody("");
    } catch (err) {
      setError(
        err instanceof MemberApiError
          ? err.message
          : "We could not post that just now. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className={cn("flex flex-col gap-2.5", className)}>
      {/* `aria-label` rather than a visible one: three composers can be open at
          once (post, reply, edit) and three stacked field labels read as noise
          when the placeholder already says what the box is for. */}
      <textarea
        ref={fieldRef}
        value={body}
        onChange={(event) => setBody(event.target.value)}
        rows={3}
        maxLength={10_000}
        placeholder={placeholder ?? label}
        aria-label={label}
        aria-invalid={error ? true : undefined}
        className={cn(luxeControlClass, "resize-y leading-relaxed", error && "border-red-400/60")}
      />

      {error && (
        <p role="alert" className="text-xs font-medium text-red-400">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2.5">
        <LuxeButton type="submit" size="sm" disabled={busy || body.trim().length === 0}>
          {busy && <Loader2 aria-hidden className="size-3.5 animate-spin" />}
          {submitLabel}
        </LuxeButton>
        {onCancel && (
          <LuxeButton type="button" variant="quiet" onClick={onCancel}>
            Cancel
          </LuxeButton>
        )}
      </div>
    </form>
  );
}
