import { memberRequest } from "@/lib/memberApi";

/**
 * Community domain client.
 *
 * Built on `memberRequest` so it shares the one access token and the one
 * refresh path — nothing here touches storage or auth.
 *
 * Two shapes of thing cross this boundary and they are kept apart on purpose.
 * Everything a member typed — post bodies, comments, headlines, bios, poll
 * labels — is TEXT that the server has already stripped of markup, and it is
 * rendered as text on the way out. Everything a member pasted — `mediaUrl`,
 * `locationUrl`, `proofUrl` — is a link the server checked for an http(s)
 * scheme, and it is checked again before it reaches an `href` or a `src`. The
 * server has no way to know which renderer will read a row next, and this
 * client has no way to know the row came from a version of the server that
 * checked. Both ends check, and neither relies on the other having done it.
 */

/* ---------------------------------------------------------------- shared */

/** `member | moderator | admin` in the database, so a plain string on the wire. */
export type CommunityRole = string;

/** Pin, lock and hide belong to the people who run the room, and nobody else. */
export function canModerate(role: CommunityRole): boolean {
  return role === "moderator" || role === "admin";
}

export interface CommunityBadge {
  id: number;
  name: string;
  emoji: string;
  threshold: number;
  awardedAt: string | null;
}

export interface NextBadge {
  name: string;
  emoji: string;
  threshold: number;
  pointsToGo: number;
}

/**
 * A link a member supplied, re-checked before it is rendered.
 *
 * `javascript:` and `data:` in an href are the whole attack, and a relative
 * path would resolve against this site rather than the one the author meant.
 */
