import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Link2,
  MessagesSquare,
  Presentation,
  Users,
  Video,
} from "lucide-react";
import { cn } from "@/lib/cn";
import {
  addDays,
  addMonths,
  byDay,
  calendarApi,
  dayKey,
  formatRange,
  formatTime,
  isSameDay,
  isSameMonth,
  localZone,
  monthGrid,
  startOfDay,
  startOfWeek,
  type CalendarEntry,
  type CalendarResponse,
} from "@/lib/calendarApi";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNotice,
  PageHeader,
  Skeleton,
} from "@/pages/admin/ui/primitives";
import { Drawer, DrawerFacts } from "@/pages/admin/ui/Drawer";
import { pluralize } from "@/pages/admin/ui/friendly";

/**
 * The unified calendar — Calendar addendum §5.
 *
 * Month, Week, Day and Agenda over everything that occupies time: coaching
 * appointments, live events and community events. Selecting anything opens the
 * details drawer §5 asks for.
 *
 * The grid is hand-built rather than pulled from a calendar library. The three
 * candidates each weigh more than this whole admin bundle's chart code, and
 * what is actually needed here — six rows of seven days, a day column, and a
 * list — is a hundred lines of date arithmetic that behaves exactly as we want
 * across a DST boundary. `calendarApi.ts` holds that arithmetic, working in
 * local time throughout: the API answers in UTC instants, and bucketing those
 * by their UTC date files a 9pm session under tomorrow for anyone west of
 * Greenwich.
 */

type View = "month" | "week" | "day" | "agenda";

const VIEWS: { key: View; label: string }[] = [
  { key: "month", label: "Month" },
  { key: "week", label: "Week" },
  { key: "day", label: "Day" },
  { key: "agenda", label: "Agenda" },
];

const KIND_STYLE: Record<
  CalendarEntry["kind"],
  { chip: string; dot: string; Icon: typeof Video; label: string }
> = {
  coaching: {
    chip: "border-accent/30 bg-accent-soft text-accent",
    dot: "bg-accent",
    Icon: Video,
    label: "Coaching",
  },
  event: {
    chip: "border-warn/30 bg-warn-soft text-warn",
    dot: "bg-warn",
    Icon: Presentation,
    label: "Events",
  },
  "community-event": {
    chip: "border-pos/30 bg-pos-soft text-pos",
    dot: "bg-pos",
    Icon: MessagesSquare,
    label: "Community",
  },
};

