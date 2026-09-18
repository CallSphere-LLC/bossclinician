import { useMemo, useState } from "react";
import { Link } from "react-router";
import { CheckCircle2, ChevronLeft, Clock, Info, Loader2, Video } from "lucide-react";
import { GlassCard } from "@/components/luxe/GlassCard";
import { LuxeButton, LuxePill } from "@/components/luxe/LuxeButton";
import { LuxeTextarea } from "@/components/luxe/LuxeField";
import { MemberApiError } from "@/lib/memberApi";
import {
  coachingApi,
  type BookResult,
  type CoachingPackage,
  type CoachingPolicy,
  type CoachingSession,
} from "@/lib/coachingApi";
import { cn } from "@/lib/cn";
import { CreditMeter } from "@/components/booking/CreditMeter";
import { SlotSearch } from "@/components/booking/SlotSearch";
import { ZoneLine } from "@/components/booking/TimezoneNotice";
import { AddToCalendar } from "@/components/booking/AddToCalendar";
import { creditReturnSentence, noticeSentence } from "@/components/booking/policyText";
import {
  durationLabel,
  formatFullDateTime,
  sameClock,
  zoneSentence,
} from "@/components/booking/timezone";

type Step = "package" | "slot" | "confirm" | "done";

/** A package that can actually be spent: in date, in credit, and still on sale. */
type BookablePackage = CoachingPackage & { offerSlug: string };

function isBookable(row: CoachingPackage): row is BookablePackage {
  return row.canBook && row.offerSlug !== null;
}

