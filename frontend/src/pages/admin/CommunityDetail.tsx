import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import * as Tabs from "@radix-ui/react-tabs";
import { motion } from "motion/react";
import {
  ArrowLeft,
  Award,
  CalendarDays,
  Check,
  Hash,
  MessageSquare,
  Pin,
  Plus,
  Send,
  Target,
  Trash2,
  Trophy,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { adminApi } from "@/lib/api";
import type {
  Challenge,
  ChallengeEntry,
  CommunityBadge,
  CommunityChannel,
  CommunityDetail as CommunityDetailType,
  CommunityEvent,
  CommunityMembership,
  CommunityPost,
  LeaderboardEntry,
  Member,
} from "@/types/admin";
import { cn } from "@/lib/cn";
import { formatDateTime, formatNumber, formatRelative } from "@/lib/format";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorNotice,
  Field,
  Input,
  PageHeader,
  Skeleton,
  Textarea,
} from "@/pages/admin/ui/primitives";
import { Modal, useConfirm } from "@/pages/admin/ui/Dialog";
import { friendlyError, pluralize } from "@/pages/admin/ui/friendly";

const TAB_LIST = [
  { value: "channels", label: "Channels", icon: Hash },
  { value: "members", label: "Members", icon: Users },
  { value: "challenges", label: "Challenges", icon: Target },
  { value: "events", label: "Events", icon: CalendarDays },
  { value: "badges", label: "Badges", icon: Award },
] as const;

/**
 * The stored values for a channel are one-word machine settings; what she needs
 * to choose between is how the channel behaves and who is allowed in. Both the
 * pickers and the read-back subtitles come from these lists so the words she
 * picked are the words she sees afterwards.
 */
const CHANNEL_FORMATS = [
  { value: "feed", label: "Posts & comments" },
  { value: "chat", label: "Live chat" },
] as const;

const CHANNEL_VISIBILITY = [
  { value: "public", label: "Everyone in this community" },
  { value: "private", label: "Invited members only" },
] as const;

function channelFormatLabel(format: string): string {
  return CHANNEL_FORMATS.find((option) => option.value === format)?.label ?? "Posts & comments";
}

/** What a person can do in the space, rather than the word stored against them. */
const ROLE_LABEL: Record<string, string> = {
  member: "Member",
  moderator: "Helps run this",
  admin: "Runs this",
};

export default function CommunityDetail() {
  const { id } = useParams();
  const communityId = Number(id);
  const [community, setCommunity] = useState<CommunityDetailType | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!communityId) return;
    adminApi
      .community(communityId)
      .then(setCommunity)
      .catch(() => setError("We couldn't load this community. Try refreshing the page."));
  }, [communityId]);

  useEffect(load, [load]);

  if (error) return <ErrorNotice message={error} />;

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link to="/admin/community">
          <ArrowLeft />
          All communities
        </Link>
      </Button>

      <PageHeader
        eyebrow="Community"
        title={community?.name ?? "Loading…"}
        description={community?.description}
        actions={
          community && (
            <Badge tone={community.access === "paid" ? "gold" : "neutral"}>
              {community.access === "paid" ? "Paid community" : "Free community"}
            </Badge>
          )
        }
      />

      <Tabs.Root defaultValue="channels">
        <Tabs.List className="flex gap-1 overflow-x-auto rounded-xl border border-hairline/70 bg-surface p-1.5">
          {TAB_LIST.map((tab) => {
            const Icon = tab.icon;
            return (
              <Tabs.Trigger
                key={tab.value}
                value={tab.value}
                className="flex shrink-0 items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-ink-soft transition-colors hover:text-plum data-[state=active]:bg-brand-gradient data-[state=active]:text-white"
              >
                <Icon className="size-4" />
                {tab.label}
              </Tabs.Trigger>
            );
          })}
        </Tabs.List>

        <div className="mt-5">
          <Tabs.Content value="channels">
            <ChannelsTab communityId={communityId} channels={community?.channels ?? null} onChange={load} />
          </Tabs.Content>
          <Tabs.Content value="members">
            <MembersTab communityId={communityId} />
          </Tabs.Content>
          <Tabs.Content value="challenges">
            <ChallengesTab communityId={communityId} />
          </Tabs.Content>
          <Tabs.Content value="events">
            <EventsTab communityId={communityId} />
          </Tabs.Content>
          <Tabs.Content value="badges">
            <BadgesTab communityId={communityId} />
          </Tabs.Content>
        </div>
      </Tabs.Root>
    </div>
  );
}

