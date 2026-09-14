import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { toast } from "sonner";
import {
  ArrowLeft,
  Ban,
  CalendarClock,
  Clock,
  Download,
  Loader2,
  Mic,
  NotebookPen,
  Paperclip,
  Video,
} from "lucide-react";
import { Seo } from "@/components/Seo";
import { MemberShell } from "@/components/member/MemberShell";
import { GlassCard } from "@/components/luxe/GlassCard";
import { LuxeButton, LuxePill } from "@/components/luxe/LuxeButton";
import { useMember } from "@/hooks/useMember";
import { MemberApiError } from "@/lib/memberApi";
import { coachingApi, type CoachingPolicy, type CoachingSession } from "@/lib/coachingApi";
import { cn } from "@/lib/cn";
import { AddToCalendar } from "@/components/booking/AddToCalendar";
import { CancelSessionDialog } from "@/components/booking/CancelSessionDialog";
import { RescheduleDialog } from "@/components/booking/RescheduleDialog";
import { TimezoneNotice } from "@/components/booking/TimezoneNotice";
import { useDisplayTimezone } from "@/components/booking/useDisplayTimezone";
import { creditReturnSentence, rescheduleSentence } from "@/components/booking/policyText";
import {
  durationLabel,
  formatFullDateTime,
  formatRelativeDay,
  sameClock,
} from "@/components/booking/timezone";

/**
 * One coaching call, before and after it happens.
 *
 * Before: what you are going to talk about, and the two ways out — move it or
 * drop it. After: the recording, the notes, whatever was shared.
 *
 * A member who does not own this session gets the not-found panel, which is the
 * same thing a stranger gets. Nothing here reveals that the id exists.
 */
