import { useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  EyeOff,
  Flag,
  Loader2,
  Lock,
  LockOpen,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { GlassCard } from "@/components/luxe/GlassCard";
import { LuxeButton } from "@/components/luxe/LuxeButton";
import { luxeControlClass } from "@/components/luxe/LuxeField";
import { MemberChip } from "@/components/community/MemberChip";
import { PostBody } from "@/components/community/PostBody";
import { PostMedia } from "@/components/community/PostMedia";
import { PollBlock } from "@/components/community/PollBlock";
import { ReactionBar } from "@/components/community/ReactionBar";
import { CommentThread } from "@/components/community/CommentThread";
import { ReportDialog } from "@/components/community/ReportDialog";
import { MemberApiError } from "@/lib/memberApi";
import {
  communityApi,
  isPostDeleted,
  type CommunityPost,
  type ModerationAction,
} from "@/lib/communityApi";
import { formatRelative } from "@/lib/format";
import { cn } from "@/lib/cn";

/**
 * One post in the feed.
 *
 * The card owns nothing: every change — a reaction, a vote, an edit, a pin —
 * goes back up through `onChange` so the feed holds one copy of each post and
 * the card never disagrees with the list it is in.
 *
 * Moderation lives behind `canModerate`, which comes from the membership role
 * the server sent for this community. Hiding the buttons is presentation, not
 * protection: the endpoint checks the same role again, and it is the one that
 * decides. What the check here buys is that a plain member is never shown a
 * control that would fail, which is a different and smaller promise.
 */

interface PostCardProps {
  post: CommunityPost;
  communitySlug: string;
  reactionEmoji: string[];
  canModerate: boolean;
  /** False for a member who has not confirmed their address yet. */
  canWrite: boolean;
  /**
   * Applied to whatever the list currently holds for this post, not to the copy
   * this render closed over — a reaction and a comment can be in flight at the
   * same moment, and each would otherwise overwrite the other's result.
   */
  onChange: (postId: number, update: (post: CommunityPost) => CommunityPost) => void;
  onRemove: (postId: number) => void;
  /** Opens the thread on mount, for a notification that pointed at a comment. */
  defaultOpenComments?: boolean;
}

export function PostCard({
  post,
  communitySlug,
  reactionEmoji,
  canModerate,
  canWrite,
  onChange,
  onRemove,
  defaultOpenComments = false,
}: PostCardProps) {
  const [showComments, setShowComments] = useState(defaultOpenComments);
  const [editing, setEditing] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [busy, setBusy] = useState(false);

  // A post that has not reached the server yet has no id anything can act on.
  const pending = post.id < 0;
  const carriesMedia = post.kind === "image" || post.kind === "video" || post.kind === "link";

  const moderate = async (action: ModerationAction) => {
    setBusy(true);
    try {
      const result = await communityApi.moderatePost(post.id, action);
      if (isPostDeleted(result)) {
        onRemove(post.id);
        toast.success("Hidden from the feed.");
      } else {
        onChange(post.id, () => result);
        toast.success(MODERATION_TOAST[action]);
      }
    } catch (err) {
      toast.error(
        err instanceof MemberApiError ? err.message : "That did not save. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await communityApi.deletePost(post.id);
      onRemove(post.id);
      toast.success("Your post was deleted.");
    } catch (err) {
      toast.error(
        err instanceof MemberApiError
          ? err.message
          : "We could not delete that just now. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  const authorHref =
    post.author.memberId === null
      ? undefined
      : `/community/${communitySlug}/members/${post.author.memberId}`;

  return (
    <GlassCard
      as="article"
      spotlight={false}
      interactive={false}
      accent={post.pinned ? "gold" : "neutral"}
      className={cn("p-5 sm:p-6", pending && "opacity-60")}
    >
      <header className="flex items-start justify-between gap-3">
        <MemberChip
          name={post.author.name}
          avatarUrl={post.author.avatarUrl}
          headline={post.author.headline}
          to={authorHref}
          className="min-w-0 flex-1"
        />

        <div className="flex shrink-0 items-center gap-2">
          {post.pinned && (
            <span
              className="inline-flex items-center gap-1 rounded-full bg-gold/[0.14] px-2.5 py-1 text-[0.6rem] font-bold uppercase tracking-[0.12em] text-gold"
              title="Pinned to the top of this channel"
            >
              <Pin aria-hidden className="size-3" />
              <span className="sr-only sm:not-sr-only">Pinned</span>
            </span>
          )}
          {post.locked && (
            <span
              className="inline-flex items-center gap-1 rounded-full bg-white/[0.07] px-2.5 py-1 text-[0.6rem] font-bold uppercase tracking-[0.12em] text-orchid-dim"
              title="Comments are closed"
            >
              <Lock aria-hidden className="size-3" />
              <span className="sr-only sm:not-sr-only">Locked</span>
            </span>
          )}

          {!pending && (
            <PostMenu
              post={post}
              busy={busy}
              canModerate={canModerate}
              onEdit={() => setEditing(true)}
              onDelete={() => void remove()}
              onModerate={(action) => void moderate(action)}
              onReport={() => setReporting(true)}
            />
          )}
        </div>
      </header>

      <div className="mt-1 pl-12 text-xs text-orchid-faint">
        <time dateTime={post.createdAt ?? undefined}>{formatRelative(post.createdAt)}</time>
        {post.updatedAt && post.updatedAt !== post.createdAt && <span> · edited</span>}
      </div>

      {editing ? (
        <PostEditor
          post={post}
          carriesMedia={carriesMedia}
          onCancel={() => setEditing(false)}
          onSaved={(saved) => {
            onChange(post.id, () => saved);
            setEditing(false);
          }}
        />
      ) : (
        <div className="mt-3">
          {post.title && (
            <h3 className="font-display text-lg leading-snug text-white sm:text-xl">
              {post.title}
            </h3>
          )}
          <PostBody text={post.body} className={cn(post.title && "mt-2")} />
          <PostMedia kind={post.kind} mediaUrl={post.mediaUrl} mediaLabel={post.mediaLabel} />
          {post.poll && (
            <PollBlock
              postId={post.id}
              poll={post.poll}
              locked={post.locked}
              onChange={(poll) => onChange(post.id, (current) => ({ ...current, poll }))}
            />
          )}
        </div>
      )}

      {!pending && (
        <footer className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <ReactionBar
            postId={post.id}
            reactions={post.reactions}
            available={reactionEmoji}
            onChange={(reactions) =>
              onChange(post.id, (current) => ({
                ...current,
                reactions,
                reactionCount: reactions.reduce((sum, r) => sum + r.count, 0),
                myReactions: reactions.filter((r) => r.mine).map((r) => r.emoji),
              }))
            }
          />

          <button
            type="button"
            onClick={() => setShowComments((open) => !open)}
            aria-expanded={showComments}
            className={cn(
              "inline-flex min-h-[2.75rem] items-center gap-2 rounded-full px-3",
              "text-xs font-semibold uppercase tracking-[0.12em] transition-colors duration-300",
              "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold",
              showComments ? "bg-ink/[0.06] text-white" : "text-orchid-dim hover:text-white",
            )}
          >
            <MessageCircle aria-hidden className="size-4" />
            {post.commentCount === 0
              ? "Reply"
              : `${post.commentCount} ${post.commentCount === 1 ? "reply" : "replies"}`}
          </button>
        </footer>
      )}

      {showComments && !pending && (
        <CommentThread
          postId={post.id}
          communitySlug={communitySlug}
          locked={post.locked}
          canWrite={canWrite}
          onCountChange={(delta) =>
            onChange(post.id, (current) => ({
              ...current,
              commentCount: Math.max(0, current.commentCount + delta),
            }))
          }
        />
      )}

      <ReportDialog
        open={reporting}
        onOpenChange={setReporting}
        target={{ kind: "post", id: post.id }}
        authorName={post.author.name}
      />
    </GlassCard>
  );
}

const MODERATION_TOAST: Record<ModerationAction, string> = {
  pin: "Pinned to the top of this channel.",
  unpin: "Unpinned.",
  lock: "Comments are now closed on this post.",
  unlock: "Comments are open again.",
  hide: "Hidden from the feed.",
};

interface PostMenuProps {
  post: CommunityPost;
  busy: boolean;
  canModerate: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onModerate: (action: ModerationAction) => void;
  onReport: () => void;
}

function PostMenu({
  post,
  busy,
  canModerate,
  onEdit,
  onDelete,
  onModerate,
  onReport,
}: PostMenuProps) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  return (
    <DropdownMenu.Root
      onOpenChange={(open) => {
        if (!open) setConfirmingDelete(false);
      }}
    >
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          disabled={busy}
          aria-label="More actions for this post"
          className={cn(
            "grid size-11 place-items-center rounded-full text-orchid-dim",
            "transition-colors duration-300 hover:bg-white/[0.07] hover:text-white",
            "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold",
            "disabled:opacity-50",
          )}
        >
          {busy ? (
            <Loader2 aria-hidden className="size-4 animate-spin" />
          ) : (
            <MoreHorizontal aria-hidden className="size-4" />
          )}
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        {/* Named colours rather than themeable tokens: the portal renders
            outside `.theme-luxe`, where those resolve to the light palette. */}
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          className="z-50 min-w-[13rem] rounded-2xl border border-white/10 bg-night-raised p-1.5 shadow-[0_28px_60px_-20px_rgba(0,0,0,0.9)]"
        >
          {post.canEdit && (
            <MenuItem icon={Pencil} onSelect={onEdit}>
              Edit
            </MenuItem>
          )}

          {post.mine &&
            (confirmingDelete ? (
              <MenuItem
                icon={Trash2}
                tone="danger"
                onSelect={onDelete}
              >
                Yes, delete it
              </MenuItem>
            ) : (
              <MenuItem
                icon={Trash2}
                tone="danger"
                // Kept open so the confirmation replaces the item in place; a
                // second dialog for deleting your own sentence is theatre.
                onSelect={(event) => {
                  event.preventDefault();
                  setConfirmingDelete(true);
                }}
              >
                Delete
              </MenuItem>
            ))}

          {!post.mine && (
            <MenuItem icon={Flag} onSelect={onReport}>
              Report
            </MenuItem>
          )}

          {canModerate && (
            <>
              <DropdownMenu.Separator className="my-1 h-px bg-white/10" />
              <p className="px-3 py-1.5 text-[0.6rem] font-bold uppercase tracking-[0.14em] text-orchid-faint">
                Moderation
              </p>
              <MenuItem
                icon={post.pinned ? PinOff : Pin}
                onSelect={() => onModerate(post.pinned ? "unpin" : "pin")}
              >
                {post.pinned ? "Unpin" : "Pin to top"}
              </MenuItem>
              <MenuItem
                icon={post.locked ? LockOpen : Lock}
                onSelect={() => onModerate(post.locked ? "unlock" : "lock")}
              >
                {post.locked ? "Reopen comments" : "Close comments"}
              </MenuItem>
              <MenuItem icon={EyeOff} tone="danger" onSelect={() => onModerate("hide")}>
                Hide from feed
              </MenuItem>
            </>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function MenuItem({
  icon: Icon,
  tone = "default",
  onSelect,
  children,
}: {
  icon: typeof Pin;
  tone?: "default" | "danger";
  onSelect: (event: Event) => void;
  children: React.ReactNode;
}) {
  return (
    <DropdownMenu.Item
      onSelect={onSelect}
      className={cn(
        "flex min-h-[2.75rem] cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2.5",
        "text-sm outline-none data-[highlighted]:bg-white/[0.07]",
        tone === "danger" ? "text-red-300" : "text-white/85",
      )}
    >
      <Icon aria-hidden className={cn("size-4", tone === "danger" ? "text-red-400" : "text-gold")} />
      {children}
    </DropdownMenu.Item>
  );
}

interface PostEditorProps {
  post: CommunityPost;
  carriesMedia: boolean;
  onCancel: () => void;
  onSaved: (post: CommunityPost) => void;
}

function PostEditor({ post, carriesMedia, onCancel, onSaved }: PostEditorProps) {
  const [title, setTitle] = useState(post.title);
  const [body, setBody] = useState(post.body);
  const [mediaUrl, setMediaUrl] = useState(post.mediaUrl);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      onSaved(
        await communityApi.updatePost(post.id, {
          title: title.trim(),
          body: body.trim(),
          ...(carriesMedia ? { mediaUrl: mediaUrl.trim() } : {}),
        }),
      );
    } catch (err) {
      toast.error(
        err instanceof MemberApiError ? err.message : "That edit did not save. Please try again.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      className="mt-3 flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <input
        value={title}
        maxLength={300}
        placeholder="Title (optional)"
        aria-label="Post title"
        onChange={(e) => setTitle(e.target.value)}
        className={luxeControlClass}
      />
      <textarea
        rows={5}
        value={body}
        maxLength={20_000}
        placeholder="What did you want to say?"
        aria-label="Post"
        onChange={(e) => setBody(e.target.value)}
        className={cn(luxeControlClass, "resize-y leading-relaxed")}
      />
      {carriesMedia && (
        <input
          type="url"
          value={mediaUrl}
          maxLength={2000}
          placeholder="https://…"
          aria-label="Link"
          onChange={(e) => setMediaUrl(e.target.value)}
          className={luxeControlClass}
        />
      )}
      <div className="flex flex-wrap gap-2.5">
        <LuxeButton type="submit" size="sm" disabled={saving}>
          {saving ? "Saving…" : "Save changes"}
        </LuxeButton>
        <LuxeButton type="button" variant="glass" size="sm" onClick={onCancel} disabled={saving}>
          Cancel
        </LuxeButton>
      </div>
      {post.poll && (
        <p className="text-xs text-orchid-faint">
          Poll options cannot be changed — the votes already cast were answers to the question as
          it was asked.
        </p>
      )}
    </form>
  );
}
