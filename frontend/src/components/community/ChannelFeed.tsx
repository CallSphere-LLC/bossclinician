import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Loader2, MessagesSquare } from "lucide-react";
import { toast } from "sonner";
import { GlassCard } from "@/components/luxe/GlassCard";
import { PostCard } from "@/components/community/PostCard";
import { PostComposer } from "@/components/community/PostComposer";
import { useMember } from "@/hooks/useMember";
import { MemberApiError } from "@/lib/memberApi";
import {
  canModerate,
  communityApi,
  type ChannelFeedPage,
  type CommunityPost,
  type CommunityRole,
  type NewPostInput,
} from "@/lib/communityApi";

/**
 * A channel's posts, the composer above them, and more of them as you scroll.
 *
 * Paging is by page number rather than a cursor because that is what the API
 * offers. It has one honest weakness: a post written while somebody is reading
 * page one shifts everything down by one, and the first row of page two is a
 * row they have already seen. Posts are keyed by id and the list refuses
 * duplicates on merge, so the visible result is a page that is occasionally one
 * post short — which is the failure worth having, next to showing the same post
 * twice.
 *
 * `IntersectionObserver` rather than a scroll handler: this list is the whole
 * page on a phone, and a scroll listener firing on every frame of a flick is
 * exactly the work that makes a feed feel cheap.
 */

interface ChannelFeedProps {
  communitySlug: string;
  channelSlug: string;
  /** The member's role in this community, which is what unlocks moderation. */
  role: CommunityRole;
}

const PER_PAGE = 20;

