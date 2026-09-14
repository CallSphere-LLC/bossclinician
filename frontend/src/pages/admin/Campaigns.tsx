import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Link, useSearchParams } from "react-router";
import {
  CalendarClock,
  Copy,
  Mails,
  Megaphone,
  Plus,
  Send,
  Trash2,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { adminApi } from "@/lib/api";
import { marketingApi, type SequenceSummary } from "@/lib/marketingApi";
import {
  PROGRAMME_STATUS_LABEL,
  PROGRAMME_TYPES,
  PROGRAMME_TYPE_LABEL,
  filterProgramme,
  mergeProgramme,
  programmeFolders,
  readProgrammeFilters,
  sequenceSpan,
  statusOptionsFor,
  writeProgrammeFilters,
  type ProgrammeFilters,
  type ProgrammeRow,
  type ProgrammeStatus,
} from "@/pages/admin/emailProgramme";
import { contactsApi, type Segment, type Tag } from "@/lib/contactsApi";
import type { Campaign } from "@/types/admin";
import { formatDateTime, formatNumber } from "@/lib/format";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNotice,
  Field,
  Input,
  PageHeader,
  selectStyles,
  type BadgeProps,
} from "@/pages/admin/ui/primitives";
import { DataTable, RowActions } from "@/pages/admin/ui/DataTable";
import { Modal, useConfirm } from "@/pages/admin/ui/Dialog";
import EmailComposer from "@/components/admin/EmailComposer";
import {
  CAMPAIGN_FIELDS,
  CAMPAIGN_FIELD_IDS,
  orderedErrors,
  saveBlockedSummary,
  validateCampaignDraft,
} from "@/components/admin/emailDraftValidation";
import { eventsAdminApi, type EventSummary } from "@/lib/eventsApi";
import { isoToWallClock, wallClockToIso } from "@/lib/zonedDateTime";
import {
  friendlyError,
  humanizeKey,
  pluralize,
} from "@/pages/admin/ui/friendly";

const STATUS_TONE: Record<string, NonNullable<BadgeProps["tone"]>> = {
  draft: "slate",
  scheduled: "gold",
  sending: "blue",
  sent: "green",
  failed: "red",
};

/** A3: sequence rows, in the shared status vocabulary of the combined list. */
const PROGRAMME_STATUS_TONE: Record<ProgrammeStatus, NonNullable<BadgeProps["tone"]>> = {
  draft: "slate",
  scheduled: "gold",
  sending: "green",
  sent: "green",
  paused: "gold",
  failed: "red",
  archived: "neutral",
};

/**
 * Stored status → what actually happened, in her words. The raw values are
 * one-word machine states; "failed" in particular reads like something she did
 * wrong rather than mail that never went out.
 */
const STATUS_LABEL: Record<string, string> = {
  draft: "Not sent yet",
  scheduled: "Scheduled",
  sending: "Sending now",
  sent: "Sent",
  failed: "Didn't send",
};

const AUDIENCES = [
  { key: "all_subscribers", label: "Everyone on my email list" },
  { key: "all_members", label: "Everyone with a membership" },
  { key: "leads", label: "Everyone who's enquired" },
  { key: "community", label: "Everyone in my community" },
];

const TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Europe/London",
  "Australia/Sydney",
];

const DEFAULT_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York";

/* ------------------------------------------------------- when it goes out */

/**
 * The four ways an email can be timed, as one choice.
 *
 * They were three separate mechanisms before: a Send button, a "Send later"
 * date, and — in the database and the scheduler but on no screen — an event
 * anchor. The anchor had been built and tested and could not be reached, so
 * "24 hours before the webinar" was a thing the software did and nobody could
 * ask for. One picker, because from where she is sitting this is one decision.
 */
type SendMode = "manual" | "absolute" | "event_start" | "event_registration";

const SEND_MODES: { key: SendMode; label: string }[] = [
  { key: "manual", label: "When I press Send" },
  { key: "absolute", label: "At a date and time" },
  { key: "event_start", label: "Before or after an event" },
  { key: "event_registration", label: "When someone registers for an event" },
];

/**
 * Offsets from an event's start. Signed minutes — negative is before.
 *
 * A fixed list rather than a number box, because "how many minutes before"
 * is not how anybody thinks about a reminder, and because a typo in a number
 * box is a mailing at the wrong hour.
 */
const EVENT_START_OFFSETS: { minutes: number; label: string }[] = [
  { minutes: -10080, label: "1 week before it starts" },
  { minutes: -4320, label: "3 days before it starts" },
  { minutes: -2880, label: "2 days before it starts" },
  { minutes: -1440, label: "24 hours before it starts" },
  { minutes: -720, label: "12 hours before it starts" },
  { minutes: -180, label: "3 hours before it starts" },
  { minutes: -60, label: "1 hour before it starts" },
  { minutes: -15, label: "15 minutes before it starts" },
  { minutes: 0, label: "the moment it starts" },
  { minutes: 60, label: "1 hour after it starts" },
  { minutes: 180, label: "3 hours after it starts" },
  { minutes: 1440, label: "1 day after it starts" },
  { minutes: 4320, label: "3 days after it starts" },
];

/** Offsets from the moment a person registers. Never negative — see the route. */
const REGISTRATION_OFFSETS: { minutes: number; label: string }[] = [
  { minutes: 0, label: "straight away" },
  { minutes: 30, label: "30 minutes later" },
  { minutes: 60, label: "1 hour later" },
  { minutes: 240, label: "4 hours later" },
  { minutes: 1440, label: "1 day later" },
  { minutes: 4320, label: "3 days later" },
];

function offsetChoices(mode: SendMode) {
  return mode === "event_registration" ? REGISTRATION_OFFSETS : EVENT_START_OFFSETS;
}

