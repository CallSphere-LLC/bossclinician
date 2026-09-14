import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router";
import * as Tabs from "@radix-ui/react-tabs";
import { motion } from "motion/react";
import {
  ArrowLeft,
  ArrowUpDown,
  Award,
  CalendarClock,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronUp,
  Clock,
  Hash,
  Layers,
  Lock,
  MessageSquare,
  Paperclip,
  Pin,
  Plus,
  ScrollText,
  Send,
  Settings,
  ShieldAlert,
  Sparkles,
  Target,
  Trash2,
  Trophy,
  UserPlus,
  Users,
  Video,
  X,
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
  AdminAccessGroup,
  AdminAccessGroupGrants,
  AdminAccessGroupMember,
  AdminChannelInvite,
  AdminCommunityOffer,
  AdminCommunityReport,
  AdminLiveVisit,
  AdminPointRule,
  AdminScheduledPost,
  CommunityDetail as CommunityDetailShape,
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
  selectStyles,
  Skeleton,
  Textarea,
  Chip,
  chipRowStyles,
} from "@/pages/admin/ui/primitives";
import { Modal, useConfirm } from "@/pages/admin/ui/Dialog";
import {
  friendlyError,
  fromDateInput,
  fromDateTimeInput,
  pluralize,
  toDateTimeInput,
} from "@/pages/admin/ui/friendly";

const TAB_LIST = [
  { value: "channels", label: "Channels", icon: Hash },
  { value: "members", label: "Members", icon: Users },
  { value: "groups", label: "Access groups", icon: Layers },
  { value: "challenges", label: "Challenges", icon: Target },
  { value: "events", label: "Events", icon: CalendarDays },
  { value: "badges", label: "Badges", icon: Award },
  { value: "points", label: "Points", icon: Sparkles },
  { value: "review", label: "Review feed", icon: ShieldAlert },
  { value: "scheduled", label: "Scheduled", icon: Clock },
  { value: "guidelines", label: "Guidelines", icon: ScrollText },
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
    // A malformed id (`/admin/community/abc` → NaN, or `/0`) used to return
    // here without firing a request, leaving the page on "Loading…" for ever.
    // There is nothing to fetch, so say so rather than hanging.
    if (!Number.isInteger(communityId) || communityId <= 0) {
      setError("We couldn't find that community. It may have been deleted.");
      return;
    }
    adminApi
      .community(communityId)
      .then(setCommunity)
      // The error argument matters. This catch used to take no parameter and
      // print "Try refreshing the page" for every failure — including the 404
      // the server correctly returns for a community that no longer exists,
      // where refreshing can never help. `friendlyError` reads the status off
      // the ApiError and says "We couldn't find that community" instead.
      .catch((err: unknown) => setError(friendlyError(err, "community")));
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
        {/* Wraps rather than scrolls. This started as five tabs in a row and is
            now ten; `overflow-x-auto` kept them reachable in principle but
            clipped the last three at the card's edge with no visible hint that
            anything was there, which is indistinguishable from them being
            missing. Wrapping costs a second line on a narrow window and shows
            every tab at every width. */}
        <Tabs.List className="flex flex-wrap gap-1 rounded-xl border border-hairline/70 bg-surface p-1.5">
          {TAB_LIST.map((tab) => {
            const Icon = tab.icon;
            return (
              <Tabs.Trigger
                key={tab.value}
                value={tab.value}
                className="flex min-h-11 shrink-0 items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-semibold text-ink-soft transition-colors hover:text-plum data-[state=active]:bg-brand-gradient data-[state=active]:text-white"
              >
                <Icon className="size-4" />
                {tab.label}
              </Tabs.Trigger>
            );
          })}
        </Tabs.List>

        <div className="mt-5">
          <Tabs.Content value="channels">
            <ChannelsTab
              communityId={communityId}
              community={community}
              channels={community?.channels ?? null}
              onChange={load}
            />
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
          <Tabs.Content value="groups">
            <AccessGroupsTab communityId={communityId} />
          </Tabs.Content>
          <Tabs.Content value="points">
            <PointRulesTab communityId={communityId} />
          </Tabs.Content>
          <Tabs.Content value="review">
            <ReviewFeedTab communityId={communityId} />
          </Tabs.Content>
          <Tabs.Content value="scheduled">
            <ScheduledPostsTab communityId={communityId} />
          </Tabs.Content>
          <Tabs.Content value="guidelines">
            <GuidelinesTab communityId={communityId} community={community} />
          </Tabs.Content>
        </div>
      </Tabs.Root>
    </div>
  );
}

/* ---------------------------------------------------------------- Channels */

/**
 * The live room, from the admin's side.
 *
 * Members see this at the top of their channel list under whatever it is
 * called — "JOIN OFFICE HOURS" on the live site — and the admin console had no
 * screen for it at all. The result read as a missing channel: a member listed
 * three things, the admin listed two, and the third was a room its owner could
 * not see, name, close or check the attendance of. It is not a channel, so it
 * is not in the channel table; it belongs here, in the same list and the same
 * position the member sees it in, so the two views agree.
 */
const LIVE_ROOM_ACCESS = [
  { value: "always", label: "Always open", help: "Members can gather in there whenever they like." },
  {
    value: "hosted",
    label: "Only when you're in",
    help: "Shut until you or a moderator joins — nobody sits in an empty room all week.",
  },
] as const;

