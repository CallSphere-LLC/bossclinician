import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { CalendarClock, Copy, Pencil, Plus, Tags, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import {
  CADENCE_CHOICES,
  EVENT_KIND_HINT,
  EVENT_KIND_LABEL,
  describeCadence,
  eventsAdminApi,
  type EventDetail,
  type EventDraft,
  type EventKind,
  type EventReport,
  type EventSummary,
  type Registrant,
} from "@/lib/eventsApi";
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

const DEFAULT_TIMEZONE = "America/New_York";

/* ── Times in the event's own zone ──────────────────────────────────────── */

/** How far a zone is from UTC at that instant, in milliseconds. */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(instant);

    const read = (type: string): number =>
      Number(parts.find((part) => part.type === type)?.value ?? "0");

    const asUtc = Date.UTC(
      read("year"),
      read("month") - 1,
      read("day"),
      // Midnight comes back as hour 24 in this format.
      read("hour") % 24,
      read("minute"),
      read("second"),
    );
    return asUtc - instant.getTime();
  } catch {
    // An unrecognised zone name would otherwise throw and blank the date box.
    return 0;
  }
}

/**
 * "2026-06-12T14:00" typed into the box → the moment that is 2pm in the event's
 * own zone.
 *
 * Read plainly, a date box gives back the time on the computer she is sitting
 * at, which is how an event advertised for 2pm Eastern goes out at 11am for
 * everyone. The second pass covers the clocks going forward, where the offset
 * on either side of the entered time is not the same.
 */
function wallClockToIso(local: string, timeZone: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!match) return null;

  const naive = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
  );
  const firstPass = naive - zoneOffsetMs(new Date(naive), timeZone);
  const instant = naive - zoneOffsetMs(new Date(firstPass), timeZone);
  return new Date(instant).toISOString();
}

/** The stored moment → what the date box shows, in the event's own zone. */
function isoToWallClock(iso: string | null, timeZone: string): string {
  if (!iso) return "";
  const instant = new Date(iso);
  if (Number.isNaN(instant.getTime())) return "";
  return new Date(instant.getTime() + zoneOffsetMs(instant, timeZone)).toISOString().slice(0, 16);
}

/** The date of a live event written out in its own zone, with the zone named. */
function describeStart(iso: string | null, timeZone: string): string {
  if (!iso) return "No date yet";
  const instant = new Date(iso);
  if (Number.isNaN(instant.getTime())) return "No date yet";
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: timeZone || DEFAULT_TIMEZONE,
      dateStyle: "medium",
      timeStyle: "short",
      timeZoneName: "short",
    }).format(instant);
  } catch {
    return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(
      instant,
    );
  }
}

/** When this event happens, whichever kind it is. */
function whenLabel(event: EventSummary): string {
  if (event.kind === "evergreen") {
    return describeCadence(event.evergreenIntervalMinutes) || "No cadence set";
  }
  if (event.kind === "replay") return "As soon as they sign up";
  return describeStart(event.startsAt, event.timezone);
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
  }>({});
  const [registrants, setRegistrants] = useState<Registrant[] | null>(null);
  const [report, setReport] = useState<EventReport | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);

  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newKind, setNewKind] = useState<EventKind>("live");
  const [newStarts, setNewStarts] = useState("");
  const [newCadence, setNewCadence] = useState(15);
  const [newProblem, setNewProblem] = useState<string | null>(null);
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
  }

  /* Creating ------------------------------------------------------------- */

  function startNew() {
    setNewTitle("");
    setNewKind("live");
    setNewStarts("");
    setNewCadence(15);
    setNewProblem(null);
    setAdding(true);
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    const title = newTitle.trim();
    if (!title) return;

    const draft: EventDraft & { title: string } = { title, kind: newKind };
    if (newKind === "live") {
      const iso = wallClockToIso(newStarts, DEFAULT_TIMEZONE);
      if (!iso) {
        setNewProblem("Pick the date and time this event happens.");
        return;
      }
      setNewProblem(null);
      draft.startsAt = iso;
      draft.timezone = DEFAULT_TIMEZONE;
    }
    if (newKind === "evergreen") draft.evergreenIntervalMinutes = newCadence;

    setCreating(true);
    try {
      const created = await eventsAdminApi.create(draft);
      setAdding(false);
      loadList();
      open(created.id);
    } catch (err) {
      toast.error(friendlyError(err, "event"));
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

    setProblems(found);
    if (Object.keys(found).length > 0) return;

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
      toast.error(friendlyError(err, "event"));
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
      await navigator.clipboard.writeText(`${window.location.origin}${path}`);
      toast.success(`Link copied — paste it into your reply to ${registrant.email}.`);
    } catch (err) {
      toast.error(friendlyError(err, "event"));
    }
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

      <DataTable
        columns={columns}
        data={events}
        searchPlaceholder="Search your events…"
        itemNoun={{ one: "event", many: "events" }}
        minWidth="1000px"
        emptyState={
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
