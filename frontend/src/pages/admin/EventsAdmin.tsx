import { publicSiteUrl } from "@/lib/siteOrigins";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router";
import type { ColumnDef } from "@tanstack/react-table";
import {
  AlertTriangle,
  BellRing,
  CalendarClock,
  Copy,
  MapPin,
  Pencil,
  Plus,
  Repeat,
  RotateCcw,
  Tags,
  Trash2,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { ApiError } from "@/lib/api";
import {
  CADENCE_CHOICES,
  EVENT_DEFAULT_TIMEZONE,
  MAX_OCCURRENCES,
  RECURRENCE_FREQ_CHOICES,
  REMINDER_CHOICES,
  EVENT_KIND_HINT,
  EVENT_KIND_LABEL,
  describeCadence,
  describeRecurrence,
  describeReminderOffset,
  describeStart,
  eventsAdminApi,
  type EventDetail,
  type EventDraft,
  type EventKind,
  type EventReminderWithStats,
  type EventReport,
  type EventSummary,
  type LocationType,
  type RecurrenceFreq,
  type ReminderKind,
  type Registrant,
} from "@/lib/eventsApi";
import { isoToWallClock, wallClockToIso } from "@/lib/zonedDateTime";
import { contactsApi, money, type Tag } from "@/lib/contactsApi";
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
  Skeleton,
  Textarea,
} from "@/pages/admin/ui/primitives";
import { DataTable, RowActions } from "@/pages/admin/ui/DataTable";
import { Modal, useConfirm } from "@/pages/admin/ui/Dialog";
import { friendlyError, pluralize, publishLabel, webAddress } from "@/pages/admin/ui/friendly";

/**
 * Events — webinars, workshops and recordings — with the people who signed up
 * for each one.
 *
 * The three kinds behave differently enough that the raw words for them are
 * useless on their own: "evergreen" means a session starts a few minutes after
 * each person registers, which is a sentence, not a label. Every kind is
 * therefore shown as its label plus that sentence, and the registrant list
 * prints the session time the server already worked out in the event's own
 * zone rather than re-deriving it in the browser's.
 */

const checkboxStyles = "size-4 rounded border-hairline text-plum focus-visible:ring-plum/30";

const EVENT_KINDS: EventKind[] = ["live", "evergreen", "replay"];

const TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Europe/London",
  "Australia/Sydney",
];

const DEFAULT_TIMEZONE = EVENT_DEFAULT_TIMEZONE;

/** The rule on a summary row, in the shape `describeRecurrence` takes. */
function ruleOf(event: EventSummary) {
  if (event.kind !== "live" || !event.recurrenceFreq) return null;
  return {
    freq: event.recurrenceFreq,
    interval: event.recurrenceInterval ?? 1,
    until: event.recurrenceUntil ?? null,
    count: event.recurrenceCount ?? null,
  };
}

/** When this event happens, whichever kind it is. */
function whenLabel(event: EventSummary): string {
  if (event.kind === "evergreen") {
    return describeCadence(event.evergreenIntervalMinutes) || "No cadence set";
  }
  if (event.kind === "replay") return "As soon as they sign up";
  const start = describeStart(event.startsAt, event.timezone);
  const rule = ruleOf(event);
  return rule ? `From ${start} · ${describeRecurrence(rule).toLowerCase()}` : start;
}

/**
 * Whether an event still has something to come, for `?when=upcoming`.
 *
 * A live session counts until it has finished; a series until its last session
 * could have finished; an always-on event always counts, because a session
 * starts shortly after anyone signs up; a recording never does, because there
 * is nothing to wait for. A series with a count is judged on the longest a
 * month can be, so it errs towards showing an event rather than hiding one.
 */
function isStillToCome(event: EventSummary, now: number): boolean {
  if (event.kind === "evergreen") return true;
  if (event.kind === "replay" || !event.startsAt) return false;
  const start = new Date(event.startsAt).getTime();
  const length = event.durationMinutes * 60_000;
  const rule = ruleOf(event);
  if (!rule) return start + length >= now;
  if (rule.until) {
    // The end date is a calendar day in the event's zone; a day's grace covers
    // every zone's idea of when that day is over.
    return new Date(`${rule.until}T23:59:59Z`).getTime() + 86_400_000 >= now;
  }
  const days = { daily: 1, weekly: 7, monthly: 31 }[rule.freq];
  const lastStart = start + ((rule.count ?? 1) - 1) * rule.interval * days * 86_400_000;
  return lastStart + length >= now;
}

/* ── Repeats and location ───────────────────────────────────────────────── */

/** The repeat rule as the form holds it: strings, because they come straight from inputs. */
interface RepeatForm {
  on: boolean;
  freq: RecurrenceFreq;
  interval: string;
  ends: "count" | "until";
  count: string;
  /** YYYY-MM-DD, the last date a session may fall on. */
  until: string;
}

const NO_REPEAT: RepeatForm = {
  on: false,
  freq: "weekly",
  interval: "1",
  ends: "count",
  count: "6",
  until: "",
};

type RepeatDraft = Pick<
  EventDraft,
  "recurrenceFreq" | "recurrenceInterval" | "recurrenceUntil" | "recurrenceCount"
>;

function repeatFromDetail(event: EventSummary): RepeatForm {
  if (!event.recurrenceFreq) return { ...NO_REPEAT };
  return {
    on: true,
    freq: event.recurrenceFreq,
    interval: String(event.recurrenceInterval ?? 1),
    ends: event.recurrenceUntil ? "until" : "count",
    count: event.recurrenceCount ? String(event.recurrenceCount) : NO_REPEAT.count,
    until: event.recurrenceUntil ?? "",
  };
}

/**
 * The form's rule as the API takes it, or the sentence saying what is missing.
 * The server checks the rest (an end date before the first session, more than
 * 200 sessions) and its sentence is shown the same way.
 */
function repeatToDraft(repeat: RepeatForm): { draft: RepeatDraft } | { problem: string } {
  if (!repeat.on) {
    return {
      draft: { recurrenceFreq: null, recurrenceUntil: null, recurrenceCount: null, recurrenceInterval: 1 },
    };
  }
  const interval = Number(repeat.interval);
  if (!Number.isInteger(interval) || interval < 1 || interval > 99) {
    return { problem: "Repeat every 1 to 99 — a whole number." };
  }
  if (repeat.ends === "count") {
    const count = Number(repeat.count);
    if (!Number.isInteger(count) || count < 1 || count > MAX_OCCURRENCES) {
      return { problem: `Say how many sessions there are in all, from 1 to ${MAX_OCCURRENCES}.` };
    }
    return {
      draft: {
        recurrenceFreq: repeat.freq,
        recurrenceInterval: interval,
        recurrenceCount: count,
        recurrenceUntil: null,
      },
    };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(repeat.until)) {
    return { problem: "Pick the last date a session can fall on." };
  }
  return {
    draft: {
      recurrenceFreq: repeat.freq,
      recurrenceInterval: interval,
      recurrenceUntil: repeat.until,
      recurrenceCount: null,
    },
  };
}

/** A 400's own sentence when there is one; the friendly fallback otherwise. */
function saveProblem(err: unknown, noun: string): string {
  return err instanceof ApiError && err.status === 400 && err.message
    ? err.message
    : friendlyError(err, noun);
}

