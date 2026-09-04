import { useEffect, useState } from "react";
import { CalendarPlus, Clock, Loader2, PlayCircle, Radio, Video } from "lucide-react";
import { Seo } from "@/components/Seo";
import { MemberShell } from "@/components/member/MemberShell";
import { GlassCard } from "@/components/luxe/GlassCard";
import { LuxeButton } from "@/components/luxe/LuxeButton";
import { MemberApiError } from "@/lib/memberApi";
import { memberEventsApi, type MemberEvent } from "@/lib/memberEventsApi";
import { formatDate } from "@/lib/format";

/**
 * "What am I signed up for?"
 *
 * The public side has always been able to register somebody and email them a
 * confirmation carrying the room link, the calendar file and, later, the
 * replay. What it could not do was answer this question — the links lived only
 * in that email, so a member who lost it lost the room with it.
 *
 * The room link is deliberately absent until the room is actually open. A link
 * that does nothing is worse than no link, because somebody will sit on it
 * waiting for the session to start.
 */

export default function MemberEvents() {
  const [data, setData] = useState<{ upcoming: MemberEvent[]; past: MemberEvent[] } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await memberEventsApi.list();
        if (!cancelled) setData(res);
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof MemberApiError
            ? err.message
            : "We couldn't load your events just now. Please try again.",
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <MemberShell
      title="Your events"
      description="Everything you have signed up for, with the room link when it opens and the replay while it lasts."
    >
      <Seo title="Your events | Boss Clinician" />

      {error && (
        <GlassCard accent="gold" spotlight={false} interactive={false} className="p-6">
          <p className="copy-luxe text-sm">{error}</p>
        </GlassCard>
      )}

      {!data && !error && (
        <div className="grid place-items-center py-20">
          <Loader2 aria-hidden className="size-6 animate-spin text-gold" />
          <span className="sr-only">Loading your events</span>
        </div>
      )}

      {data && data.upcoming.length === 0 && data.past.length === 0 && (
        <GlassCard accent="gold" spotlight={false} interactive={false} className="p-8 text-center">
          <h2 className="font-display text-xl text-white">Nothing booked yet</h2>
          <p className="copy-luxe mx-auto mt-2 max-w-md text-sm">
            When you register for a masterclass or a live session, it will show
            up here with the joining link and a calendar invitation.
          </p>
          <LuxeButton variant="foil" size="md" href="/events" className="mt-6 min-h-[44px]">
            See what's coming up
          </LuxeButton>
        </GlassCard>
      )}

      {data && data.upcoming.length > 0 && (
        <section className="mb-10">
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-[0.14em] text-white/50">
            Coming up
          </h2>
          <ul className="space-y-4">
            {data.upcoming.map((event) => (
              <EventRow key={event.registrationId} event={event} />
            ))}
          </ul>
        </section>
      )}

      {data && data.past.length > 0 && (
        <section>
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-[0.14em] text-white/50">
            Already happened
          </h2>
          <ul className="space-y-4">
            {data.past.map((event) => (
              <EventRow key={event.registrationId} event={event} past />
            ))}
          </ul>
        </section>
      )}
    </MemberShell>
  );
}

function EventRow({ event, past = false }: { event: MemberEvent; past?: boolean }) {
  return (
    <li>
      <GlassCard
        accent={event.live ? "gold" : "plum"}
        spotlight={false}
        interactive={false}
        className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center"
      >
        {event.coverImage ? (
          <img
            src={event.coverImage}
            alt=""
            className="h-24 w-full shrink-0 rounded-xl object-cover sm:w-40"
          />
        ) : (
          <span className="grid h-24 w-full shrink-0 place-items-center rounded-xl bg-white/[0.05] sm:w-40">
            <Video aria-hidden className="size-6 text-white/40" />
          </span>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-display text-lg text-white">{event.title}</h3>
            {event.live && (
              <span className="inline-flex min-h-6 items-center gap-1.5 rounded-full bg-gold/15 px-2.5 text-[0.65rem] font-bold uppercase tracking-[0.1em] text-gold">
                <Radio aria-hidden className="size-3" />
                On now
              </span>
            )}
            {past && event.attended && (
              <span className="text-[0.65rem] font-bold uppercase tracking-[0.1em] text-green-bright">
                You came
              </span>
            )}
          </div>
          <p className="copy-luxe mt-1 flex items-center gap-1.5 text-sm">
            <Clock aria-hidden className="size-3.5 shrink-0" />
            {event.sessionLabel}
          </p>
          {event.replayExpiresAt && event.replayUrl && (
            <p className="mt-1 text-xs text-white/50">
              Replay available until {formatDate(event.replayExpiresAt)}
            </p>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap gap-2">
          {event.roomUrl && (
            <LuxeButton variant="foil" size="sm" href={event.roomUrl} className="min-h-[44px]">
              Join now
            </LuxeButton>
          )}
          {event.replayUrl && (
            <LuxeButton
              variant="outline"
              size="sm"
              href={event.replayUrl}
              className="min-h-[44px]"
            >
              <PlayCircle aria-hidden className="size-4" />
              Watch the replay
            </LuxeButton>
          )}
          {!past && (
            <a
              href={event.icsUrl}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-white/15 px-4 text-sm font-semibold text-white/80 transition-colors hover:border-white/30"
            >
              <CalendarPlus aria-hidden className="size-4" />
              Add to calendar
            </a>
          )}
        </div>
      </GlassCard>
    </li>
  );
}