/* ---------------------------------------------------------------- Channels */

function ChannelsTab({
  communityId,
  channels,
  onChange,
}: {
  communityId: number;
  channels: CommunityChannel[] | null;
  onChange: () => void;
}) {
  const [active, setActive] = useState<CommunityChannel | null>(null);
  const [posts, setPosts] = useState<CommunityPost[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", description: "", format: "feed", visibility: "public" });
  const [composer, setComposer] = useState("");
  const [confirm, confirmDialog] = useConfirm();

  // Select the first channel once they load.
  useEffect(() => {
    if (channels?.length && !active) setActive(channels[0]);
  }, [channels, active]);

  const loadPosts = useCallback((channelId: number) => {
    setPosts(null);
    adminApi
      .channelPosts(channelId)
      .then(setPosts)
      .catch(() => toast.error("We couldn't load what's in this channel. Try again in a moment."));
  }, []);

  useEffect(() => {
    if (active) loadPosts(active.id);
  }, [active, loadPosts]);

  async function createChannel(e: FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    try {
      await adminApi.channelCreate(communityId, form);
      toast.success("Channel created");
      setCreating(false);
      setForm({ name: "", description: "", format: "feed", visibility: "public" });
      onChange();
    } catch (err) {
      toast.error(friendlyError(err, "channel"));
    }
  }

  async function post(e: FormEvent) {
    e.preventDefault();
    if (!active || !composer.trim()) return;
    try {
      const created = await adminApi.postCreate(active.id, { body: composer, authorName: "Host" });
      setPosts((prev) => (prev ? [created, ...prev] : [created]));
      setComposer("");
      toast.success("Posted — your members can see it now");
    } catch (err) {
      toast.error(friendlyError(err, "post"));
    }
  }

  async function togglePin(p: CommunityPost) {
    try {
      const updated = await adminApi.postUpdate(p.id, { pinned: !p.pinned });
      setPosts((prev) => prev?.map((x) => (x.id === p.id ? { ...x, pinned: updated.pinned } : x)) ?? prev);
    } catch (err) {
      toast.error(friendlyError(err, "post"));
    }
  }

  async function removePost(p: CommunityPost) {
    const ok = await confirm({
      title: "Delete this post?",
      description: "The comments and reactions on it go too, and you can't get them back.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    try {
      await adminApi.postDelete(p.id);
      setPosts((prev) => prev?.filter((x) => x.id !== p.id) ?? prev);
      toast.success("Post deleted");
    } catch (err) {
      toast.error(friendlyError(err, "post"));
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[17rem_minmax(0,1fr)]">
      <Card className="h-fit">
        <CardHeader
          title="Channels"
          action={
            <Button
              variant="ghost"
              size="iconSm"
              aria-label="Add a channel"
              onClick={() => setCreating(true)}
            >
              <Plus />
            </Button>
          }
        />
        <div className="p-2">
          {channels === null ? (
            <div className="space-y-2 p-2">
              {Array.from({ length: 3 }, (_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : channels.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-ink-soft">
              No channels yet — create one to start posting.
            </p>
          ) : (
            <ul className="space-y-0.5">
              {channels.map((channel) => (
                <li key={channel.id}>
                  <button
                    type="button"
                    onClick={() => setActive(channel)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm transition-colors",
                      active?.id === channel.id
                        ? "bg-lilac-tint font-semibold text-plum-deep"
                        : "text-ink-soft hover:bg-cream",
                    )}
                  >
                    <Hash className="size-4 shrink-0 opacity-60" />
                    <span className="min-w-0 flex-1 truncate">{channel.name}</span>
                    {channel.visibility === "private" && (
                      <span className="text-[0.6rem] font-bold uppercase text-ink-soft/60">
                        Invite only
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      <Card>
        {/* The channel's own name, never its web address — she named it
            "Wins & Wednesdays", not "wins-wednesdays". */}
        <CardHeader
          title={active ? active.name : "No channel picked yet"}
          subtitle={
            active ? active.description || channelFormatLabel(active.format) : undefined
          }
        />

        {active && (
          <form onSubmit={post} className="border-b border-hairline/60 p-4">
            <Textarea
              rows={3}
              value={composer}
              onChange={(e) => setComposer(e.target.value)}
              placeholder={`Share something with ${active.name}…`}
              aria-label="Write a post"
            />
            <div className="mt-2.5 flex justify-end">
              <Button type="submit" size="sm" disabled={!composer.trim()}>
                <Send />
                Post
              </Button>
            </div>
          </form>
        )}

        {!active ? (
          <EmptyState
            icon={<Hash />}
            title="Pick a channel"
            description="Choose one on the left to read it and post in it."
          />
        ) : posts === null ? (
          <div className="space-y-3 p-5">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-20 w-full" />
            ))}
          </div>
        ) : posts.length === 0 ? (
          <EmptyState
            icon={<MessageSquare />}
            title="No posts yet"
            description="Kick things off with a welcome post."
          />
        ) : (
          <ul className="divide-y divide-hairline/60">
            {posts.map((p) => (
              <motion.li
                key={p.id}
                layout
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className="p-4"
              >
                <div className="flex items-start gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-lilac-tint text-xs font-bold text-plum-deep">
                    {(p.authorName || "H").slice(0, 1).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-semibold text-ink">{p.authorName || "Host"}</span>
                      <span className="text-xs text-ink-soft">{formatRelative(p.createdAt)}</span>
                      {p.pinned && (
                        <Badge tone="gold">
                          <Pin className="size-3" />
                          Pinned
                        </Badge>
                      )}
                      {p.status === "hidden" && <Badge tone="slate">Hidden from members</Badge>}
                    </p>
                    {p.title && <p className="mt-1 font-semibold text-ink">{p.title}</p>}
                    <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-ink-soft">
                      {p.body}
                    </p>
                    <p className="mt-2 flex gap-4 text-xs text-ink-soft/80">
                      <span>{pluralize(p.commentCount, "comment")}</span>
                      <span>{pluralize(p.reactionCount, "reaction")}</span>
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button
                      variant="ghost"
                      size="iconSm"
                      aria-label={p.pinned ? "Unpin post" : "Pin post"}
                      onClick={() => togglePin(p)}
                    >
                      <Pin className={p.pinned ? "text-gold" : undefined} />
                    </Button>
                    <Button
                      variant="dangerGhost"
                      size="iconSm"
                      aria-label="Delete post"
                      onClick={() => removePost(p)}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </div>
              </motion.li>
            ))}
          </ul>
        )}
      </Card>

      <Modal
        open={creating}
        onOpenChange={setCreating}
        title="New channel"
        description="A room inside this community for one kind of conversation."
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button size="sm" type="submit" form="new-channel">
              Create channel
            </Button>
          </>
        }
      >
        <form id="new-channel" onSubmit={createChannel} className="space-y-4">
          <Field label="What's it called?" htmlFor="channel-name">
            <Input
              id="channel-name"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Wins & Wednesdays"
              required
              autoFocus
            />
          </Field>
          <Field
            label="What's it for?"
            hint="shown under the channel name"
            htmlFor="channel-desc"
          >
            <Input
              id="channel-desc"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="Share the win you're proudest of this week."
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="How should it work?">
              <div className="flex gap-2">
                {CHANNEL_FORMATS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, format: option.value }))}
                    className={cn(
                      "flex-1 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors",
                      form.format === option.value
                        ? "bg-brand-gradient text-white"
                        : "border border-hairline text-ink-soft hover:border-plum/40",
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Who can see it?">
              <div className="flex gap-2">
                {CHANNEL_VISIBILITY.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, visibility: option.value }))}
                    className={cn(
                      "flex-1 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors",
                      form.visibility === option.value
                        ? "bg-brand-gradient text-white"
                        : "border border-hairline text-ink-soft hover:border-plum/40",
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </Field>
          </div>
        </form>
      </Modal>

      {confirmDialog}
    </div>
  );
}

/* ----------------------------------------------------------------- Members */

function MembersTab({ communityId }: { communityId: number }) {
  const [memberships, setMemberships] = useState<CommunityMembership[] | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[] | null>(null);
  const [allMembers, setAllMembers] = useState<Member[]>([]);
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState("");

  const load = useCallback(() => {
    adminApi.communityMembers(communityId).then(setMemberships).catch(() => undefined);
    adminApi.leaderboard(communityId).then(setLeaderboard).catch(() => undefined);
  }, [communityId]);

  useEffect(load, [load]);
  useEffect(() => {
    adminApi.membersList().then(setAllMembers).catch(() => undefined);
  }, []);

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!selected) return;
    try {
      await adminApi.communityAddMember(communityId, Number(selected));
      toast.success("They're in — they can see this community now");
      setAdding(false);
      setSelected("");
      load();
    } catch (err) {
      toast.error(friendlyError(err, "member"));
    }
  }

  async function remove(membership: CommunityMembership) {
    try {
      await adminApi.membershipDelete(membership.id);
      setMemberships((prev) => prev?.filter((m) => m.id !== membership.id) ?? prev);
      toast.success("Removed from this community");
    } catch (err) {
      toast.error(friendlyError(err, "member"));
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <Card>
        <CardHeader
          title="Members"
          subtitle={
            memberships
              ? `${pluralize(memberships.length, "person", "people")} in this community`
              : undefined
          }
          action={
            <Button size="sm" onClick={() => setAdding(true)}>
              <Plus />
              Add someone
            </Button>
          }
        />
        {memberships === null ? (
          <div className="space-y-2 p-5">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : memberships.length === 0 ? (
          <EmptyState
            icon={<Users />}
            title="No members yet"
            description="Add someone from your Members list and they'll see this community."
          />
        ) : (
          <ul className="divide-y divide-hairline/60">
            {memberships.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-lilac-tint text-xs font-bold text-plum-deep">
                  {(m.name || m.email).slice(0, 1).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-ink">{m.name || m.email}</p>
                  <p className="truncate text-xs text-ink-soft">{m.email}</p>
                </div>
                <Badge tone={m.role === "member" ? "neutral" : "plum"}>
                  {ROLE_LABEL[m.role] ?? "Member"}
                </Badge>
                <Badge tone="gold">{formatNumber(m.points)} points</Badge>
                <Button
                  variant="dangerGhost"
                  size="iconSm"
                  aria-label={`Remove ${m.name || m.email} from this community`}
                  onClick={() => remove(m)}
                >
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="h-fit">
        <CardHeader
          title="Leaderboard"
          subtitle="Your 20 most active members"
          icon={<Trophy className="size-4" />}
        />
        {leaderboard === null ? (
          <div className="space-y-2 p-5">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : leaderboard.length === 0 ? (
          <EmptyState
            icon={<Trophy />}
            title="No points yet"
            description="Points add up as members post and finish your challenges."
          />
        ) : (
          <ol className="divide-y divide-hairline/60">
            {leaderboard.map((entry, i) => (
              <li key={entry.email} className="flex items-center gap-3 px-5 py-3">
                <span
                  className={cn(
                    "grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold",
                    i === 0
                      ? "bg-gold text-ink"
                      : i < 3
                        ? "bg-lilac-tint text-plum-deep"
                        : "bg-cream text-ink-soft",
                  )}
                >
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-ink">
                  {entry.badge && <span className="mr-1">{entry.badge}</span>}
                  {entry.name || entry.email}
                </span>
                <span className="shrink-0 text-sm font-bold tabular-nums text-plum">
                  {entry.points}
                </span>
              </li>
            ))}
          </ol>
        )}
      </Card>

      <Modal
        open={adding}
        onOpenChange={setAdding}
        title="Add someone to this community"
        description="You can only add people who are already in your Members list — add them there first, then come back."
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setAdding(false)}>
              Cancel
            </Button>
            <Button size="sm" type="submit" form="add-member" disabled={!selected}>
              Add them
            </Button>
          </>
        }
      >
        <form id="add-member" onSubmit={add}>
          <Field label="Who do you want to add?" htmlFor="add-member-who">
            <select
              id="add-member-who"
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              className="h-11 w-full rounded-xl border border-hairline bg-surface px-3 text-sm outline-none focus-visible:border-plum focus-visible:ring-4 focus-visible:ring-plum/12"
            >
              <option value="">Choose someone…</option>
              {allMembers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name ? `${m.name} — ${m.email}` : m.email}
                </option>
              ))}
            </select>
          </Field>
        </form>
      </Modal>
    </div>
  );
}

/* -------------------------------------------------------------- Challenges */

/**
 * A challenge's dates as a sentence. Both dates are optional, and an arrow
 * between a date and the words "open ended" reads like a database row — this
 * says which of the four cases she's actually looking at.
 */
function challengeDates(challenge: Challenge): string {
  if (challenge.startsAt && challenge.endsAt) {
    return `Runs ${formatDateTime(challenge.startsAt)} to ${formatDateTime(challenge.endsAt)}`;
  }
  if (challenge.startsAt) return `Starts ${formatDateTime(challenge.startsAt)} · no end date`;
  if (challenge.endsAt) return `Ends ${formatDateTime(challenge.endsAt)}`;
  return "No dates set — this one runs until you delete it";
}

function ChallengesTab({ communityId }: { communityId: number }) {
  const [challenges, setChallenges] = useState<Challenge[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ title: "", description: "", points: 10, startsAt: "", endsAt: "" });
  const [entriesFor, setEntriesFor] = useState<Challenge | null>(null);
  const [entries, setEntries] = useState<ChallengeEntry[] | null>(null);

  const load = useCallback(() => {
    adminApi
      .challenges(communityId)
      .then(setChallenges)
      .catch(() => undefined);
  }, [communityId]);

  useEffect(load, [load]);

  useEffect(() => {
    if (!entriesFor) return;
    setEntries(null);
    adminApi.challengeEntries(entriesFor.id).then(setEntries).catch(() => undefined);
  }, [entriesFor]);

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) return;
    try {
      await adminApi.challengeCreate(communityId, form);
      toast.success("Challenge created");
      setCreating(false);
      setForm({ title: "", description: "", points: 10, startsAt: "", endsAt: "" });
      load();
    } catch (err) {
      toast.error(friendlyError(err, "challenge"));
    }
  }

  async function approve(entry: ChallengeEntry) {
    try {
      await adminApi.entryApprove(entry.id);
      setEntries((prev) =>
        prev?.map((x) => (x.id === entry.id ? { ...x, approved: true } : x)) ?? prev,
      );
      toast.success("Approved — their points have gone up");
      load();
    } catch (err) {
      toast.error(friendlyError(err, "entry"));
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus />
          New challenge
        </Button>
      </div>

      {challenges === null ? (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-40 w-full" />
          ))}
        </div>
      ) : challenges.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Target />}
            title="No challenges yet"
            description="A challenge with a start and end date is the quickest way to get a quiet space talking again."
            action={
              <Button size="sm" onClick={() => setCreating(true)}>
                Create challenge
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {challenges.map((c) => (
            <Card key={c.id} className="p-5">
              <div className="flex items-start justify-between gap-3">
                <h3 className="font-display text-lg text-ink">{c.title}</h3>
                <Badge tone="gold">{c.points} points</Badge>
              </div>
              <p className="mt-1.5 line-clamp-2 text-sm text-ink-soft">
                {c.description || "No description yet."}
              </p>
              <p className="mt-3 text-xs text-ink-soft">{challengeDates(c)}</p>
              <div className="mt-4 flex items-center justify-between border-t border-hairline/70 pt-3">
                <span className="text-xs text-ink-soft">
                  {c.entryCount === 0 ? (
                    "Nobody's entered yet"
                  ) : (
                    <>
                      <strong className="text-ink">{c.approvedCount}</strong> of {c.entryCount}{" "}
                      approved
                    </>
                  )}
                </span>
                <Button variant="secondary" size="sm" onClick={() => setEntriesFor(c)}>
                  See who's entered
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal
        open={creating}
        onOpenChange={setCreating}
        title="New challenge"
        description="Something for your members to do, with points for finishing it."
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button size="sm" type="submit" form="new-challenge">
              Create
            </Button>
          </>
        }
      >
        <form id="new-challenge" onSubmit={create} className="space-y-4">
          <Field label="What's the challenge called?" htmlFor="challenge-title">
            <Input
              id="challenge-title"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="10-day client attraction sprint"
              required
              autoFocus
            />
          </Field>
          <Field label="What do they have to do?" htmlFor="challenge-desc">
            <Textarea
              id="challenge-desc"
              rows={3}
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="Reach out to one past client a day for ten days, and share how it went."
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Points for finishing" htmlFor="challenge-points">
              <Input
                id="challenge-points"
                type="number"
                min={0}
                value={form.points}
                onChange={(e) => setForm((f) => ({ ...f, points: Number(e.target.value) }))}
              />
            </Field>
            <Field label="Starts" hint="optional" htmlFor="challenge-starts">
              <Input
                id="challenge-starts"
                type="date"
                value={form.startsAt}
                onChange={(e) => setForm((f) => ({ ...f, startsAt: e.target.value }))}
              />
            </Field>
            <Field label="Ends" hint="optional" htmlFor="challenge-ends">
              <Input
                id="challenge-ends"
                type="date"
                value={form.endsAt}
                onChange={(e) => setForm((f) => ({ ...f, endsAt: e.target.value }))}
              />
            </Field>
          </div>
        </form>
      </Modal>

      <Modal
        open={entriesFor !== null}
        onOpenChange={(open) => !open && setEntriesFor(null)}
        title={entriesFor ? `Who's entered — ${entriesFor.title}` : ""}
        description={
          entriesFor
            ? `Approving someone adds ${entriesFor.points} points to their total straight away.`
            : undefined
        }
        size="lg"
      >
        {entries === null ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : entries.length === 0 ? (
          <EmptyState
            icon={<Target />}
            title="Nobody's entered yet"
            description="As members finish the challenge, they'll appear here for you to approve."
          />
        ) : (
          <ul className="divide-y divide-hairline/60">
            {entries.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-ink">
                    {entry.name || entry.email}
                  </p>
                  {entry.note && <p className="truncate text-xs text-ink-soft">{entry.note}</p>}
                  {entry.proofUrl && (
                    <a
                      href={entry.proofUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs font-semibold text-plum hover:underline"
                    >
                      See what they sent
                    </a>
                  )}
                </div>
                {entry.approved ? (
                  <Badge tone="green">
                    <Check className="size-3" />
                    Approved
                  </Badge>
                ) : (
                  <Button size="sm" onClick={() => approve(entry)}>
                    Approve
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Modal>
    </div>
  );
}

/* ------------------------------------------------------------------ Events */

function EventsTab({ communityId }: { communityId: number }) {
  const [events, setEvents] = useState<CommunityEvent[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ title: "", description: "", startsAt: "", durationMinutes: 60, locationUrl: "" });

  const load = useCallback(() => {
    adminApi.communityEvents(communityId).then(setEvents).catch(() => undefined);
  }, [communityId]);

  useEffect(load, [load]);

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) return;
    try {
      await adminApi.eventCreate(communityId, form);
      toast.success("Event scheduled — your members can see it now");
      setCreating(false);
      setForm({ title: "", description: "", startsAt: "", durationMinutes: 60, locationUrl: "" });
      load();
    } catch (err) {
      toast.error(friendlyError(err, "event"));
    }
  }

  async function remove(id: number) {
    try {
      await adminApi.eventDelete(id);
      setEvents((prev) => prev?.filter((e) => e.id !== id) ?? prev);
      toast.success("Event deleted");
    } catch (err) {
      toast.error(friendlyError(err, "event"));
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus />
          Schedule event
        </Button>
      </div>

      <Card>
        {events === null ? (
          <div className="space-y-2 p-5">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : events.length === 0 ? (
          <EmptyState
            icon={<CalendarDays />}
            title="Nothing in the diary yet"
            description="Live calls and Q&As are what keep a space busy between launches."
          />
        ) : (
          <ul className="divide-y divide-hairline/60">
            {events.map((event) => (
              <li key={event.id} className="flex flex-wrap items-center gap-4 px-5 py-4">
                <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-lilac-tint text-plum">
                  <CalendarDays className="size-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-ink">{event.title}</p>
                  <p className="truncate text-xs text-ink-soft">
                    {event.startsAt ? formatDateTime(event.startsAt) : "No date set"} ·{" "}
                    {event.durationMinutes} minutes
                  </p>
                </div>
                {event.locationUrl && (
                  <Button asChild variant="secondary" size="sm">
                    <a href={event.locationUrl} target="_blank" rel="noreferrer">
                      Open the call
                    </a>
                  </Button>
                )}
                <Button
                  variant="dangerGhost"
                  size="iconSm"
                  aria-label={`Delete ${event.title}`}
                  onClick={() => remove(event.id)}
                >
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Modal
        open={creating}
        onOpenChange={setCreating}
        title="Schedule an event"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button size="sm" type="submit" form="new-event">
              Schedule
            </Button>
          </>
        }
      >
        <form id="new-event" onSubmit={create} className="space-y-4">
          <Field label="What's the event called?" htmlFor="event-title">
            <Input
              id="event-title"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="Monthly member Q&A"
              required
              autoFocus
            />
          </Field>
          <Field label="What happens on it?" htmlFor="event-desc">
            <Textarea
              id="event-desc"
              rows={2}
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="Bring one question about your practice and we'll work through it together."
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="When does it start?" htmlFor="event-starts">
              <Input
                id="event-starts"
                type="datetime-local"
                value={form.startsAt}
                onChange={(e) => setForm((f) => ({ ...f, startsAt: e.target.value }))}
              />
            </Field>
            <Field label="How long is it?" hint="in minutes" htmlFor="event-length">
              <Input
                id="event-length"
                type="number"
                min={5}
                value={form.durationMinutes}
                onChange={(e) => setForm((f) => ({ ...f, durationMinutes: Number(e.target.value) }))}
              />
            </Field>
          </div>
          <Field
            label="Where do they join?"
            hint="paste your Zoom, Meet or Riverside link"
            htmlFor="event-link"
          >
            <Input
              id="event-link"
              value={form.locationUrl}
              onChange={(e) => setForm((f) => ({ ...f, locationUrl: e.target.value }))}
              placeholder="https://zoom.us/j/…"
            />
          </Field>
        </form>
      </Modal>
    </div>
  );
}

/* ------------------------------------------------------------------ Badges */

function BadgesTab({ communityId }: { communityId: number }) {
  const [badges, setBadges] = useState<CommunityBadge[] | null>(null);
  const [form, setForm] = useState({ name: "", emoji: "🏅", threshold: 100 });

  const load = useCallback(() => {
    adminApi.badges(communityId).then(setBadges).catch(() => undefined);
  }, [communityId]);

  useEffect(load, [load]);

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    try {
      await adminApi.badgeCreate(communityId, form);
      setForm({ name: "", emoji: "🏅", threshold: 100 });
      toast.success("Badge created");
      load();
    } catch (err) {
      toast.error(friendlyError(err, "badge"));
    }
  }

  async function remove(id: number) {
    try {
      await adminApi.badgeDelete(id);
      setBadges((prev) => prev?.filter((b) => b.id !== id) ?? prev);
    } catch (err) {
      toast.error(friendlyError(err, "badge"));
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <Card>
        <CardHeader
          title="Badges"
          subtitle="Given out automatically when someone reaches the points"
        />
        {badges === null ? (
          <div className="space-y-2 p-5">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : badges.length === 0 ? (
          <EmptyState
            icon={<Award />}
            title="No badges yet"
            description="Add one to reward the members who keep showing up."
          />
        ) : (
          <ul className="divide-y divide-hairline/60">
            {badges.map((badge) => (
              <li key={badge.id} className="flex items-center gap-3 px-5 py-3.5">
                <span className="text-2xl">{badge.emoji}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-ink">{badge.name}</p>
                  <p className="text-xs text-ink-soft">
                    Given at {formatNumber(badge.threshold)} points
                  </p>
                </div>
                <Button
                  variant="dangerGhost"
                  size="iconSm"
                  aria-label={`Delete ${badge.name}`}
                  onClick={() => remove(badge.id)}
                >
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="h-fit">
        <CardHeader title="Add a badge" />
        <form onSubmit={create} className="space-y-4 p-5">
          <Field label="What's it called?" htmlFor="badge-name">
            <Input
              id="badge-name"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Founding Member"
              required
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Icon" hint="any emoji" htmlFor="badge-icon">
              <Input
                id="badge-icon"
                value={form.emoji}
                onChange={(e) => setForm((f) => ({ ...f, emoji: e.target.value }))}
                maxLength={4}
              />
            </Field>
            <Field label="Points needed" htmlFor="badge-points">
              <Input
                id="badge-points"
                type="number"
                min={0}
                value={form.threshold}
                onChange={(e) => setForm((f) => ({ ...f, threshold: Number(e.target.value) }))}
              />
            </Field>
          </div>
          <Button type="submit" size="sm" className="w-full">
            <Plus />
            Add badge
          </Button>
        </form>
      </Card>
    </div>
  );
}