/* ── The settings form ──────────────────────────────────────────────────── */

interface EventForm {
  title: string;
  descriptionMd: string;
  kind: EventKind;
  /** Wall-clock time in the event's own zone, as the date box writes it. */
  startsLocal: string;
  durationMinutes: string;
  timezone: string;
  cadenceMinutes: number;
  roomUrl: string;
  replayUrl: string;
  replayExpiresAfterHours: string;
  applyTagIds: number[];
  attendedTagId: number | null;
  noShowTagId: number | null;
  published: boolean;
  repeat: RepeatForm;
  locationType: LocationType;
  locationAddress: string;
}

function formFromDetail(detail: EventDetail): EventForm {
  const timezone = detail.timezone || DEFAULT_TIMEZONE;
  return {
    title: detail.title,
    descriptionMd: detail.descriptionMd,
    kind: detail.kind,
    startsLocal: isoToWallClock(detail.startsAt, timezone),
    durationMinutes: String(detail.durationMinutes),
    timezone,
    cadenceMinutes: detail.evergreenIntervalMinutes ?? 15,
    roomUrl: detail.roomUrl,
    replayUrl: detail.replayUrl,
    replayExpiresAfterHours:
      detail.replayExpiresAfterHours === null ? "" : String(detail.replayExpiresAfterHours),
    applyTagIds: detail.applyTagIds ?? [],
    attendedTagId: detail.attendedTagId,
    noShowTagId: detail.noShowTagId,
    published: detail.published,
    repeat: repeatFromDetail(detail),
    locationType: detail.locationType ?? "online",
    locationAddress: detail.locationAddress ?? "",
  };
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-hairline bg-white/[0.03] px-4 py-3">
      <p className="text-xs text-ink-soft">{label}</p>
      <p className="mt-1 font-display text-xl text-ink">{value}</p>
    </div>
  );
}

