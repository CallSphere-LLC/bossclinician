import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Link, useNavigate, useSearchParams } from "react-router";
import {
  ArrowLeft,
  CalendarClock,
  CalendarDays,
  Copy,
  Eye,
  Folder,
  LayoutTemplate,
  Mails,
  Megaphone,
  Plus,
  Send,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { adminApi } from "@/lib/api";
import { marketingApi } from "@/lib/marketingApi";
import { sequenceSpan } from "@/pages/admin/emailProgramme";
import {
  EMAIL_KINDS,
  EMAIL_KIND_LABEL,
  NO_FILTERS,
  UNFILED,
  filterEmails,
  folderNames,
  folderSummaries,
  isReadOnlyCampaign,
  longDateTime,
  mergeEmails,
  percentOf,
  readEmailFilters,
  statusLabelFor,
  statusOptionsFor,
  writeEmailFilters,
  type CampaignRecord,
  type EmailFilters,
  type EmailKind,
  type EmailRow,
  type EmailStatus,
  type SequenceRecord,
} from "@/pages/admin/campaigns/emailList";
import NewCampaignDialog, { type NewCampaignStep } from "@/pages/admin/campaigns/NewCampaignDialog";
import CampaignPreview from "@/pages/admin/campaigns/CampaignPreview";
import ManageTemplatesDialog from "@/pages/admin/campaigns/ManageTemplatesDialog";
import { cn } from "@/lib/cn";
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
  Skeleton,
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

/**
 * Sheet row 67: one status vocabulary for every kind of email, in Kajabi's
 * words (Draft, Scheduled, Active, In Progress, Sent / Delivered). The pill
 * colour follows what she would do about it: gold is waiting, blue is going
 * out now, green is live or done, red never went.
 */
const STATUS_TONE: Record<EmailStatus, NonNullable<BadgeProps["tone"]>> = {
  draft: "slate",
  scheduled: "gold",
  active: "green",
  in_progress: "blue",
  sent: "green",
  paused: "gold",
  failed: "red",
  archived: "neutral",
};

const KIND_TONE: Record<EmailKind, NonNullable<BadgeProps["tone"]>> = {
  broadcast: "blue",
  sequence: "plum",
  event: "gold",
};

const KIND_ICON: Record<EmailKind, typeof Megaphone> = {
  broadcast: Megaphone,
  sequence: Mails,
  event: CalendarDays,
};

/** The Type filter's words, as Kajabi has them. */
const KIND_FILTER_LABEL: Record<EmailKind, string> = {
  broadcast: "Email Broadcast",
  sequence: "Email Sequence",
  event: "Event emails",
};

/** For sorting the rate columns: a share of sends, with "no figures" sorting below 0%. */
function ratio(part: number | null, sends: number | null): number {
  return part === null || sends === null || sends <= 0 ? -1 : part / sends;
}

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
 * The line under an email's title, the way Kajabi writes it: "Sent September
 * 26, 2026 05:00 AM", "Scheduled for …", or "6 emails over 11 days" for a
 * sequence. What an anchored email will do, and why a skipped one didn't go,
 * are said here too — a silent skip used to read "Didn't send" with no reason.
 */
function EmailDescription({ row }: { row: EmailRow }) {
  if (row.source === "sequence") {
    return (
      <span className="block truncate text-xs text-ink-soft">
        {sequenceSpan(row.sequence)}
        {row.sequence.activeCount > 0 && ` · ${formatNumber(row.sequence.activeCount)} going through now`}
      </span>
    );
  }
  const campaign = row.campaign;
  if (campaign.status === "sent") {
    return (
      <span className="block truncate text-xs text-ink-soft">
        {campaign.sentAt
          ? `Sent ${longDateTime(campaign.sentAt, campaign.timezone || undefined)}`
          : "Sent"}
        {campaign.failedCount > 0 && (
          <span className="text-red-300"> · {formatNumber(campaign.failedCount)} didn't arrive</span>
        )}
      </span>
    );
  }
  if (campaign.anchorSkipReason) {
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
      <span className="block truncate text-xs text-gold">
        Scheduled for {scheduledLabel(campaign.scheduledAt, campaign.timezone || DEFAULT_TIMEZONE)}
      </span>
    );
  }
  if (campaign.status === "sending") {
    return <span className="block text-xs text-blue-300">Sending now — the numbers fill in as it goes</span>;
  }
  return (
    <span className="block truncate text-xs text-ink-soft">
      {campaign.subject ? `Subject: ${campaign.subject}` : "No subject line yet"}
    </span>
  );
}