export function ChannelFeed({ communitySlug, channelSlug, role }: ChannelFeedProps) {
  const { member } = useMember();
  const [searchParams] = useSearchParams();

  const [channel, setChannel] = useState<ChannelFeedPage["channel"] | null>(null);
  const [posts, setPosts] = useState<CommunityPost[]>([]);
  const [reactionEmoji, setReactionEmoji] = useState<string[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");

  const sentinel = useRef<HTMLDivElement | null>(null);
  // Optimistic posts need ids the server will never mint, so the list can find
  // and replace them. Negative and falling does that without a lookup table.
  const nextTempId = useRef(-1);
  // Guards the observer against firing twice for the same page while the first
  // request is still in flight — the sentinel stays on screen until it lands.
  const inFlight = useRef(false);
  /**
   * Which channel the visible list belongs to.
   *
   * Every response is checked against this before it is applied. Without it, a
   * slow page of one channel lands after the reader has moved to another and
   * repaints the new room with the old room's posts — which looks exactly like
   * a permissions bug and is the reason this ref exists rather than a boolean.
   */
  const feedKey = `${communitySlug}/${channelSlug}`;
  const currentKey = useRef(feedKey);

  const deepLinkedPost = Number(searchParams.get("post")) || 0;

  const loadPage = useCallback(
    async (wanted: number) => {
      if (inFlight.current) return;
      inFlight.current = true;
      if (wanted === 1) setLoading(true);
      else setLoadingMore(true);

      try {
        const data = await communityApi.posts(communitySlug, channelSlug, wanted, PER_PAGE);
        if (currentKey.current !== feedKey) return;
        setChannel(data.channel);
        setReactionEmoji(data.reactionEmoji);
        setHasMore(data.hasMore);
        setPage(data.page);
        setPosts((current) => {
          if (wanted === 1) return data.posts;
          const seen = new Set(current.map((p) => p.id));
          return [...current, ...data.posts.filter((p) => !seen.has(p.id))];
        });
        setError("");
      } catch (err) {
        if (currentKey.current !== feedKey) return;
        setError(
          err instanceof MemberApiError
            ? err.message
            : "We could not load this channel just now. Please try again.",
        );
      } finally {
        inFlight.current = false;
        if (currentKey.current === feedKey) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [communitySlug, channelSlug, feedKey],
  );

  // Switching channels starts over rather than appending: the two lists are
  // different rooms, and merging them would put one channel's posts in another.
  useEffect(() => {
    currentKey.current = feedKey;
    // Cleared outright rather than awaited: the request still running belongs to
    // the channel just left, and its result is discarded by the key check above.
    inFlight.current = false;
    setPosts([]);
    setChannel(null);
    setPage(0);
    setHasMore(false);
    setLoading(true);
    void loadPage(1);
  }, [feedKey, loadPage]);

  useEffect(() => {
    const node = sentinel.current;
    if (!node || !hasMore || loading) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) void loadPage(page + 1);
      },
      // Starts fetching a screen early, so the next posts are usually already
      // there by the time the reader arrives at the bottom of these ones.
      { rootMargin: "600px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, loading, page, loadPage]);

  const createPost = useCallback(
    async (input: NewPostInput): Promise<boolean> => {
      const tempId = nextTempId.current--;
      const optimistic: CommunityPost = {
        id: tempId,
        kind: input.kind,
        title: input.title ?? "",
        body: input.body ?? "",
        mediaUrl: input.mediaUrl ?? "",
        pinned: false,
        locked: false,
        author: {
          memberId: member?.id ?? null,
          name: member?.name ?? "You",
          avatarUrl: member?.avatarUrl ?? "",
          headline: "",
          isHost: false,
        },
        mine: true,
        canEdit: false,
        commentCount: 0,
        reactionCount: 0,
        reactions: [],
        myReactions: [],
        poll:
          input.kind === "poll" && input.pollOptions
            ? {
                options: input.pollOptions.map((label, i) => ({
                  id: -(i + 1),
                  label,
                  voteCount: 0,
                  mine: false,
                })),
                totalVotes: 0,
                myOptionId: null,
              }
            : null,
        createdAt: new Date().toISOString(),
        updatedAt: null,
        lastActivityAt: new Date().toISOString(),
      };

      // Below the pinned block rather than at the very top, because that is
      // where the server will put it and a post that visibly jumps a moment
      // after it appears reads as a bug.
      setPosts((current) => {
        const pinnedCount = current.findIndex((p) => !p.pinned);
        const at = pinnedCount === -1 ? current.length : pinnedCount;
        return [...current.slice(0, at), optimistic, ...current.slice(at)];
      });

      try {
        const saved = await communityApi.createPost(communitySlug, channelSlug, input);
        setPosts((current) => current.map((p) => (p.id === tempId ? saved : p)));
        return true;
      } catch (err) {
        setPosts((current) => current.filter((p) => p.id !== tempId));
        toast.error(
          err instanceof MemberApiError
            ? err.message
            : "Your post did not send. Please try again.",
        );
        return false;
      }
    },
    [communitySlug, channelSlug, member],
  );

  /**
   * Applied as an updater rather than a finished post.
   *
   * A card can have a reaction, a vote and a comment all in flight at once, and
   * each of those callbacks closed over the post as it was when the card last
   * rendered. Handing the list a whole object built from that stale copy is how
   * a vote silently undoes the reaction registered a moment earlier; handing it
   * a function that reads the current row cannot.
   */
  const updatePost = useCallback(
    (id: number, update: (post: CommunityPost) => CommunityPost) => {
      setPosts((current) => current.map((p) => (p.id === id ? update(p) : p)));
    },
    [],
  );

  const removePost = useCallback((id: number) => {
    setPosts((current) => current.filter((p) => p.id !== id));
  }, []);

  const impersonated = member?.impersonatedBy != null;
  const verified = member?.emailVerifiedAt != null;

  return (
    <div className="flex flex-col gap-5">
      {channel && channel.description && (
        <p className="copy-luxe text-sm">{channel.description}</p>
      )}

      {impersonated ? (
        <GlassCard spotlight={false} interactive={false} className="p-5">
          <p className="text-sm leading-relaxed text-orchid">
            You are viewing this account as an administrator, so posting is switched off. Anything
            written here would look to everyone else like the member wrote it.
          </p>
        </GlassCard>
      ) : verified ? (
        <PostComposer
          channelName={channel?.name ?? "the community"}
          authorName={member?.name ?? ""}
          authorEmail={member?.email ?? ""}
          authorAvatarUrl={member?.avatarUrl ?? ""}
          onSubmit={createPost}
        />
      ) : (
        <GlassCard spotlight={false} interactive={false} className="p-5">
          <p className="text-sm leading-relaxed text-orchid">
            Confirm your email address and you can post here. Everything below is yours to read in
            the meantime.
          </p>
        </GlassCard>
      )}

      <div aria-live="polite">
        {error && (
          <p role="alert" className="text-sm font-medium text-red-400">
            {error}
          </p>
        )}
        {loading && !error && (
          <p className="flex items-center gap-2.5 text-sm text-orchid-dim">
            <Loader2 aria-hidden className="size-4 animate-spin" />
            Loading posts…
          </p>
        )}
      </div>

      {!loading && !error && posts.length === 0 && (
        <GlassCard spotlight={false} interactive={false} className="p-8 text-center">
          <MessagesSquare aria-hidden className="mx-auto size-7 text-gold" />
          <p className="mt-3 font-display text-lg text-white">Nothing here yet</p>
          <p className="copy-luxe mx-auto mt-2 max-w-sm text-sm">
            Be the first — an introduction, a question you are sitting with, or the thing that went
            well this week.
          </p>
        </GlassCard>
      )}

      {posts.length > 0 && (
        <ul className="flex flex-col gap-4">
          {posts.map((post) => (
            <li key={post.id}>
              <PostCard
                post={post}
                communitySlug={communitySlug}
                reactionEmoji={reactionEmoji}
                canModerate={canModerate(role)}
                canWrite={Boolean(verified) && !impersonated}
                onChange={updatePost}
                onRemove={removePost}
                defaultOpenComments={post.id === deepLinkedPost}
              />
            </li>
          ))}
        </ul>
      )}

      <div ref={sentinel} aria-hidden className="h-px" />

      {loadingMore && (
        <p className="flex items-center justify-center gap-2.5 py-4 text-sm text-orchid-dim">
          <Loader2 aria-hidden className="size-4 animate-spin" />
          Loading more…
        </p>
      )}

      {!hasMore && posts.length > 0 && !loading && (
        <p className="py-2 text-center text-xs uppercase tracking-[0.16em] text-orchid-faint">
          You have reached the beginning
        </p>
      )}
    </div>
  );
}