/** The radio group of kinds, shared by the add box and the settings form. */
function KindChoice({
  value,
  onChange,
  name,
}: {
  value: EventKind;
  onChange: (kind: EventKind) => void;
  name: string;
}) {
  return (
    <fieldset className="grid gap-2.5">
      <legend className="mb-1.5 text-[0.8rem] font-semibold text-ink">
        What sort of event is it?
      </legend>
      {EVENT_KINDS.map((kind) => (
        <label
          key={kind}
          className={`flex cursor-pointer gap-3 rounded-xl border p-3.5 transition-colors ${
            value === kind
              ? "border-gold/50 bg-gold/[0.08]"
              : "border-hairline bg-white/[0.03] hover:border-white/20"
          }`}
        >
          <input
            type="radio"
            name={name}
            value={kind}
            checked={value === kind}
            onChange={() => onChange(kind)}
            className="mt-0.5 size-4 border-hairline text-plum focus-visible:ring-plum/30"
          />
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-ink">{EVENT_KIND_LABEL[kind]}</span>
            <span className="mt-0.5 block text-xs text-ink-soft">{EVENT_KIND_HINT[kind]}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

/**
 * The repeat rule: how often, every how many, and when it stops.
 *
 * Shared by the add box and the settings form. The sentence underneath is the
 * rule read back in words — or, when something is missing, what is missing —
 * so a save never fails without saying why.
 */
function RepeatFields({
  value,
  onChange,
  error,
}: {
  value: RepeatForm;
  onChange: (value: RepeatForm) => void;
  error?: string | null;
}) {
  const unit = RECURRENCE_FREQ_CHOICES.find((choice) => choice.value === value.freq)?.unit ?? "week";
  const parsed = repeatToDraft(value);
  const preview =
    value.on && "draft" in parsed && parsed.draft.recurrenceFreq
      ? describeRecurrence({
          freq: parsed.draft.recurrenceFreq,
          interval: parsed.draft.recurrenceInterval ?? 1,
          until: parsed.draft.recurrenceUntil ?? null,
          count: parsed.draft.recurrenceCount ?? null,
        })
      : "";

  return (
    <div className="grid gap-3 rounded-xl border border-hairline bg-white/[0.03] p-3.5">
      <label className="flex cursor-pointer items-start gap-2.5 text-sm text-ink">
        <input
          type="checkbox"
          className={`mt-0.5 ${checkboxStyles}`}
          checked={value.on}
          onChange={(event) => onChange({ ...value, on: event.target.checked })}
        />
        <span>
          <span className="flex items-center gap-1.5 font-semibold">
            <Repeat aria-hidden className="size-3.5" />
            Repeat this event
          </span>
          <span className="mt-0.5 block text-xs text-ink-soft">
            One sign-up covers every session: each one goes into their calendar, and the
            reminders go out before each.
          </span>
        </span>
      </label>

      {value.on && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="How often">
            <select
              className={selectStyles}
              aria-label="How often it repeats"
              value={value.freq}
              onChange={(event) =>
                onChange({ ...value, freq: event.target.value as RecurrenceFreq })
              }
            >
              {RECURRENCE_FREQ_CHOICES.map((choice) => (
                <option key={choice.value} value={choice.value}>
                  {choice.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label={`Every how many ${unit}s`} hint="1 is every one">
            <Input
              inputMode="numeric"
              aria-label={`Every how many ${unit}s`}
              value={value.interval}
              onChange={(event) =>
                onChange({ ...value, interval: event.target.value.replace(/[^0-9]/g, "") })
              }
            />
          </Field>
          <Field label="When do the repeats stop?">
            <select
              className={selectStyles}
              aria-label="When the repeats stop"
              value={value.ends}
              onChange={(event) =>
                onChange({ ...value, ends: event.target.value as RepeatForm["ends"] })
              }
            >
              <option value="count">After a number of sessions</option>
              <option value="until">On a date</option>
            </select>
          </Field>
          {value.ends === "count" ? (
            <Field label="How many sessions in all" hint="the first one included">
              <Input
                inputMode="numeric"
                aria-label="How many sessions in all"
                value={value.count}
                onChange={(event) =>
                  onChange({ ...value, count: event.target.value.replace(/[^0-9]/g, "") })
                }
              />
            </Field>
          ) : (
            <Field label="The last date a session can fall on" hint="in the event’s time zone">
              <Input
                type="date"
                aria-label="The last date a session can fall on"
                value={value.until}
                onChange={(event) => onChange({ ...value, until: event.target.value })}
              />
            </Field>
          )}
        </div>
      )}

      {value.on &&
        (error ? (
          <p role="alert" className="text-sm font-semibold text-red-400">
            {error}
          </p>
        ) : preview ? (
          <p className="text-sm text-ink-soft">{preview}.</p>
        ) : null)}
    </div>
  );
}

/** Online, or in person at an address. */
function LocationFields({
  name,
  type,
  address,
  onChange,
  error,
}: {
  name: string;
  type: LocationType;
  address: string;
  onChange: (type: LocationType, address: string) => void;
  error?: string | null;
}) {
  const options: { value: LocationType; label: string; hint: string }[] = [
    { value: "online", label: "Online", hint: "People join on your link." },
    { value: "in_person", label: "In person", hint: "At an address you give below." },
  ];
  return (
    <fieldset className="grid gap-2.5">
      <legend className="mb-1.5 text-[0.8rem] font-semibold text-ink">Where does it happen?</legend>
      <div className="grid gap-2.5 sm:grid-cols-2">
        {options.map((option) => (
          <label
            key={option.value}
            className={`flex cursor-pointer gap-3 rounded-xl border p-3.5 transition-colors ${
              type === option.value
                ? "border-gold/50 bg-gold/[0.08]"
                : "border-hairline bg-white/[0.03] hover:border-white/20"
            }`}
          >
            <input
              type="radio"
              name={`${name}-location`}
              value={option.value}
              checked={type === option.value}
              onChange={() => onChange(option.value, address)}
              className="mt-0.5 size-4 border-hairline text-plum focus-visible:ring-plum/30"
            />
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-ink">{option.label}</span>
              <span className="mt-0.5 block text-xs text-ink-soft">{option.hint}</span>
            </span>
          </label>
        ))}
      </div>
      {type === "in_person" && (
        <Field
          label="The address"
          hint="shown on the event page and in their calendar"
          error={error ?? undefined}
        >
          <Textarea
            rows={2}
            aria-label="The address"
            value={address}
            onChange={(event) => onChange(type, event.target.value)}
            placeholder="12 Main St, Suite 4, Austin, TX 78701"
          />
        </Field>
      )}
    </fieldset>
  );
}

/** How many saved sessions the editor lists before "and N more". */
const SESSIONS_SHOWN = 24;

/** The "you choose" entry in the add-a-reminder dropdown. */
const CUSTOM_REMINDER = -1;

/* ── Reminders ──────────────────────────────────────────────────────────── */

/**
 * The reminders one event sends, and what has happened to them.
 *
 * This panel is the whole point of the change it arrived with. The public event
 * page has always said "I'll hold you a place and remind you before we start"
 * and the confirmation said "I'll send you a reminder before we begin" — and
 * there was nothing in this editor about reminders at all. Three steps were
 * hard-coded in a job file, no confirmation was ever actually sent, and there
 * was no way to see whether any of it worked.
 *
 * Sent and arrived are shown as separate numbers on purpose. They are two
 * different facts, and the gap between them is the only visible symptom of a
 * sending problem — which is not hypothetical: while the sending account is
 * suspended, every one of these lands on "couldn't send" with the provider's
 * own words attached, which is what somebody needs in order to fix it.
 */
function ReminderRow({
  reminder,
  timezone,
  onToggle,
  onRetry,
  onRemove,
  busy,
}: {
  reminder: EventReminderWithStats;
  /** The event's own zone, so "next" is read on the same clock as its start. */
  timezone: string;
  onToggle: (enabled: boolean) => void;
  onRetry: () => void;
  onRemove: () => void;
  busy: boolean;
}) {
  const { stats } = reminder;
  const nothingYet =
    stats.queued === 0 && stats.sent === 0 && stats.failed === 0 && stats.skipped === 0;

  return (
    <li className="rounded-xl border border-hairline bg-white/[0.03] p-3.5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <label className="flex min-w-0 cursor-pointer items-start gap-2.5">
          <input
            type="checkbox"
            className={`mt-0.5 ${checkboxStyles}`}
            checked={reminder.enabled}
            disabled={busy}
            onChange={(event) => onToggle(event.target.checked)}
          />
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-ink">
              {reminder.kind === "registration"
                ? "A confirmation, as soon as they sign up"
                : `A reminder ${reminder.label}`}
            </span>
            <span className="mt-0.5 block text-xs text-ink-soft">
              {reminder.enabled
                ? reminder.kind === "registration"
                  ? "Goes out while the thank-you page is still on their screen."
                  : "Counted back from each person’s own session time, in this event’s time zone."
                : "Switched off — nobody gets this one."}
            </span>
          </span>
        </label>

        <div className="flex shrink-0 items-center gap-1.5">
          {stats.failed > 0 && (
            <Button variant="secondary" size="sm" disabled={busy} onClick={onRetry}>
              <RotateCcw />
              Try again
            </Button>
          )}
          <Button
            variant="secondary"
            size="sm"
            disabled={busy}
            aria-label={`Remove the reminder ${reminder.label}`}
            onClick={onRemove}
          >
            <Trash2 />
          </Button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        {nothingYet ? (
          <span className="text-ink-soft">Nothing to send yet.</span>
        ) : (
          <>
            {stats.queued > 0 && (
              <span className="text-ink-soft">
                {stats.queued} waiting
                {stats.nextAt ? ` — next ${describeStart(stats.nextAt, timezone)}` : ""}
              </span>
            )}
            {stats.sent > 0 && (
              <span className="text-ink-soft">
                {stats.sent} sent
                {/* Accepted by the provider is not the same as arrived, and while
                    sending is broken the difference is the only thing worth
                    looking at. */}
                {stats.delivered > 0 && `, ${stats.delivered} arrived`}
                {stats.bounced > 0 && `, ${stats.bounced} bounced back`}
              </span>
            )}
            {stats.skipped > 0 && (
              <span className="text-ink-soft">{stats.skipped} skipped</span>
            )}
            {stats.failed > 0 && (
              <span className="inline-flex items-center gap-1 font-semibold text-red-400">
                <AlertTriangle aria-hidden className="size-3.5" />
                {stats.failed} couldn’t send
              </span>
            )}
          </>
        )}
      </div>

      {stats.lastProblem && (
        <p className="mt-2 break-words rounded-lg bg-white/[0.04] px-2.5 py-2 text-xs text-ink-soft">
          Last problem: {stats.lastProblem}
        </p>
      )}
    </li>
  );
}

/* ── The screen ─────────────────────────────────────────────────────────── */

export default function EventsAdmin() {
  const [events, setEvents] = useState<EventSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tags, setTags] = useState<Tag[]>([]);
  const [confirm, confirmDialog] = useConfirm();

  const [openId, setOpenId] = useState<number | null>(null);
  const [detail, setDetail] = useState<EventDetail | null>(null);
  const [form, setForm] = useState<EventForm | null>(null);
  const [problems, setProblems] = useState<{
    title?: string;
    startsAt?: string;
    duration?: string;
    repeat?: string;
    address?: string;
    /** The server's own sentence when it refused the save. */
    server?: string;
  }>({});
  const [registrants, setRegistrants] = useState<Registrant[] | null>(null);
  const [report, setReport] = useState<EventReport | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);

  const [reminderBusy, setReminderBusy] = useState(false);
  const [newReminder, setNewReminder] = useState(3);
  const [customAmount, setCustomAmount] = useState("2");
  const [customUnit, setCustomUnit] = useState<"hours" | "days">("hours");
  const [reminderProblem, setReminderProblem] = useState<string | null>(null);

  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newKind, setNewKind] = useState<EventKind>("live");
  const [newStarts, setNewStarts] = useState("");
  const [newCadence, setNewCadence] = useState(15);
  const [newProblem, setNewProblem] = useState<string | null>(null);
  const [newRepeat, setNewRepeat] = useState<RepeatForm>({ ...NO_REPEAT });
  const [newRepeatProblem, setNewRepeatProblem] = useState<string | null>(null);
  const [newLocationType, setNewLocationType] = useState<LocationType>("online");
  const [newAddress, setNewAddress] = useState("");
  const [newAddressProblem, setNewAddressProblem] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const loadList = useCallback(() => {
    eventsAdminApi
      .list()
      .then((rows) => {
        setEvents(rows);
        setError(null);
      })
      .catch(() => setError("We couldn’t load your events. Try refreshing the page."));
  }, []);

  useEffect(loadList, [loadList]);

  /*
   * Deep links, for the Marketing Overview's tiles and anything else that
   * points here: `?when=upcoming` narrows the list to events still to come, and
   * `?event=<id>` opens that event. Both say what they did — a filtered list
   * that looks like the whole list is how somebody concludes an event vanished.
   */
  const [searchParams, setSearchParams] = useSearchParams();
  const whenFilter = searchParams.get("when") === "upcoming" ? "upcoming" : null;
  const linkedEventId = Number(searchParams.get("event")) || null;
  const [linkProblem, setLinkProblem] = useState<string | null>(null);
  const openedFromLink = useRef<number | null>(null);

  const visibleEvents = useMemo(() => {
    if (events === null || whenFilter !== "upcoming") return events;
    const now = Date.now();
    return events.filter((row) => isStillToCome(row, now));
  }, [events, whenFilter]);

  function clearParam(name: string) {
    const next = new URLSearchParams(searchParams);
    next.delete(name);
    setSearchParams(next, { replace: true });
  }

  useEffect(() => {
    if (linkedEventId === null) {
      openedFromLink.current = null;
      return;
    }
    if (events === null || openedFromLink.current === linkedEventId) return;
    openedFromLink.current = linkedEventId;
    if (events.some((row) => row.id === linkedEventId)) {
      setLinkProblem(null);
      open(linkedEventId);
    } else {
      setLinkProblem("The event in that link isn’t here any more — it may have been deleted.");
    }
    // `open` is a plain function redefined each render; the id and the loaded
    // list are what decide whether to act.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, linkedEventId]);

  useEffect(() => {
    contactsApi.tags().then(setTags).catch(() => setTags([]));
  }, []);

  const loadDetail = useCallback((id: number) => {
    eventsAdminApi
      .get(id)
      .then((row) => {
        setDetail(row);
        setForm(formFromDetail(row));
      })
      .catch((err) => toast.error(friendlyError(err, "event")));
    eventsAdminApi.registrations(id).then(setRegistrants).catch(() => setRegistrants([]));
    eventsAdminApi.report(id).then(setReport).catch(() => setReport(null));
  }, []);

  function open(id: number) {
    setOpenId(id);
    setDetail(null);
    setForm(null);
    setProblems({});
    setRegistrants(null);
    setReport(null);
    setSelected([]);
    loadDetail(id);
  }

  function close() {
    setOpenId(null);
    setDetail(null);
    setForm(null);
    // A link that opened this event has done its job; left on the address it
    // would reopen the event on every refresh.
    if (searchParams.has("event")) clearParam("event");
  }

  /* Creating ------------------------------------------------------------- */

  function startNew() {
    setNewTitle("");
    setNewKind("live");
    setNewStarts("");
    setNewCadence(15);
    setNewProblem(null);
    setNewRepeat({ ...NO_REPEAT });
    setNewRepeatProblem(null);
    setNewLocationType("online");
    setNewAddress("");
    setNewAddressProblem(null);
    setCreateError(null);
    setAdding(true);
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    const title = newTitle.trim();
    if (!title) {
      setCreateError("Give this event a name.");
      return;
    }
    setCreateError(null);

    // Every problem is found and shown at once, next to its own field, rather
    // than the first one ending the save and hiding the rest.
    let blocked = false;
    const draft: EventDraft & { title: string } = { title, kind: newKind };
    if (newKind === "live") {
      const iso = wallClockToIso(newStarts, DEFAULT_TIMEZONE);
      if (!iso) {
        setNewProblem("Pick the date and time this event happens.");
        blocked = true;
      } else {
        setNewProblem(null);
        draft.startsAt = iso;
        draft.timezone = DEFAULT_TIMEZONE;
      }
      const repeat = repeatToDraft(newRepeat);
      if ("problem" in repeat) {
        setNewRepeatProblem(repeat.problem);
        blocked = true;
      } else {
        setNewRepeatProblem(null);
        Object.assign(draft, repeat.draft);
      }
    }
    if (newKind === "evergreen") draft.evergreenIntervalMinutes = newCadence;
    if (newLocationType === "in_person" && !newAddress.trim()) {
      setNewAddressProblem("Add the address, so people know where to go.");
      blocked = true;
    } else {
      setNewAddressProblem(null);
    }
    if (blocked) {
      setCreateError("Some details need a look — they’re marked in red above.");
      return;
    }
    draft.locationType = newLocationType;
    draft.locationAddress = newLocationType === "in_person" ? newAddress.trim() : "";

    setCreating(true);
    try {
      const created = await eventsAdminApi.create(draft);
      setAdding(false);
      loadList();
      open(created.id);
    } catch (err) {
      const message = saveProblem(err, "event");
      setCreateError(message);
      toast.error(message);
    } finally {
      setCreating(false);
    }
  }

  /* Saving --------------------------------------------------------------- */

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!form || openId === null) return;

    const found: typeof problems = {};
    if (!form.title.trim()) found.title = "Give this event a name.";

    const duration = Number(form.durationMinutes);
    if (!Number.isFinite(duration) || duration < 5 || duration > 1440) {
      found.duration = "Somewhere between 5 minutes and a whole day.";
    }

    const startsAt = form.kind === "live" ? wallClockToIso(form.startsLocal, form.timezone) : null;
    if (form.kind === "live" && !startsAt) {
      found.startsAt = "Pick the date and time it happens.";
    }

    // Only a live event repeats; switching kind switches the rule off with it.
    const repeat: { draft: RepeatDraft } | { problem: string } =
      form.kind === "live" ? repeatToDraft(form.repeat) : repeatToDraft(NO_REPEAT);
    if ("problem" in repeat) found.repeat = repeat.problem;
    if (form.locationType === "in_person" && !form.locationAddress.trim()) {
      found.address = "Add the address, so people know where to go.";
    }

    setProblems(found);
    if (Object.keys(found).length > 0) {
      // The editor is long; the red text may be a scroll away from the button.
      toast.error("Some details need a look before this saves — they’re marked in red.");
      return;
    }

    const expiry = form.replayExpiresAfterHours.trim();
    const draft: EventDraft = {
      title: form.title.trim(),
      descriptionMd: form.descriptionMd,
      kind: form.kind,
      durationMinutes: Math.round(duration),
      timezone: form.timezone,
      roomUrl: form.roomUrl.trim(),
      replayUrl: form.replayUrl.trim(),
      replayExpiresAfterHours: expiry === "" ? null : Number(expiry),
      applyTagIds: form.applyTagIds,
      attendedTagId: form.attendedTagId,
      noShowTagId: form.noShowTagId,
      published: form.published,
      ...("draft" in repeat ? repeat.draft : {}),
      locationType: form.locationType,
      locationAddress: form.locationType === "in_person" ? form.locationAddress.trim() : "",
    };
    if (startsAt) draft.startsAt = startsAt;
    if (form.kind === "evergreen") draft.evergreenIntervalMinutes = form.cadenceMinutes;

    setSaving(true);
    try {
      await eventsAdminApi.update(openId, draft);
      toast.success("Event saved");
      loadList();
      loadDetail(openId);
    } catch (err) {
      const message = saveProblem(err, "event");
      setProblems({ server: message });
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  const remove = useCallback(
    async (event: EventSummary) => {
      const ok = await confirm({
        title: `Delete the ${event.title} event?`,
        description:
          "Everyone who signed up goes with it, along with the record of who turned up. You can’t undo this.",
        confirmLabel: "Yes, delete it",
        destructive: true,
      });
      if (!ok) return;

      try {
        await eventsAdminApi.remove(event.id);
        toast.success(`“${event.title}” is deleted.`);
        if (openId === event.id) close();
        loadList();
      } catch (err) {
        toast.error(friendlyError(err, "event"));
      }
    },
    [confirm, loadList, openId],
  );

  /* Registrants ---------------------------------------------------------- */

  async function markAttendance(attended: boolean) {
    if (openId === null || selected.length === 0) return;
    try {
      await eventsAdminApi.markAttendance(openId, selected, attended);
      toast.success(
        attended
          ? `${pluralize(selected.length, "person", "people")} marked as turned up.`
          : `${pluralize(selected.length, "person", "people")} marked as didn’t turn up.`,
      );
      setSelected([]);
      loadDetail(openId);
      loadList();
    } catch (err) {
      toast.error(friendlyError(err, "event"));
    }
  }

  async function copyJoinLink(registrant: Registrant) {
    if (openId === null) return;
    try {
      const { path } = await eventsAdminApi.joinLink(openId, Number(registrant.id));
      await navigator.clipboard.writeText(publicSiteUrl(path));
      toast.success(`Link copied — paste it into your reply to ${registrant.email}.`);
    } catch (err) {
      toast.error(friendlyError(err, "event"));
    }
  }

  /* Reminders ------------------------------------------------------------ */

  /**
   * Every reminder change re-reads the event rather than patching state in
   * place. The counts beside each reminder are computed on the server from the
   * send log, and a screen that guessed at them would drift the moment a tick
   * ran between two clicks.
   */
  async function withReminders(work: () => Promise<string>) {
    if (openId === null) return;
    setReminderBusy(true);
    try {
      toast.success(await work());
      setReminderProblem(null);
      loadDetail(openId);
    } catch (err) {
      const message = saveProblem(err, "reminder");
      setReminderProblem(message);
      toast.error(message);
    } finally {
      setReminderBusy(false);
    }
  }

  /**
   * Adds one of the listed moments, or "N hours/days before" when the admin
   * picks their own. Four weeks is the furthest out a reminder can be, which is
   * the same limit the server and the table enforce.
   */
  async function addReminder() {
    if (openId === null) return;
    let kind: ReminderKind;
    let offsetMinutes: number;
    let label: string;

    if (newReminder === CUSTOM_REMINDER) {
      const amount = Number(customAmount);
      const max = customUnit === "days" ? 28 : 672;
      if (!Number.isInteger(amount) || amount < 1 || amount > max) {
        setReminderProblem(
          customUnit === "days"
            ? "Pick a whole number of days, from 1 to 28."
            : "Pick a whole number of hours, from 1 to 672 (four weeks).",
        );
        return;
      }
      kind = "before";
      offsetMinutes = amount * (customUnit === "days" ? 1440 : 60);
      const words = describeReminderOffset(kind, offsetMinutes);
      label = words.charAt(0).toUpperCase() + words.slice(1);
    } else {
      const choice = REMINDER_CHOICES[newReminder];
      if (!choice) return;
      kind = choice.kind;
      offsetMinutes = choice.offsetMinutes;
      label = choice.label;
    }

    await withReminders(async () => {
      await eventsAdminApi.addReminder(openId, { kind, offsetMinutes });
      return `${label} added.`;
    });
  }

  async function tagEveryone() {
    if (openId === null) return;
    try {
      await eventsAdminApi.runSplit(openId);
      toast.success("Tagging everyone now — it takes a moment to work through the list.");
    } catch (err) {
      toast.error(friendlyError(err, "event"));
    }
  }

  const allSelected =
    registrants !== null && registrants.length > 0 && selected.length === registrants.length;

  const registrantColumns = useMemo<ColumnDef<Registrant, unknown>[]>(
    () => [
      {
        id: "pick",
        enableSorting: false,
        header: () => (
          <input
            type="checkbox"
            aria-label="Select everyone who signed up"
            className={checkboxStyles}
            checked={allSelected}
            onChange={(event) =>
              setSelected(
                event.target.checked ? (registrants ?? []).map((row) => Number(row.id)) : [],
              )
            }
          />
        ),
        cell: ({ row }) => {
          const id = Number(row.original.id);
          return (
            <input
              type="checkbox"
              aria-label={`Select ${row.original.name || row.original.email}`}
              className={checkboxStyles}
              checked={selected.includes(id)}
              onChange={(event) =>
                setSelected((current) =>
                  event.target.checked
                    ? [...current, id]
                    : current.filter((picked) => picked !== id),
                )
              }
            />
          );
        },
      },
      {
        accessorKey: "name",
        header: "Who",
        cell: ({ row }) => (
          <span className="min-w-0">
            <span className="block truncate font-semibold text-ink">
              {row.original.name || "No name given"}
            </span>
            <span className="block truncate text-xs text-ink-soft">{row.original.email}</span>
          </span>
        ),
      },
      {
        accessorKey: "sessionLabel",
        header: "Their session",
        cell: ({ row }) => (
          <span className="text-sm text-ink-soft">{row.original.sessionLabel}</span>
        ),
      },
      {
        accessorKey: "attended",
        header: "Turned up",
        cell: ({ row }) => (
          <Badge tone={row.original.attended ? "green" : "slate"}>
            {row.original.attended ? "Turned up" : "Not yet"}
          </Badge>
        ),
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        cell: ({ row }) => (
          <RowActions>
            <Button
              variant="ghost"
              size="iconSm"
              aria-label={`Copy the join link for ${row.original.email}`}
              onClick={() => void copyJoinLink(row.original)}
            >
              <Copy />
            </Button>
          </RowActions>
        ),
      },
    ],
    // `openId` is in here because the copy action closes over which event the
    // join link belongs to.
    [allSelected, registrants, selected, openId],
  );

  const columns = useMemo<ColumnDef<EventSummary, unknown>[]>(
    () => [
      {
        accessorKey: "title",
        header: "Event",
        cell: ({ row }) => (
          <button
            type="button"
            onClick={() => open(row.original.id)}
            className="flex min-w-0 items-center gap-3 text-left hover:text-plum"
          >
            <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-lilac-tint text-plum">
              <CalendarClock className="size-4" />
            </span>
            <span className="min-w-0">
              <span className="block truncate font-semibold text-ink">{row.original.title}</span>
              <span className="block truncate text-xs text-ink-soft">
                {webAddress("events", row.original.slug)}
              </span>
            </span>
          </button>
        ),
      },
      {
        accessorKey: "kind",
        header: "What it is",
        cell: ({ row }) => (
          <Badge tone={row.original.kind === "live" ? "gold" : "blue"}>
            {EVENT_KIND_LABEL[row.original.kind]}
          </Badge>
        ),
      },
      {
        accessorKey: "startsAt",
        header: "When",
        cell: ({ row }) => <span className="text-sm text-ink-soft">{whenLabel(row.original)}</span>,
      },
      {
        accessorKey: "registrationCount",
        header: "Signed up",
        cell: ({ row }) => (
          <span className="text-sm text-ink-soft">
            {row.original.registrationCount === 0
              ? "Nobody yet"
              : pluralize(row.original.registrationCount, "person", "people")}
          </span>
        ),
      },
      {
        accessorKey: "attendedCount",
        header: "Turned up",
        cell: ({ row }) => (
          <span className="text-sm text-ink-soft">{row.original.attendedCount}</span>
        ),
      },
      {
        accessorKey: "published",
        header: "On your site",
        cell: ({ row }) => (
          <Badge tone={row.original.published ? "green" : "slate"}>
            {publishLabel(row.original.published)}
          </Badge>
        ),
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        cell: ({ row }) => (
          <RowActions>
            <Button
              variant="ghost"
              size="iconSm"
              aria-label={`Open ${row.original.title}`}
              onClick={() => open(row.original.id)}
            >
              <Pencil />
            </Button>
            <Button
              variant="dangerGhost"
              size="iconSm"
              aria-label={`Delete ${row.original.title}`}
              onClick={() => void remove(row.original)}
            >
              <Trash2 />
            </Button>
          </RowActions>
        ),
      },
    ],
    [remove],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Marketing"
        title="Events"
        description="Webinars, workshops and recordings — who signed up, who turned up, and what happened next."
        actions={
          <Button size="sm" onClick={startNew}>
            <Plus />
            Add an event
          </Button>
        }
      />

      {error && <ErrorNotice message={error} />}
      {linkProblem && <ErrorNotice message={linkProblem} />}

      {whenFilter === "upcoming" && (
        <Card className="flex flex-wrap items-center justify-between gap-3 p-3">
          <p className="text-sm text-ink-soft">
            Showing only events still to come: live sessions that haven’t finished, and
            always-on events.
          </p>
          <Button variant="secondary" size="sm" onClick={() => clearParam("when")}>
            Show all events
          </Button>
        </Card>
      )}

      <DataTable
        columns={columns}
        data={visibleEvents}
        searchPlaceholder="Search your events…"
        itemNoun={{ one: "event", many: "events" }}
        minWidth="1000px"
        emptyState={
          whenFilter === "upcoming" && (events?.length ?? 0) > 0 ? (
            <EmptyState
              icon={<CalendarClock />}
              title="Nothing coming up"
              description="Every event you have has already happened. Show all events to see them."
              action={
                <Button size="sm" variant="secondary" onClick={() => clearParam("when")}>
                  Show all events
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={<CalendarClock />}
              title="No events yet"
              description="Add a webinar or a workshop, share its link, and everyone who signs up appears here."
              action={
                <Button size="sm" onClick={startNew}>
                  <Plus />
                  Add your first event
                </Button>
              }
            />
          )
        }
      />

      {/* ---------------------------------------------------- add an event */}

      <Modal
        open={adding}
        onOpenChange={(value) => !value && setAdding(false)}
        title="Add an event"
        description="The rest of the details come next."
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setAdding(false)}>
              Cancel
            </Button>
            <Button size="sm" type="submit" form="event-new" disabled={creating}>
              {creating ? "Creating…" : "Create and set it up"}
            </Button>
          </>
        }
      >
        <form id="event-new" onSubmit={create} className="grid gap-5">
          <Field label="What is this event called?" hint="people signing up see this">
            <Input
              aria-label="What this event is called"
              value={newTitle}
              onChange={(event) => setNewTitle(event.target.value)}
              placeholder="The Practice Reset workshop"
              required
              autoFocus
            />
          </Field>

          <KindChoice value={newKind} onChange={setNewKind} name="new-event-kind" />

          {newKind === "live" && (
            <Field
              label="When does it happen?"
              hint="Eastern time — you can change this next"
              error={newProblem ?? undefined}
            >
              <Input
                type="datetime-local"
                aria-label="When it happens"
                value={newStarts}
                onChange={(event) => {
                  setNewStarts(event.target.value);
                  if (newProblem) setNewProblem(null);
                }}
                required
              />
            </Field>
          )}

          {newKind === "evergreen" && (
            <Field label="How often does a session start?">
              <select
                className={selectStyles}
                aria-label="How often a session starts"
                value={newCadence}
                onChange={(event) => setNewCadence(Number(event.target.value))}
              >
                {CADENCE_CHOICES.map((minutes) => (
                  <option key={minutes} value={minutes}>
                    {describeCadence(minutes)}
                  </option>
                ))}
              </select>
            </Field>
          )}

          {newKind === "live" && (
            <RepeatFields
              value={newRepeat}
              error={newRepeatProblem}
              onChange={(value) => {
                setNewRepeat(value);
                setNewRepeatProblem(null);
                setCreateError(null);
              }}
            />
          )}

          <LocationFields
            name="new-event"
            type={newLocationType}
            address={newAddress}
            error={newAddressProblem}
            onChange={(type, address) => {
              setNewLocationType(type);
              setNewAddress(address);
              setNewAddressProblem(null);
              setCreateError(null);
            }}
          />

          {createError && (
            <p role="alert" className="text-sm font-semibold text-red-400">
              {createError}
            </p>
          )}
        </form>
      </Modal>

      {/* -------------------------------------------------------- one event */}

      <Modal
        open={openId !== null}
        onOpenChange={(value) => !value && close()}
        title={detail?.title ?? "Event"}
        description={detail ? webAddress("events", detail.slug) : undefined}
        size="xl"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={close}>
              Close
            </Button>
            <Button size="sm" type="submit" form="event-form" disabled={saving || !form}>
              {saving ? "Saving…" : "Save event"}
            </Button>
          </>
        }
      >
        {!detail || !form ? (
          <div className="space-y-3">
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        ) : (
          <div className="space-y-8">
            {/* -------------------------------------------------- the numbers */}
            {report && (
              <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
                <StatTile label="Signed up" value={String(report.registered)} />
                <StatTile label="Turned up" value={String(report.attended)} />
                <StatTile label="Bought something" value={String(report.converted)} />
                <StatTile label="Turned up" value={`${report.attendanceRate}%`} />
                <StatTile label="Bought after" value={`${report.conversionRate}%`} />
                <StatTile label="Money made" value={money(report.revenueCents)} />
              </div>
            )}

            {/* ------------------------------------------------- the settings */}
            <form id="event-form" onSubmit={save} className="grid gap-5">
              {problems.server && <ErrorNotice message={problems.server} />}

              <Field label="What is this event called?" error={problems.title}>
                <Input
                  aria-label="What this event is called"
                  value={form.title}
                  onChange={(event) =>
                    setForm((current) => current && { ...current, title: event.target.value })
                  }
                  required
                />
              </Field>

              <Field label="What is it about?" hint="what people read before they sign up">
                <Textarea
                  rows={4}
                  aria-label="What this event is about"
                  value={form.descriptionMd}
                  onChange={(event) =>
                    setForm(
                      (current) => current && { ...current, descriptionMd: event.target.value },
                    )
                  }
                  placeholder="An hour on pricing, with time for questions at the end."
                />
              </Field>

              <KindChoice
                value={form.kind}
                onChange={(kind) => setForm((current) => current && { ...current, kind })}
                name="event-kind"
              />

              <div className="grid gap-5 sm:grid-cols-2">
                {form.kind === "live" && (
                  <Field label="When does it happen?" error={problems.startsAt}>
                    <Input
                      type="datetime-local"
                      aria-label="When it happens"
                      value={form.startsLocal}
                      onChange={(event) =>
                        setForm(
                          (current) => current && { ...current, startsLocal: event.target.value },
                        )
                      }
                    />
                  </Field>
                )}

                {form.kind === "evergreen" && (
                  <Field
                    label="How often does a session start?"
                    hint={describeCadence(form.cadenceMinutes).toLowerCase()}
                  >
                    <select
                      className={selectStyles}
                      aria-label="How often a session starts"
                      value={form.cadenceMinutes}
                      onChange={(event) =>
                        setForm(
                          (current) =>
                            current && { ...current, cadenceMinutes: Number(event.target.value) },
                        )
                      }
                    >
                      {CADENCE_CHOICES.map((minutes) => (
                        <option key={minutes} value={minutes}>
                          {describeCadence(minutes)}
                        </option>
                      ))}
                    </select>
                  </Field>
                )}

                <Field label="How long does it run?" hint="minutes" error={problems.duration}>
                  <Input
                    inputMode="numeric"
                    aria-label="How long it runs, in minutes"
                    value={form.durationMinutes}
                    onChange={(event) =>
                      setForm(
                        (current) => current && { ...current, durationMinutes: event.target.value },
                      )
                    }
                    placeholder="60"
                  />
                </Field>

                <Field label="Which time zone are those times in?">
                  <select
                    className={selectStyles}
                    aria-label="Which time zone those times are in"
                    value={form.timezone}
                    onChange={(event) =>
                      setForm((current) => current && { ...current, timezone: event.target.value })
                    }
                  >
                    {(TIMEZONES.includes(form.timezone)
                      ? TIMEZONES
                      : [form.timezone, ...TIMEZONES]
                    ).map((zone) => (
                      <option key={zone} value={zone}>
                        {zone.split("/").pop()?.replace(/_/g, " ")}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field label="The link people join on" hint="your Zoom or YouTube link">
                  <Input
                    aria-label="The link people join on"
                    value={form.roomUrl}
                    onChange={(event) =>
                      setForm((current) => current && { ...current, roomUrl: event.target.value })
                    }
                    placeholder="https://zoom.us/j/…"
                  />
                </Field>

                <Field label="The link to the recording" hint="optional">
                  <Input
                    aria-label="The link to the recording"
                    value={form.replayUrl}
                    onChange={(event) =>
                      setForm((current) => current && { ...current, replayUrl: event.target.value })
                    }
                    placeholder="https://…"
                  />
                </Field>

                <Field
                  label="How long the recording stays up"
                  hint="hours — leave blank to keep it up for good"
                >
                  <Input
                    inputMode="numeric"
                    aria-label="How long the recording stays up, in hours"
                    value={form.replayExpiresAfterHours}
                    onChange={(event) =>
                      setForm(
                        (current) =>
                          current && {
                            ...current,
                            replayExpiresAfterHours: event.target.value.replace(/[^0-9]/g, ""),
                          },
                      )
                    }
                    placeholder="72"
                  />
                </Field>
              </div>

              {form.kind === "live" && (
                <RepeatFields
                  value={form.repeat}
                  error={problems.repeat}
                  onChange={(repeat) => setForm((current) => current && { ...current, repeat })}
                />
              )}

              {form.kind === "live" && (detail.occurrences?.length ?? 0) > 1 && (
                <Card className="p-3">
                  <p className="text-sm font-semibold text-ink">
                    {detail.recurrenceLabel} — the sessions as saved
                  </p>
                  <ol className="mt-2 grid gap-x-4 gap-y-1 text-sm text-ink-soft sm:grid-cols-2">
                    {(detail.occurrences ?? []).slice(0, SESSIONS_SHOWN).map((iso, index) => (
                      <li key={iso}>
                        {index + 1}. {describeStart(iso, detail.timezone)}
                      </li>
                    ))}
                  </ol>
                  {(detail.occurrences?.length ?? 0) > SESSIONS_SHOWN && (
                    <p className="mt-2 text-xs text-ink-soft">
                      …and {(detail.occurrences?.length ?? 0) - SESSIONS_SHOWN} more.
                    </p>
                  )}
                  <p className="mt-2 text-xs text-ink-soft">
                    Everyone who signs up gets every session from their first one on — in their
                    calendar file, on their events page, and with reminders before each.
                  </p>
                </Card>
              )}

              <LocationFields
                name="event"
                type={form.locationType}
                address={form.locationAddress}
                error={problems.address}
                onChange={(locationType, locationAddress) =>
                  setForm((current) => current && { ...current, locationType, locationAddress })
                }
              />

              {form.locationType === "in_person" && form.locationAddress.trim() && (
                <p className="-mt-2 flex items-start gap-1.5 text-xs text-ink-soft">
                  <MapPin aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                  The address goes on the event page, in the confirmation and reminders, and into
                  every calendar file as its location.
                </p>
              )}

              <Field
                label="Tags added when somebody signs up"
                hint="tick as many as you need"
                className="min-w-0"
              >
                {tags.length === 0 ? (
                  <p className="text-sm text-ink-soft">
                    You have no tags yet — make one under Contacts and it will show up here.
                  </p>
                ) : (
                  <div className="max-h-40 space-y-1.5 overflow-y-auto rounded-xl border border-hairline bg-white/[0.03] p-3">
                    {tags.map((tag) => (
                      <label
                        key={tag.id}
                        className="flex cursor-pointer items-center gap-2.5 text-sm text-ink"
                      >
                        <input
                          type="checkbox"
                          className={checkboxStyles}
                          checked={form.applyTagIds.includes(tag.id)}
                          onChange={(event) =>
                            setForm(
                              (current) =>
                                current && {
                                  ...current,
                                  applyTagIds: event.target.checked
                                    ? [...current.applyTagIds, tag.id]
                                    : current.applyTagIds.filter((id) => id !== tag.id),
                                },
                            )
                          }
                        />
                        {tag.name}
                      </label>
                    ))}
                  </div>
                )}
              </Field>

              <div className="grid gap-5 sm:grid-cols-2">
                <Field label="Tag everyone who turned up">
                  <select
                    className={selectStyles}
                    aria-label="Tag for everyone who turned up"
                    value={form.attendedTagId === null ? "" : String(form.attendedTagId)}
                    onChange={(event) =>
                      setForm(
                        (current) =>
                          current && {
                            ...current,
                            attendedTagId: event.target.value ? Number(event.target.value) : null,
                          },
                      )
                    }
                  >
                    <option value="">Don’t tag them</option>
                    {tags.map((tag) => (
                      <option key={tag.id} value={tag.id}>
                        {tag.name}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field label="Tag everyone who didn’t turn up">
                  <select
                    className={selectStyles}
                    aria-label="Tag for everyone who did not turn up"
                    value={form.noShowTagId === null ? "" : String(form.noShowTagId)}
                    onChange={(event) =>
                      setForm(
                        (current) =>
                          current && {
                            ...current,
                            noShowTagId: event.target.value ? Number(event.target.value) : null,
                          },
                      )
                    }
                  >
                    <option value="">Don’t tag them</option>
                    {tags.map((tag) => (
                      <option key={tag.id} value={tag.id}>
                        {tag.name}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>

              <p className="text-sm text-ink-soft">
                Those two tags are what a follow-up email is built from — one message to everyone
                who turned up, a different one to everyone who missed it.
              </p>

              <label className="flex cursor-pointer items-start gap-2.5 text-sm text-ink">
                <input
                  type="checkbox"
                  className={`mt-0.5 ${checkboxStyles}`}
                  checked={form.published}
                  onChange={(event) =>
                    setForm(
                      (current) => current && { ...current, published: event.target.checked },
                    )
                  }
                />
                <span>
                  Live on your site
                  <span className="mt-0.5 block text-xs text-ink-soft">
                    {form.published
                      ? `Anyone can sign up at ${webAddress("events", detail.slug)}.`
                      : "Nobody can sign up yet."}
                  </span>
                </span>
              </label>
            </form>

            {/* ------------------------------------------------- reminders */}
            <div className="space-y-3">
              <div>
                <h3 className="flex items-center gap-2 font-display text-base text-ink">
                  <BellRing aria-hidden className="size-4" />
                  Reminders
                </h3>
                <p className="mt-1 text-sm text-ink-soft">
                  The emails that go out on their own. Each one is counted back from that
                  person’s own session time — so an always-on event reminds everybody
                  relative to the session they were given, not to one shared date.
                </p>
              </div>

              {form.kind === "replay" && (
                <Card className="border-gold/25 p-3">
                  <p className="text-sm text-ink-soft">
                    A recording is watchable the moment somebody signs up, so there is
                    nothing to remind them about. The confirmation still goes out.
                  </p>
                </Card>
              )}

              {detail.reminders.length === 0 ? (
                <Card className="p-3">
                  <p className="text-sm text-ink-soft">
                    No reminders on this event. Nobody will hear from you between signing up
                    and the session itself.
                  </p>
                </Card>
              ) : (
                <ul className="space-y-2.5">
                  {detail.reminders.map((reminder) => (
                    <ReminderRow
                      key={reminder.id}
                      reminder={reminder}
                      timezone={form.timezone}
                      busy={reminderBusy}
                      onToggle={(enabled) =>
                        void withReminders(async () => {
                          await eventsAdminApi.updateReminder(detail.id, reminder.id, {
                            enabled,
                          });
                          return enabled
                            ? `Reminder ${reminder.label} switched on.`
                            : `Reminder ${reminder.label} switched off.`;
                        })
                      }
                      onRetry={() =>
                        void withReminders(async () => {
                          const { requeued } = await eventsAdminApi.retryReminder(
                            detail.id,
                            reminder.id,
                          );
                          return requeued === 0
                            ? "Nothing left to try again."
                            : `${pluralize(requeued, "reminder", "reminders")} queued to try again.`;
                        })
                      }
                      onRemove={() =>
                        void withReminders(async () => {
                          await eventsAdminApi.removeReminder(detail.id, reminder.id);
                          return `Reminder ${reminder.label} removed.`;
                        })
                      }
                    />
                  ))}
                </ul>
              )}

              <div className="flex flex-wrap items-end gap-2">
                <Field
                  label="Add another reminder"
                  className="min-w-[220px] flex-1"
                  error={reminderProblem ?? undefined}
                >
                  <select
                    className={selectStyles}
                    aria-label="When the new reminder goes out"
                    value={newReminder}
                    onChange={(event) => {
                      setNewReminder(Number(event.target.value));
                      setReminderProblem(null);
                    }}
                  >
                    {REMINDER_CHOICES.map((choice, index) => (
                      <option key={choice.label} value={index}>
                        {choice.label}
                      </option>
                    ))}
                    <option value={CUSTOM_REMINDER}>Hours or days before — you choose</option>
                  </select>
                </Field>
                {newReminder === CUSTOM_REMINDER && (
                  <>
                    <Field label="How many" className="w-24">
                      <Input
                        inputMode="numeric"
                        aria-label="How many hours or days before"
                        value={customAmount}
                        onChange={(event) => {
                          setCustomAmount(event.target.value.replace(/[^0-9]/g, ""));
                          setReminderProblem(null);
                        }}
                      />
                    </Field>
                    <Field label="Of what" className="w-36">
                      <select
                        className={selectStyles}
                        aria-label="Hours or days before"
                        value={customUnit}
                        onChange={(event) => {
                          setCustomUnit(event.target.value as "hours" | "days");
                          setReminderProblem(null);
                        }}
                      >
                        <option value="hours">hours before</option>
                        <option value="days">days before</option>
                      </select>
                    </Field>
                  </>
                )}
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={reminderBusy}
                  onClick={() => void addReminder()}
                >
                  <Plus />
                  Add
                </Button>
              </div>

              <p className="text-sm text-ink-soft">
                A reminder whose moment has already gone is never sent — it is recorded as
                skipped instead. So adding “1 week before” to a session three days away
                changes nothing for the people already signed up, and a restart never
                sends a backlog of reminders for sessions that have been and gone.
              </p>
            </div>

            {/* ----------------------------------------------- registrants */}
            <div className="space-y-3">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h3 className="font-display text-base text-ink">Who signed up</h3>
                  <p className="mt-1 text-sm text-ink-soft">
                    Each person keeps their own session time, shown in your event’s time zone.
                  </p>
                </div>
                <Button variant="secondary" size="sm" onClick={() => void tagEveryone()}>
                  <Tags />
                  Tag everyone now
                </Button>
              </div>

              <Card className="border-gold/25 p-3">
                <p className="text-sm text-ink-soft">
                  “Tag everyone now” applies the turned-up and didn’t-turn-up tags straight away,
                  instead of waiting for them to go on by themselves after the event.
                </p>
              </Card>

              <DataTable
                columns={registrantColumns}
                data={registrants}
                searchPlaceholder="Search by name or email…"
                itemNoun={{ one: "person", many: "people" }}
                minWidth="760px"
                toolbar={
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={selected.length === 0}
                      onClick={() => void markAttendance(true)}
                    >
                      Mark as turned up
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={selected.length === 0}
                      onClick={() => void markAttendance(false)}
                    >
                      Mark as didn’t turn up
                    </Button>
                    {selected.length > 0 && (
                      <span className="text-xs text-ink-soft">
                        {pluralize(selected.length, "person", "people")} ticked
                      </span>
                    )}
                  </div>
                }
                emptyState={
                  <EmptyState
                    icon={<Users />}
                    title="Nobody has signed up yet"
                    description="Once this event is live on your site, everyone who registers appears here with their own session time."
                  />
                }
              />
            </div>
          </div>
        )}
      </Modal>

      {confirmDialog}
    </div>
  );
}