/* ------------------------------------------------------------------ Screen */

export default function Campaigns() {
  const navigate = useNavigate();
  const [campaigns, setCampaigns] = useState<CampaignRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Partial<Campaign> | null>(null);
  const [audienceCount, setAudienceCount] = useState<number | null>(null);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  /**
   * Sheet row 67. Broadcasts, sequences and event emails share one list, as on
   * Kajabi's Email Campaigns page; Email Sequences is no longer a page of its
   * own. Filters live in the URL — `?type=sequence&status=active`,
   * `?view=folders&folder=Launch` — so a tile on the Marketing Overview, the
   * old sequences address or a bookmark opens it already narrowed.
   */
  const [sequences, setSequences] = useState<SequenceRecord[] | null>(null);
  const [sequenceError, setSequenceError] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = readEmailFilters(searchParams);
  const setFilters = useCallback(
    (next: Partial<EmailFilters>) =>
      setSearchParams(
        (current) => writeEmailFilters(current, { ...readEmailFilters(current), ...next }),
        { replace: true },
      ),
    [setSearchParams],
  );
  /** "New Email Campaign": the Broadcast / Sequence chooser. */
  const [chooser, setChooser] = useState<{ open: boolean; step: NewCampaignStep }>({
    open: false,
    step: "choose",
  });
  /** An imported email that has already gone out, open read-only. */
  const [previewing, setPreviewing] = useState<CampaignRecord | null>(null);
  const [managingTemplates, setManagingTemplates] = useState(false);
  const [sendMode, setSendMode] = useState<SendMode>("manual");
  const [events, setEvents] = useState<EventSummary[]>([]);
  /**
   * A1. Set by the first Save that is refused. From then on every field's
   * message is worked out live on each render, so it sits beside the field
   * while the problem exists and disappears the moment it is fixed.
   */
  const [showErrors, setShowErrors] = useState(false);
  /** A save in flight. A second press used to create a second copy of a new email. */
  const [saving, setSaving] = useState(false);
  const [confirm, confirmDialog] = useConfirm();

  /**
   * Opens the composer on a campaign, or on a blank one.
   *
   * Goes through one function so the timing picker cannot disagree with the
   * campaign it is showing — a new draft that inherited the last one's mode
   * would offer to schedule something against an event it was never pointed at.
   */
  const openDraft = useCallback((campaign?: Campaign, defaults?: Partial<Campaign>) => {
    const next: Partial<Campaign> =
      campaign ?? {
        audience: "all_subscribers",
        status: "draft",
        timezone: DEFAULT_TIMEZONE,
        ...defaults,
      };
    setSendMode(sendModeOf(next));
    setShowErrors(false);
    setDraft(next);
  }, []);

  /**
   * What clicking an email row does: imported history that has already gone
   * out opens read-only — it is a record of what Kajabi sent, not something to
   * edit or send again — and everything else opens in the editor as before.
   */
  const openCampaign = useCallback(
    (campaign: CampaignRecord) => {
      if (isReadOnlyCampaign(campaign)) setPreviewing(campaign);
      else openDraft(campaign);
    },
    [openDraft],
  );

  /** A new broadcast from inside a folder starts in that folder. */
  const newBroadcast = useCallback(() => {
    setChooser((current) => ({ ...current, open: false }));
    const folder = filters.folder && filters.folder !== UNFILED ? filters.folder : "";
    openDraft(undefined, folder ? { folder } : undefined);
  }, [filters.folder, openDraft]);

  const load = useCallback(() => {
    adminApi
      .growthList<CampaignRecord>("campaigns")
      .then((rows) => {
        setCampaigns(rows);
        setError(null);
      })
      .catch(() => {
        // Empty rather than null, so the sequences still list instead of the
        // table waiting forever on the half that failed.
        setCampaigns((current) => current ?? []);
        setError("We couldn't load your emails. Try refreshing the page.");
      });
    // A failure here costs the sequence rows, not the broadcasts — and says so,
    // rather than showing a list with its sequences silently missing.
    marketingApi
      .sequences()
      .then((rows) => {
        setSequences(rows as SequenceRecord[]);
        setSequenceError(null);
      })
      .catch(() => {
        setSequences((current) => current ?? []);
        setSequenceError("We couldn't load your sequences just now, so only broadcasts are listed.");
      });
  }, []);

  const allRows = useMemo(
    () => (campaigns && sequences ? mergeEmails(campaigns, sequences) : null),
    [campaigns, sequences],
  );
  const folders = useMemo(() => (allRows ? folderNames(allRows) : []), [allRows]);
  const folderCards = useMemo(() => (allRows ? folderSummaries(allRows) : []), [allRows]);
  const visibleRows = useMemo(
    () => (allRows ? filterEmails(allRows, readEmailFilters(searchParams)) : null),
    [allRows, searchParams],
  );
  // Inside a folder the folder is where she is, not a filter to clear.
  const filtering = Boolean(
    filters.kind || filters.status || (filters.view === "all" && filters.folder),
  );
  /** Folders tab with no folder chosen: the folder cards stand in for the table. */
  const showingFolderCards = filters.view === "folders" && !filters.folder;

  useEffect(load, [load]);

  /*
   * `?new=1` (or `broadcast` / `sequence`) opens "New Email Campaign" from a
   * link — the old sequences page's "New sequence" and the Marketing
   * Overview's buttons land here — and is then taken out of the address so a
   * refresh doesn't open it again.
   */
  useEffect(() => {
    const wanted = searchParams.get("new");
    if (!wanted) return;
    if (wanted === "broadcast") openDraft();
    else setChooser({ open: true, step: wanted === "sequence" ? "sequence" : "choose" });
    const next = new URLSearchParams(searchParams);
    next.delete("new");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams, openDraft]);

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
    if (!draft || saving) return;

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

    setSaving(true);
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

      const liveRegistration =
        draft.status === "sending" && draft.anchorKind === "event_registration";
      const wasArmed = draft.status === "scheduled" || liveRegistration;

      /*
       * A live "upon registration" campaign sits on `sending`, which neither
       * schedule route will re-arm — so editing its wording, or moving it to
       * another timing, saved the words and then failed with "wait for the
       * current send to finish". Unchanged, it is left running as it is:
       * re-arming would restamp the arming moment and drop everyone who
       * registered since and is still waiting out the delay. Changed, it is
       * switched off first so the new timing can be armed. The draft's anchor
       * fields are the ones being edited; the saved row is what is armed.
       */
      const armed = campaigns?.find((row) => row.id === draft.id);
      const offsetForMode =
        anchorOffsetMinutes ?? (sendMode === "event_start" ? -1440 : 0);
      const registrationUnchanged =
        liveRegistration &&
        sendMode === "event_registration" &&
        armed !== undefined &&
        anchorEventId === armed.anchorEventId &&
        offsetForMode === (armed.anchorOffsetMinutes ?? 0);
      if (liveRegistration && sendMode !== "manual" && !registrationUnchanged) {
        await adminApi.campaignCancelSchedule(campaign.id);
        // It is a draft on the server now; a retry after a failed re-arm must
        // not try to switch it off a second time.
        setDraft((current) =>
          current ? { ...current, status: "draft", anchorKind: "absolute" } : current,
        );
      }

      if (registrationUnchanged) {
        toast.success("Email saved — it carries on going to new registrations.");
      } else if (sendMode === "absolute" && scheduledAt) {
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
    } finally {
      setSaving(false);
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
          name: `${campaign.name || campaign.subject || "Untitled email"} (copy)`.slice(0, 200),
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
        setPreviewing(null);
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

  const removeSequence = useCallback(
    async (sequence: SequenceRecord) => {
      const ok = await confirm({
        title: `Delete ${sequence.name}?`,
        description:
          "The emails in it go too, along with the record of who has been through it. This cannot be undone.",
        confirmLabel: "Delete it",
        destructive: true,
      });
      if (!ok) return;
      try {
        await marketingApi.deleteSequence(sequence.id);
        toast.success("Sequence deleted");
        load();
      } catch (err) {
        toast.error(friendlyError(err, "sequence"));
      }
    },
    [confirm, load],
  );

  /*
   * Sheet row 67. One row type for every kind, laid out as Kajabi's list is:
   * the title with its type, folder and one line of what happened under it,
   * then Sends / Opened / Clicked / Unsubscribed, then the status pill. The
   * type is a badge under the title rather than a column of its own, which is
   * what kept the row's actions on screen at 1280px before (A3).
   */
  const columns = useMemo<ColumnDef<EmailRow, unknown>[]>(
    () => [
      {
        id: "name",
        // What the search box matches: the name, its folder and its subject.
        accessorFn: (row) =>
          row.source === "campaign"
            ? `${row.name} ${row.folder} ${row.campaign.subject}`
            : `${row.name} ${row.folder} ${row.sequence.description}`,
        header: "Email Campaign",
        cell: ({ row }) => {
          const item = row.original;
          const Icon = KIND_ICON[item.kind];
          const title = (
            <>
              <span className="block truncate font-semibold text-ink group-hover/title:text-gold">
                {item.name}
              </span>
              <span className="mt-0.5 flex min-w-0 flex-wrap items-center gap-1.5">
                <Badge tone={KIND_TONE[item.kind]} className="shrink-0">
                  <Icon className="size-3 shrink-0" aria-hidden="true" />
                  {EMAIL_KIND_LABEL[item.kind]}
                </Badge>
                {item.folder && (
                  <span className="inline-flex min-w-0 items-center gap-1 text-xs text-ink-soft">
                    <Folder className="size-3 shrink-0" aria-hidden="true" />
                    <span className="truncate">{item.folder}</span>
                  </span>
                )}
              </span>
              <span className="mt-0.5 block min-w-0">
                <EmailDescription row={item} />
              </span>
            </>
          );
          if (item.source === "sequence") {
            return (
              <Link
                to={`/admin/marketing/sequences/${item.sequence.id}`}
                className="group/title block min-w-0 max-w-[24rem] py-1 text-left"
              >
                {title}
              </Link>
            );
          }
          return (
            <button
              type="button"
              onClick={() => openCampaign(item.campaign)}
              className="group/title block min-w-0 max-w-[24rem] py-1 text-left"
            >
              {title}
            </button>
          );
        },
      },
      {
        id: "sends",
        enableGlobalFilter: false,
        accessorFn: (row) => row.stats.sends ?? -1,
        header: "Sends",
        cell: ({ row }) => (
          <span className="font-bold tabular-nums text-ink">
            {row.original.stats.sends === null ? "—" : formatNumber(row.original.stats.sends)}
          </span>
        ),
      },
      {
        id: "opened",
        enableGlobalFilter: false,
        accessorFn: (row) => ratio(row.stats.opened, row.stats.sends),
        header: "Opened",
        cell: ({ row }) => (
          <span className="tabular-nums text-ink">
            {percentOf(row.original.stats.opened, row.original.stats.sends)}
          </span>
        ),
      },
      {
        id: "clicked",
        enableGlobalFilter: false,
        accessorFn: (row) => ratio(row.stats.clicked, row.stats.sends),
        header: "Clicked",
        cell: ({ row }) => (
          <span className="tabular-nums text-ink">
            {percentOf(row.original.stats.clicked, row.original.stats.sends)}
          </span>
        ),
      },
      {
        id: "unsubscribed",
        enableGlobalFilter: false,
        accessorFn: (row) => ratio(row.stats.unsubscribed, row.stats.sends),
        header: "Unsubscribed",
        cell: ({ row }) => (
          <span className="tabular-nums text-ink">
            {percentOf(row.original.stats.unsubscribed, row.original.stats.sends)}
          </span>
        ),
      },
      {
        id: "status",
        accessorFn: (row) => statusLabelFor(row),
        header: "Status",
        cell: ({ row }) => (
          <Badge tone={STATUS_TONE[row.original.status]}>{statusLabelFor(row.original)}</Badge>
        ),
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        cell: ({ row }) => {
          const item = row.original;
          if (item.source === "sequence") {
            const sequence = item.sequence;
            return (
              <RowActions>
                <Button asChild size="sm" variant="secondary">
                  <Link to={`/admin/marketing/sequences/${sequence.id}`}>Open</Link>
                </Button>
                <Button
                  variant="dangerGhost"
                  size="iconSm"
                  aria-label={`Delete ${sequence.name}`}
                  onClick={() => void removeSequence(sequence)}
                >
                  <Trash2 />
                </Button>
              </RowActions>
            );
          }
          const campaign = item.campaign;
          return (
            <RowActions>
              {item.readOnly ? (
                <Button size="sm" variant="secondary" onClick={() => setPreviewing(campaign)}>
                  <Eye />
                  View
                </Button>
              ) : (
                campaign.status !== "sent" &&
                campaign.status !== "sending" && (
                  <Button size="sm" onClick={() => send(campaign)}>
                    <Send />
                    Send
                  </Button>
                )
              )}
              {!item.readOnly &&
                (campaign.status === "scheduled" ||
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
                aria-label={`Make a copy of ${item.name}`}
                onClick={() => duplicate(campaign)}
              >
                <Copy />
              </Button>
              <Button
                variant="dangerGhost"
                size="iconSm"
                aria-label={`Delete ${item.name}`}
                onClick={() => remove({ ...campaign, name: item.name })}
              >
                <Trash2 />
              </Button>
            </RowActions>
          );
        },
      },
    ],
    [send, remove, removeSequence, duplicate, openCampaign, load],
  );

  const clearFilters = () =>
    setFilters(filters.view === "folders" ? { kind: "", status: "" } : { ...NO_FILTERS });

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Marketing"
        title="Email Campaigns"
        description="Everything you email people, in one list — one-time broadcasts, the sequences that run on their own, and your event emails."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => setManagingTemplates(true)}>
              <LayoutTemplate />
              Manage Templates
            </Button>
            <Button size="sm" onClick={() => setChooser({ open: true, step: "choose" })}>
              <Plus />
              New Email Campaign
            </Button>
          </div>
        }
      />

      {error && <ErrorNotice message={error} />}
      {sequenceError && <ErrorNotice message={sequenceError} />}

      {/* All emails / Folders — Kajabi's two views of the same list. */}
      <div role="tablist" aria-label="How to list your emails" className="flex gap-1 border-b border-hairline/60">
        {(["all", "folders"] as const).map((view) => {
          const selected = filters.view === view;
          return (
            <button
              key={view}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setFilters({ view, folder: "" })}
              className={cn(
                "-mb-px min-h-11 border-b-2 px-4 text-sm font-semibold transition-colors",
                selected
                  ? "border-gold text-ink"
                  : "border-transparent text-ink-soft hover:text-ink",
              )}
            >
              {view === "all" ? "All emails" : "Folders"}
            </button>
          );
        })}
      </div>

      {filters.view === "folders" && filters.folder && (
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => setFilters({ folder: "" })}>
            <ArrowLeft />
            All folders
          </Button>
          <h2 className="flex items-center gap-2 font-semibold text-ink">
            <Folder className="size-4 text-gold" aria-hidden="true" />
            {filters.folder === UNFILED ? "Unfiled" : filters.folder}
          </h2>
        </div>
      )}

      {showingFolderCards ? (
        allRows === null ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2].map((key) => (
              <Skeleton key={key} className="h-28 rounded-2xl" />
            ))}
          </div>
        ) : folderCards.length === 0 ? (
          <Card>
            <EmptyState
              icon={<Folder />}
              title="No emails yet"
              description="Give an email or a sequence a folder and it will be grouped here."
            />
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {folderCards.map((folder) => {
              const kinds = EMAIL_KINDS.filter((kind) => folder.byKind[kind] > 0);
              return (
                <button
                  key={folder.name}
                  type="button"
                  onClick={() => setFilters({ folder: folder.name })}
                  className="flex flex-col gap-2 rounded-2xl border border-hairline bg-surface p-5 text-left transition-colors hover:border-gold/45 hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-gold/20"
                >
                  <span className="flex min-w-0 items-center gap-2 font-semibold text-ink">
                    <Folder className="size-4 shrink-0 text-gold" aria-hidden="true" />
                    <span className="truncate">{folder.name === UNFILED ? "Unfiled" : folder.name}</span>
                  </span>
                  <span className="text-sm text-ink-soft">
                    {pluralize(folder.total, "email")}
                    {kinds.length > 1 &&
                      ` — ${kinds
                        .map((kind) => `${folder.byKind[kind]} ${KIND_FILTER_LABEL[kind].toLowerCase()}`)
                        .join(", ")}`}
                  </span>
                </button>
              );
            })}
          </div>
        )
      ) : (
        <DataTable
          columns={columns}
          data={visibleRows}
          searchPlaceholder="Search email campaigns…"
          itemNoun={{ one: "email campaign", many: "email campaigns" }}
          initialPageSize={25}
          minWidth="1080px"
          columnWidths={{
            name: "36%",
            sends: "88px",
            opened: "92px",
            clicked: "92px",
            unsubscribed: "124px",
            status: "128px",
            actions: "200px",
          }}
          toolbar={
            <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter the list">
              <select
                aria-label="Type"
                className={`${selectStyles} h-11 w-auto min-w-[9rem]`}
                value={filters.kind}
                onChange={(event) => {
                  const kind = event.target.value as EmailFilters["kind"];
                  // A status the new type can't be in would leave an empty list
                  // with no visible reason, so it is dropped with the switch.
                  const keepStatus =
                    !filters.status || statusOptionsFor(kind).includes(filters.status as EmailStatus);
                  setFilters({ kind, status: keepStatus ? filters.status : "" });
                }}
              >
                <option value="">All types</option>
                {EMAIL_KINDS.map((kind) => (
                  <option key={kind} value={kind}>{KIND_FILTER_LABEL[kind]}</option>
                ))}
              </select>
              <select
                aria-label="Status"
                className={`${selectStyles} h-11 w-auto min-w-[9rem]`}
                value={filters.status}
                onChange={(event) =>
                  setFilters({ status: event.target.value as EmailFilters["status"] })
                }
              >
                <option value="">All statuses</option>
                {statusOptionsFor(filters.kind).map((status) => (
                  <option key={status} value={status}>
                    {statusLabelFor({ kind: filters.kind || "broadcast", status })}
                  </option>
                ))}
              </select>
              {filters.view === "all" && (
                <select
                  aria-label="Folder"
                  className={`${selectStyles} h-11 w-auto min-w-[9rem]`}
                  value={filters.folder}
                  onChange={(event) => setFilters({ folder: event.target.value })}
                >
                  <option value="">All folders</option>
                  <option value={UNFILED}>Unfiled</option>
                  {/* A folder named in a link but empty here still shows as chosen. */}
                  {[
                    ...new Set([
                      ...folders,
                      ...(filters.folder && filters.folder !== UNFILED ? [filters.folder] : []),
                    ]),
                  ].map((folder) => (
                    <option key={folder} value={folder}>{folder}</option>
                  ))}
                </select>
              )}
              {filtering && (
                <Button variant="ghost" size="sm" onClick={clearFilters}>
                  Clear filters
                </Button>
              )}
            </div>
          }
          emptyState={
            (filtering || filters.view === "folders") && (allRows?.length ?? 0) > 0 ? (
              <EmptyState
                icon={<Megaphone />}
                title="Nothing matches these filters"
                description="Try another type or status — or clear the filters to see everything."
                action={
                  filtering ? (
                    <Button size="sm" variant="secondary" onClick={clearFilters}>
                      Clear filters
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <EmptyState
                icon={<Megaphone />}
                title="No email campaigns yet"
                description="Send a one-time broadcast to your subscribers, members or enquiries, or build a sequence that runs on its own."
                action={
                  <Button size="sm" onClick={() => setChooser({ open: true, step: "choose" })}>
                    <Plus />
                    New Email Campaign
                  </Button>
                }
              />
            )
          }
        />
      )}

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
            <Button size="sm" type="submit" form="campaign-form" disabled={saving}>
              {saving ? "Saving…" : "Save email"}
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
                  <strong className="font-bold tabular-nums text-lg text-plum">
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
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_10rem]">
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
                source="broadcast"
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
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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

      <NewCampaignDialog
        open={chooser.open}
        initialStep={chooser.step}
        onOpenChange={(open) => setChooser((current) => ({ ...current, open }))}
        onChooseBroadcast={newBroadcast}
        onSequenceCreated={(sequence) => {
          setChooser({ open: false, step: "choose" });
          navigate(`/admin/marketing/sequences/${sequence.id}`);
        }}
      />

      <CampaignPreview
        campaign={previewing}
        onOpenChange={(open) => !open && setPreviewing(null)}
        onDuplicate={(campaign) => void duplicate(campaign)}
      />

      <ManageTemplatesDialog open={managingTemplates} onOpenChange={setManagingTemplates} />

      {confirmDialog}
    </div>
  );
}
