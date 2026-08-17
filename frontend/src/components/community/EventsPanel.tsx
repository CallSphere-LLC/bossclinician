import { useEffect, useState } from "react";
import { CalendarDays, Users } from "lucide-react";
import { toast } from "sonner";
import { AddToCalendar } from "@/components/booking/AddToCalendar";
import { SidebarPanel } from "@/components/community/SidebarPanel";
import { MemberApiError } from "@/lib/memberApi";
import {
  communityApi,
  safeLink,
  type CommunityEvent,
  type RsvpStatus,
} from "@/lib/communityApi";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/cn";

/**
 * What is coming up, and whether the member is going.
 *
 * The RSVP flips before the request lands, because three buttons that all sit
 * there looking identical for half a second is how somebody taps "Going" twice.
 * The going-count is taken from the response rather than nudged locally — other
 * people are answering at the same time, and only the server knows the total.
 *
 * Times are drawn in the reader's own zone by `formatDateTime`, which is the
 * only zone that can be right without asking. `startsAt` crosses the wire as a
 * UTC instant precisely so that conversion is this side's job.
 */

const RSVP_CHOICES: { status: RsvpStatus; label: string }[] = [
  { status: "going", label: "Going" },
  { status: "maybe", label: "Maybe" },
  { status: "declined", label: "Can't" },
];

export function EventsPanel({ communitySlug }: { communitySlug: string }) {
  const [events, setEvents] = useState<CommunityEvent[] | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await communityApi.events(communitySlug);
        if (!cancelled) {
          setEvents(data.upcoming);
          setError("");
        }
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof MemberApiError ? err.message : "We could not load the calendar.",
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [communitySlug]);

  const rsvp = async (event: CommunityEvent, status: RsvpStatus) => {
    if (saving !== null || event.myStatus === status) return;
    const before = events ?? [];
    setSaving(event.id);
    setEvents(before.map((e) => (e.id === event.id ? { ...e, myStatus: status } : e)));

    try {
      const result = await communityApi.rsvp(event.id, status);
      setEvents((current) =>
        (current ?? []).map((e) =>
          e.id === result.eventId
            ? { ...e, myStatus: result.status, goingCount: result.goingCount }
            : e,
        ),
      );
    } catch (err) {
      setEvents(before);
      toast.error(
        err instanceof MemberApiError ? err.message : "Your RSVP did not save. Please try again.",
      );
    } finally {
      setSaving(null);
    }
  };

  return (
    <SidebarPanel
      title="Coming up"
      icon={<CalendarDays aria-hidden className="size-4 text-gold" />}
      loading={events === null && !error}
      error={error}
      isEmpty={events?.length === 0}
      empty="Nothing on the calendar right now."
    >
      <ul className="flex flex-col gap-5">
        {events?.map((event) => (
          <li key={event.id} className="border-b border-white/[0.07] pb-5 last:border-0 last:pb-0">
            <p className="font-semibold leading-snug text-white">{event.title}</p>

            {event.startsAt && (
              <p className="mt-1 text-xs text-orchid">
                <time dateTime={event.startsAt}>{formatDateTime(event.startsAt)}</time>
                {event.durationMinutes > 0 && ` · ${event.durationMinutes} min`}
              </p>
            )}

            {event.description && (
              <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-orchid-dim">
                {event.description}
              </p>
            )}

            <p className="mt-2 flex items-center gap-1.5 text-xs text-orchid-faint">
              <Users aria-hidden className="size-3.5" />
              {event.goingCount} going
            </p>

            <div
              role="group"
              aria-label={`RSVP to ${event.title}`}
              className="mt-3 flex flex-wrap gap-1.5"
            >
              {RSVP_CHOICES.map((choice) => {
                const active = event.myStatus === choice.status;
                return (
                  <button
                    key={choice.status}
                    type="button"
                    onClick={() => void rsvp(event, choice.status)}
                    disabled={saving === event.id}
                    aria-pressed={active}
                    className={cn(
                      "min-h-[2.75rem] rounded-full border px-4",
                      "text-[0.65rem] font-semibold uppercase tracking-[0.12em]",
                      "transition-colors duration-300 disabled:opacity-50",
                      "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold",
                      active
                        ? "border-gold/50 bg-gold/[0.12] text-gold"
                        : "border-white/12 bg-white/[0.03] text-white/60 hover:border-white/25 hover:text-white",
                    )}
                  >
                    {choice.label}
                  </button>
                );
              })}
            </div>

            {event.startsAt && event.myStatus === "going" && (
              <div className="mt-3">
                {/* No `.ics` route exists for community events, so no session
                    id is passed and the component offers only the Google link
                    it builds from these same fields. */}
                <AddToCalendar
                  title={event.title}
                  startsAt={event.startsAt}
                  durationMinutes={event.durationMinutes || 60}
                  meetingUrl={safeLink(event.locationUrl)}
                  agenda={event.description}
                />
              </div>
            )}
          </li>
        ))}
      </ul>
    </SidebarPanel>
  );
}