export function BookingFlow({
  packages,
  policy,
  siteTimezone,
  timezone,
  viewingAsAdmin,
  onBooked,
}: {
  packages: CoachingPackage[];
  policy: CoachingPolicy;
  /** The zone the business keeps its calendar in, for the "and hers is" line. */
  siteTimezone: string;
  /** The zone every time in this flow is drawn in; the page owns the control. */
  timezone: string;
  /** An admin looking at somebody else's account must not book their calls. */
  viewingAsAdmin: boolean;
  onBooked: (result: BookResult) => void;
}) {
  const bookable = useMemo(() => packages.filter(isBookable), [packages]);

  // With one package there is no choice to make, so the flow opens on the
  // calendar. Offering a one-item list is a step that exists only to be clicked.
  const [step, setStep] = useState<Step>(bookable.length === 1 ? "slot" : "package");
  const [chosenId, setChosenId] = useState<number | null>(
    bookable.length === 1 ? bookable[0].creditId : null,
  );
  const [selected, setSelected] = useState<string | null>(null);
  const [agenda, setAgenda] = useState("");
  const [booked, setBooked] = useState<CoachingSession | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  // Looked up by id rather than held as an object, so a credit count refreshed
  // by the page behind this flow shows through instead of going stale mid-book.
  const chosen = chosenId === null ? null : (bookable.find((row) => row.creditId === chosenId) ?? null);

  const pickPackage = (row: BookablePackage) => {
    setChosenId(row.creditId);
    setSelected(null);
    setStep("slot");
  };

  const confirm = async () => {
    if (!chosen || !selected) return;
    setSubmitting(true);
    setSubmitError("");
    try {
      const result = await coachingApi.book({
        offerSlug: chosen.offerSlug,
        startsAt: selected,
        // Recorded so a later "you booked this as 9am Eastern" is answerable.
        timezone,
        agenda: agenda.trim(),
      });
      setBooked(result.session);
      setStep("done");
      onBooked(result);
    } catch (error) {
      setSubmitError(
        error instanceof MemberApiError
          ? error.message
          : "We could not book that time. Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (step === "done" && booked) {
    return (
      <BookedPanel
        session={booked}
        timezone={timezone}
        canBookAgain={bookable.length > 0}
        onBookAgain={() => {
          setBooked(null);
          setSelected(null);
          setAgenda("");
          setStep(bookable.length === 1 ? "slot" : "package");
        }}
      />
    );
  }

  return (
    <GlassCard spotlight={false} interactive={false} className="p-5 sm:p-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-xl text-white">Book a call</h2>
          <p className="copy-luxe mt-1.5 text-sm">
            {step === "package"
              ? "Choose which package this call comes out of."
              : step === "slot"
                ? "Pick a time that works for you."
                : "One last look before it is in the diary."}
          </p>
        </div>
        <StepTrail step={step} showPackageStep={bookable.length !== 1} />
      </div>

      <div aria-hidden className="rule-faint my-6 w-full" />

      {step === "package" && (
        <ul className="grid gap-3">
          {bookable.map((row) => (
            <li key={row.creditId}>
              <button
                type="button"
                onClick={() => pickPackage(row)}
                className={cn(
                  "w-full rounded-2xl border border-white/12 bg-white/[0.03] p-5 text-left",
                  "transition-colors duration-300 hover:border-gold/45 hover:bg-white/[0.06]",
                  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold",
                )}
              >
                <div className="flex flex-wrap items-center gap-3">
                  <span className="font-display text-lg text-white">{row.offerTitle}</span>
                  <LuxePill accent="gold">{durationLabel(row.durationMinutes)}</LuxePill>
                  {row.format === "group" && <LuxePill accent="plum">Group</LuxePill>}
                </div>
                <CreditMeter used={row.sessionsUsed} total={row.sessionsTotal} className="mt-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {step === "slot" && chosen && (
        <div>
          {/* Restated right above the grid. The page banner above owns the
              control; this owns the reminder at the moment of the decision. */}
          <ZoneLine timezone={timezone} />

          <div className="mt-5">
            <SlotSearch
              offerSlug={chosen.offerSlug}
              timezone={timezone}
              horizonDays={policy.bookingHorizonDays}
              selected={selected}
              onSelect={setSelected}
            />
          </div>

          {/* The choice read back in full before the step advances — the third
              and last place the zone is named on the way to a booking. */}
          <p aria-live="polite" className="mt-6 min-h-[1.5rem] text-sm text-orchid">
            {selected ? (
              <>
                You have picked{" "}
                <strong className="font-semibold text-gold">
                  {formatFullDateTime(selected, timezone)}
                </strong>
              </>
            ) : (
              "Pick a time above to carry on."
            )}
          </p>

          <div className="mt-4 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
            {bookable.length === 1 ? (
              <span />
            ) : (
              <LuxeButton
                type="button"
                variant="quiet"
                onClick={() => {
                  setSelected(null);
                  setStep("package");
                }}
              >
                <ChevronLeft aria-hidden className="size-4" />
                Choose a different package
              </LuxeButton>
            )}
            <LuxeButton
              type="button"
              variant="foil"
              size="sm"
              disabled={!selected}
              onClick={() => setStep("confirm")}
            >
              Continue
            </LuxeButton>
          </div>
        </div>
      )}

      {step === "confirm" && chosen && selected && (
        <ConfirmStep
          packageRow={chosen}
          startsAt={selected}
          timezone={timezone}
          siteTimezone={siteTimezone}
          policy={policy}
          agenda={agenda}
          onAgendaChange={setAgenda}
          submitting={submitting}
          error={submitError}
          viewingAsAdmin={viewingAsAdmin}
          onBack={() => setStep("slot")}
          onConfirm={() => void confirm()}
        />
      )}
    </GlassCard>
  );
}

/* ── Confirm ────────────────────────────────────────────────────────────── */

function ConfirmStep({
  packageRow,
  startsAt,
  timezone,
  siteTimezone,
  policy,
  agenda,
  onAgendaChange,
  submitting,
  error,
  viewingAsAdmin,
  onBack,
  onConfirm,
}: {
  packageRow: BookablePackage;
  startsAt: string;
  timezone: string;
  siteTimezone: string;
  policy: CoachingPolicy;
  agenda: string;
  onAgendaChange: (value: string) => void;
  submitting: boolean;
  error: string;
  viewingAsAdmin: boolean;
  onBack: () => void;
  onConfirm: () => void;
}) {
  const differentZone = !sameClock(siteTimezone, timezone, startsAt);
  const notice = noticeSentence(policy);

  return (
    <div>
      <div className="rounded-2xl border border-gold/25 bg-gold/[0.06] p-5 sm:p-6">
        <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-gold">
          Your call
        </p>
        <p className="mt-2.5 text-balance font-display text-xl leading-snug text-white sm:text-2xl">
          {formatFullDateTime(startsAt, timezone)}
        </p>
        <p className="mt-2 text-sm text-orchid">
          Times shown in {zoneSentence(timezone, startsAt)}.
          {differentZone && ` That is ${formatFullDateTime(startsAt, siteTimezone)} where Yvette is.`}
        </p>

        <dl className="mt-5 grid gap-x-8 gap-y-3 sm:grid-cols-2">
          <div>
            <dt className="text-[0.64rem] font-semibold uppercase tracking-[0.16em] text-orchid-faint">
              How long
            </dt>
            <dd className="mt-1 flex items-center gap-2 text-sm text-white">
              <Clock aria-hidden className="size-4 text-gold" />
              {durationLabel(packageRow.durationMinutes)}
            </dd>
          </div>
          <div>
            <dt className="text-[0.64rem] font-semibold uppercase tracking-[0.16em] text-orchid-faint">
              Comes out of
            </dt>
            <dd className="mt-1 text-sm text-white">
              {packageRow.offerTitle}
              {packageRow.sessionsRemaining !== null && (
                <span className="text-orchid-dim">
                  {" "}
                  — {packageRow.sessionsRemaining} left before this one
                </span>
              )}
            </dd>
          </div>
        </dl>
      </div>

      <div className="mt-6">
        <LuxeTextarea
          label="What would you like to work on?"
          value={agenda}
          rows={4}
          maxLength={2000}
          onChange={(event) => onAgendaChange(event.target.value)}
          hint="Yvette reads this before the call, so you can start on the real thing instead of catching her up."
        />
      </div>

      <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.02] p-5">
        <p className="flex items-center gap-2 text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-orchid">
          <Info aria-hidden className="size-3.5 text-gold" />
          If you need to change it
        </p>
        <p className="copy-luxe mt-2.5 text-sm">{creditReturnSentence(policy)}</p>
        {notice && <p className="copy-luxe mt-2 text-sm">{notice}</p>}
      </div>

      <div aria-live="polite" className="mt-5 min-h-[1.25rem]">
        {error && (
          <p role="alert" className="text-sm font-medium text-red-400">
            {error}
          </p>
        )}
        {viewingAsAdmin && (
          <p className="text-sm font-medium text-amber-300">
            You are viewing this account as an administrator, so you cannot book on their behalf.
          </p>
        )}
      </div>

      <div className="mt-3 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
        <LuxeButton type="button" variant="quiet" onClick={onBack}>
          <ChevronLeft aria-hidden className="size-4" />
          Pick another time
        </LuxeButton>
        <LuxeButton
          type="button"
          variant="foil"
          size="sm"
          disabled={submitting || viewingAsAdmin}
          onClick={onConfirm}
        >
          {submitting && <Loader2 aria-hidden className="size-4 animate-spin" />}
          {submitting ? "Booking" : "Confirm this time"}
        </LuxeButton>
      </div>
    </div>
  );
}

/* ── Booked ─────────────────────────────────────────────────────────────── */

function BookedPanel({
  session,
  timezone,
  canBookAgain,
  onBookAgain,
}: {
  session: CoachingSession;
  timezone: string;
  canBookAgain: boolean;
  onBookAgain: () => void;
}) {
  return (
    <GlassCard accent="green" spotlight={false} interactive={false} className="p-5 sm:p-8">
      <div className="flex items-start gap-4">
        <span
          aria-hidden
          className="grid size-11 shrink-0 place-items-center rounded-full border border-green-bright/30 bg-green-bright/[0.12]"
        >
          <CheckCircle2 className="size-5 text-green-bright" />
        </span>
        {/* A live region, because the flow replaces the form in place rather
            than moving the member to a new page — without this, a screen reader
            gets no signal that the booking went through. */}
        <div role="status" className="min-w-0">
          <h2 className="font-display text-2xl text-white">You are booked in.</h2>
          <p className="mt-2 text-balance text-lg text-white">
            {session.startsAt ? formatFullDateTime(session.startsAt, timezone) : "—"}
          </p>
          <p className="copy-luxe mt-1.5 text-sm">
            {durationLabel(session.durationMinutes)} with Yvette. A confirmation and a calendar
            invitation are on their way to your inbox.
          </p>
        </div>
      </div>

      {session.meetingUrl && (
        <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-orchid">
            Where to join
          </p>
          <a
            href={session.meetingUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2.5 inline-flex min-h-[2.75rem] items-center gap-2.5 break-all text-sm text-gold underline decoration-gold/40 underline-offset-4 hover:text-gold-bright"
          >
            <Video aria-hidden className="size-4 shrink-0" />
            {session.meetingUrl}
          </a>
        </div>
      )}

      {session.startsAt && (
        <div className="mt-6">
          <AddToCalendar
            sessionId={session.id}
            title={`${session.offerTitle} with Yvette Howard`}
            startsAt={session.startsAt}
            durationMinutes={session.durationMinutes}
            meetingUrl={session.meetingUrl}
            agenda={session.agenda}
          />
        </div>
      )}

      <div aria-hidden className="rule-faint my-6 w-full" />

      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <LuxeButton to={`/coaching/sessions/${session.id}`} variant="glass" size="sm">
          Open this session
        </LuxeButton>
        {canBookAgain && (
          <LuxeButton type="button" variant="quiet" onClick={onBookAgain}>
            Book another call
          </LuxeButton>
        )}
        <Link
          to="/coaching"
          className="text-sm text-orchid-dim underline decoration-white/20 underline-offset-4 hover:text-white"
        >
          Back to coaching
        </Link>
      </div>
    </GlassCard>
  );
}

/* ── Step trail ─────────────────────────────────────────────────────────── */

function StepTrail({ step, showPackageStep }: { step: Step; showPackageStep: boolean }) {
  const steps: { key: Step; label: string }[] = [
    ...(showPackageStep ? [{ key: "package" as Step, label: "Package" }] : []),
    { key: "slot", label: "Time" },
    { key: "confirm", label: "Confirm" },
  ];
  const currentIndex = steps.findIndex((entry) => entry.key === step);

  return (
    <ol className="flex items-center gap-2.5">
      {steps.map((entry, index) => (
        <li key={entry.key} className="flex items-center gap-2.5">
          <span
            className={cn(
              "text-[0.64rem] font-semibold uppercase tracking-[0.14em]",
              index === currentIndex ? "text-gold" : "text-orchid-faint",
            )}
            aria-current={index === currentIndex ? "step" : undefined}
          >
            {entry.label}
          </span>
          {index < steps.length - 1 && (
            <span aria-hidden className="h-px w-4 bg-ink/15 sm:w-6" />
          )}
        </li>
      ))}
    </ol>
  );
}