function LiveRoomPanel({
  communityId,
  community,
  onChange,
}: {
  communityId: number;
  community: CommunityDetailType;
  onChange: () => void;
}) {
  const [form, setForm] = useState({
    liveRoomEnabled: community.liveRoomEnabled === true,
    liveRoomAccess: community.liveRoomAccess ?? "always",
    liveRoomAlias: community.liveRoomAlias ?? "",
    liveRoomCapacity: community.liveRoomCapacity ?? 8,
  });
  const [saving, setSaving] = useState(false);
  const [visits, setVisits] = useState<AdminLiveVisit[] | null>(null);

  useEffect(() => {
    adminApi.communityLiveVisits(communityId).then(setVisits).catch(() => setVisits([]));
  }, [communityId]);

  const label = form.liveRoomAlias.trim() || "Live room";

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await adminApi.communityUpdate(communityId, form);
      toast.success("Live room saved");
      onChange();
    } catch (err) {
      toast.error(friendlyError(err, "community"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title={label}
        subtitle={
          form.liveRoomEnabled
            ? "Members reach this from the top of their channel list."
            : "Switched off — nobody sees it."
        }
        icon={<Video className="size-4" />}
        action={
          <Button asChild variant="secondary" size="sm">
            <Link to={`/community/${community.slug}/live`} target="_blank" rel="noreferrer">
              Open the room
            </Link>
          </Button>
        }
      />

      <form onSubmit={save} className="space-y-4 px-5 py-5">
        <Field label="Is it open?">
          <div className="flex gap-2">
            {[
              { value: true, label: "On" },
              { value: false, label: "Off" },
            ].map((option) => (
              <button
                key={String(option.value)}
                type="button"
                onClick={() => setForm((f) => ({ ...f, liveRoomEnabled: option.value }))}
                className={cn(
                  "min-h-11 flex-1 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors",
                  form.liveRoomEnabled === option.value
                    ? "bg-brand-gradient text-white"
                    : "border border-hairline text-ink-soft hover:border-plum/40",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </Field>

        <Field
          label="What do you call it?"
          hint="members see your words, not ours"
          htmlFor="live-alias"
        >
          <Input
            id="live-alias"
            value={form.liveRoomAlias}
            maxLength={60}
            onChange={(e) => setForm((f) => ({ ...f, liveRoomAlias: e.target.value }))}
            placeholder="Office Hours"
          />
        </Field>

        <Field label="When can they get in?">
          <div className="grid gap-2 sm:grid-cols-2">
            {LIVE_ROOM_ACCESS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setForm((f) => ({ ...f, liveRoomAccess: option.value }))}
                className={cn(
                  "rounded-xl px-3.5 py-3 text-left text-sm transition-colors",
                  form.liveRoomAccess === option.value
                    ? "bg-brand-gradient text-white"
                    : "border border-hairline text-ink-soft hover:border-plum/40",
                )}
              >
                <span className="block font-semibold">{option.label}</span>
                <span className="mt-0.5 block text-xs opacity-80">{option.help}</span>
              </button>
            ))}
          </div>
        </Field>

        <Field
          label="How many people at once?"
          hint="between 2 and 16 — every camera is sent to every other person, so a big room is a slow one"
          htmlFor="live-capacity"
        >
          <Input
            id="live-capacity"
            type="number"
            min={2}
            max={16}
            className="w-28"
            value={form.liveRoomCapacity}
            onChange={(e) => setForm((f) => ({ ...f, liveRoomCapacity: Number(e.target.value) }))}
          />
        </Field>

        <Button type="submit" size="sm" disabled={saving}>
          {saving ? "Saving…" : "Save live room"}
        </Button>
      </form>

      <div className="border-t border-hairline/60 px-5 py-5">
        <p className="text-[0.8rem] font-semibold text-ink">Who's been in</p>
        {visits === null ? (
          <Skeleton className="mt-3 h-16 w-full" />
        ) : visits.length === 0 ? (
          <p className="mt-2 text-xs text-ink-soft">
            Nobody yet. "Did anyone come to office hours on Tuesday" is answered
            here once they have.
          </p>
        ) : (
          <ul className="mt-3 space-y-1.5">
            {visits.slice(0, 20).map((visit) => (
              <li key={String(visit.id)} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="min-w-0 flex-1 truncate text-ink">
                  {visit.memberName || visit.email}
                </span>
                <span className="text-xs text-ink-soft">{formatRelative(visit.joinedAt)}</span>
                {visit.seconds === null ? (
                  <Badge tone="green">In there now</Badge>
                ) : (
                  <Badge tone="neutral">{Math.max(1, Math.round(visit.seconds / 60))} min</Badge>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

/**
 * The fields a channel has.
 *
 * One shape, one set of controls, used by the create dialog and by the settings
 * screen — because the two have to offer the same choices. They did not: the
 * dialog grew the tier, the cover and the view modes, and there was no settings
 * screen at all, so a channel created with the wrong visibility (or pointed at
 * no tier when it should have been) could never be put right. A create form
 * without an edit form is a one-way door.
 */
interface ChannelForm {
  name: string;
  description: string;
  format: string;
  visibility: string;
  coverImage: string;
  /** "" is the empty <select> option, meaning the whole community. */
  accessGroupId: string;
  viewModes: string[];
  defaultViewMode: string;
}

const BLANK_CHANNEL: ChannelForm = {
  name: "",
  description: "",
  format: "feed",
  visibility: "public",
  coverImage: "",
  accessGroupId: "",
  viewModes: ["feed"],
  defaultViewMode: "feed",
};

function channelToForm(channel: CommunityChannel): ChannelForm {
  return {
    name: channel.name,
    description: channel.description ?? "",
    format: channel.format,
    visibility: channel.visibility,
    coverImage: channel.coverImage ?? "",
    accessGroupId: channel.accessGroupId == null ? "" : String(channel.accessGroupId),
    viewModes: channel.viewModes?.length ? channel.viewModes : ["feed"],
    defaultViewMode:
      channel.viewMode || channel.defaultViewMode || channel.viewModes?.[0] || "feed",
  };
}

/** What the endpoint wants, from what she picked. */
function channelToPayload(form: ChannelForm): Record<string, unknown> {
  return {
    ...form,
    accessGroupId: form.accessGroupId === "" ? null : Number(form.accessGroupId),
    // The layout the member side renders (`view_mode`): the one it opens in.
    viewMode: form.defaultViewMode,
  };
}

function ChannelFields({
  form,
  onChange,
  groups,
  idPrefix,
}: {
  form: ChannelForm;
  onChange: (next: ChannelForm) => void;
  groups: AdminAccessGroup[];
  idPrefix: string;
}) {
  const set = (patch: Partial<ChannelForm>) => onChange({ ...form, ...patch });

  return (
    <div className="space-y-4">
      <Field label="What's it called?" htmlFor={`${idPrefix}-name`}>
        <Input
          id={`${idPrefix}-name`}
          value={form.name}
          onChange={(e) => set({ name: e.target.value })}
          placeholder="Wins & Wednesdays"
          required
        />
      </Field>
      <Field label="What's it for?" hint="shown under the channel name" htmlFor={`${idPrefix}-desc`}>
        <Input
          id={`${idPrefix}-desc`}
          value={form.description}
          onChange={(e) => set({ description: e.target.value })}
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
                onClick={() => set({ format: option.value })}
                className={cn(
                  "min-h-11 flex-1 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors",
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
                onClick={() => set({ visibility: option.value })}
                className={cn(
                  "min-h-11 flex-1 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors",
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

      {/* Said here rather than discovered later. "Invited members only" used to
          hide a channel from everybody — including its author — because there
          was nowhere to record an invitation; now there is, and the person
          choosing it needs to know that picking somebody is the next step. */}
      {form.visibility === "private" && (
        <p className="rounded-xl bg-lilac-tint/60 px-3.5 py-2.5 text-xs text-plum-deep">
          Nobody sees this channel until you invite them. You and anyone who
          helps run this community can always see it. Invite people from this
          channel's settings once it exists.
        </p>
      )}

      <Field
        label="Which members?"
        hint="leave open to the whole community unless you have a tier for it"
        htmlFor={`${idPrefix}-group`}
      >
        <select
          id={`${idPrefix}-group`}
          className={selectStyles}
          value={form.accessGroupId}
          onChange={(e) => set({ accessGroupId: e.target.value })}
        >
          <option value="">Everyone in this community</option>
          {groups.map((group) => (
            <option key={group.id} value={String(group.id)}>
              {group.name} only
            </option>
          ))}
        </select>
      </Field>

      <Field
        label="How can members read it?"
        hint="pick at least one — the default is what they see first"
      >
        <div className={chipRowStyles}>
          {CHANNEL_VIEW_MODES.map((mode) => {
            const on = form.viewModes.includes(mode.value);
            return (
              <Chip
                key={mode.value}
                selected={on}
                title={mode.help}
                onClick={() => {
                  // Never empty: turning the last one off would leave a channel
                  // with no way to read it, which the database refuses anyway.
                  const next = on
                    ? form.viewModes.filter((v) => v !== mode.value)
                    : [...form.viewModes, mode.value];
                  if (next.length === 0) return;
                  set({
                    viewModes: next,
                    // Keep the default inside the set she just chose.
                    defaultViewMode: next.includes(form.defaultViewMode)
                      ? form.defaultViewMode
                      : next[0],
                  });
                }}
              >
                {mode.label}
              </Chip>
            );
          })}
        </div>
        {form.viewModes.length > 1 && (
          <select
            className={cn(selectStyles, "mt-3")}
            aria-label="Which one members see first"
            value={form.defaultViewMode}
            onChange={(e) => set({ defaultViewMode: e.target.value })}
          >
            {form.viewModes.map((mode) => (
              <option key={mode} value={mode}>
                Opens as {CHANNEL_VIEW_MODES.find((m) => m.value === mode)?.label ?? mode}
              </option>
            ))}
          </select>
        )}
      </Field>

      <Field
        label="Cover image"
        hint="optional — a link to a picture, 1280x720 looks best"
        htmlFor={`${idPrefix}-cover`}
      >
        <Input
          id={`${idPrefix}-cover`}
          value={form.coverImage}
          onChange={(e) => set({ coverImage: e.target.value })}
          placeholder="https://…/cover.jpg"
        />
      </Field>
    </div>
  );
}

/**
 * Who is allowed into one invite-only channel.
 *
 * Only people already in the community can be picked, and the endpoint enforces
 * that too: a channel invitation to somebody who cannot open the community is a
 * row that grants nothing.
 */
function ChannelInvites({
  channel,
  members,
}: {
  channel: CommunityChannel;
  members: CommunityMembership[];
}) {
  const [invites, setInvites] = useState<AdminChannelInvite[] | null>(null);
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    adminApi
      .channelInvites(Number(channel.id))
      .then(setInvites)
      .catch(() => setInvites([]));
  }, [channel.id]);

  useEffect(load, [load]);

  const invited = new Set((invites ?? []).map((row) => String(row.memberId)));
  const addable = members.filter((m) => !invited.has(String(m.memberId)));

  return (
    <div className="space-y-3 rounded-xl border border-hairline/70 p-4">
      <p className="text-[0.8rem] font-semibold text-ink">Who's invited</p>
      {invites === null ? (
        <Skeleton className="h-10 w-full" />
      ) : invites.length === 0 ? (
        <p className="text-xs text-ink-soft">
          Nobody yet — only you and the people who help run this community can
          see it.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {invites.map((row) => (
            <li key={String(row.memberId)} className="flex items-center gap-2 text-sm">
              <span className="min-w-0 flex-1 truncate text-ink">{row.name || row.email}</span>
              <Button
                variant="dangerGhost"
                size="iconSm"
                aria-label={`Remove ${row.name || row.email} from this channel`}
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await adminApi.channelInviteRemove(Number(channel.id), Number(row.memberId));
                    load();
                  } catch (err) {
                    toast.error(friendlyError(err, "invite"));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <X />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <Field label="Invite someone" className="min-w-[12rem] flex-1">
          <select
            className={selectStyles}
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
          >
            <option value="">Choose someone…</option>
            {addable.map((m) => (
              <option key={String(m.memberId)} value={String(m.memberId)}>
                {m.name ? `${m.name} — ${m.email}` : m.email}
              </option>
            ))}
          </select>
        </Field>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={!selected || busy}
          onClick={async () => {
            setBusy(true);
            try {
              await adminApi.channelInviteAdd(Number(channel.id), Number(selected));
              setSelected("");
              load();
              toast.success("They can see this channel now.");
            } catch (err) {
              toast.error(friendlyError(err, "invite"));
            } finally {
              setBusy(false);
            }
          }}
        >
          <UserPlus />
          Invite
        </Button>
      </div>
    </div>
  );
}

function ChannelsTab({
  communityId,
  community,
  channels,
  onChange,
}: {
  communityId: number;
  community: CommunityDetailType | null;
  channels: CommunityChannel[] | null;
  onChange: () => void;
}) {
  const [active, setActive] = useState<CommunityChannel | null>(null);
  /**
   * Whether the right pane is showing the live room instead of a channel.
   *
   * The room is not a channel, but a member meets it in the same list, so this
   * is the same picker rather than a tab somewhere else — which is how it came
   * to be invisible from here in the first place.
   */
  const [showLive, setShowLive] = useState(false);
  const [posts, setPosts] = useState<CommunityPost[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [createForm, setCreateForm] = useState<ChannelForm>(BLANK_CHANNEL);
  /** The channel whose settings are open, and the edits made to it so far. */
  const [editing, setEditing] = useState<CommunityChannel | null>(null);
  const [editForm, setEditForm] = useState<ChannelForm>(BLANK_CHANNEL);
  const [savingChannel, setSavingChannel] = useState(false);
  /** Whether the list is showing move up/down controls instead of settings. */
  const [reordering, setReordering] = useState(false);
  const [moving, setMoving] = useState(false);
  /** Offered in the tier picker. Empty is fine — it just means no tiers yet. */
  const [groups, setGroups] = useState<AdminAccessGroup[]>([]);
  /** Who can be invited to an invite-only channel: this community's members. */
  const [members, setMembers] = useState<CommunityMembership[]>([]);

  useEffect(() => {
    adminApi.accessGroups(communityId).then(setGroups).catch(() => setGroups([]));
    adminApi.communityMembers(communityId).then(setMembers).catch(() => setMembers([]));
  }, [communityId]);

  const [composer, setComposer] = useState({ body: "", mediaUrl: "", mediaLabel: "" });
  const [attaching, setAttaching] = useState(false);
  /** "" is "post it now"; anything else is the local time she picked. */
  const [publishAt, setPublishAt] = useState("");
  const [posting, setPosting] = useState(false);
  const [confirm, confirmDialog] = useConfirm();

  // Select the first channel once they load, and follow the same channel across
  // a reload so saving its settings does not bounce the reader to the top.
  useEffect(() => {
    if (!channels?.length) return;
    setActive((current) => {
      if (!current) return channels[0];
      return channels.find((ch) => ch.id === current.id) ?? channels[0];
    });
  }, [channels]);

  const loadPosts = useCallback((channelId: number) => {
    setPosts(null);
    adminApi
      .channelPosts(channelId)
      .then(setPosts)
      .catch(() => toast.error("We couldn't load what's in this channel. Try again in a moment."));
  }, []);

  useEffect(() => {
    if (active) loadPosts(Number(active.id));
  }, [active, loadPosts]);

  async function createChannel(e: FormEvent) {
    e.preventDefault();
    if (!createForm.name.trim()) return;
    try {
      await adminApi.channelCreate(communityId, channelToPayload(createForm));
      toast.success(
        createForm.visibility === "private"
          ? "Channel created — invite people to it from its settings."
          : "Channel created",
      );
      setCreating(false);
      setCreateForm(BLANK_CHANNEL);
      onChange();
    } catch (err) {
      toast.error(friendlyError(err, "channel"));
    }
  }

  async function saveChannel(e: FormEvent) {
    e.preventDefault();
    if (!editing || !editForm.name.trim()) return;
    setSavingChannel(true);
    try {
      await adminApi.channelUpdate(Number(editing.id), channelToPayload(editForm));
      toast.success("Channel saved");
      setEditing(null);
      onChange();
    } catch (err) {
      toast.error(friendlyError(err, "channel"));
    } finally {
      setSavingChannel(false);
    }
  }

  async function removeChannel(channel: CommunityChannel) {
    const ok = await confirm({
      title: `Delete “${channel.name}”?`,
      description:
        "Every post, comment and reaction in it goes too, and you can't get them back.",
      confirmLabel: "Delete channel",
      destructive: true,
    });
    if (!ok) return;
    try {
      await adminApi.channelDelete(Number(channel.id));
      setEditing(null);
      if (active?.id === channel.id) setActive(null);
      toast.success("Channel deleted");
      onChange();
    } catch (err) {
      toast.error(friendlyError(err, "channel"));
    }
  }

  /**
   * Swap one channel with its neighbour and save the whole order.
   *
   * The server takes every channel at once, so a save can never leave two
   * channels sharing a position; the list is then re-read rather than trusted
   * from here, so what she sees is what members get.
   */
  async function moveChannel(index: number, direction: -1 | 1) {
    if (!channels) return;
    const target = index + direction;
    if (target < 0 || target >= channels.length) return;
    const ids = channels.map((ch) => Number(ch.id));
    [ids[index], ids[target]] = [ids[target], ids[index]];
    setMoving(true);
    try {
      await adminApi.channelReorder(communityId, ids);
      onChange();
    } catch (err) {
      toast.error(friendlyError(err, "channel order"));
      onChange();
    } finally {
      setMoving(false);
    }
  }

  async function post(e: FormEvent) {
    e.preventDefault();
    if (!active || !composer.body.trim()) return;
    // A time she picked in her own timezone → the instant the server stores.
    const when = publishAt ? fromDateTimeInput(publishAt) : "";
    if (publishAt && !when) {
      toast.error("We couldn't read that time. Pick it again?");
      return;
    }
    setPosting(true);
    try {
      const created = await adminApi.postCreate(Number(active.id), {
        body: composer.body,
        authorName: "Host",
        mediaUrl: composer.mediaUrl,
        mediaLabel: composer.mediaLabel,
        publishAt: when || undefined,
      });
      setComposer({ body: "", mediaUrl: "", mediaLabel: "" });
      setAttaching(false);
      if (when) {
        setPublishAt("");
        // Re-read rather than splice it in at the top: a scheduled post is not
        // yet in the channel, and the list marks it "waiting to go out" in the
        // place it will actually appear.
        loadPosts(Number(active.id));
        toast.success(`Scheduled for ${formatDateTime(when)} — it's on the Scheduled tab.`);
      } else {
        setPosts((prev) => (prev ? [created, ...prev] : [created]));
        toast.success("Posted — your members can see it now");
      }
    } catch (err) {
      toast.error(friendlyError(err, "post"));
    } finally {
      setPosting(false);
    }
  }

  async function togglePin(p: CommunityPost) {
    try {
      const updated = await adminApi.postUpdate(Number(p.id), { pinned: !p.pinned });
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
      await adminApi.postDelete(Number(p.id));
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
          /* Every channel in the community, whatever its visibility and whoever
             is in it. This list is not a member's view of the room: a channel
             its owner cannot see is a channel its owner cannot fix. */
          subtitle={channels ? `${pluralize(channels.length, "channel", "channels")} in here` : undefined}
          action={
            <div className="flex gap-1">
              {channels && channels.length > 1 && (
                <Button
                  variant={reordering ? "primary" : "ghost"}
                  size="sm"
                  aria-pressed={reordering}
                  onClick={() => setReordering((v) => !v)}
                >
                  <ArrowUpDown />
                  {reordering ? "Done" : "Reorder"}
                </Button>
              )}
              <Button variant="secondary" size="sm" onClick={() => setCreating(true)}>
                <Plus />
                New
              </Button>
            </div>
          }
        />
        <div className="p-2">
          {/* First in the list, because that is where the member meets it. */}
          {community && (
            <button
              type="button"
              onClick={() => setShowLive(true)}
              className={cn(
                "mb-1 flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm transition-colors",
                showLive
                  ? "bg-lilac-tint font-semibold text-plum-deep"
                  : "text-ink-soft hover:bg-cream",
              )}
            >
              <Video className="size-4 shrink-0 opacity-60" />
              <span className="min-w-0 flex-1 truncate">
                {community.liveRoomAlias?.trim() || "Live room"}
              </span>
              {!community.liveRoomEnabled && (
                <span className="text-[0.6rem] font-bold uppercase text-ink-soft/60">Off</span>
              )}
            </button>
          )}
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
              {channels.map((channel, index) => (
                <li key={channel.id} className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      setActive(channel);
                      setShowLive(false);
                    }}
                    className={cn(
                      "flex min-w-0 flex-1 items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm transition-colors",
                      active?.id === channel.id
                        ? "bg-lilac-tint font-semibold text-plum-deep"
                        : "text-ink-soft hover:bg-cream",
                    )}
                  >
                    <Hash className="size-4 shrink-0 opacity-60" />
                    <span className="min-w-0 flex-1 truncate">{channel.name}</span>
                    {channel.visibility === "private" && (
                      <Lock
                        aria-label="Invited members only"
                        className="size-3.5 shrink-0 text-ink-soft/60"
                      />
                    )}
                    {channel.accessGroupName && (
                      <Layers
                        aria-label={`${channel.accessGroupName} only`}
                        className="size-3.5 shrink-0 text-ink-soft/60"
                      />
                    )}
                  </button>
                  {reordering ? (
                    <>
                      <Button
                        variant="ghost"
                        size="iconSm"
                        aria-label={`Move ${channel.name} up`}
                        disabled={moving || index === 0}
                        onClick={() => moveChannel(index, -1)}
                      >
                        <ChevronUp />
                      </Button>
                      <Button
                        variant="ghost"
                        size="iconSm"
                        aria-label={`Move ${channel.name} down`}
                        disabled={moving || index === channels.length - 1}
                        onClick={() => moveChannel(index, 1)}
                      >
                        <ChevronDown />
                      </Button>
                    </>
                  ) : (
                    <Button
                      variant="ghost"
                      size="iconSm"
                      aria-label={`Settings for ${channel.name}`}
                      onClick={() => {
                        setEditing(channel);
                        setEditForm(channelToForm(channel));
                      }}
                    >
                      <Settings />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      {showLive && community ? (
        <LiveRoomPanel communityId={communityId} community={community} onChange={onChange} />
      ) : (
        <Card>
          {/* The channel's own name, never its web address — she named it
              "Wins & Wednesdays", not "wins-wednesdays". */}
          <CardHeader
            title={active ? active.name : "No channel picked yet"}
            subtitle={
              active ? active.description || channelFormatLabel(active.format) : undefined
            }
            action={
              active && (
                <div className="flex flex-wrap items-center gap-2">
                  {active.visibility === "private" && (
                    <Badge tone="slate">
                      <Lock className="size-3" />
                      {active.invitedCount
                        ? `Invited: ${pluralize(active.invitedCount, "person", "people")}`
                        : "Invite only — nobody yet"}
                    </Badge>
                  )}
                  {active.accessGroupName && <Badge tone="plum">{active.accessGroupName} only</Badge>}
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setEditing(active);
                      setEditForm(channelToForm(active));
                    }}
                  >
                    <Settings />
                    Settings
                  </Button>
                </div>
              )
            }
          />

          {active && (
            <form onSubmit={post} className="border-b border-hairline/60 p-4">
              <Textarea
                rows={3}
                value={composer.body}
                onChange={(e) => setComposer((c) => ({ ...c, body: e.target.value }))}
                placeholder={`Share something with ${active.name}…`}
                aria-label="Write a post"
              />

              {attaching && (
                <div className="mt-2.5 grid gap-2.5 sm:grid-cols-2">
                  <Field label="Link to a picture, video or file" htmlFor="post-media">
                    <Input
                      id="post-media"
                      value={composer.mediaUrl}
                      onChange={(e) => setComposer((c) => ({ ...c, mediaUrl: e.target.value }))}
                      placeholder="https://…/worksheet.pdf"
                    />
                  </Field>
                  <Field
                    label="What to call it"
                    hint="optional"
                    htmlFor="post-media-label"
                  >
                    <Input
                      id="post-media-label"
                      value={composer.mediaLabel}
                      onChange={(e) => setComposer((c) => ({ ...c, mediaLabel: e.target.value }))}
                      placeholder="This week's worksheet"
                    />
                  </Field>
                </div>
              )}

              {publishAt !== "" && (
                <div className="mt-2.5">
                  <Field
                    label="Goes out at"
                    hint="your timezone — nobody sees it until then"
                    htmlFor="post-when"
                  >
                    <Input
                      id="post-when"
                      type="datetime-local"
                      value={publishAt}
                      onChange={(e) => setPublishAt(e.target.value)}
                    />
                  </Field>
                </div>
              )}

              <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-pressed={attaching}
                    onClick={() => setAttaching((v) => !v)}
                  >
                    <Paperclip />
                    {attaching ? "No attachment" : "Attach something"}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-pressed={publishAt !== ""}
                    onClick={() =>
                      // Defaults to an hour from now rather than to an empty box:
                      // "in a bit" is what "post at a time" almost always means,
                      // and a past time is refused by the endpoint anyway.
                      setPublishAt((current) => (current === "" ? defaultScheduleTime() : ""))
                    }
                  >
                    <Clock />
                    {publishAt === "" ? "Post at a time" : "Post it now instead"}
                  </Button>
                </div>
                <Button type="submit" size="sm" disabled={!composer.body.trim() || posting}>
                  {publishAt === "" ? <Send /> : <CalendarClock />}
                  {posting ? "Saving…" : publishAt === "" ? "Post" : "Schedule it"}
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
                        {p.status === "scheduled" && (
                          <Badge tone="blue">
                            <Clock className="size-3" />
                            Waiting to go out
                          </Badge>
                        )}
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
      )}

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
        <form id="new-channel" onSubmit={createChannel}>
          <ChannelFields
            form={createForm}
            onChange={setCreateForm}
            groups={groups}
            idPrefix="new-channel"
          />
        </form>
      </Modal>

      <Modal
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        title={editing ? `${editing.name} settings` : "Channel settings"}
        description="Rename it, change who can see it, or take it down."
        footer={
          <>
            <Button
              variant="dangerGhost"
              size="sm"
              onClick={() => editing && removeChannel(editing)}
            >
              <Trash2 />
              Delete channel
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button size="sm" type="submit" form="edit-channel" disabled={savingChannel}>
              {savingChannel ? "Saving…" : "Save channel"}
            </Button>
          </>
        }
      >
        <form id="edit-channel" onSubmit={saveChannel} className="space-y-4">
          <ChannelFields
            form={editForm}
            onChange={setEditForm}
            groups={groups}
            idPrefix="edit-channel"
          />
          {editing && editForm.visibility === "private" && (
            <ChannelInvites channel={editing} members={members} />
          )}
          <p className="text-xs text-ink-soft">
            The channel's web address stays as it is when you rename it, so links
            your members already have keep working.
          </p>
        </form>
      </Modal>

      {confirmDialog}
    </div>
  );
}

/**
 * An hour from now, as a `datetime-local` value in her own timezone.
 *
 * "In a bit" is what "post at a time" almost always means, and an empty box is
 * a worse starting point than a wrong-but-obvious one. `toDateTimeInput` owns
 * the timezone arithmetic — doing it again here is how a scheduled post ends up
 * going out on the wrong day.
 */
function defaultScheduleTime(): string {
  return toDateTimeInput(new Date(Date.now() + 60 * 60 * 1000).toISOString());
}

/** Kajabi's three, with its own words for what each is good for. */
const CHANNEL_VIEW_MODES = [
  { value: "feed", label: "Feed", help: "Cards to scroll through — text and pictures." },
  { value: "forum", label: "Forum", help: "A compact table for scanning topics and replies." },
  { value: "gallery", label: "Gallery", help: "A grid, for channels that are mostly images." },
] as const;

/* ----------------------------------------------------------------- Members */

/**
 * The three boards, in her words.
 *
 * The same set the member sidebar offers (2.7). "All time" alone cannot answer
 * "who turned up this week", which is the question that decides who gets a
 * shout-out — and it was the only board either surface had.
 */
const LEADERBOARD_PERIODS = [
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
  { value: "all", label: "All time" },
] as const;

type LeaderboardPeriod = (typeof LEADERBOARD_PERIODS)[number]["value"];

/**
 * Somebody's standing in this community, in one line.
 *
 * A membership row is kept when a member is banned or their account closes —
 * points and history are a record of what they did — so the list has to say
 * which of the people on it are actually in the room. The headline count is the
 * ones who are, which is the same number the members themselves are shown.
 */
function membershipIsPresent(m: CommunityMembership): boolean {
  return !m.bannedAt && (m.status === "active" || m.status === undefined);
}

function MembersTab({ communityId }: { communityId: number }) {
  const [memberships, setMemberships] = useState<CommunityMembership[] | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[] | null>(null);
  const [period, setPeriod] = useState<LeaderboardPeriod>("all");
  const [allMembers, setAllMembers] = useState<Member[]>([]);
  const [groups, setGroups] = useState<AdminAccessGroup[]>([]);
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState("");
  /** The person whose tiers are being changed. */
  const [tiersFor, setTiersFor] = useState<CommunityMembership | null>(null);

  const load = useCallback(() => {
    adminApi.communityMembers(communityId).then(setMemberships).catch(() => undefined);
    adminApi.accessGroups(communityId).then(setGroups).catch(() => setGroups([]));
  }, [communityId]);

  useEffect(load, [load]);
  useEffect(() => {
    setLeaderboard(null);
    adminApi.leaderboard(communityId, period).then(setLeaderboard).catch(() => setLeaderboard([]));
  }, [communityId, period]);
  useEffect(() => {
    adminApi.membersList().then(setAllMembers).catch(() => undefined);
  }, []);

  const [confirm, confirmDialog] = useConfirm();

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
    const ok = await confirm({
      title: `Remove ${membership.name || membership.email}?`,
      description: "They lose access to this community, and their points go with them.",
      confirmLabel: "Yes, remove them",
      destructive: true,
    });
    if (!ok) return;
    try {
      await adminApi.membershipDelete(Number(membership.id));
      setMemberships((prev) => prev?.filter((m) => m.id !== membership.id) ?? prev);
      toast.success("Removed from this community");
    } catch (err) {
      toast.error(friendlyError(err, "member"));
    }
  }

  const present = memberships?.filter(membershipIsPresent).length ?? 0;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <Card>
        <CardHeader
          title="Members"
          subtitle={
            memberships
              ? `${pluralize(present, "person", "people")} in this community`
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
                {/* Why they are not one of the people counted above. */}
                {m.bannedAt && <Badge tone="red">Banned from here</Badge>}
                {!m.bannedAt && m.status && m.status !== "active" && (
                  <Badge tone="slate">Account {m.status}</Badge>
                )}
                {(m.groups ?? []).map((group) => (
                  <Badge key={String(group.id)} tone="plum">
                    {group.name}
                  </Badge>
                ))}
                <Badge tone={m.role === "member" ? "neutral" : "plum"}>
                  {ROLE_LABEL[m.role] ?? "Member"}
                </Badge>
                <Badge tone="gold">{formatNumber(m.points)} points</Badge>
                {groups.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Change which tiers ${m.name || m.email} is in`}
                    onClick={() => setTiersFor(m)}
                  >
                    <Layers />
                    Tiers
                  </Button>
                )}
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
        <div className="px-5 pt-4">
          <div className={chipRowStyles}>
            {LEADERBOARD_PERIODS.map((option) => (
              <Chip
                key={option.value}
                selected={period === option.value}
                onClick={() => setPeriod(option.value)}
              >
                {option.label}
              </Chip>
            ))}
          </div>
        </div>
        {leaderboard === null ? (
          <div className="space-y-2 p-5">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : leaderboard.length === 0 ? (
          <EmptyState
            icon={<Trophy />}
            title={period === "all" ? "No points yet" : "Nothing earned yet"}
            description={
              period === "all"
                ? "Points add up as members post and finish your challenges."
                : "Nobody has earned points in this window. Try all time."
            }
          />
        ) : (
          <ol className="divide-y divide-hairline/60">
            {leaderboard.map((entry, i) => {
              // The server's rank, which shares a number on a tie. Falling back
              // to the row position would print 1, 2 for two people on equal
              // points and invent a winner.
              const rank = entry.rank ?? i + 1;
              return (
                <li key={entry.email || String(entry.memberId)} className="flex items-center gap-3 px-5 py-3">
                  <span
                    className={cn(
                      "grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold",
                      rank === 1
                        ? "bg-gold text-ink"
                        : rank <= 3
                          ? "bg-lilac-tint text-plum-deep"
                          : "bg-cream text-ink-soft",
                    )}
                    title={entry.tied ? `Joint ${rank}` : undefined}
                  >
                    {entry.tied ? `=${rank}` : rank}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm text-ink">
                    {entry.badge && <span className="mr-1">{entry.badge}</span>}
                    {entry.name || entry.email}
                  </span>
                  <span className="shrink-0 text-sm font-bold tabular-nums text-plum">
                    {entry.points}
                  </span>
                </li>
              );
            })}
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
              className={selectStyles}
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

      <MemberTiersModal
        communityId={communityId}
        membership={tiersFor}
        groups={groups}
        onClose={() => setTiersFor(null)}
        onSaved={load}
      />

      {confirmDialog}
    </div>
  );
}

/**
 * Which tiers one person is in, by hand.
 *
 * This is the half of access groups that had no controls anywhere: a group
 * could be created and named and then had nothing that could be put in it, so
 * every group read "0 MEMBERS · 0 CHANNELS" for ever.
 *
 * Only hand-picked membership is editable here. A tier somebody has because
 * they bought something is derived from the live purchase and is deliberately
 * not a row anybody can delete — taking it away by hand would leave them paying
 * for a tier they are no longer in.
 */
function MemberTiersModal({
  communityId,
  membership,
  groups,
  onClose,
  onSaved,
}: {
  communityId: number;
  membership: CommunityMembership | null;
  groups: AdminAccessGroup[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [busy, setBusy] = useState<number | null>(null);
  const inGroup = new Set((membership?.groups ?? []).map((g) => String(g.id)));

  return (
    <Modal
      open={membership !== null}
      onOpenChange={(open) => !open && onClose()}
      title={membership ? `Tiers for ${membership.name || membership.email}` : "Tiers"}
      description="Turning one on lets them into every channel limited to it."
      footer={
        <Button variant="secondary" size="sm" onClick={onClose}>
          Done
        </Button>
      }
    >
      {groups.length === 0 ? (
        <p className="text-sm text-ink-soft">
          No tiers in this community yet — make one on the Access groups tab.
        </p>
      ) : (
        <ul className="space-y-2">
          {groups.map((group) => {
            const on = inGroup.has(String(group.id));
            return (
              <li
                key={group.id}
                className="flex flex-wrap items-center gap-3 rounded-xl border border-hairline/70 px-3.5 py-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-ink">{group.name}</p>
                  {group.description && (
                    <p className="truncate text-xs text-ink-soft">{group.description}</p>
                  )}
                </div>
                <Button
                  size="sm"
                  variant={on ? "dangerGhost" : "secondary"}
                  disabled={busy === Number(group.id) || membership === null}
                  onClick={async () => {
                    if (!membership) return;
                    setBusy(Number(group.id));
                    try {
                      if (on) {
                        await adminApi.accessGroupRemoveMember(
                          communityId,
                          Number(group.id),
                          Number(membership.memberId),
                        );
                      } else {
                        await adminApi.accessGroupAddMember(
                          communityId,
                          Number(group.id),
                          Number(membership.memberId),
                        );
                      }
                      onSaved();
                      onClose();
                      toast.success(on ? "Taken out of the tier." : "Added to the tier.");
                    } catch (err) {
                      toast.error(friendlyError(err, "access group"));
                    } finally {
                      setBusy(null);
                    }
                  }}
                >
                  {on ? (
                    <>
                      <X />
                      Take out
                    </>
                  ) : (
                    <>
                      <Check />
                      Put in
                    </>
                  )}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
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
      await adminApi.challengeCreate(communityId, {
        ...form,
        // A day she picked is a day where she is, and "ends on the 28th" means
        // the end of the 28th. Sent raw, both dates became midnight UTC — the
        // card read a day early and members were locked out on the last day.
        startsAt: fromDateInput(form.startsAt),
        endsAt: fromDateInput(form.endsAt, "end"),
      });
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

  const [confirm, confirmDialog] = useConfirm();

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) return;
    try {
      await adminApi.eventCreate(communityId, {
        ...form,
        // The box speaks her wall clock; the column stores an instant. Sent raw
        // it was read as UTC, and the event she set for 7pm was advertised to
        // her members at 3pm.
        startsAt: fromDateTimeInput(form.startsAt),
      });
      toast.success("Event scheduled — your members can see it now");
      setCreating(false);
      setForm({ title: "", description: "", startsAt: "", durationMinutes: 60, locationUrl: "" });
      load();
    } catch (err) {
      toast.error(friendlyError(err, "event"));
    }
  }

  async function remove(id: number) {
    const ok = await confirm({
      title: "Delete this event?",
      description: "It disappears from your members' calendars straight away.",
      confirmLabel: "Yes, delete it",
      destructive: true,
    });
    if (!ok) return;
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

      {confirmDialog}
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

  const [confirm, confirmDialog] = useConfirm();

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
    const ok = await confirm({
      title: "Delete this badge?",
      description: "Members who have already earned it keep it; nobody new can earn it.",
      confirmLabel: "Yes, delete it",
      destructive: true,
    });
    if (!ok) return;
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

      {confirmDialog}
    </div>
  );
}

/* ------------------------------------------------------------ Access groups */

/**
 * The tier layer.
 *
 * A group used to be a name and nothing else: it could be created and deleted,
 * and there was no control anywhere that put a person or a channel into one, so
 * every group read "0 members · 0 channels" for ever and the tab's own promise
 * — "channels can be limited to one, and an offer can grant it" — was
 * unreachable. Both halves are here now: people go in from this panel or from
 * the Members tab, channels from a channel's settings, and what an offer grants
 * is read back below so it is visible whether one does.
 *
 * Deleting a group deliberately opens its channels to the whole community
 * rather than orphaning them — the database does that with ON DELETE SET NULL,
 * and it is the safe direction: nobody loses access they already had. The
 * dialog says so, because "delete" that quietly widens access is worse than one
 * that says it will.
 */
function AccessGroupsTab({ communityId }: { communityId: number }) {
  const [groups, setGroups] = useState<AdminAccessGroup[] | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [openGroup, setOpenGroup] = useState<number | null>(null);
  const [confirm, confirmDialog] = useConfirm();

  const load = useCallback(() => {
    adminApi
      .accessGroups(communityId)
      .then(setGroups)
      .catch(() => toast.error("We couldn't load your access groups."));
  }, [communityId]);

  useEffect(load, [load]);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      await adminApi.accessGroupCreate(communityId, { name, description });
      setName("");
      setDescription("");
      load();
      toast.success("Group added.");
    } catch (err) {
      toast.error(friendlyError(err, "access group"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          title="Access groups"
          subtitle="Tiers inside this community. Channels can be limited to one, and an offer can grant it."
        />
        <form onSubmit={create} className="flex flex-wrap items-end gap-3 px-5 py-5">
          <Field label="Group name" className="min-w-[12rem] flex-1">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Inner Circle"
              maxLength={120}
            />
          </Field>
          <Field label="What it is" className="min-w-[14rem] flex-[2]">
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="The paid tier"
              maxLength={600}
            />
          </Field>
          <Button type="submit" size="sm" disabled={saving || !name.trim()}>
            <Plus />
            {saving ? "Adding…" : "Add group"}
          </Button>
        </form>
      </Card>

      {groups === null ? (
        <Skeleton className="h-32 w-full" />
      ) : groups.length === 0 ? (
        <EmptyState
          icon={<Layers />}
          title="No groups yet"
          description="Without a group, every channel is open to everyone in the community — which is fine until you want a tier that isn't."
        />
      ) : (
        <div className="space-y-3">
          {groups.map((group) => {
            const open = openGroup === Number(group.id);
            return (
              <Card key={group.id}>
                <div className="flex flex-wrap items-center gap-4 px-5 py-4">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-ink">{group.name}</p>
                    {group.description && (
                      <p className="truncate text-sm text-ink-soft">{group.description}</p>
                    )}
                  </div>
                  <Badge tone="neutral">
                    {pluralize(group.memberCount, "member", "members")}
                  </Badge>
                  <Badge tone="neutral">
                    {pluralize(group.channelCount, "channel", "channels")}
                  </Badge>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setOpenGroup(open ? null : Number(group.id))}
                  >
                    <Settings />
                    {open ? "Close" : "Manage"}
                  </Button>
                  <Button
                    variant="dangerGhost"
                    size="sm"
                    onClick={async () => {
                      const ok = await confirm({
                        title: `Delete ${group.name}?`,
                        description:
                          group.channelCount > 0
                            ? `Its ${pluralize(group.channelCount, "channel", "channels")} will become open to everyone in the community. Nobody loses access.`
                            : "Members of this group keep their community access.",
                        confirmLabel: "Yes, delete it",
                        destructive: true,
                      });
                      if (!ok) return;
                      try {
                        await adminApi.accessGroupDelete(communityId, Number(group.id));
                        load();
                        toast.success("Group deleted.");
                      } catch (err) {
                        toast.error(friendlyError(err, "access group"));
                      }
                    }}
                  >
                    <Trash2 />
                    Delete
                  </Button>
                </div>
                {open && (
                  <AccessGroupPanel
                    communityId={communityId}
                    group={group}
                    onChanged={load}
                  />
                )}
              </Card>
            );
          })}
        </div>
      )}
      {confirmDialog}
    </div>
  );
}

/** One tier, opened up: its name, its people, and what sells it. */
function AccessGroupPanel({
  communityId,
  group,
  onChanged,
}: {
  communityId: number;
  group: AdminAccessGroup;
  onChanged: () => void;
}) {
  const [members, setMembers] = useState<AdminAccessGroupMember[] | null>(null);
  const [grants, setGrants] = useState<AdminAccessGroupGrants | null>(null);
  const [candidates, setCandidates] = useState<CommunityMembership[]>([]);
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState(group.name);
  const [description, setDescription] = useState(group.description);
  const [renaming, setRenaming] = useState(false);
  /** Offers that sell this community — the only ones that can grant its tiers. */
  const [offers, setOffers] = useState<AdminCommunityOffer[] | null>(null);
  const [offerPick, setOfferPick] = useState("");
  const [granting, setGranting] = useState(false);

  const load = useCallback(() => {
    adminApi
      .accessGroupMembers(communityId, Number(group.id))
      .then(setMembers)
      .catch(() => setMembers([]));
    adminApi
      .accessGroupGrants(communityId, Number(group.id))
      .then(setGrants)
      .catch(() => setGrants({ offers: [], products: [], plans: [] }));
    adminApi
      .communityOffers(communityId)
      .then(setOffers)
      .catch(() => setOffers([]));
  }, [communityId, group.id]);

  /** Point an offer at this tier, or (null) stop it granting one. */
  async function setOfferGrant(offerId: number, accessGroupId: number | null) {
    setGranting(true);
    try {
      await adminApi.offerAccessGroupSave(offerId, accessGroupId);
      setOfferPick("");
      load();
      onChanged();
      toast.success(
        accessGroupId === null
          ? "That offer no longer grants this tier."
          : "Buying that offer puts people in this tier now.",
      );
    } catch (err) {
      toast.error(friendlyError(err, "offer"));
    } finally {
      setGranting(false);
    }
  }

  useEffect(load, [load]);
  useEffect(() => {
    // Only people already in the community: a tier is a subset of the room,
    // not a way into it.
    adminApi.communityMembers(communityId).then(setCandidates).catch(() => setCandidates([]));
  }, [communityId]);

  const inGroup = new Set((members ?? []).map((row) => String(row.memberId)));
  const addable = candidates.filter((m) => !inGroup.has(String(m.memberId)));
  const soldBy =
    (grants?.offers.length ?? 0) + (grants?.products.length ?? 0) + (grants?.plans.length ?? 0);

  return (
    <div className="grid gap-5 border-t border-hairline/60 px-5 py-5 lg:grid-cols-2">
      <div className="space-y-3">
        <p className="text-[0.8rem] font-semibold text-ink">Who's in it</p>
        {members === null ? (
          <Skeleton className="h-16 w-full" />
        ) : members.length === 0 ? (
          <p className="text-xs text-ink-soft">
            Nobody by hand yet. Anyone who buys something that grants this tier
            is in it automatically, and drops out again if they're refunded.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {members.map((row) => (
              <li key={String(row.memberId)} className="flex items-center gap-2 text-sm">
                <span className="min-w-0 flex-1 truncate text-ink">{row.name || row.email}</span>
                {row.source === "purchase" && <Badge tone="neutral">Bought it</Badge>}
                <Button
                  variant="dangerGhost"
                  size="iconSm"
                  aria-label={`Take ${row.name || row.email} out of ${group.name}`}
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await adminApi.accessGroupRemoveMember(
                        communityId,
                        Number(group.id),
                        Number(row.memberId),
                      );
                      load();
                      onChanged();
                    } catch (err) {
                      toast.error(friendlyError(err, "access group"));
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <X />
                </Button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-wrap items-end gap-2">
          <Field label="Put someone in" className="min-w-[12rem] flex-1">
            <select
              className={selectStyles}
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
            >
              <option value="">Choose someone…</option>
              {addable.map((m) => (
                <option key={String(m.memberId)} value={String(m.memberId)}>
                  {m.name ? `${m.name} — ${m.email}` : m.email}
                </option>
              ))}
            </select>
          </Field>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={!selected || busy}
            onClick={async () => {
              setBusy(true);
              try {
                await adminApi.accessGroupAddMember(
                  communityId,
                  Number(group.id),
                  Number(selected),
                );
                setSelected("");
                load();
                onChanged();
                toast.success("They're in this tier now.");
              } catch (err) {
                toast.error(friendlyError(err, "access group"));
              } finally {
                setBusy(false);
              }
            }}
          >
            <UserPlus />
            Add
          </Button>
        </div>
      </div>

      <div className="space-y-4">
        <div className="space-y-2">
          <p className="text-[0.8rem] font-semibold text-ink">What grants it</p>
          {grants === null ? (
            <Skeleton className="h-12 w-full" />
          ) : soldBy === 0 ? (
            <p className="text-xs text-ink-soft">
              Nothing sells this tier yet. Pick it on an offer, a product or a
              plan and buying that puts people in here — and a refund takes them
              back out, because the tier is read from the purchase rather than
              copied out of it.
            </p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {grants.offers.map((offer) => (
                <li key={`offer-${offer.id}`} className="flex items-center gap-1">
                  <Badge tone="gold">Offer: {offer.title}</Badge>
                  <Button
                    variant="dangerGhost"
                    size="iconSm"
                    aria-label={`Stop ${offer.title} granting ${group.name}`}
                    disabled={granting}
                    onClick={() => setOfferGrant(Number(offer.id), null)}
                  >
                    <X />
                  </Button>
                </li>
              ))}
              {grants.products.map((product) => (
                <li key={`product-${product.id}`}>
                  <Badge tone="plum">Product: {product.title}</Badge>
                </li>
              ))}
              {grants.plans.map((plan) => (
                <li key={`plan-${plan.id}`}>
                  <Badge tone="blue">Plan: {plan.name}</Badge>
                </li>
              ))}
            </ul>
          )}

          {/* "An offer can grant it" — the half that had no control anywhere.
              Only offers that sell this community are offered, because the
              save refuses any other: a tier in a room the offer doesn't unlock
              is a tier the buyer could never use. */}
          {offers === null ? null : offers.length === 0 ? (
            <p className="text-xs text-ink-soft">
              No offer sells this community yet, so none can grant this tier. Add
              the community to an offer first, then come back here.
            </p>
          ) : (
            <div className="flex flex-wrap items-end gap-2">
              <Field label="Let an offer grant it" className="min-w-[12rem] flex-1">
                <select
                  className={selectStyles}
                  value={offerPick}
                  onChange={(e) => setOfferPick(e.target.value)}
                >
                  <option value="">Choose an offer…</option>
                  {offers
                    .filter((offer) => String(offer.accessGroupId) !== String(group.id))
                    .map((offer) => (
                      <option key={String(offer.id)} value={String(offer.id)}>
                        {offer.accessGroupName
                          ? `${offer.title} (grants ${offer.accessGroupName} now)`
                          : offer.title}
                      </option>
                    ))}
                </select>
              </Field>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={!offerPick || granting}
                onClick={() => setOfferGrant(Number(offerPick), Number(group.id))}
              >
                <Check />
                {granting ? "Saving…" : "Grant it"}
              </Button>
            </div>
          )}
        </div>

        <div className="space-y-2">
          <p className="text-[0.8rem] font-semibold text-ink">Rename it</p>
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Name" className="min-w-[10rem] flex-1">
              <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
            </Field>
            <Field label="What it is" className="min-w-[12rem] flex-[2]">
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={600}
              />
            </Field>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={renaming || !name.trim()}
              onClick={async () => {
                setRenaming(true);
                try {
                  await adminApi.accessGroupSave(communityId, Number(group.id), {
                    name,
                    description,
                  });
                  onChanged();
                  toast.success("Saved.");
                } catch (err) {
                  toast.error(friendlyError(err, "access group"));
                } finally {
                  setRenaming(false);
                }
              }}
            >
              {renaming ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- Point rules */

const PERIOD_LABELS: Record<string, string> = {
  day: "a day",
  week: "a week",
  month: "a month",
  all: "ever",
};

/**
 * Kajabi's rules table, editable.
 *
 * The MAXIMUM column is the one that matters and the one people skip: without a
 * cap, a point-per-post rule makes the leaderboard a measure of stamina, and
 * badges something you get by typing "thanks!" forty times in an evening.
 */
function PointRulesTab({ communityId }: { communityId: number }) {
  const [rules, setRules] = useState<AdminPointRule[] | null>(null);
  const [savingAction, setSavingAction] = useState<string | null>(null);

  const load = useCallback(() => {
    adminApi
      .pointRules(communityId)
      .then(setRules)
      .catch(() => toast.error("We couldn't load your points rules."));
  }, [communityId]);

  useEffect(load, [load]);

  const save = async (rule: AdminPointRule, patch: Partial<AdminPointRule>) => {
    const next = { ...rule, ...patch };
    setSavingAction(rule.action);
    try {
      const saved = await adminApi.pointRuleSave(communityId, rule.action, {
        points: next.points,
        maxPerPeriod: next.maxPerPeriod,
        period: next.period,
      });
      setRules((prev) =>
        prev ? prev.map((r) => (r.action === rule.action ? { ...r, ...saved } : r)) : prev,
      );
    } catch (err) {
      toast.error(friendlyError(err, "points rule"));
      load();
    } finally {
      setSavingAction(null);
    }
  };

  return (
    <Card>
      <CardHeader
        title="Points"
        subtitle="What earns points, and how often it can. Get points when you engage with your community."
      />
      <div className="overflow-x-auto px-5 py-5">
        {rules === null ? (
          <Skeleton className="h-48 w-full" />
        ) : (
          <table className="w-full min-w-[34rem] text-left text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-ink-soft">
                <th className="py-2 pr-4 font-semibold">Rule</th>
                <th className="py-2 pr-4 font-semibold">Points</th>
                <th className="py-2 font-semibold">Most times</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((rule) => (
                <tr key={rule.action} className="border-t border-hairline/70">
                  <td className="py-3 pr-4 font-medium text-ink">{rule.label}</td>
                  <td className="py-3 pr-4">
                    <Input
                      type="number"
                      min={0}
                      max={10000}
                      className="h-11 w-24"
                      aria-label={`Points for ${rule.label}`}
                      value={rule.points}
                      disabled={savingAction === rule.action}
                      onChange={(e) =>
                        setRules((prev) =>
                          prev
                            ? prev.map((r) =>
                                r.action === rule.action
                                  ? { ...r, points: Number(e.target.value) }
                                  : r,
                              )
                            : prev,
                        )
                      }
                      onBlur={() => save(rule, {})}
                    />
                  </td>
                  <td className="py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Input
                        type="number"
                        min={1}
                        max={1000}
                        className="h-11 w-24"
                        aria-label={`Cap for ${rule.label}`}
                        placeholder="No limit"
                        value={rule.maxPerPeriod ?? ""}
                        disabled={savingAction === rule.action}
                        onChange={(e) =>
                          setRules((prev) =>
                            prev
                              ? prev.map((r) =>
                                  r.action === rule.action
                                    ? {
                                        ...r,
                                        maxPerPeriod:
                                          e.target.value === "" ? null : Number(e.target.value),
                                      }
                                    : r,
                                )
                              : prev,
                          )
                        }
                        onBlur={() => save(rule, {})}
                      />
                      <select
                        className={cn(selectStyles, "w-auto")}
                        aria-label={`Period for ${rule.label}`}
                        value={rule.period}
                        disabled={savingAction === rule.action}
                        onChange={(e) =>
                          void save(rule, { period: e.target.value as AdminPointRule["period"] })
                        }
                      >
                        {Object.entries(PERIOD_LABELS).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="mt-4 text-xs text-ink-soft">
          Leave the limit blank for no cap. A cap is what stops the leaderboard
          measuring who posts most rather than who helps most.
        </p>
      </div>
    </Card>
  );
}

/* --------------------------------------------------------------- Review feed */

function ReviewFeedTab({ communityId }: { communityId: number }) {
  const [reports, setReports] = useState<AdminCommunityReport[] | null>(null);
  const [status, setStatus] = useState("open");
  const [confirm, confirmDialog] = useConfirm();

  const load = useCallback(() => {
    setReports(null);
    adminApi
      .communityReports(communityId, status)
      .then(setReports)
      .catch(() => toast.error("We couldn't load the review feed."));
  }, [communityId, status]);

  useEffect(load, [load]);

  const resolve = async (report: AdminCommunityReport, action: "hide" | "dismiss") => {
    if (action === "hide") {
      const ok = await confirm({
        title: "Hide this from the community?",
        description: "Members won't see it any more. Every open report about it is closed too.",
        confirmLabel: "Yes, hide it",
        destructive: true,
      });
      if (!ok) return;
    }
    try {
      await adminApi.communityReportResolve(communityId, Number(report.id), action);
      load();
      toast.success(action === "hide" ? "Hidden." : "Report dismissed.");
    } catch (err) {
      toast.error(friendlyError(err, "report"));
    }
  };

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          title="Review feed"
          subtitle="What members have reported. Nothing here is hidden until you say so."
          action={
            <select
              className={cn(selectStyles, "w-auto")}
              aria-label="Which reports to show"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="open">Waiting on you</option>
              <option value="actioned">Hidden</option>
              <option value="dismissed">Dismissed</option>
              <option value="all">Everything</option>
            </select>
          }
        />
      </Card>

      {reports === null ? (
        <Skeleton className="h-32 w-full" />
      ) : reports.length === 0 ? (
        <EmptyState
          icon={<ShieldAlert />}
          title={status === "open" ? "Nothing to review" : "Nothing here"}
          description={
            status === "open"
              ? "When somebody reports a post or a comment, it will wait for you here."
              : "Try a different filter."
          }
        />
      ) : (
        <div className="space-y-3">
          {reports.map((report) => (
            <Card key={report.id} className="px-5 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-ink">
                    {report.reporterName} reported {report.commentId ? "a comment" : "a post"}
                    {report.channelName ? ` in ${report.channelName}` : ""}
                  </p>
                  <p className="mt-1 text-sm text-ink-soft">“{report.reason}”</p>
                  <p className="mt-2 rounded-xl bg-cream px-3.5 py-2.5 text-sm text-ink">
                    <span className="font-semibold">{report.authorName}: </span>
                    {report.content.slice(0, 400) || "(nothing to show)"}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  {report.status === "open" ? (
                    <>
                      <Button variant="danger" size="sm" onClick={() => void resolve(report, "hide")}>
                        Hide it
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => void resolve(report, "dismiss")}
                      >
                        It's fine
                      </Button>
                    </>
                  ) : (
                    <Badge tone={report.status === "actioned" ? "red" : "neutral"}>
                      {report.status === "actioned" ? "Hidden" : "Dismissed"}
                    </Badge>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
      {confirmDialog}
    </div>
  );
}

/* ----------------------------------------------------------- Scheduled posts */

function ScheduledPostsTab({ communityId }: { communityId: number }) {
  const [posts, setPosts] = useState<AdminScheduledPost[] | null>(null);

  const load = useCallback(() => {
    adminApi
      .communityScheduledPosts(communityId)
      .then(setPosts)
      .catch(() => toast.error("We couldn't load your scheduled posts."));
  }, [communityId]);

  useEffect(load, [load]);

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          title="Waiting to go out"
          subtitle="Posts written now and published later. Nobody can see them until they land."
        />
      </Card>

      {posts === null ? (
        <Skeleton className="h-32 w-full" />
      ) : posts.length === 0 ? (
        <EmptyState
          icon={<Clock />}
          title="Nothing scheduled"
          description="Write a post in a channel and choose a time for it, and it will wait here until then."
        />
      ) : (
        <div className="space-y-3">
          {posts.map((post) => (
            <ScheduledPostRow
              key={post.id}
              communityId={communityId}
              post={post}
              onChanged={load}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * One waiting post: what it is, when it goes out, and the two things worth
 * doing to it.
 *
 * Moving the time and sending it now are the same edit to a moderator — "the
 * webinar moved" and "actually, publish that" are the only two reasons to open
 * this screen — so they sit together rather than behind separate affordances.
 */
function ScheduledPostRow({
  communityId,
  post,
  onChanged,
}: {
  communityId: number;
  post: AdminScheduledPost;
  onChanged: () => void;
}) {
  const [when, setWhen] = useState(() => toDateTimeInput(post.publishAt));
  const [busy, setBusy] = useState(false);
  const moved = when !== toDateTimeInput(post.publishAt);

  return (
    <Card className="flex flex-wrap items-end gap-4 px-5 py-4">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-ink">
          {post.title || post.body.slice(0, 70) || "(no words yet)"}
        </p>
        <p className="text-xs text-ink-soft">
          {post.channelName} · by {post.authorName} · goes out{" "}
          {formatDateTime(post.publishAt)}
        </p>
      </div>
      <Field label="Move it to" htmlFor={`scheduled-${post.id}`} className="w-56">
        <Input
          id={`scheduled-${post.id}`}
          type="datetime-local"
          value={when}
          onChange={(e) => setWhen(e.target.value)}
        />
      </Field>
      <Button
        variant="secondary"
        size="sm"
        disabled={!moved || busy}
        onClick={async () => {
          const iso = fromDateTimeInput(when);
          if (!iso) {
            toast.error("We couldn't read that time. Pick it again?");
            return;
          }
          setBusy(true);
          try {
            await adminApi.communityScheduledPostSave(communityId, Number(post.id), {
              publishAt: iso,
            });
            onChanged();
            toast.success("Moved.");
          } catch (err) {
            toast.error(friendlyError(err, "scheduled post"));
          } finally {
            setBusy(false);
          }
        }}
      >
        <Clock />
        Move it
      </Button>
      <Button
        size="sm"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await adminApi.communityScheduledPostSave(communityId, Number(post.id), {
              publishNow: true,
            });
            onChanged();
            toast.success("Published.");
          } catch (err) {
            toast.error(friendlyError(err, "scheduled post"));
          } finally {
            setBusy(false);
          }
        }}
      >
        <Send />
        Send it now
      </Button>
    </Card>
  );
}

/* ---------------------------------------------------------------- Guidelines */

function GuidelinesTab({
  communityId,
  community,
}: {
  communityId: number;
  community: CommunityDetailShape | null;
}) {
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (community && !loaded) {
      setText(community.guidelinesMd ?? "");
      setLoaded(true);
    }
  }, [community, loaded]);

  return (
    <Card>
      <CardHeader
        title="Community guidelines"
        subtitle="Shown in a panel members must accept before they post. Markdown, so headings and links work."
      />
      <div className="space-y-4 px-5 py-5">
        <Textarea
          rows={14}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={"## House rules\n\nBe kind. No selling.\n\nEmail yvette@bossclinician.com if something is wrong."}
        />
        <div className="flex flex-wrap items-center gap-3">
          <Button
            size="sm"
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              try {
                const res = await adminApi.communityGuidelinesSave(communityId, text);
                toast.success(
                  res.reAccceptanceRequired
                    ? "Saved. Members will be asked to accept these again."
                    : "Saved. Nothing changed, so nobody has to accept again.",
                );
              } catch (err) {
                toast.error(friendlyError(err, "guidelines"));
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? "Saving…" : "Save guidelines"}
          </Button>
          <p className="text-xs text-ink-soft">
            Changing the words asks everyone to accept again — rules somebody
            agreed to in March are not the rules they're being held to now.
          </p>
        </div>
      </div>
    </Card>
  );
}