export default function CoachingSession() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const { member } = useMember();
  const { timezone, setTimezone, deviceTimezone } = useDisplayTimezone();

  const [session, setSession] = useState<CoachingSession | null>(null);
  const [policy, setPolicy] = useState<CoachingPolicy | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState("");
  const [rescheduling, setRescheduling] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const load = useCallback(async () => {
    if (!Number.isInteger(id) || id <= 0) {
      setMissing(true);
      return;
    }
    try {
      // The policy lives on the overview rather than on the session, and both
      // the reschedule picker and the cancel dialog need it before they can say
      // anything truthful — so neither screen opens until both have landed.
      const [detail, overview] = await Promise.all([
        coachingApi.session(id),
        coachingApi.overview(),
      ]);
      setSession(detail.session);
      setPolicy(overview.policy);
      setError("");
    } catch (err) {
      if (err instanceof MemberApiError && err.status === 404) {
        setMissing(true);
        return;
      }
      setError(
        err instanceof MemberApiError
          ? err.message
          : "We could not load this session just now. Please try again.",
      );
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const viewingAsAdmin = member?.impersonatedBy != null;

  if (missing) return <NotFoundPanel />;

  const heading = session?.offerTitle || "Coaching session";
  const when = session?.startsAt ? formatFullDateTime(session.startsAt, timezone) : "";

  return (
    <MemberShell title={heading} description={when || undefined}>
      <Seo title={`${heading} | Boss Clinician`} />

      <Link
        to="/coaching"
        className="inline-flex min-h-[2.75rem] items-center gap-2 text-sm text-orchid-dim transition-colors duration-300 hover:text-white"
      >
        <ArrowLeft aria-hidden className="size-4" />
        All coaching
      </Link>

      <div aria-live="polite" className="mt-4">
        {error && (
          <p role="alert" className="text-sm font-medium text-red-400">
            {error}
          </p>
        )}
        {!error && session === null && (
          <p className="flex items-center gap-2.5 text-sm text-orchid-dim">
            <Loader2 aria-hidden className="size-4 animate-spin" />
            Loading this session…
          </p>
        )}
      </div>

      {session && policy && (
        <div className="mt-4 grid gap-6">
          <TimezoneNotice
            timezone={timezone}
            onChange={setTimezone}
            deviceTimezone={deviceTimezone}
          />

          <WhenCard session={session} timezone={timezone} />

          <AgendaCard session={session} />

          <NotesCard session={session} />

          {(session.recordingUrl || session.files.length > 0) && (
            <AfterwardsCard session={session} />
          )}

          {(session.canReschedule || session.canCancel) && (
            <GlassCard spotlight={false} interactive={false} className="p-5 sm:p-6">
              <h2 className="font-display text-lg text-white">Need to change it?</h2>
              <p className="copy-luxe mt-2 max-w-xl text-sm">
                {rescheduleSentence(policy)} {creditReturnSentence(policy)}
              </p>
              {session.changeDeadline && session.cancelRefundsCredit && (
                <p className="mt-2 text-sm text-orchid">
                  That means you have until{" "}
                  <strong className="font-semibold text-white">
                    {formatFullDateTime(session.changeDeadline, timezone)}
                  </strong>
                  .
                </p>
              )}
              {session.canCancel && !session.cancelRefundsCredit && (
                <p className="mt-2 text-sm font-medium text-amber-300">
                  You are inside that window now, so cancelling will use the session up.
                </p>
              )}
              <div className="mt-5 flex flex-wrap gap-3">
                {session.canReschedule && (
                  <LuxeButton
                    type="button"
                    variant="glass"
                    size="sm"
                    onClick={() => setRescheduling(true)}
                  >
                    <CalendarClock aria-hidden className="size-4" />
                    Move this call
                  </LuxeButton>
                )}
                {session.canCancel && (
                  <LuxeButton
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setCancelling(true)}
                    className="border-red-400/40 text-red-200 hover:border-red-400 hover:bg-red-500/[0.12] hover:text-white"
                  >
                    <Ban aria-hidden className="size-4" />
                    Cancel this call
                  </LuxeButton>
                )}
              </div>
            </GlassCard>
          )}

          <RescheduleDialog
            open={rescheduling}
            onOpenChange={setRescheduling}
            session={session}
            policy={policy}
            timezone={timezone}
            onTimezoneChange={setTimezone}
            deviceTimezone={deviceTimezone}
            viewingAsAdmin={viewingAsAdmin}
            onRescheduled={(updated) => {
              setSession(updated);
              toast.success(
                `Moved to ${updated.startsAt ? formatFullDateTime(updated.startsAt, timezone) : "a new time"}.`,
              );
            }}
          />

          <CancelSessionDialog
            open={cancelling}
            onOpenChange={setCancelling}
            session={session}
            policy={policy}
            timezone={timezone}
            viewingAsAdmin={viewingAsAdmin}
            onCancelled={(result) => {
              setSession(result.session);
              toast.success(result.message);
            }}
          />
        </div>
      )}
    </MemberShell>
  );
}

/* ── When and where ─────────────────────────────────────────────────────── */

function WhenCard({ session, timezone }: { session: CoachingSession; timezone: string }) {
  const cancelled = session.status === "cancelled";
  const upcoming = session.status === "scheduled";
  const differentZone =
    session.startsAt !== null && !sameClock(session.timezone, timezone, session.startsAt);

  return (
    <GlassCard
      accent={cancelled ? "neutral" : "gold"}
      spotlight={false}
      interactive={false}
      className={cn("p-5 sm:p-6", cancelled && "opacity-80")}
    >
      <div className="flex flex-wrap items-center gap-2.5">
        <LuxePill accent={cancelled ? "neutral" : upcoming ? "gold" : "green"}>
          {cancelled
            ? "Cancelled"
            : upcoming && session.startsAt
              ? formatRelativeDay(session.startsAt, timezone)
              : session.status === "no_show"
                ? "Missed"
                : "Completed"}
        </LuxePill>
        <span className="flex items-center gap-2 text-sm text-orchid">
          <Clock aria-hidden className="size-3.5 text-gold" />
          {durationLabel(session.durationMinutes)}
        </span>
      </div>

      <p className="mt-3 text-balance font-display text-xl leading-snug text-white sm:text-2xl">
        {session.startsAt ? formatFullDateTime(session.startsAt, timezone) : "No time set yet"}
      </p>

      {/* Only when the two differ: a member who booked in Eastern and is now
          reading in Pacific needs both, and nobody else needs the clutter. */}
      {differentZone && session.startsAt && (
        <p className="mt-1.5 text-sm text-orchid-dim">
          Booked as {formatFullDateTime(session.startsAt, session.timezone)}.
        </p>
      )}

      {cancelled && session.cancelReason && (
        <p className="copy-luxe mt-3 text-sm">Reason given: {session.cancelReason}</p>
      )}

      {upcoming && (
        <div className="mt-5 grid gap-4">
          {session.meetingUrl && (
            <div>
              <LuxeButton href={session.meetingUrl} target="_blank" variant="foil" size="sm">
                <Video aria-hidden className="size-4" />
                Join the call
              </LuxeButton>
            </div>
          )}
          {session.startsAt && (
            <AddToCalendar
              sessionId={session.id}
              title={`${session.offerTitle} with Yvette Howard`}
              startsAt={session.startsAt}
              durationMinutes={session.durationMinutes}
              meetingUrl={session.meetingUrl}
              agenda={session.agenda}
            />
          )}
        </div>
      )}

      {upcoming && session.meetingUrl && (
        <p className="mt-4 break-all text-xs text-orchid-faint">{session.meetingUrl}</p>
      )}
    </GlassCard>
  );
}

/* ── Agenda and notes ───────────────────────────────────────────────────── */

/**
 * What the member asked for when they booked.
 *
 * Read-only here on purpose: the agenda is written on the booking form and the
 * shared notes are Yvette's to keep during the call. Neither has a member-facing
 * write route, and an editable box that silently fails to save would be worse
 * than an honest transcript of what was agreed.
 */
function AgendaCard({ session }: { session: CoachingSession }) {
  return (
    <TextCard
      heading="What you wanted to work on"
      blurb="Written when you booked, so Yvette can read it before you meet."
      empty="Nothing was written down for this one."
      value={session.agenda}
    />
  );
}

function NotesCard({ session }: { session: CoachingSession }) {
  return (
    <TextCard
      heading="Shared notes"
      blurb="Anything Yvette writes up for you — actions, numbers, the wording you landed on."
      empty="No notes yet. They usually turn up during or just after the call."
      value={session.sharedNotes}
      icon
    />
  );
}

function TextCard({
  heading,
  blurb,
  empty,
  value,
  icon,
}: {
  heading: string;
  blurb: string;
  empty: string;
  value: string;
  icon?: boolean;
}) {
  return (
    <GlassCard spotlight={false} interactive={false} className="p-5 sm:p-6">
      <h2 className="flex items-center gap-2 font-display text-lg text-white">
        {icon && <NotebookPen aria-hidden className="size-4 text-gold" />}
        {heading}
      </h2>
      <p className="copy-luxe mt-2 max-w-xl text-sm">{blurb}</p>
      <p className="copy-luxe mt-4 whitespace-pre-wrap text-sm">{value.trim() || empty}</p>
    </GlassCard>
  );
}

/* ── Recording and files ────────────────────────────────────────────────── */

function AfterwardsCard({ session }: { session: CoachingSession }) {
  return (
    <GlassCard spotlight={false} interactive={false} className="p-5 sm:p-6">
      <h2 className="font-display text-lg text-white">From the call</h2>

      {session.recordingUrl && (
        <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <p className="flex items-center gap-2 text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-orchid">
            <Mic aria-hidden className="size-3.5 text-gold" />
            Recording
          </p>
          <LuxeButton
            href={session.recordingUrl}
            target="_blank"
            variant="glass"
            size="sm"
            className="mt-3"
          >
            Watch the recording
          </LuxeButton>
        </div>
      )}

      {session.files.length > 0 && (
        <div className="mt-4">
          <p className="flex items-center gap-2 text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-orchid">
            <Paperclip aria-hidden className="size-3.5 text-gold" />
            Attachments
          </p>
          <ul className="mt-2 divide-y divide-white/[0.07]">
            {session.files.map((file) => (
              <li key={file.id}>
                <a
                  href={file.url}
                  className="flex min-h-[3rem] items-center gap-3 py-3 text-sm text-white transition-colors duration-300 hover:text-gold"
                >
                  <Download aria-hidden className="size-4 shrink-0 text-gold" />
                  <span className="min-w-0 flex-1 truncate">{file.title || "Attachment"}</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </GlassCard>
  );
}

/* ── Not found ──────────────────────────────────────────────────────────── */

function NotFoundPanel() {
  return (
    <MemberShell title="We could not find that session">
      <Seo title="Session not found | Boss Clinician" />
      <GlassCard
        spotlight={false}
        interactive={false}
        className="flex flex-col items-center px-6 py-16 text-center sm:px-8"
      >
        <p className="copy-luxe max-w-md text-balance text-sm">
          This session is not on your account. If you followed a link from an email, it may have
          been for a different account — check which address you are signed in with.
        </p>
        <div className="mt-8">
          <LuxeButton to="/coaching" variant="foil" size="sm">
            Back to coaching
          </LuxeButton>
        </div>
      </GlassCard>
    </MemberShell>
  );
}