function offsetLabel(mode: SendMode, minutes: number): string {
  const found = offsetChoices(mode).find((choice) => choice.minutes === minutes);
  if (found) return found.label;
  const hours = Math.round(Math.abs(minutes) / 60);
  const when = minutes < 0 ? "before" : "after";
  return mode === "event_registration"
    ? `${hours} hours after they register`
    : `${hours} hours ${when} it starts`;
}

/** Which mode a saved campaign is already in, so reopening it shows the truth. */
function sendModeOf(campaign: Partial<Campaign>): SendMode {
  if (campaign.anchorKind === "event_start") return "event_start";
  if (campaign.anchorKind === "event_registration") return "event_registration";
  if (campaign.scheduledAt) return "absolute";
  return "manual";
}

/**
 * When an event-anchored campaign would actually send, worked out in the
 * browser exactly as the scheduler works it out on the server.
 *
 * Shown before she saves, because the one mistake this feature invites is
 * asking for a window that has already closed — "24 hours before" a webinar
 * that starts this afternoon. The server refuses that; saying so here means
 * she never meets the refusal.
 */
function eventSendMoment(
  event: EventSummary | undefined,
  offsetMinutes: number,
): { at: Date; past: boolean } | null {
  if (!event?.startsAt) return null;
  const starts = Date.parse(event.startsAt);
  if (!Number.isFinite(starts)) return null;
  const at = new Date(starts + offsetMinutes * 60_000);
  return { at, past: at.getTime() <= Date.now() };
}

function scheduledLabel(iso: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(new Date(iso));
  } catch {
    return formatDateTime(iso);
  }
}

/** Falls back to a readable version of a group this list doesn't cover. */
function audienceLabel(key: string): string {
  return AUDIENCES.find((a) => a.key === key)?.label ?? humanizeKey(key);
}

function chosenAudience(campaign: Partial<Campaign>): string {
  if (campaign.segmentId) return `segment:${campaign.segmentId}`;
  if (campaign.includeTagIds?.length) return `tag:${campaign.includeTagIds[0]}`;
  return campaign.audience ?? "all_subscribers";
}

function campaignAudienceLabel(campaign: Partial<Campaign>, segments: Segment[], tags: Tag[]): string {
  if (campaign.segmentId) {
    return segments.find((segment) => segment.id === campaign.segmentId)?.name ?? "Saved group";
  }
  if (campaign.includeTagIds?.length) {
    const names = campaign.includeTagIds
      .map((id) => tags.find((tag) => tag.id === id)?.name)
      .filter(Boolean);
    return names.length > 0 ? `Tagged ${names.join(" or ")}` : "Tagged contacts";
  }
  return audienceLabel(campaign.audience ?? "all_subscribers");
}

/**
 * The line under a broadcast's status badge: what happened, or what will.
 *
 * Its own component because the combined list shows it inside the Status
 * column rather than in a column of its own (A3, to keep the row's actions on
 * screen at 1280px).
 */
function CampaignOutcome({ campaign }: { campaign: Campaign }) {
  if (campaign.status === "sent") {
    return (
      <span className="block text-xs text-ink-soft">
        <strong className="text-ink">{formatNumber(campaign.deliveredCount)}</strong> arrived
        {campaign.failedCount > 0 && (
          <span className="text-red-300"> · {formatNumber(campaign.failedCount)} didn't</span>
        )}
        {campaign.sentAt && (
          <span className="block whitespace-nowrap">{formatDateTime(campaign.sentAt)}</span>
        )}
      </span>
    );
  }
  if (campaign.anchorSkipReason) {
    // The scheduler passed this over and said why. Without this the campaign
    // read "Didn't send" and gave no reason, which is the state a silent skip
    // leaves somebody in.
    return <span className="block text-xs text-red-300">{campaign.anchorSkipReason}</span>;
  }
  if (campaign.anchorKind === "event_registration" && campaign.status === "sending") {
    return (
      <span className="flex items-start gap-1.5 text-xs text-blue-300">
        <CalendarClock className="mt-0.5 size-3 shrink-0" />
        Goes out {offsetLabel("event_registration", campaign.anchorOffsetMinutes)} to new
        registrations
      </span>
    );
  }
  if (campaign.anchorKind === "event_start" && campaign.status === "scheduled") {
    return (
      <span className="flex items-start gap-1.5 text-xs text-gold">
        <CalendarClock className="mt-0.5 size-3 shrink-0" />
        Sends {offsetLabel("event_start", campaign.anchorOffsetMinutes)}
      </span>
    );
  }
  if (campaign.status === "scheduled" && campaign.scheduledAt) {
    return (
      <span className="block text-xs text-gold">
        Sends {scheduledLabel(campaign.scheduledAt, campaign.timezone || DEFAULT_TIMEZONE)}
      </span>
    );
  }
  return null;
}

/* ------------------------------------------------------------------ Screen */

