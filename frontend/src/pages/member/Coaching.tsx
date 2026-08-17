import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  CalendarClock,
  ChevronRight,
  Clock,
  Loader2,
  Mic,
  Sparkles,
  Video,
} from "lucide-react";
import { Seo } from "@/components/Seo";
import { MemberShell } from "@/components/member/MemberShell";
import { GlassCard } from "@/components/luxe/GlassCard";
import { LuxeButton, LuxePill } from "@/components/luxe/LuxeButton";
import { useMember } from "@/hooks/useMember";
import { MemberApiError } from "@/lib/memberApi";
import {
  coachingApi,
  type CoachingOverview,
  type CoachingPackage,
  type CoachingSessionSummary,
} from "@/lib/coachingApi";
import { cn } from "@/lib/cn";
import { CreditMeter } from "@/components/booking/CreditMeter";
import { BookingFlow } from "@/components/booking/BookingFlow";
import { TimezoneNotice } from "@/components/booking/TimezoneNotice";
import { useDisplayTimezone } from "@/components/booking/useDisplayTimezone";
import { creditReturnSentence } from "@/components/booking/policyText";
import { durationLabel, formatListDateTime, formatRelativeDay } from "@/components/booking/timezone";
import { formatDate } from "@/lib/format";

/**
 * Coaching home: what you have bought, what is in the diary, and what happened.
 *
 * Every time on this page is drawn in one named zone, set once at the top. That
 * banner is not decoration — a member who reads 9am here and 9am in their own
 * calendar has to be reading the same 9am, and the only way to guarantee that
 * is to say which clock this is.
 */
