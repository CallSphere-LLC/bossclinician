import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import {
  ArrowLeft,
  Ban,
  CalendarClock,
  Clock,
  Download,
  Loader2,
  Mic,
  Paperclip,
  Video,
} from "lucide-react";
import { Seo } from "@/components/Seo";
import { MemberShell } from "@/components/member/MemberShell";
import { GlassCard } from "@/components/luxe/GlassCard";
import { LuxeButton, LuxePill } from "@/components/luxe/LuxeButton";
import { LuxeTextarea } from "@/components/luxe/LuxeField";
import { useMember } from "@/hooks/useMember";
import { MemberApiError } from "@/lib/memberApi";
import { coachingApi, type CoachingSessionDetail } from "@/lib/coachingApi";
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

  const [session, setSession] = useState<CoachingSessionDetail | null>(null);
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
      setSession(await coachingApi.session(id));
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
  const when = session?.scheduledAt ? formatFullDateTime(session.scheduledAt, timezone) : "";

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

      {session && (
        <div className="mt-4 grid gap-6">
          <TimezoneNotice
            timezone={timezone}
            onChange={setTimezone}
            deviceTimezone={deviceTimezone}
          />

          <WhenCard session={session} timezone={timezone} />

          <AgendaCard
            session={session}
            viewingAsAdmin={viewingAsAdmin}
            onSaved={setSession}
          />

          <NotesCard session={session} viewingAsAdmin={viewingAsAdmin} onSaved={setSession} />

          {(session.recordingUrl || session.files.length > 0) && (
            <AfterwardsCard session={session} />
          )}

          {(session.cancellation.canReschedule || session.cancellation.canCancel) && (
            <GlassCard spotlight={false} interactive={false} className="p-5 sm:p-6">
              <h2 className="font-display text-lg text-white">Need to change it?</h2>
              <p className="copy-luxe mt-2 max-w-xl text-sm">
                {rescheduleSentence(session.policy)} {creditReturnSentence(session.policy)}
              </p>
              <div className="mt-5 flex flex-wrap gap-3">
                {session.cancellation.canReschedule && (
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
                {session.cancellation.canCancel && (
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
            timezone={timezone}
            onTimezoneChange={setTimezone}
            deviceTimezone={deviceTimezone}
            viewingAsAdmin={viewingAsAdmin}
            onRescheduled={(updated) => {
              setSession(updated);
              toast.success(
                `Moved to ${updated.scheduledAt ? formatFullDateTime(updated.scheduledAt, timezone) : "a new time"}.`,
              );
            }}
          />

          <CancelSessionDialog
            open={cancelling}
            onOpenChange={setCancelling}
            session={session}
            timezone={timezone}
            viewingAsAdmin={viewingAsAdmin}
            onCancelled={(result) => {
              setSession(result.session);
              toast.success(
                result.creditReturned
                  ? "Cancelled. The session is back on your package."
                  : "Cancelled. That session counted as used.",
              );
            }}
          />
        </div>
      )}
    </MemberShell>
  );
}

/* ── When and where ─────────────────────────────────────────────────────── */

function WhenCard({
  session,
  timezone,
}: {
  session: CoachingSessionDetail;
  timezone: string;
}) {
  const cancelled = session.status === "cancelled";
  const upcoming = session.status === "scheduled";
  const differentZone =
    session.scheduledAt !== null && !sameClock(session.timezone, timezone, session.scheduledAt);

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
            : upcoming && session.scheduledAt
              ? formatRelativeDay(session.scheduledAt, timezone)
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
        {session.scheduledAt ? formatFullDateTime(session.scheduledAt, timezone) : "No time set yet"}
      </p>

      {/* Only when the two differ: a member who booked in Eastern and is now
          reading in Pacific needs both, and nobody else needs the clutter. */}
      {differentZone && session.scheduledAt && (
        <p className="mt-1.5 text-sm text-orchid-dim">
          Booked as {formatFullDateTime(session.scheduledAt, session.timezone)}.
        </p>
      )}

      {cancelled && session.cancelReason && (
        <p className="copy-luxe mt-3 text-sm">Reason given: {session.cancelReason}</p>
      )}

      {upcoming && (
        <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-3">
          {session.meetingUrl && (
            <LuxeButton href={session.meetingUrl} target="_blank" variant="foil" size="sm">
              <Video aria-hidden className="size-4" />
              Join the call
            </LuxeButton>
          )}
          {session.scheduledAt && (
            <AddToCalendar
              icsUrl={session.calendarUrl}
              title={`${session.offerTitle} with Yvette Howard`}
              startsAt={session.scheduledAt}
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

/* ── Agenda ─────────────────────────────────────────────────────────────── */

function AgendaCard({
  session,
  viewingAsAdmin,
  onSaved,
}: {
  session: CoachingSessionDetail;
  viewingAsAdmin: boolean;
  onSaved: (session: CoachingSessionDetail) => void;
}) {
  const editable = session.status === "scheduled" && !viewingAsAdmin;

  return (
    <EditableTextCard
      heading="What you want to work on"
      blurb="Yvette reads this before you meet, so the call can start on the real thing."
      empty="Nothing written down yet."
      value={session.agenda}
      editable={editable}
      label="Your agenda"
      onSave={(next) => coachingApi.updateSession(session.id, { agenda: next })}
      onSaved={onSaved}
      savedMessage="Your agenda is saved."
    />
  );
}

/* ── Shared notes ───────────────────────────────────────────────────────── */

function NotesCard({
  session,
  viewingAsAdmin,
  onSaved,
}: {
  session: CoachingSessionDetail;
  viewingAsAdmin: boolean;
  onSaved: (session: CoachingSessionDetail) => void;
}) {
  return (
    <EditableTextCard
      heading="Shared notes"
      blurb="A single page you and Yvette both write on — actions, numbers, the wording you landed on. Anything she types here appears for you too."
      empty="No notes yet. They usually turn up during or just after the call."
      value={session.sharedNotes}
      editable={session.status !== "cancelled" && !viewingAsAdmin}
      label="Shared notes"
      onSave={(next) => coachingApi.updateSession(session.id, { sharedNotes: next })}
      onSaved={onSaved}
      savedMessage="Notes saved."
    />
  );
}

/**
 * Both text panels are the same thing: a block of prose the member may edit
 * while the session is live, and read afterwards.
 */
function EditableTextCard({
  heading,
  blurb,
  empty,
  value,
  editable,
  label,
  onSave,
  onSaved,
  savedMessage,
}: {
  heading: string;
  blurb: string;
  empty: string;
  value: string;
  editable: boolean;
  label: string;
  onSave: (value: string) => Promise<CoachingSessionDetail>;
  onSaved: (session: CoachingSessionDetail) => void;
  savedMessage: string;
}) {
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const lastFromServer = useRef(value);

  // Anything that returns the whole session — a reschedule, a cancel — replaces
  // this text under the box. An untouched box adopts the new text; a box with
  // unsaved edits in it keeps them, because losing typing to a background
  // refresh is unforgivable.
  useEffect(() => {
    if (lastFromServer.current === value) return;
    setDraft((current) => (current === lastFromServer.current ? value : current));
    lastFromServer.current = value;
  }, [value]);

  const dirty = draft.trim() !== value.trim();

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      onSaved(await onSave(draft.trim()));
      toast.success(savedMessage);
    } catch (err) {
      setError(
        err instanceof MemberApiError ? err.message : "We could not save that. Please try again.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <GlassCard spotlight={false} interactive={false} className="p-5 sm:p-6">
      <h2 className="font-display text-lg text-white">{heading}</h2>
      <p className="copy-luxe mt-2 max-w-xl text-sm">{blurb}</p>

      {editable ? (
        <>
          <div className="mt-5">
            <LuxeTextarea
              label={label}
              rows={5}
              maxLength={5000}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
            />
          </div>
          <div aria-live="polite" className="mt-3 min-h-[1.25rem]">
            {error && (
              <p role="alert" className="text-sm font-medium text-red-400">
                {error}
              </p>
            )}
          </div>
          <LuxeButton
            type="button"
            variant="glass"
            size="sm"
            disabled={!dirty || saving}
            onClick={() => void save()}
          >
            {saving && <Loader2 aria-hidden className="size-4 animate-spin" />}
            {saving ? "Saving" : dirty ? "Save" : "Saved"}
          </LuxeButton>
        </>
      ) : (
        <p className="copy-luxe mt-4 whitespace-pre-wrap text-sm">{value.trim() || empty}</p>
      )}
    </GlassCard>
  );
}

/* ── Recording and files ────────────────────────────────────────────────── */

function AfterwardsCard({ session }: { session: CoachingSessionDetail }) {
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