export default function Calendar() {
  const [view, setView] = useState<View>("month");
  const [cursor, setCursor] = useState(() => startOfDay(new Date()));
  const [data, setData] = useState<CalendarResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<CalendarEntry | null>(null);

  /* The window to fetch. Deliberately wider than the visible view for month
     and week — the grid spills into neighbouring months, and those days must
     not render empty just because the request stopped at the boundary. */
  const [from, to] = useMemo((): [Date, Date] => {
    if (view === "month") {
      const grid = monthGrid(cursor);
      return [grid[0], addDays(grid[grid.length - 1], 1)];
    }
    if (view === "week") {
      const start = startOfWeek(cursor);
      return [start, addDays(start, 7)];
    }
    if (view === "day") return [startOfDay(cursor), addDays(startOfDay(cursor), 1)];
    // Agenda looks forward from today rather than around the cursor.
    return [startOfDay(new Date()), addDays(startOfDay(new Date()), 60)];
  }, [view, cursor]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    calendarApi
      .range(dayKey(from), dayKey(to))
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setError(null);
      })
      .catch(() => {
        if (!cancelled) setError("We couldn't load your calendar. Try refreshing the page.");
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [from, to]);

  const entries = data?.entries ?? [];
  const grouped = useMemo(() => byDay(entries), [entries]);

  const step = useCallback(
    (direction: -1 | 1) => {
      setCursor((current) => {
        if (view === "month") return addMonths(current, direction);
        if (view === "week") return addDays(current, 7 * direction);
        return addDays(current, direction);
      });
    },
    [view],
  );

  const heading = useMemo(() => {
    if (view === "month") {
      return cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    }
    if (view === "week") {
      const start = startOfWeek(cursor);
      const end = addDays(start, 6);
      const sameMonth = isSameMonth(start, end);
      return `${start.toLocaleDateString(undefined, { day: "numeric", month: "short" })} – ${end.toLocaleDateString(
        undefined,
        sameMonth ? { day: "numeric", month: "short", year: "numeric" } : { day: "numeric", month: "short", year: "numeric" },
      )}`;
    }
    if (view === "day") {
      return cursor.toLocaleDateString(undefined, {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      });
    }
    return "Next 60 days";
  }, [view, cursor]);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Main"
        title="Calendar"
        description={`Coaching, events and community in one place. Times are shown in ${localZone()}.`}
        actions={
          <Button variant="secondary" size="sm" asChild>
            <Link to="/admin/settings/connections">
              <Link2 />
              Calendar connections
            </Link>
          </Button>
        }
      />

      {data && !data.connections.google.connected && <GoogleNotice available={data.connections.google.available} />}
      {error && <ErrorNotice message={error} />}

      <Card>
        {/* ── Toolbar ─────────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-3 border-b border-hairline/60 px-4 py-3">
          {view !== "agenda" && (
            <div className="flex items-center gap-1">
              <Button variant="secondary" size="iconSm" onClick={() => step(-1)} aria-label="Previous">
                <ChevronLeft />
              </Button>
              <Button variant="secondary" size="iconSm" onClick={() => step(1)} aria-label="Next">
                <ChevronRight />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setCursor(startOfDay(new Date()))}
                className="ml-1"
              >
                Today
              </Button>
            </div>
          )}

          <h2 className="font-display text-base text-ink">{heading}</h2>

          <div
            role="group"
            aria-label="Calendar view"
            className="ml-auto flex items-center gap-0.5 rounded-xl border border-hairline p-0.5"
          >
            {VIEWS.map((v) => (
              <button
                key={v.key}
                type="button"
                onClick={() => setView(v.key)}
                aria-pressed={view === v.key}
                className={cn(
                  "rounded-[0.6rem] px-3 py-1.5 text-[0.78rem] font-semibold transition-colors",
                  view === v.key
                    ? "bg-accent-solid text-accent-on"
                    : "text-ink-soft hover:bg-raise hover:text-ink",
                )}
              >
                {v.label}
              </button>
            ))}
          </div>
        </div>

        <Legend />

        {loading && !data ? (
          <div className="space-y-2 p-4">
            <Skeleton className="h-64" />
          </div>
        ) : view === "month" ? (
          <MonthView cursor={cursor} grouped={grouped} onSelect={setSelected} />
        ) : view === "week" ? (
          <WeekView cursor={cursor} grouped={grouped} onSelect={setSelected} />
        ) : view === "day" ? (
          <DayView cursor={cursor} grouped={grouped} onSelect={setSelected} />
        ) : (
          <AgendaView entries={entries} onSelect={setSelected} />
        )}
      </Card>

      <EventDrawer entry={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

/* ------------------------------------------------------------------ pieces */

function Legend() {
  return (
    <ul className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-hairline/60 px-4 py-2.5">
      {(Object.keys(KIND_STYLE) as CalendarEntry["kind"][]).map((kind) => (
        <li key={kind} className="flex items-center gap-2 text-[0.74rem] text-ink-soft">
          <span aria-hidden className={cn("size-2 rounded-full", KIND_STYLE[kind].dot)} />
          {KIND_STYLE[kind].label}
        </li>
      ))}
    </ul>
  );
}

/**
 * The banner that says the calendar is not yet syncing.
 *
 * Shown rather than hidden because §3 requires the connect action to be
 * discoverable, and because a calendar that silently shows only what was
 * entered by hand is exactly the failure the addendum was written about.
 */
function GoogleNotice({ available }: { available: boolean }) {
  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-hairline bg-raise px-4 py-3"
    >
      <p className="text-sm text-ink-soft">
        <span className="font-semibold text-ink">No external calendar is connected.</span>{" "}
        {available
          ? "Connect Google Calendar to have meetings appear here automatically."
          : "Google Calendar sync needs to be set up by your developer before it can be connected."}
      </p>
      <Button variant={available ? "primary" : "secondary"} size="sm" asChild>
        <Link to="/admin/settings/connections">
          {available ? "Connect Google Calendar" : "See connections"}
        </Link>
      </Button>
    </div>
  );
}

function EntryChip({
  entry,
  onSelect,
  compact = false,
}: {
  entry: CalendarEntry;
  onSelect: (entry: CalendarEntry) => void;
  compact?: boolean;
}) {
  const style = KIND_STYLE[entry.kind];
  return (
    <button
      type="button"
      onClick={() => onSelect(entry)}
      title={`${formatRange(entry)} · ${entry.title}`}
      className={cn(
        "flex w-full items-center gap-1.5 rounded-md border px-1.5 py-1 text-left transition-opacity hover:opacity-85",
        style.chip,
      )}
    >
      <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", style.dot)} />
      {/* The time never truncates — "9:0…" tells her nothing, and it is the
          half of the chip she is scanning for. The title gives way instead. */}
      <span className="shrink-0 font-numeric text-[0.68rem] font-semibold tabular-nums">
        {formatTime(entry.start)}
      </span>
      {!compact && <span className="truncate text-[0.7rem] font-medium">{entry.title}</span>}
    </button>
  );
}

/* --------------------------------------------------------------- Month */

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function MonthView({
  cursor,
  grouped,
  onSelect,
}: {
  cursor: Date;
  grouped: Map<string, CalendarEntry[]>;
  onSelect: (entry: CalendarEntry) => void;
}) {
  const days = useMemo(() => monthGrid(cursor), [cursor]);
  const today = new Date();

  return (
    // §5 asks for it to stay usable on tablet and mobile. A month grid cannot
    // usefully compress below about 44rem, so it scrolls inside its own box
    // rather than squeezing seven columns into a phone.
    <div className="overflow-x-auto">
      <div className="min-w-[44rem]">
        <div className="grid grid-cols-7 border-b border-hairline/60">
          {WEEKDAYS.map((day) => (
            <div
              key={day}
              className="px-2 py-2 text-center text-[0.68rem] font-bold uppercase tracking-[0.1em] text-ink-soft"
            >
              {day}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7">
          {days.map((day) => {
            const key = dayKey(day);
            const items = grouped.get(key) ?? [];
            const outside = !isSameMonth(day, cursor);
            const isToday = isSameDay(day, today);

            return (
              <div
                key={key}
                className={cn(
                  "min-h-[7rem] border-b border-r border-hairline/50 p-1.5",
                  outside && "bg-raise/60",
                )}
              >
                <div className="mb-1 flex items-center justify-between">
                  <span
                    className={cn(
                      "grid size-6 place-items-center rounded-full font-numeric text-[0.72rem] tabular-nums",
                      isToday
                        ? "bg-accent-solid font-bold text-accent-on"
                        : outside
                          ? "text-ink-soft/60"
                          : "text-ink-soft",
                    )}
                  >
                    {day.getDate()}
                  </span>
                  {items.length > 2 && (
                    <span className="font-numeric text-[0.62rem] text-ink-soft">
                      {items.length}
                    </span>
                  )}
                </div>

                <div className="space-y-1">
                  {items.slice(0, 3).map((entry) => (
                    <EntryChip key={entry.id} entry={entry} onSelect={onSelect} />
                  ))}
                  {items.length > 3 && (
                    <p className="px-1 text-[0.66rem] text-ink-soft">
                      +{items.length - 3} more
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- Week */

function WeekView({
  cursor,
  grouped,
  onSelect,
}: {
  cursor: Date;
  grouped: Map<string, CalendarEntry[]>;
  onSelect: (entry: CalendarEntry) => void;
}) {
  const start = startOfWeek(cursor);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const today = new Date();

  return (
    <div className="overflow-x-auto">
      <div className="grid min-w-[44rem] grid-cols-7">
        {days.map((day) => {
          const key = dayKey(day);
          const items = grouped.get(key) ?? [];
          const isToday = isSameDay(day, today);
          return (
            <div key={key} className="min-h-[18rem] border-r border-hairline/50 last:border-r-0">
              <div
                className={cn(
                  "border-b border-hairline/60 px-2 py-2 text-center",
                  isToday && "bg-accent-soft",
                )}
              >
                <p className="text-[0.68rem] font-bold uppercase tracking-[0.1em] text-ink-soft">
                  {day.toLocaleDateString(undefined, { weekday: "short" })}
                </p>
                <p
                  className={cn(
                    "font-numeric text-[1.1rem] font-semibold tabular-nums",
                    isToday ? "text-accent" : "text-ink",
                  )}
                >
                  {day.getDate()}
                </p>
              </div>
              <div className="space-y-1.5 p-1.5">
                {items.length === 0 ? (
                  <p className="px-1 pt-3 text-center text-[0.68rem] text-ink-soft/60">Nothing</p>
                ) : (
                  items.map((entry) => (
                    <WeekEntry key={entry.id} entry={entry} onSelect={onSelect} />
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WeekEntry({
  entry,
  onSelect,
}: {
  entry: CalendarEntry;
  onSelect: (entry: CalendarEntry) => void;
}) {
  const style = KIND_STYLE[entry.kind];
  return (
    <button
      type="button"
      onClick={() => onSelect(entry)}
      className={cn(
        "w-full rounded-lg border px-2 py-1.5 text-left transition-opacity hover:opacity-85",
        style.chip,
      )}
    >
      <p className="font-numeric text-[0.68rem] font-semibold tabular-nums">
        {formatRange(entry)}
      </p>
      <p className="mt-0.5 line-clamp-2 text-[0.72rem] font-medium leading-snug">{entry.title}</p>
      {entry.attendee && (
        <p className="mt-0.5 truncate text-[0.66rem] opacity-80">{entry.attendee}</p>
      )}
    </button>
  );
}

/* ----------------------------------------------------------------- Day */

function DayView({
  cursor,
  grouped,
  onSelect,
}: {
  cursor: Date;
  grouped: Map<string, CalendarEntry[]>;
  onSelect: (entry: CalendarEntry) => void;
}) {
  const items = grouped.get(dayKey(cursor)) ?? [];

  if (items.length === 0) {
    return (
      <EmptyState
        icon={<CalendarDays />}
        title="Nothing scheduled"
        description="Coaching sessions, live events and community events for this day will appear here."
      />
    );
  }

  return (
    <ul className="divide-y divide-hairline/60">
      {items.map((entry) => (
        <li key={entry.id}>
          <button
            type="button"
            onClick={() => onSelect(entry)}
            className="flex w-full items-start gap-4 px-5 py-4 text-left transition-colors hover:bg-raise"
          >
            <span className="w-[10.5rem] shrink-0 font-numeric text-[0.82rem] font-semibold tabular-nums text-accent">
              {formatRange(entry)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[0.92rem] font-semibold text-ink">
                {entry.title}
              </span>
              <span className="mt-0.5 block truncate text-[0.78rem] text-ink-soft">
                {[entry.type, entry.attendee].filter(Boolean).join(" · ")}
              </span>
            </span>
            <StatusBadge entry={entry} />
          </button>
        </li>
      ))}
    </ul>
  );
}

/* -------------------------------------------------------------- Agenda */

function AgendaView({
  entries,
  onSelect,
}: {
  entries: CalendarEntry[];
  onSelect: (entry: CalendarEntry) => void;
}) {
  const grouped = useMemo(() => byDay(entries), [entries]);
  const days = [...grouped.keys()].sort();

  if (days.length === 0) {
    return (
      <EmptyState
        icon={<CalendarDays />}
        title="Nothing coming up"
        description="Your next two months are clear. Bookings and events will appear here as they are made."
      />
    );
  }

  return (
    <div className="divide-y divide-hairline/60">
      {days.map((key) => {
        const items = grouped.get(key) ?? [];
        // `key` is a local calendar day; parse it as local so the heading
        // cannot land on the day before.
        const [y, m, d] = key.split("-").map(Number);
        const date = new Date(y, m - 1, d);
        return (
          <section key={key}>
            <div className="flex items-baseline gap-3 bg-raise/70 px-5 py-2">
              <h3 className="font-numeric text-[0.82rem] font-semibold tabular-nums text-ink">
                {date.toLocaleDateString(undefined, {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                })}
              </h3>
              <span className="text-[0.72rem] text-ink-soft">
                {pluralize(items.length, "thing", "things")}
              </span>
            </div>
            <ul className="divide-y divide-hairline/50">
              {items.map((entry) => (
                <li key={entry.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(entry)}
                    className="flex w-full items-center gap-4 px-5 py-3 text-left transition-colors hover:bg-raise"
                  >
                    <span className="w-[10.5rem] shrink-0 font-numeric text-[0.8rem] font-semibold tabular-nums text-accent">
                      {formatRange(entry)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[0.88rem] font-medium text-ink">
                        {entry.title}
                      </span>
                      <span className="block truncate text-[0.75rem] text-ink-soft">
                        {[entry.type, entry.attendee].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    <StatusBadge entry={entry} />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

/* --------------------------------------------------------------- Shared */

const STATUS_TONE: Record<string, "green" | "gold" | "red" | "slate"> = {
  scheduled: "gold",
  completed: "green",
  cancelled: "red",
  published: "green",
  draft: "slate",
};

function StatusBadge({ entry }: { entry: CalendarEntry }) {
  return (
    <Badge tone={STATUS_TONE[entry.status] ?? "slate"} className="hidden shrink-0 sm:inline-flex">
      {entry.status}
    </Badge>
  );
}

/** §5's event-details drawer. */
function EventDrawer({
  entry,
  onClose,
}: {
  entry: CalendarEntry | null;
  onClose: () => void;
}) {
  const facts: { label: string; value: ReactNode }[] = entry
    ? [
        { label: "When", value: formatRange(entry) },
        {
          label: "Date",
          value: new Date(entry.start).toLocaleDateString(undefined, {
            weekday: "long",
            day: "numeric",
            month: "long",
            year: "numeric",
          }),
        },
        { label: "Type", value: entry.type },
        ...(entry.attendee ? [{ label: "Attendee", value: entry.attendee }] : []),
        ...(entry.attendeeEmail ? [{ label: "Email", value: entry.attendeeEmail }] : []),
        ...entry.detail.map((d) => ({ label: d.label, value: d.value })),
        {
          label: "Where",
          value: entry.location ? (
            <a
              href={entry.location}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-medium text-accent hover:underline"
            >
              Join
              <ExternalLink aria-hidden className="size-3.5" />
            </a>
          ) : (
            "—"
          ),
        },
        {
          // §5 asks for the source on every event. One value today; the field
          // is what makes a Google-sourced row readable when there is one.
          label: "Source",
          value: entry.source === "boss-clinician" ? "Boss Clinician" : entry.source,
        },
        { label: "Status", value: <StatusBadge entry={entry} /> },
        ...(entry.timezone ? [{ label: "Timezone", value: entry.timezone }] : []),
      ]
    : [];

  return (
    <Drawer
      open={entry !== null}
      onOpenChange={(open) => !open && onClose()}
      title={entry?.title ?? ""}
      description={entry?.type}
      footer={
        entry && (
          <Button variant="primary" size="sm" asChild>
            <Link to={entry.to}>
              <Users />
              Open record
            </Link>
          </Button>
        )
      }
    >
      {entry && <DrawerFacts items={facts} />}
    </Drawer>
  );
}