export function safeLink(value: string): string {
  if (!value) return "";
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

/* -------------------------------------------------------------- listings */

export interface CommunitySummary {
  id: number;
  slug: string;
  name: string;
  description: string;
  coverImage: string;
  joined: boolean;
  role: CommunityRole;
  points: number;
  joinedAt: string | null;
  memberCount: number;
  unreadCount: number;
  href: string;
}

export interface CommunityListResponse {
  communities: CommunitySummary[];
}

export interface CommunityChannel {
  id: number;
  slug: string;
  name: string;
  description: string;
  /** `feed` (threaded posts) or `chat` (group messages). */
  format: string;
  /** `public` or `private`. Private channels only reach moderators at all. */
  visibility: string;
  coverImage: string;
  /** The layouts this channel offers: feed, forum, gallery. */
  viewModes: string[];
  /** Which of them it opens in. */
  defaultViewMode: string;
  postCount: number;
  unreadCount: number;
  href: string;
}

export interface CommunityMembership {
  role: CommunityRole;
  points: number;
  bio: string;
  headline: string;
  joinedAt: string | null;
  lastSeenAt: string | null;
  badges: CommunityBadge[];
  nextBadge: NextBadge | null;
}

export interface CommunityOverview {
  community: {
    id: number;
    slug: string;
    name: string;
    description: string;
    coverImage: string;
    memberCount: number;
  };
  membership: CommunityMembership;
  channels: CommunityChannel[];
  unreadTotal: number;
  unreadNotifications: number;
  /** Null when the community has no live room, so the chip is simply absent. */
  liveRoom: { enabled: true; label: string; href: string } | null;
  /**
   * Null when there are no guidelines. `pending` raises the modal; reading the
   * room stays open either way, so somebody deciding whether to accept can see
   * what they are agreeing to.
   */
  guidelines: { text: string; pending: boolean } | null;
}

/* ------------------------------------------------------------------ feed */

export type PostKind = "text" | "image" | "video" | "poll" | "link";

export interface PostReaction {
  emoji: string;
  count: number;
  /** Whether this member is one of the people behind the count. */
  mine: boolean;
}

export interface PollOption {
  id: number;
  label: string;
  voteCount: number;
  mine: boolean;
}

export interface PostPoll {
  options: PollOption[];
  totalVotes: number;
  /** Null until this member has voted, which is what hides the results. */
  myOptionId: number | null;
}

export interface PostAuthor {
  /** Null on a post the host wrote from the admin: no member account behind it. */
  memberId: number | null;
  name: string;
  avatarUrl: string;
  headline: string;
  isHost: boolean;
}

export interface CommunityPost {
  id: number;
  kind: PostKind;
  title: string;
  body: string;
  mediaUrl: string;
  pinned: boolean;
  locked: boolean;
  author: PostAuthor;
  mine: boolean;
  canEdit: boolean;
  commentCount: number;
  reactionCount: number;
  reactions: PostReaction[];
  myReactions: string[];
  poll: PostPoll | null;
  createdAt: string | null;
  updatedAt: string | null;
  lastActivityAt: string | null;
}

export interface ChannelFeedPage {
  community: { id: number; slug: string; name: string };
  channel: {
    id: number;
    slug: string;
    name: string;
    description: string;
    format: string;
    visibility: string;
    viewModes: string[];
    defaultViewMode: string;
  };
  posts: CommunityPost[];
  /** The server's allowlist. The reaction row is drawn from this, not a const. */
  reactionEmoji: string[];
  page: number;
  perPage: number;
  total: number;
  hasMore: boolean;
}

export interface PostDeleted {
  id: number;
  deleted: true;
}

export function isPostDeleted(result: CommunityPost | PostDeleted): result is PostDeleted {
  return (result as PostDeleted).deleted === true;
}

export interface NewPostInput {
  kind: PostKind;
  title?: string;
  body?: string;
  mediaUrl?: string;
  pollOptions?: string[];
}

/* -------------------------------------------------------------- comments */

export interface CommunityComment {
  id: number;
  parentId: number | null;
  memberId: number | null;
  authorName: string;
  authorAvatarUrl: string;
  authorIsHost: boolean;
  body: string;
  mine: boolean;
  createdAt: string | null;
  updatedAt: string | null;
  replies: CommunityComment[];
}

export interface CommentThreadResponse {
  postId: number;
  locked: boolean;
  comments: CommunityComment[];
}

/* ------------------------------------------------------------- reactions */

export interface ReactionResult {
  postId: number;
  reactions: PostReaction[];
}

export interface VoteResult extends PostPoll {
  postId: number;
}

/* ----------------------------------------------------------- moderation */

export type ModerationAction = "pin" | "unpin" | "lock" | "unlock" | "hide";

/* --------------------------------------------------------- notifications */

export interface CommunityNotification {
  id: number;
  kind: string;
  title: string;
  body: string;
  /** An in-app path, not an absolute URL — routed, never opened as a link. */
  link: string;
  actor: { name: string; avatarUrl: string } | null;
  read: boolean;
  createdAt: string | null;
}

export interface NotificationPage {
  notifications: CommunityNotification[];
  unreadCount: number;
  page: number;
  perPage: number;
  total: number;
  hasMore: boolean;
}

export interface MarkReadResult {
  marked: number;
  unreadCount: number;
}

/* ------------------------------------------------------------- directory */

/**
 * Note what is absent: there is no email field here, and there is none on the
 * profile either. The API does not send one. Members hand over an address to
 * buy something and to be told when their course opens, not so that four
 * hundred strangers in the same room can have it.
 */
export interface DirectoryMember {
  memberId: number;
  name: string;
  avatarUrl: string;
  headline: string;
  role: CommunityRole;
  points: number;
  joinedAt: string | null;
  /** The emoji of the highest badge they have earned, or null. */
  badge: string | null;
  mine: boolean;
  href: string;
}

export interface DirectoryPage {
  members: DirectoryMember[];
  page: number;
  perPage: number;
  total: number;
  hasMore: boolean;
}

export interface CommunityMemberProfile {
  memberId: number;
  name: string;
  avatarUrl: string;
  headline: string;
  bio: string;
  role: CommunityRole;
  points: number;
  joinedAt: string | null;
  postCount: number;
  commentCount: number;
  mine: boolean;
  badges: CommunityBadge[];
}

/* ----------------------------------------------------------- leaderboard */

export interface LeaderboardRow {
  memberId: number;
  name: string;
  avatarUrl: string;
  headline: string;
  points: number;
  rank: number;
  badge: string | null;
  mine: boolean;
}

export interface LeaderboardResponse {
  leaderboard: LeaderboardRow[];
  /** This member's own row, wherever it sits. Null if they are not ranked. */
  me: LeaderboardRow | null;
}

/* ------------------------------------------------------------ challenges */

export interface ChallengeEntry {
  id: number;
  approved: boolean;
  proofUrl: string;
  note: string;
  enteredAt: string | null;
}

export interface Challenge {
  id: number;
  title: string;
  description: string;
  coverImage: string;
  startsAt: string | null;
  endsAt: string | null;
  points: number;
  entryCount: number;
  open: boolean;
  myEntry: ChallengeEntry | null;
}

export interface ChallengesResponse {
  challenges: Challenge[];
}

export interface ChallengeEntryResult {
  challengeId: number;
  entryId?: number;
  entered: boolean;
  approved: boolean;
  proofUrl?: string;
  note?: string;
  enteredAt?: string | null;
  /** True once an admin has approved it: the proof behind the points is fixed. */
  locked: boolean;
}

/* ---------------------------------------------------------------- events */

export type RsvpStatus = "going" | "maybe" | "declined";

export interface CommunityEvent {
  id: number;
  title: string;
  description: string;
  startsAt: string | null;
  durationMinutes: number;
  locationUrl: string;
  goingCount: number;
  myStatus: RsvpStatus | null;
  attended: boolean;
  upcoming: boolean;
}

export interface EventsResponse {
  events: CommunityEvent[];
  upcoming: CommunityEvent[];
  past: CommunityEvent[];
}

export interface RsvpResult {
  eventId: number;
  status: RsvpStatus;
  goingCount: number;
}

/* ------------------------------------------------------------------ wire */

function query(params: Record<string, string | number | boolean | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  const encoded = search.toString();
  return encoded ? `?${encoded}` : "";
}

/** Path segments are member-supplied only in the sense that they came from a URL bar. */
const seg = encodeURIComponent;

/* ------------------------------------------------------------- live room */

export interface LiveRoomPeer {
  peerId: string;
  memberId: number;
  name: string;
  avatarUrl: string;
  role: string;
}

export interface DmMessage {
  id: number;
  mine: boolean;
  body: string;
  at: string;
}

export interface DmThreadSummary {
  id: number;
  otherMemberId: number;
  otherName: string;
  otherAvatarUrl: string;
  lastMessageAt: string | null;
  preview: string;
  unread: number;
}

export interface DmThreadList {
  threads: DmThreadSummary[];
  unreadTotal: number;
}

export interface DmThread {
  threadId: number;
  other: { memberId: number; name: string; avatarUrl: string };
  messages: DmMessage[];
}

export interface LiveRoomStatus {
  /** Yvette calls hers Office Hours; this is Kajabi's "feature alias". */
  label: string;
  communityName: string;
  access: "always" | "hosted";
  open: boolean;
  /** Said plainly — a closed room with no reason reads as a bug. */
  closedReason: string;
  capacity: number;
  occupancy: number;
  full: boolean;
  youAreHost: boolean;
  roster: LiveRoomPeer[];
}

export const communityApi = {
  list: () => memberRequest<CommunityListResponse>("/member/community"),

  liveStatus: (slug: string) =>
    memberRequest<LiveRoomStatus>(`/member/community/${seg(slug)}/live`),

  acceptGuidelines: (slug: string) =>
    memberRequest<{ accepted: true }>(`/member/community/${seg(slug)}/guidelines/accept`, {
      method: "POST",
    }),

  // ---- direct messages ----

  dmThreads: (slug: string) =>
    memberRequest<DmThreadList>(`/member/community/${seg(slug)}/dm`),

  dmThread: (slug: string, memberId: number) =>
    memberRequest<DmThread>(`/member/community/${seg(slug)}/dm/${memberId}`),

  sendDm: (slug: string, memberId: number, body: string) =>
    memberRequest<DmMessage>(`/member/community/${seg(slug)}/dm/${memberId}`, {
      method: "POST",
      body: JSON.stringify({ body }),
    }),

  overview: (slug: string) => memberRequest<CommunityOverview>(`/member/community/${seg(slug)}`),

  // ---- feed ----

  posts: (slug: string, channelSlug: string, page = 1, perPage = 20) =>
    memberRequest<ChannelFeedPage>(
      `/member/community/${seg(slug)}/channels/${seg(channelSlug)}/posts${query({ page, perPage })}`,
    ),

  createPost: (slug: string, channelSlug: string, input: NewPostInput) =>
    memberRequest<CommunityPost>(
      `/member/community/${seg(slug)}/channels/${seg(channelSlug)}/posts`,
      { method: "POST", body: JSON.stringify(input) },
    ),

  updatePost: (postId: number, input: { title?: string; body?: string; mediaUrl?: string }) =>
    memberRequest<CommunityPost>(`/member/community/posts/${postId}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),

  deletePost: (postId: number) =>
    memberRequest<PostDeleted>(`/member/community/posts/${postId}`, { method: "DELETE" }),

  /**
   * Moderator-only. Hiding answers in the same `{id, deleted}` shape a member
   * deleting their own post gets, because to every other reader it is the same
   * event: the post is gone from the feed.
   */
  moderatePost: (postId: number, action: ModerationAction) =>
    memberRequest<CommunityPost | PostDeleted>(`/member/community/posts/${postId}/moderate`, {
      method: "POST",
      body: JSON.stringify({ action }),
    }),

  // ---- comments ----

  comments: (postId: number) =>
    memberRequest<CommentThreadResponse>(`/member/community/posts/${postId}/comments`),

  addComment: (postId: number, body: string, parentId?: number) =>
    memberRequest<CommunityComment>(`/member/community/posts/${postId}/comments`, {
      method: "POST",
      body: JSON.stringify(parentId === undefined ? { body } : { body, parentId }),
    }),

  // ---- reactions ----

  react: (postId: number, emoji: string) =>
    memberRequest<ReactionResult>(`/member/community/posts/${postId}/reactions`, {
      method: "POST",
      body: JSON.stringify({ emoji }),
    }),

  /** The emoji rides in the query string: a DELETE with a body is awkward. */
  unreact: (postId: number, emoji: string) =>
    memberRequest<ReactionResult>(
      `/member/community/posts/${postId}/reactions${query({ emoji })}`,
      { method: "DELETE" },
    ),

  // ---- polls ----

  vote: (postId: number, optionId: number) =>
    memberRequest<VoteResult>(`/member/community/posts/${postId}/vote`, {
      method: "POST",
      body: JSON.stringify({ optionId }),
    }),

  // ---- reports ----

  reportPost: (postId: number, reason: string) =>
    memberRequest<{ reported: true }>(`/member/community/posts/${postId}/report`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    }),

  reportComment: (commentId: number, reason: string) =>
    memberRequest<{ reported: true }>(`/member/community/comments/${commentId}/report`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    }),

  // ---- notifications ----

  notifications: (input: { page?: number; perPage?: number; unread?: boolean } = {}) =>
    memberRequest<NotificationPage>(`/member/community/notifications${query({ ...input })}`),

  markRead: (input: { ids: number[] } | { all: true }) =>
    memberRequest<MarkReadResult>("/member/community/notifications/read", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  // ---- people ----

  members: (slug: string, input: { page?: number; perPage?: number; q?: string } = {}) =>
    memberRequest<DirectoryPage>(`/member/community/${seg(slug)}/members${query({ ...input })}`),

  profile: (slug: string, memberId: number) =>
    memberRequest<CommunityMemberProfile>(`/member/community/${seg(slug)}/members/${memberId}`),

  leaderboard: (slug: string) =>
    memberRequest<LeaderboardResponse>(`/member/community/${seg(slug)}/leaderboard`),

  // ---- challenges ----

  challenges: (slug: string) =>
    memberRequest<ChallengesResponse>(`/member/community/${seg(slug)}/challenges`),

  enterChallenge: (challengeId: number, input: { proofUrl?: string; note?: string }) =>
    memberRequest<ChallengeEntryResult>(`/member/community/challenges/${challengeId}/enter`, {
      method: "POST",
      body: JSON.stringify(input),
    }),

  // ---- events ----

  events: (slug: string) =>
    memberRequest<EventsResponse>(`/member/community/${seg(slug)}/events`),

  rsvp: (eventId: number, status: RsvpStatus) =>
    memberRequest<RsvpResult>(`/member/community/events/${eventId}/rsvp`, {
      method: "POST",
      body: JSON.stringify({ status }),
    }),
};