export default function Campaigns() {
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Partial<Campaign> | null>(null);
  const [audienceCount, setAudienceCount] = useState<number | null>(null);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  /**
   * A3. Sequences share this list with broadcasts, so the whole programme is
   * one screen. Filters live in the URL — `?type=sequence&status=sending` — so
   * a tile on the Marketing Overview or a bookmark opens it already narrowed.
   */
  const [sequences, setSequences] = useState<SequenceSummary[] | null>(null);
  const [sequenceError, setSequenceError] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = readProgrammeFilters(searchParams);
  const setFilters = useCallback(
    (next: Partial<ProgrammeFilters>) =>
      setSearchParams(
        (current) =>
          writeProgrammeFilters(current, { ...readProgrammeFilters(current), ...next }),
        { replace: true },
      ),
    [setSearchParams],
  );
  const [sendMode, setSendMode] = useState<SendMode>("manual");
  const [events, setEvents] = useState<EventSummary[]>([]);
  /**
   * A1. Set by the first Save that is refused. From then on every field's
   * message is worked out live on each render, so it sits beside the field
   * while the problem exists and disappears the moment it is fixed.
   */
  const [showErrors, setShowErrors] = useState(false);
  const [confirm, confirmDialog] = useConfirm();

  /**
   * Opens the composer on a campaign, or on a blank one.
   *
   * Goes through one function so the timing picker cannot disagree with the
   * campaign it is showing — a new draft that inherited the last one's mode
   * would offer to schedule something against an event it was never pointed at.
   */
  const openDraft = useCallback((campaign?: Campaign) => {
    const next: Partial<Campaign> =
      campaign ?? { audience: "all_subscribers", status: "draft", timezone: DEFAULT_TIMEZONE };
    setSendMode(sendModeOf(next));
    setShowErrors(false);
    setDraft(next);
  }, []);

  const load = useCallback(() => {
    adminApi
      .growthList<Campaign>("campaigns")
      .then(setCampaigns)
      .catch(() => setError("We couldn't load your emails. Try refreshing the page."));
    // A failure here costs the sequence rows, not the broadcasts — and says so,
    // rather than showing a programme with its sequences silently missing.
    marketingApi
      .sequences()
      .then((rows) => {
        setSequences(rows);
        setSequenceError(null);
      })
      .catch(() => {
        setSequences([]);
        setSequenceError("We couldn't load your sequences just now, so only broadcasts are listed.");
      });
  }, []);

  const programme = useMemo(
    () => (campaigns && sequences ? mergeProgramme(campaigns, sequences) : null),
    [campaigns, sequences],
  );
  const folders = useMemo(() => (programme ? programmeFolders(programme) : []), [programme]);
  const visibleRows = useMemo(
    () => (programme ? filterProgramme(programme, readProgrammeFilters(searchParams)) : null),
    [programme, searchParams],
  );
  const filtering = Boolean(filters.type || filters.status || filters.folder);

  useEffect(load, [load]);

  useEffect(() => {
    contactsApi.segments().then(setSegments).catch(() => setSegments([]));
    contactsApi.tags().then(setTags).catch(() => setTags([]));
    // Needed to offer "before or after an event". A failure here costs the two
    // event-anchored modes and nothing else, so it is not an error banner.
    eventsAdminApi.list().then(setEvents).catch(() => setEvents([]));
  }, []);

  // Live count of how many people the draft would reach.
  useEffect(() => {
    if (!draft?.audience) {
      setAudienceCount(null);
      return;
    }
    let cancelled = false;
    setAudienceCount(null);
    adminApi
      .audienceCount({
        audience: draft.audience,
        segmentId: draft.segmentId,
        includeTagIds: draft.includeTagIds,
        excludeSegmentIds: draft.excludeSegmentIds,
        excludeTagIds: draft.excludeTagIds,
      })
      .then((r) => !cancelled && setAudienceCount(r.count))
      .catch(() => !cancelled && setAudienceCount(null));
    return () => {
      cancelled = true;
    };
  }, [
    draft?.audience,
    draft?.segmentId,
    draft?.includeTagIds?.join(","),
    draft?.excludeSegmentIds?.join(","),
    draft?.excludeTagIds?.join(","),
  ]);

  const anchorEvent = events.find((event) => event.id === draft?.anchorEventId);
  const anchorMoment =
    sendMode === "event_start"
      ? eventSendMoment(anchorEvent, draft?.anchorOffsetMinutes ?? -1440)
      : null;
  const fieldErrors =
    draft && showErrors
      ? validateCampaignDraft(draft, { sendMode, now: Date.now(), anchorEvent: anchorEvent ?? null })
      : {};

  async function save(e: FormEvent) {
    e.preventDefault();
    // Unreachable in practice — the form only renders while there is a draft.
    if (!draft) return;

    /*
     * A1. Every rule that can refuse a save is in validateCampaignDraft, and a
     * refusal always does three things: marks the field, puts the sentence
     * under it, and says so in a toast. The form is `noValidate`, so the
     * browser cannot cancel the submit on its own any more — that is what made
     * an empty "Subject line B" swallow Save with no request and no word.
     *
     * An already-closed event window is refused here too, in her words, rather
     * than saved and quietly marked "Didn't send" by the scheduler hours later.
     * The server makes the same check; this one exists so she never reaches it.
     */
    const fieldErrors = validateCampaignDraft(draft, {
      sendMode,
      now: Date.now(),
      anchorEvent: anchorEvent ?? null,
    });
    const summary = saveBlockedSummary(fieldErrors, CAMPAIGN_FIELDS);
    if (summary) {
      setShowErrors(true);
      toast.error(summary);
      const [first] = orderedErrors(fieldErrors, CAMPAIGN_FIELDS);
      const control = document.getElementById(CAMPAIGN_FIELD_IDS[first.field]);
      control?.scrollIntoView({ block: "center", behavior: "smooth" });
      control?.focus({ preventScroll: true });
      return;
    }

    try {
      // The anchor is never written through the campaign save: the server
      // stamps the arming moment as part of arming it, and that stamp is what
      // stops a closed window mailing the list. Same reason `status` is left
      // alone here.
      const {
        scheduledAt,
        status: _status,
        anchorKind: _anchorKind,
        anchorEventId,
        anchorOffsetMinutes,
        anchorArmedAt: _anchorArmedAt,
        anchorSkipReason: _anchorSkipReason,
        ...content
      } = draft;
      let campaign: Campaign;
      if (draft.id) campaign = await adminApi.growthUpdate<Campaign>("campaigns", draft.id, content);
      else {
        campaign = await adminApi.growthCreate<Campaign>("campaigns", { ...content, status: "draft" });
        // If the scheduling request fails after creation, a retry updates this
        // draft instead of creating a second email with the same content.
        setDraft((current) => current ? { ...current, id: campaign.id, status: "draft" } : current);
      }

      const wasArmed =
        draft.status === "scheduled" ||
        (draft.status === "sending" && draft.anchorKind === "event_registration");

      if (sendMode === "absolute" && scheduledAt) {
        const timezone = draft.timezone || DEFAULT_TIMEZONE;
        await adminApi.campaignSchedule(campaign.id, scheduledAt, timezone);
        toast.success(`Email scheduled for ${scheduledLabel(scheduledAt, timezone)}`);
      } else if (sendMode === "event_start" || sendMode === "event_registration") {
        const offset = anchorOffsetMinutes ?? (sendMode === "event_start" ? -1440 : 0);
        await adminApi.campaignScheduleEvent(campaign.id, {
          anchorKind: sendMode,
          anchorEventId: anchorEventId!,
          anchorOffsetMinutes: offset,
        });
        toast.success(
          sendMode === "event_registration"
            ? `On — everyone who registers for “${anchorEvent?.title ?? "that event"}” from now on gets this ${offsetLabel(sendMode, offset)}.`
            : `Scheduled for ${offsetLabel(sendMode, offset)} — ${scheduledLabel(anchorMoment!.at.toISOString(), draft.timezone || DEFAULT_TIMEZONE)}.`,
        );
      } else if (draft.id && wasArmed) {
        await adminApi.campaignCancelSchedule(draft.id);
        toast.success("Scheduled send cancelled; the email is a draft again");
      } else {
        toast.success("Email saved");
      }
      setDraft(null);
      load();
    } catch (err) {
      toast.error(friendlyError(err, "email"));
    }
  }

  async function sendTest() {
    if (!draft?.subject?.trim()) {
      toast.error("Add a subject before sending a test.");
      return;
    }
    try {
      const result = await adminApi.campaignTest({
        subject: draft.subject,
        bodyMd: draft.bodyMd ?? "",
      });
      toast.success(`Test sent to ${result.to}`);
    } catch (err) {
      toast.error(friendlyError(err, "test email"));
    }
  }

  const send = useCallback(
    async (campaign: Campaign) => {
      // A failed lookup used to read as zero, which put "Send to 0 people" on
       // the button of a send that goes to the whole list.
      const count = await adminApi
        .audienceCount(campaign)
        .then((r) => r.count)
        .catch(() => null);

      if (count === null) {
        toast.error("We couldn't work out who this would go to — try again in a moment.");
        return;
      }

      const ok = await confirm({
        title: `Send “${campaign.name}”?`,
        description: `This goes to ${pluralize(count, "person", "people")} — ${audienceLabel(
          campaignAudienceLabel(campaign, segments, tags),
        ).toLowerCase()}. Once it's gone you can't take it back.`,
        confirmLabel: `Send to ${pluralize(count, "person", "people")}`,
      });
      if (!ok) return;

      try {
        const result = await adminApi.campaignSend(campaign.id);
        toast.success(
          `Sending to ${pluralize(result.queued, "person", "people")} — this takes a few minutes.`,
        );
        load();
        // The numbers below fill in as the sending works through the list.
        window.setTimeout(load, 4000);
      } catch (err) {
        toast.error(friendlyError(err, "email"));
      }
    },
    [confirm, load, segments, tags],
  );

  /**
   * Copies a past email into a new draft.
   *
   * The other half of a template library, and the half people actually reach
   * for: last quarter's launch email, sent again with three words changed. The
   * copy deliberately carries no schedule and no send history — it is a draft,
   * and it opens for editing so nothing can go out by accident.
   */
  const duplicate = useCallback(
    async (campaign: Campaign) => {
      try {
        const copy = await adminApi.growthCreate<Campaign>("campaigns", {
          name: `${campaign.name} (copy)`.slice(0, 200),
          folder: campaign.folder,
          subject: campaign.subject,
          subjectB: campaign.subjectB,
          abSplitPercent: campaign.abSplitPercent,
          previewText: campaign.previewText,
          bodyMd: campaign.bodyMd,
          audience: campaign.audience,
          segmentId: campaign.segmentId,
          includeTagIds: campaign.includeTagIds,
          excludeSegmentIds: campaign.excludeSegmentIds,
          excludeTagIds: campaign.excludeTagIds,
          timezone: campaign.timezone,
          status: "draft",
        });
        toast.success(`Copied to “${copy.name}” — nothing has been sent.`);
        load();
        openDraft(copy);
      } catch (err) {
        toast.error(friendlyError(err, "email"));
      }
    },
    [load, openDraft],
  );

  const remove = useCallback(
    async (campaign: Campaign) => {
      const ok = await confirm({
        title: `Delete “${campaign.name}”?`,
        confirmLabel: "Yes, delete it",
        destructive: true,
      });
      if (!ok) return;
      try {
        await adminApi.growthDelete("campaigns", campaign.id);
        toast.success("Email deleted");
        load();
      } catch (err) {
        toast.error(friendlyError(err, "email"));
      }
    },
    [confirm, load],
  );

  /*
   * A3. One row type for both kinds. Broadcast cells are exactly what they
   * were; a sequence row reads "6 emails over 11 days" where a broadcast shows
   * its subject, and opens its own editor rather than this dialog.
   */
  const columns = useMemo<ColumnDef<ProgrammeRow, unknown>[]>(
    () => [
      {
        id: "name",
        // What the search box matches: the name plus the line under it.
        accessorFn: (row) =>
          row.type === "broadcast"
            ? `${row.name} ${row.campaign.subject}`
            : `${row.name} ${sequenceSpan(row.sequence)}`,
        header: "Email",
        /*
         * The type is said inline — "Sequence · 6 emails over 11 days" — the
         * way Kajabi lists them, rather than in a column of its own. A Type
         * column was what pushed Send and Delete past the edge at 1280px.
         */
        cell: ({ row }) => {
          const item = row.original;
          if (item.type === "sequence") {
            return (
              <Link
                to={`/admin/marketing/sequences/${item.sequence.id}`}
                className="block min-w-0 max-w-[15rem] text-left"
              >
                <span className="block truncate font-semibold text-ink">{item.name}</span>
                <span className="flex min-w-0 items-center gap-1 text-xs text-ink-soft">
                  <Mails className="size-3 shrink-0 text-lilac" aria-hidden="true" />
                  <span className="shrink-0 font-medium text-lilac">Sequence</span>
                  <span className="truncate">· {sequenceSpan(item.sequence)}</span>
                </span>
              </Link>
            );
          }
          return (
            <button
              type="button"
              onClick={() => openDraft(item.campaign)}
              className="block min-w-0 max-w-[15rem] text-left"
            >
              <span className="block truncate font-semibold text-ink">{item.name}</span>
              <span className="flex min-w-0 items-center gap-1 text-xs text-ink-soft">
                <Megaphone className="size-3 shrink-0 text-sky-300" aria-hidden="true" />
                <span className="shrink-0 font-medium text-sky-300">Broadcast</span>
                <span className="truncate">· {item.campaign.subject || "No subject line yet"}</span>
              </span>
            </button>
          );
        },
      },
      {
        id: "folder",
        accessorFn: (row) => row.folder,
        header: "Folder",
        cell: ({ row }) => row.original.folder
          ? <Badge tone="slate">{row.original.folder}</Badge>
          : <span className="text-sm text-ink-soft">Unfiled</span>,
      },
      {
        id: "audience",
        accessorFn: (row) =>
          row.type === "broadcast" ? campaignAudienceLabel(row.campaign, segments, tags) : "",
        header: "Who gets it",
        cell: ({ row }) => {
          const item = row.original;
          if (item.type === "sequence") {
            return (
              <span className="text-sm text-ink-soft">
                Whoever joins it
                <span className="block text-xs">
                  {formatNumber(item.sequence.activeCount)} going through now
                </span>
              </span>
            );
          }
          return (
            <Badge tone="plum" className="max-w-[10rem]" title={campaignAudienceLabel(item.campaign, segments, tags)}>
              <Users className="size-3 shrink-0" />
              <span className="truncate">{campaignAudienceLabel(item.campaign, segments, tags)}</span>
            </Badge>
          );
        },
      },
      {
        /*
         * Status and "how it went" share a column: the badge, and under it the
         * line that explains it. Two columns here, plus Type and Date sent,
         * was what put Send and Delete past the right edge at 1280px.
         */
        id: "status",
        accessorFn: (row) => PROGRAMME_STATUS_LABEL[row.status],
        header: "Status",
        cell: ({ row }) => {
          const item = row.original;
          if (item.type === "sequence") {
            return (
              <div className="space-y-1">
                <Badge tone={PROGRAMME_STATUS_TONE[item.status]}>
                  {PROGRAMME_STATUS_LABEL[item.status]}
                </Badge>
                <span className="block text-xs text-ink-soft">
                  <strong className="text-ink">{formatNumber(item.sequence.completedCount)}</strong>{" "}
                  finished
                </span>
              </div>
            );
          }
          const campaign = item.campaign;
          return (
            <div className="max-w-[15rem] space-y-1">
              <Badge tone={STATUS_TONE[campaign.status] ?? "neutral"}>
                {STATUS_LABEL[campaign.status] ?? humanizeKey(campaign.status)}
              </Badge>
              <CampaignOutcome campaign={campaign} />
            </div>
          );
        },
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        cell: ({ row }) => {
          const item = row.original;
          if (item.type === "sequence") {
            return (
              <RowActions>
                <Button asChild size="sm" variant="secondary">
                  <Link to={`/admin/marketing/sequences/${item.sequence.id}`}>Open</Link>
                </Button>
              </RowActions>
            );
          }
          const campaign = item.campaign;
          return (
            <RowActions>
              {campaign.status !== "sent" && campaign.status !== "sending" && (
                <Button size="sm" onClick={() => send(campaign)}>
                  <Send />
                  Send
                </Button>
              )}
              {(campaign.status === "scheduled" ||
                (campaign.status === "sending" &&
                  campaign.anchorKind === "event_registration")) && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={async () => {
                    try {
                      await adminApi.campaignCancelSchedule(campaign.id);
                      toast.success("Scheduled send cancelled");
                      load();
                    } catch (err) {
                      toast.error(friendlyError(err, "email"));
                    }
                  }}
                >
                  {campaign.anchorKind === "event_registration"
                    ? "Switch off"
                    : "Cancel schedule"}
                </Button>
              )}
              <Button
                variant="ghost"
                size="iconSm"
                title="Make a copy"
                aria-label={`Make a copy of ${campaign.name}`}
                onClick={() => duplicate(campaign)}
              >
                <Copy />
              </Button>
              <Button
                variant="dangerGhost"
                size="iconSm"
                aria-label={`Delete ${campaign.name}`}
                onClick={() => remove(campaign)}
              >
                <Trash2 />
              </Button>
            </RowActions>
          );
        },
      },
    ],
    [send, remove, duplicate, openDraft, load, segments, tags],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Marketing"
        title="Email Campaigns"
        description="Everything you email people, in one list — one-off broadcasts and the sequences that run on their own."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild size="sm" variant="secondary">
              <Link to="/admin/marketing/sequences?new=1">
                <Mails />
                New sequence
              </Link>
            </Button>
            <Button size="sm" onClick={() => openDraft()}>
              <Plus />
              Write an email
            </Button>
          </div>
        }
      />

      {error && <ErrorNotice message={error} />}
      {sequenceError && <ErrorNotice message={sequenceError} />}

      <DataTable
        columns={columns}
        data={visibleRows}
        searchPlaceholder="Search your emails…"
        itemNoun={{ one: "email or sequence", many: "emails and sequences" }}
        minWidth="900px"
        toolbar={
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter the list">
            <select
              aria-label="Type"
              className={`${selectStyles} h-11 w-auto min-w-[9rem]`}
              value={filters.type}
              onChange={(event) => {
                const type = event.target.value as ProgrammeFilters["type"];
                // A status the new type can't be in would leave an empty list
                // with no visible reason, so it is dropped with the switch.
                const keepStatus =
                  !filters.status || statusOptionsFor(type).includes(filters.status as ProgrammeStatus);
                setFilters({ type, status: keepStatus ? filters.status : "" });
              }}
            >
              <option value="">Every type</option>
              {PROGRAMME_TYPES.map((type) => (
                <option key={type} value={type}>{PROGRAMME_TYPE_LABEL[type]}s</option>
              ))}
            </select>
            <select
              aria-label="Status"
              className={`${selectStyles} h-11 w-auto min-w-[9rem]`}
              value={filters.status}
              onChange={(event) =>
                setFilters({ status: event.target.value as ProgrammeFilters["status"] })
              }
            >
              <option value="">Every status</option>
              {statusOptionsFor(filters.type).map((status) => (
                <option key={status} value={status}>{PROGRAMME_STATUS_LABEL[status]}</option>
              ))}
            </select>
            <select
              aria-label="Folder"
              className={`${selectStyles} h-11 w-auto min-w-[9rem]`}
              value={filters.folder}
              onChange={(event) => setFilters({ folder: event.target.value })}
            >
              <option value="">Every folder</option>
              {/* A folder named in a link but empty here still shows as chosen. */}
              {[...new Set([...folders, ...(filters.folder ? [filters.folder] : [])])].map((folder) => (
                <option key={folder} value={folder}>{folder}</option>
              ))}
            </select>
            {filtering && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setFilters({ type: "", status: "", folder: "" })}
              >
                Clear filters
              </Button>
            )}
          </div>
        }
        emptyState={
          filtering && (programme?.length ?? 0) > 0 ? (
            <EmptyState
              icon={<Megaphone />}
              title="Nothing matches these filters"
              description="Try another type, status or folder — or clear them to see everything."
              action={
                <Button size="sm" variant="secondary" onClick={() => setFilters({ type: "", status: "", folder: "" })}>
                  Clear filters
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={<Megaphone />}
              title="No emails yet"
              description="Write one and send it to your subscribers, members or enquiries, or build a sequence that runs on its own."
              action={
                <Button size="sm" onClick={() => openDraft()}>
                  Write an email
                </Button>
              }
            />
          )
        }
      />

      <Modal
        open={draft !== null}
        onOpenChange={(open) => !open && setDraft(null)}
        title={draft?.id ? "Edit email" : "New email"}
        size="lg"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button size="sm" type="submit" form="campaign-form">
              Save email
            </Button>
          </>
        }
      >
        {draft && (
          /* noValidate: see save(). No browser constraint may veto this form —
             the Save button lives in the dialog footer, outside it, and the
             browser's bubble never showed, so a `required` here was a Save
             that did nothing. */
          <form id="campaign-form" onSubmit={save} noValidate className="space-y-4">
            <Field
              label="Name it for yourself"
              hint="just so you can find it — nobody else sees this"
              error={fieldErrors.name}
            >
              <Input
                id={CAMPAIGN_FIELD_IDS.name}
                value={draft.name ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                placeholder="March launch — waitlist"
                autoFocus
              />
            </Field>

            <Field label="Folder" hint="optional — emails with the same folder can be filtered together">
              <Input
                value={draft.folder ?? ""}
                onChange={(event) => setDraft((current) => ({ ...current, folder: event.target.value }))}
                placeholder="Launch emails"
              />
            </Field>

            <Field label="Who should get this?">
              <select
                value={chosenAudience(draft)}
                onChange={(e) => {
                  const value = e.target.value;
                  setDraft((current) => {
                    if (value.startsWith("segment:")) {
                      return {
                        ...current,
                        segmentId: Number(value.slice(8)),
                        includeTagIds: [],
                      };
                    }
                    if (value.startsWith("tag:")) {
                      return {
                        ...current,
                        segmentId: null,
                        includeTagIds: [Number(value.slice(4))],
                      };
                    }
                    return { ...current, audience: value, segmentId: null, includeTagIds: [] };
                  });
                }}
                className={selectStyles}
              >
                <optgroup label="Built-in audiences">
                  {AUDIENCES.map((a) => (
                    <option key={a.key} value={a.key}>{a.label}</option>
                  ))}
                </optgroup>
                {segments.length > 0 && (
                  <optgroup label="Saved groups">
                    {segments.map((segment) => (
                      <option key={segment.id} value={`segment:${segment.id}`}>{segment.name}</option>
                    ))}
                  </optgroup>
                )}
                {tags.length > 0 && (
                  <optgroup label="People with a tag">
                    {tags.map((tag) => (
                      <option key={tag.id} value={`tag:${tag.id}`}>{tag.name}</option>
                    ))}
                  </optgroup>
                )}
              </select>
            </Field>

            {(segments.length > 0 || tags.length > 0) && (
              <div className="rounded-xl border border-hairline bg-white/[0.03] p-4">
                <p className="text-sm font-semibold text-ink">Leave these people out</p>
                <p className="mt-1 text-xs text-ink-soft">
                  Exclusions are applied after the audience above, to both the count and the send.
                </p>
                {segments.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-3">
                    {segments.map((segment) => (
                      <label key={segment.id} className="flex cursor-pointer items-center gap-2 text-sm text-ink">
                        <input
                          type="checkbox"
                          className="size-4 rounded border-hairline text-plum"
                          checked={(draft.excludeSegmentIds ?? []).includes(segment.id)}
                          onChange={(event) => setDraft((current) => ({
                            ...current,
                            excludeSegmentIds: event.target.checked
                              ? [...(current?.excludeSegmentIds ?? []), segment.id]
                              : (current?.excludeSegmentIds ?? []).filter((id) => id !== segment.id),
                          }))}
                        />
                        Group: {segment.name}
                      </label>
                    ))}
                  </div>
                )}
                {tags.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-3">
                    {tags.map((tag) => (
                      <label key={tag.id} className="flex cursor-pointer items-center gap-2 text-sm text-ink">
                        <input
                          type="checkbox"
                          className="size-4 rounded border-hairline text-plum"
                          checked={(draft.excludeTagIds ?? []).includes(tag.id)}
                          onChange={(event) => setDraft((current) => ({
                            ...current,
                            excludeTagIds: event.target.checked
                              ? [...(current?.excludeTagIds ?? []), tag.id]
                              : (current?.excludeTagIds ?? []).filter((id) => id !== tag.id),
                          }))}
                        />
                        Tag: {tag.name}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="rounded-xl border border-hairline bg-cream/60 px-4 py-3 text-sm">
              {audienceCount === null ? (
                <span className="text-ink-soft">Working out how many people…</span>
              ) : (
                <span className="text-ink">
                  <strong className="font-display text-lg text-plum">
                    {formatNumber(audienceCount)}
                  </strong>{" "}
                  <span className="text-ink-soft">
                    {audienceCount === 1 ? "person will get this" : "people will get this"}
                  </span>
                </span>
              )}
            </div>

            <Field label="Subject line" hint="what people see in their inbox" error={fieldErrors.subject}>
              <Input
                id={CAMPAIGN_FIELD_IDS.subject}
                value={draft.subject ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, subject: e.target.value }))}
                placeholder="Doors are open"
              />
            </Field>

            <label className="flex min-h-11 items-center gap-3 rounded-xl border border-hairline px-3 text-sm text-ink">
              <input
                type="checkbox"
                className="size-5 rounded border-hairline text-plum focus-visible:ring-plum/30"
                checked={(draft.abSplitPercent ?? 0) > 0}
                onChange={(event) => setDraft((current) => ({
                  ...current,
                  abSplitPercent: event.target.checked ? 50 : 0,
                  subjectB: event.target.checked ? current?.subjectB ?? "" : "",
                }))}
              />
              Test a second subject line
            </label>

            {(draft.abSplitPercent ?? 0) > 0 && (
              <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
                <Field
                  label="Subject line B"
                  hint="compare this with the original subject"
                  error={fieldErrors.subjectB}
                >
                  <Input
                    id={CAMPAIGN_FIELD_IDS.subjectB}
                    value={draft.subjectB ?? ""}
                    onChange={(event) => setDraft((current) => ({ ...current, subjectB: event.target.value }))}
                    placeholder="A different way to say it"
                  />
                </Field>
                <Field label="Gets version B">
                  <select
                    className={selectStyles}
                    value={draft.abSplitPercent ?? 50}
                    onChange={(event) => setDraft((current) => ({ ...current, abSplitPercent: Number(event.target.value) }))}
                  >
                    <option value={10}>10%</option>
                    <option value={25}>25%</option>
                    <option value={50}>50%</option>
                  </select>
                </Field>
              </div>
            )}

            <Field
              label="Preview line"
              hint="the grey line under the subject in their inbox"
            >
              <Input
                value={draft.previewText ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, previewText: e.target.value }))}
              />
            </Field>

            <Field label="Your message">
              <EmailComposer
                value={draft.bodyMd ?? ""}
                onChange={(next) => setDraft((d) => ({ ...d, bodyMd: next }))}
                placeholder={"Hi there,\n\nI wanted to tell you about…"}
              />
            </Field>

            {/* --------------------------------------------- when it goes out */}
            <div className="space-y-4 rounded-xl border border-hairline bg-white/[0.03] p-4">
              <Field label="When should this go out?">
                <select
                  className={selectStyles}
                  value={sendMode}
                  onChange={(event) => {
                    const next = event.target.value as SendMode;
                    setSendMode(next);
                    setDraft((current) => ({
                      ...current,
                      // Each mode owns its own timing fields, and clearing the
                      // others as she switches is what stops a leftover from
                      // one mode being saved by another.
                      scheduledAt: next === "absolute" ? current?.scheduledAt ?? null : null,
                      anchorEventId:
                        next === "event_start" || next === "event_registration"
                          ? current?.anchorEventId ?? events.find((e) => e.startsAt)?.id ?? null
                          : null,
                      anchorOffsetMinutes:
                        next === "event_start"
                          ? current?.anchorKind === "event_start"
                            ? current?.anchorOffsetMinutes ?? -1440
                            : -1440
                          : next === "event_registration"
                            ? current?.anchorKind === "event_registration"
                              ? current?.anchorOffsetMinutes ?? 0
                              : 0
                            : 0,
                    }));
                  }}
                >
                  {SEND_MODES.map((mode) => (
                    <option key={mode.key} value={mode.key}>{mode.label}</option>
                  ))}
                </select>
              </Field>

              {sendMode === "absolute" && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Date and time" error={fieldErrors.scheduledAt}>
                    <Input
                      id={CAMPAIGN_FIELD_IDS.scheduledAt}
                      type="datetime-local"
                      min={isoToWallClock(
                        new Date(Date.now() + 60_000).toISOString(),
                        draft.timezone || DEFAULT_TIMEZONE,
                      )}
                      value={isoToWallClock(draft.scheduledAt, draft.timezone || DEFAULT_TIMEZONE)}
                      onChange={(e) =>
                        setDraft((d) => {
                          if (!e.target.value) return { ...d, scheduledAt: null };
                          const scheduledAt = wallClockToIso(
                            e.target.value,
                            d?.timezone || DEFAULT_TIMEZONE,
                          );
                          if (!scheduledAt) {
                            toast.error("That local time does not exist because the clock changes then.");
                            return d;
                          }
                          return { ...d, scheduledAt };
                        })
                      }
                    />
                  </Field>

                  <Field label="Send timezone">
                    <select
                      className={selectStyles}
                      value={draft.timezone || DEFAULT_TIMEZONE}
                      onChange={(event) => {
                        const oldZone = draft.timezone || DEFAULT_TIMEZONE;
                        const wallClock = isoToWallClock(draft.scheduledAt, oldZone);
                        const timezone = event.target.value;
                        setDraft((current) => ({
                          ...current,
                          timezone,
                          scheduledAt: wallClock ? wallClockToIso(wallClock, timezone) : null,
                        }));
                      }}
                    >
                      {(TIMEZONES.includes(draft.timezone || DEFAULT_TIMEZONE)
                        ? TIMEZONES
                        : [draft.timezone || DEFAULT_TIMEZONE, ...TIMEZONES]
                      ).map((timezone) => <option key={timezone} value={timezone}>{timezone}</option>)}
                    </select>
                  </Field>
                </div>
              )}

              {(sendMode === "event_start" || sendMode === "event_registration") && (
                events.length === 0 ? (
                  <div>
                    <p className="text-sm text-ink-soft">
                      You have no events yet. Create one under Events and it will appear here.
                    </p>
                    {/* The event picker is not on screen in this branch, so the
                        refusal has to be said here or it is said nowhere. */}
                    {fieldErrors.anchorEventId && (
                      <p className="mt-1.5 text-xs font-medium text-red-300" role="alert">
                        {fieldErrors.anchorEventId}
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="Which event?" error={fieldErrors.anchorEventId}>
                        <select
                          id={CAMPAIGN_FIELD_IDS.anchorEventId}
                          className={selectStyles}
                          value={draft.anchorEventId ?? ""}
                          onChange={(event) => setDraft((current) => ({
                            ...current,
                            anchorEventId: event.target.value ? Number(event.target.value) : null,
                          }))}
                        >
                          <option value="">Choose an event…</option>
                          {events.map((event) => (
                            <option key={event.id} value={event.id}>
                              {event.title}
                              {event.startsAt
                                ? ` — ${scheduledLabel(event.startsAt, event.timezone || DEFAULT_TIMEZONE)}`
                                : " — no date yet"}
                              {event.published ? "" : " (not published)"}
                            </option>
                          ))}
                        </select>
                      </Field>

                      <Field
                        label="Send it"
                        hint={
                          sendMode === "event_start"
                            ? "counted from the event's start time"
                            : "counted from each person's own registration"
                        }
                        error={fieldErrors.anchorOffsetMinutes}
                      >
                        <select
                          id={CAMPAIGN_FIELD_IDS.anchorOffsetMinutes}
                          className={selectStyles}
                          value={draft.anchorOffsetMinutes ?? (sendMode === "event_start" ? -1440 : 0)}
                          onChange={(event) => setDraft((current) => ({
                            ...current,
                            anchorOffsetMinutes: Number(event.target.value),
                          }))}
                        >
                          {offsetChoices(sendMode).map((choice) => (
                            <option key={choice.minutes} value={choice.minutes}>
                              {choice.label}
                            </option>
                          ))}
                        </select>
                      </Field>
                    </div>

                    {sendMode === "event_start" && anchorMoment && (
                      <p
                        className={
                          anchorMoment.past
                            ? "text-sm font-medium text-red-300"
                            : "text-sm text-ink-soft"
                        }
                      >
                        {anchorMoment.past
                          ? "That moment has already passed, so this will not be sent. Choose a smaller gap before the event, or send it now — nothing goes out for a window that has already closed."
                          : `Goes out ${scheduledLabel(
                              anchorMoment.at.toISOString(),
                              draft.timezone || DEFAULT_TIMEZONE,
                            )}. If you move the event, this moves with it.`}
                      </p>
                    )}

                    {sendMode === "event_start" && anchorEvent && !anchorEvent.published && (
                      <p className="text-sm text-gold">
                        “{anchorEvent.title}” isn't published yet, so nothing will be sent until it
                        is. This email will still be waiting.
                      </p>
                    )}

                    {sendMode === "event_registration" && (
                      <p className="text-sm text-ink-soft">
                        Only people who register <strong className="text-ink">after you save
                        this</strong> get it. The{" "}
                        {formatNumber(anchorEvent?.registrationCount ?? 0)} already registered are
                        left alone, so switching this on can't mail your existing list.
                      </p>
                    )}
                  </div>
                )
              )}

              {sendMode === "manual" && (
                <p className="text-sm text-ink-soft">
                  Nothing goes out until you press Send on this email in the list.
                </p>
              )}

              {draft.anchorSkipReason && (
                <p className="text-sm text-red-300">{draft.anchorSkipReason}</p>
              )}
            </div>

            <div className="flex items-center justify-between gap-3 rounded-xl border border-hairline bg-white/[0.03] p-3">
              <span className="text-sm text-ink-soft">
                Check the subject and formatting in your own inbox before sending.
              </span>
              <Button type="button" variant="secondary" size="sm" onClick={() => void sendTest()}>
                <Send />
                Send me a test
              </Button>
            </div>
          </form>
        )}
      </Modal>

      <Card className="p-5">
        <p className="text-sm font-semibold text-ink">What happens when you send</p>
        <p className="mt-1.5 text-sm leading-relaxed text-ink-soft">
          Sending takes a few minutes for a big list, and the numbers above fill in as it goes. It's
          safe to close this page — sending carries on without you.
        </p>
      </Card>

      {confirmDialog}
    </div>
  );
}