export default function Coaching() {
  const { member } = useMember();
  const { timezone, setTimezone, deviceTimezone } = useDisplayTimezone();

  const [overview, setOverview] = useState<CoachingOverview | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setOverview(await coachingApi.overview());
      setError("");
    } catch (err) {
      setError(
        err instanceof MemberApiError
          ? err.message
          : "We could not load your coaching just now. Please try again.",
      );
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const viewingAsAdmin = member?.impersonatedBy != null;
  const hasPackages = (overview?.packages.length ?? 0) > 0;
  const bookable = overview?.packages.filter((row) => row.bookable) ?? [];

  return (
    <MemberShell
      title="Coaching"
      description="Your sessions with Yvette — what is booked, what is left on your package, and everything you have already worked through."
    >
      <Seo title="Coaching | Boss Clinician" />

      <div aria-live="polite">
        {error && (
          <p role="alert" className="text-sm font-medium text-red-400">
            {error}
          </p>
        )}
        {!error && overview === null && (
          <p className="flex items-center gap-2.5 text-sm text-orchid-dim">
            <Loader2 aria-hidden className="size-4 animate-spin" />
            Loading your coaching…
          </p>
        )}
      </div>

      {overview && (
        <div className="grid gap-6">
          <TimezoneNotice
            timezone={timezone}
            onChange={setTimezone}
            deviceTimezone={deviceTimezone}
          />

          {!hasPackages && overview.upcoming.length === 0 && overview.past.length === 0 ? (
            <NoCoachingYet />
          ) : (
            <>
              {overview.upcoming.length > 0 && (
                <section aria-labelledby="upcoming-heading">
                  <h2
                    id="upcoming-heading"
                    className="font-display text-xl text-white"
                  >
                    Coming up
                  </h2>
                  <ul className="mt-4 grid gap-3">
                    {overview.upcoming.map((session) => (
                      <li key={session.id}>
                        <UpcomingCard session={session} timezone={timezone} />
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {hasPackages && (
                <section aria-labelledby="packages-heading">
                  <h2 id="packages-heading" className="font-display text-xl text-white">
                    Your packages
                  </h2>
                  <ul className="mt-4 grid gap-3 sm:grid-cols-2">
                    {overview.packages.map((row) => (
                      <li key={row.creditId}>
                        <PackageCard row={row} />
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {bookable.length > 0 ? (
                <BookingFlow
                  packages={overview.packages}
                  policy={overview.policy}
                  coachTimezone={overview.coachTimezone}
                  timezone={timezone}
                  viewingAsAdmin={viewingAsAdmin}
                  onBooked={() => void load()}
                />
              ) : (
                hasPackages && <OutOfCredits />
              )}

              {overview.past.length > 0 && (
                <section aria-labelledby="past-heading">
                  <h2 id="past-heading" className="font-display text-xl text-white">
                    Already done
                  </h2>
                  <GlassCard spotlight={false} interactive={false} className="mt-4 px-5 sm:px-6">
                    <ul className="divide-y divide-white/[0.07]">
                      {overview.past.map((session) => (
                        <li key={session.id}>
                          <PastRow session={session} timezone={timezone} />
                        </li>
                      ))}
                    </ul>
                  </GlassCard>
                </section>
              )}

              <p className="copy-luxe max-w-2xl text-sm">{creditReturnSentence(overview.policy)}</p>
            </>
          )}
        </div>
      )}
    </MemberShell>
  );
}

/* ── Upcoming ───────────────────────────────────────────────────────────── */

function UpcomingCard({
  session,
  timezone,
}: {
  session: CoachingSessionSummary;
  timezone: string;
}) {
  return (
    <GlassCard accent="gold" spotlight={false} interactive={false} className="p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2.5">
            <LuxePill accent="gold">
              {session.scheduledAt ? formatRelativeDay(session.scheduledAt, timezone) : "Unscheduled"}
            </LuxePill>
            <span className="text-sm text-orchid-dim">{session.offerTitle}</span>
          </p>
          <p className="mt-2.5 text-balance font-display text-xl leading-snug text-white">
            {session.scheduledAt ? formatListDateTime(session.scheduledAt, timezone) : "No time yet"}
          </p>
          <p className="mt-1.5 flex items-center gap-2 text-sm text-orchid">
            <Clock aria-hidden className="size-3.5 text-gold" />
            {durationLabel(session.durationMinutes)}
          </p>
          {session.agenda && (
            <p className="copy-luxe mt-3 line-clamp-2 max-w-lg text-sm">{session.agenda}</p>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap gap-3">
          {session.meetingUrl && (
            <LuxeButton href={session.meetingUrl} target="_blank" variant="foil" size="sm">
              <Video aria-hidden className="size-4" />
              Join
            </LuxeButton>
          )}
          <LuxeButton to={`/coaching/sessions/${session.id}`} variant="glass" size="sm">
            Details
          </LuxeButton>
        </div>
      </div>
    </GlassCard>
  );
}

/* ── Packages ───────────────────────────────────────────────────────────── */

function PackageCard({ row }: { row: CoachingPackage }) {
  return (
    <GlassCard
      spotlight={false}
      interactive={false}
      className={cn("h-full p-5 sm:p-6", !row.bookable && "opacity-75")}
    >
      <div className="flex flex-wrap items-center gap-2.5">
        <h3 className="font-display text-lg text-white">{row.title}</h3>
        {row.format === "group" && <LuxePill accent="plum">Group</LuxePill>}
      </div>
      <p className="mt-1.5 text-sm text-orchid-dim">{durationLabel(row.durationMinutes)} a call</p>

      <CreditMeter used={row.sessionsUsed} total={row.sessionsTotal} className="mt-5" />

      {row.expiresAt && (
        <p className="mt-3 text-xs text-orchid-faint">Use these by {formatDate(row.expiresAt)}</p>
      )}
      {!row.bookable && row.unavailableReason && (
        <p className="mt-3 text-xs font-medium text-amber-300">{row.unavailableReason}</p>
      )}
    </GlassCard>
  );
}

/* ── Past ───────────────────────────────────────────────────────────────── */

const STATUS_LABEL: Record<CoachingSessionSummary["status"], string> = {
  scheduled: "Scheduled",
  completed: "Completed",
  cancelled: "Cancelled",
  no_show: "Missed",
};

function PastRow({ session, timezone }: { session: CoachingSessionSummary; timezone: string }) {
  return (
    <Link
      to={`/coaching/sessions/${session.id}`}
      className={cn(
        "group flex min-h-[3.5rem] items-center gap-4 py-4",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold",
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-white transition-colors duration-300 group-hover:text-gold">
          {session.offerTitle}
        </p>
        <p className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-orchid-faint">
          {session.scheduledAt ? formatListDateTime(session.scheduledAt, timezone) : "No time set"}
          <span aria-hidden>·</span>
          {STATUS_LABEL[session.status]}
          {session.hasRecording && (
            <>
              <span aria-hidden>·</span>
              <span className="inline-flex items-center gap-1 text-gold">
                <Mic aria-hidden className="size-3" />
                Recording
              </span>
            </>
          )}
        </p>
      </div>
      <ChevronRight aria-hidden className="size-4 shrink-0 text-orchid-dim" />
    </Link>
  );
}

/* ── Empty states ───────────────────────────────────────────────────────── */

function NoCoachingYet() {
  return (
    <GlassCard
      spotlight={false}
      interactive={false}
      className="flex flex-col items-center px-6 py-16 text-center sm:px-8"
    >
      <span
        aria-hidden
        className="grid size-14 place-items-center rounded-full border border-gold/25 bg-gold/[0.08]"
      >
        <Sparkles className="size-6 text-gold" />
      </span>
      <h2 className="mt-6 font-display text-2xl text-white">No coaching on your account yet</h2>
      <p className="copy-luxe mt-3 max-w-md text-balance text-sm">
        Coaching is one-to-one time with Yvette on whatever is actually in the way — pricing,
        caseload, the thing you keep putting off. Once you have a package, you book your calls here.
      </p>
      <div className="mt-8">
        <LuxeButton to="/work-with-me" variant="foil" size="sm">
          See how coaching works
        </LuxeButton>
      </div>
    </GlassCard>
  );
}

function OutOfCredits() {
  return (
    <GlassCard spotlight={false} interactive={false} className="p-5 sm:p-8">
      <div className="flex items-start gap-4">
        <span
          aria-hidden
          className="grid size-11 shrink-0 place-items-center rounded-full border border-white/12 bg-white/[0.04]"
        >
          <CalendarClock className="size-5 text-orchid-dim" />
        </span>
        <div className="min-w-0">
          <h2 className="font-display text-xl text-white">Nothing left to book</h2>
          <p className="copy-luxe mt-2 max-w-md text-sm">
            You have used every session on your packages. Adding more takes a minute, and your
            history here stays exactly as it is.
          </p>
          <div className="mt-5">
            <LuxeButton to="/work-with-me" variant="glass" size="sm">
              Add more sessions
            </LuxeButton>
          </div>
        </div>
      </div>
    </GlassCard>
  );
}
