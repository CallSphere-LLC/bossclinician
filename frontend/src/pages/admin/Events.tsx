import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { motion } from "motion/react";
import { CalendarDays, ExternalLink, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { adminApi } from "@/lib/api";
import type { Community, CommunityEvent } from "@/types/admin";
import { cn } from "@/lib/cn";
import { formatDateTime, formatRelative } from "@/lib/format";
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
import { friendlyError, pluralize } from "@/pages/admin/ui/friendly";
import { Modal, useConfirm } from "@/pages/admin/ui/Dialog";

interface EventWithCommunity extends CommunityEvent {
  communityName: string;
}

/**
 * "90" is a number to look at twice; "1 hour 30 minutes" is a length she can
 * picture, which is the only reason this row shows a duration at all.
 */
function formatDuration(minutes: number): string {
  if (!minutes || minutes < 1) return "No length set";
  if (minutes < 60) return pluralize(minutes, "minute");

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const hourPart = pluralize(hours, "hour");
  return rest ? `${hourPart} ${pluralize(rest, "minute")}` : hourPart;
}

/**
 * Cross-community event calendar.
 *
 * Events belong to a community (that's where members see them), so this page
 * aggregates across all of them rather than introducing a second, parallel
 * event concept that members would never encounter.
 */
export default function Events() {
  const [communities, setCommunities] = useState<Community[] | null>(null);
  const [events, setEvents] = useState<EventWithCommunity[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Partial<CommunityEvent & { communityId: number }> | null>(
    null,
  );
  const [confirm, confirmDialog] = useConfirm();

  const load = useCallback(async () => {
    try {
      const list = await adminApi.communities();
      setCommunities(list);

      const perCommunity = await Promise.all(
        list.map((community) =>
          adminApi
            .communityEvents(community.id)
            .then((rows) => rows.map((e) => ({ ...e, communityName: community.name })))
            .catch(() => [] as EventWithCommunity[]),
        ),
      );

      const flat = perCommunity.flat();
      flat.sort((a, b) => {
        // Undated events sink to the bottom; otherwise soonest first.
        if (!a.startsAt) return 1;
        if (!b.startsAt) return -1;
        return new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime();
      });
      setEvents(flat);
    } catch {
      setError("We couldn't load your events. Try refreshing the page.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!draft?.title?.trim() || !draft.communityId) return;
    try {
      await adminApi.eventCreate(draft.communityId, draft);
      toast.success("Event added to your calendar");
      setDraft(null);
      void load();
    } catch (err) {
      toast.error(friendlyError(err, "event"));
    }
  }

  // Both lists delete the same way and must say the same things about it, so
  // the confirmation and its wording live in one place.
  const removeEvent = useCallback(
    async (event: EventWithCommunity) => {
      const ok = await confirm({
        title: `Delete “${event.title}”?`,
        description: `Members of ${event.communityName} will stop seeing it. You can't undo this.`,
        confirmLabel: "Yes, delete it",
        destructive: true,
      });
      if (!ok) return;
      try {
        await adminApi.eventDelete(event.id);
        toast.success("Event deleted");
        void load();
      } catch (err) {
        toast.error(friendlyError(err, "event"));
      }
    },
    [confirm, load],
  );

  const now = Date.now();
  const upcoming = (events ?? []).filter((e) => e.startsAt && new Date(e.startsAt).getTime() >= now);
  const past = (events ?? []).filter((e) => !e.startsAt || new Date(e.startsAt).getTime() < now);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Marketing"
        title="Events"
        description="Your live sessions, Q&As and meet-ups across every community, in one calendar."
        actions={
          <Button
            size="sm"
            disabled={!communities?.length}
            onClick={() =>
              setDraft({ durationMinutes: 60, communityId: communities?.[0]?.id })
            }
          >
            <Plus />
            Add an event
          </Button>
        }
      />

      {error && <ErrorNotice message={error} />}

      {communities !== null && communities.length === 0 && (
        <Card>
          <EmptyState
            icon={<CalendarDays />}
            title="Set up a community first"
            description="Events sit inside a community, which is where your members find them and join. Once you have one, you can start putting dates in."
            action={
              <Button asChild size="sm">
                <Link to="/admin/community">Go to Community</Link>
              </Button>
            }
          />
        </Card>
      )}

      {events === null ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        communities !== null &&
        communities.length > 0 && (
          <div className="space-y-5">
            <Card>
              <CardHeader
                title="Coming up"
                subtitle={
                  upcoming.length === 0
                    ? "Nothing booked in"
                    : `${pluralize(upcoming.length, "event")} in the diary`
                }
                icon={<CalendarDays className="size-4" />}
              />
              {upcoming.length === 0 ? (
                <EmptyState
                  icon={<CalendarDays />}
                  title="Nothing coming up"
                  description="Put a live session in the diary and everyone in that community will see it waiting for them."
                />
              ) : (
                <ul className="divide-y divide-hairline/60">
                  {upcoming.map((event, i) => (
                    <EventRow
                      key={event.id}
                      event={event}
                      index={i}
                      onDelete={() => void removeEvent(event)}
                    />
                  ))}
                </ul>
              )}
            </Card>

            {past.length > 0 && (
              <Card>
                <CardHeader
                  title="Already happened"
                  subtitle={`${pluralize(past.length, "event")}, including any without a date`}
                />
                <ul className="divide-y divide-hairline/60">
                  {past.map((event, i) => (
                    <EventRow
                      key={event.id}
                      event={event}
                      index={i}
                      muted
                      onDelete={() => void removeEvent(event)}
                    />
                  ))}
                </ul>
              </Card>
            )}
          </div>
        )
      )}

      <Modal
        open={draft !== null}
        onOpenChange={(open) => !open && setDraft(null)}
        title="Add an event"
        description="Everyone in the community you pick will see it in their calendar."
        size="lg"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setDraft(null)}>
              Never mind
            </Button>
            <Button size="sm" type="submit" form="event-form">
              Add to the calendar
            </Button>
          </>
        }
      >
        {draft && (
          <form id="event-form" onSubmit={save} className="space-y-4">
            <Field label="Who is it for?" hint="the community that will see it">
              <select
                value={String(draft.communityId ?? "")}
                onChange={(e) => setDraft((d) => ({ ...d, communityId: Number(e.target.value) }))}
                className="h-11 w-full rounded-xl border border-hairline bg-surface px-3 text-sm outline-none focus-visible:border-plum"
                required
              >
                {(communities ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="What's it called?">
              <Input
                value={draft.title ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
                placeholder="Monthly member Q&A"
                required
                autoFocus
              />
            </Field>
            <Field label="What's it about?" hint="optional — your members read this">
              <Textarea
                rows={3}
                value={draft.description ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                placeholder="Bring your questions about pricing, packages and saying no."
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="When does it start?" hint="leave blank if you're still deciding">
                <Input
                  type="datetime-local"
                  value={draft.startsAt ?? ""}
                  onChange={(e) => setDraft((d) => ({ ...d, startsAt: e.target.value }))}
                />
              </Field>
              <Field label="How long is it?" hint="in minutes">
                <Input
                  type="number"
                  min={5}
                  value={draft.durationMinutes ?? 60}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, durationMinutes: Number(e.target.value) }))
                  }
                />
              </Field>
            </div>
            <Field label="Where do people join?" hint="your Zoom, Meet or wherever you're hosting">
              <Input
                value={draft.locationUrl ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, locationUrl: e.target.value }))}
                placeholder="https://zoom.us/j/…"
              />
            </Field>
          </form>
        )}
      </Modal>

      {confirmDialog}
    </div>
  );
}

function EventRow({
  event,
  index,
  muted,
  onDelete,
}: {
  event: EventWithCommunity;
  index: number;
  muted?: boolean;
  onDelete: () => void;
}) {
  return (
    <motion.li
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.03, 0.25) }}
      className={cn("flex flex-wrap items-center gap-4 px-5 py-4", muted && "opacity-70")}
    >
      <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-lilac-tint text-plum">
        <CalendarDays className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold text-ink">{event.title}</p>
        <p className="truncate text-xs text-ink-soft">
          {event.startsAt ? formatDateTime(event.startsAt) : "No date yet"} ·{" "}
          {formatDuration(event.durationMinutes)}
          {event.startsAt && ` · ${formatRelative(event.startsAt)}`}
        </p>
      </div>
      <Badge tone="plum">{event.communityName}</Badge>
      {event.locationUrl && (
        <Button asChild variant="secondary" size="sm">
          <a href={event.locationUrl} target="_blank" rel="noreferrer">
            Join
            <ExternalLink />
          </a>
        </Button>
      )}
      <Button
        variant="dangerGhost"
        size="iconSm"
        aria-label={`Delete ${event.title}`}
        onClick={onDelete}
      >
        <Trash2 />
      </Button>
    </motion.li>
  );
}
