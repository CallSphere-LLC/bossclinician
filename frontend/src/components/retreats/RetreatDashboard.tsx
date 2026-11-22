import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { CalendarDays, ExternalLink, Mail, MapPin, Plane } from "lucide-react";
import {
  formatCents,
  formatRetreatDate,
  formatRetreatRange,
  memberRetreatsApi,
  TASK_STATUS_LABEL,
  type MemoriesView,
  type RetreatDashboardData,
  type RetreatSectionId,
  type TaskStatus,
} from "@/lib/retreatsApi";
import { cn } from "@/lib/cn";
import {
  BUTTON_OUTLINE,
  BUTTON_PRIMARY,
  FIGURE,
  LINK,
  PreviewNote,
  RetreatMarkdown,
  SaveStatus,
  Section,
  errorMessage,
} from "./retreatUi";
import { RetreatChecklist } from "./RetreatChecklist";
import { TravelInsuranceGuidance } from "./TravelInsuranceForm";
import { QuestionnaireForm } from "./QuestionnaireForm";
import { MemoriesGallery } from "./MemoriesGallery";
import { ReflectionForm } from "./ReflectionForm";
import { InterestSelector } from "./InterestSelector";
import { JoinUsAgain } from "./JoinUsAgain";

/**
 * YOUR RETREAT DASHBOARD — the guest's private FlourisHealer preparation hub
 * (sheet row 248). A course-like page, not a course: no quiz, no grades, no
 * certificate. Rendered for a guest (member portal, lesson tool) and for the
 * owner's read-only preview, where `preview` is set and nothing can be saved.
 */
export interface RetreatDashboardProps {
  data: RetreatDashboardData;
  slug: string;
  preview?: { memories: () => Promise<MemoriesView> };
  onReload?: () => void;
  focusSection?: RetreatSectionId;
}

const HIDDEN_TAG = "Hidden from guests until it opens";

export function RetreatDashboard({ data, slug, preview, onReload, focusSection }: RetreatDashboardProps) {
  const readOnly = Boolean(preview) || data.preview;
  const { retreat } = data;

  useEffect(() => {
    if (!focusSection) return;
    const target = document.getElementById(focusSection);
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    target.focus({ preventScroll: true });
  }, [focusSection]);

  const loadMemories = preview ? preview.memories : () => memberRetreatsApi.memories(slug);
  const showPost = (available: boolean) => available || readOnly;

  return (
    <div className="flex flex-col gap-6">
      {readOnly && (
        <p className="rounded-xl border border-gold/30 bg-gold/[0.06] px-4 py-3 text-sm text-gold">
          Owner preview — this is what a guest sees. Saving is turned off and no guest data is changed.
        </p>
      )}

      {/* ── Start Here ─────────────────────────────────────────────── */}
      <Section id="start-here" title="Start Here" eyebrow={data.dashboardTitle}>
        <p className="copy-luxe whitespace-pre-wrap text-base text-white/90">{data.welcomeMessage}</p>
        <Countdown data={data} />
        <div>
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-sm font-semibold text-white">My Preparation</h3>
            <p className="text-xs text-orchid-dim">
              <span className={FIGURE}>{data.progress.completed}</span> of{" "}
              <span className={FIGURE}>{data.progress.total}</span> complete
            </p>
          </div>
          <div
            className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/10"
            role="progressbar"
            aria-label="Preparation progress"
            aria-valuemin={0}
            aria-valuemax={data.progress.total}
            aria-valuenow={data.progress.completed}
          >
            <div
              className="h-full rounded-full bg-gold"
              style={{ width: `${data.progress.total ? Math.round((data.progress.completed / data.progress.total) * 100) : 0}%` }}
            />
          </div>
          <div className="mt-4">
            <RetreatChecklist items={data.checklist} />
          </div>
          <p className="mt-3 text-xs text-orchid-dim">
            Statuses update from your actual forms and our team's review: {Object.values(TASK_STATUS_LABEL).join(", ")}.
          </p>
        </div>
        {data.importantDates.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold text-white">Important dates</h3>
            <dl className="mt-2 grid gap-2 sm:grid-cols-2">
              {data.importantDates.map((entry) => (
                <div key={entry.label} className="rounded-xl border border-white/10 px-4 py-3">
                  <dt className="text-xs text-orchid-dim">{entry.label}</dt>
                  <dd className="mt-0.5 font-body font-bold text-white">
                    {entry.date ? formatRetreatDate(entry.date) : entry.note === COMING_SOON ? COMING_SOON : formatRetreatDate(null)}
                  </dd>
                  {entry.note && entry.note !== COMING_SOON && <dd className="mt-0.5 text-xs text-orchid-dim">{entry.note}</dd>}
                </div>
              ))}
            </dl>
          </div>
        )}
        <p className="flex items-center gap-2">
          <Mail aria-hidden className="size-4 text-gold" />
          Questions? Email{" "}
          <a className={LINK} href={`mailto:${data.supportEmail}`}>
            {data.supportEmail}
          </a>
        </p>
      </Section>

      {/* ── Travel Insurance: guidance only — strongly recommended, not required ── */}
      {data.insurance.show && (
        <Section id="travel-insurance" title="Travel Insurance">
          <TravelInsuranceGuidance />
        </Section>
      )}

      {/* ── My Agreement ───────────────────────────────────────────── */}
      <Section id="agreement" title="My Agreement" status={data.agreement.status}>
        {data.agreement.signedAt ? (
          <p>Signed {formatInstant(data.agreement.signedAt)}. A copy and your signing record are in your Contracts.</p>
        ) : data.agreement.awaitingSignature ? (
          <p>Your retreat agreement is ready for you to review and sign.</p>
        ) : (
          <p>Your retreat agreement will appear here once it is ready for you to sign.</p>
        )}
        {(data.agreement.awaitingSignature || data.agreement.signedAt) && (
          <div>
            <Link to="/contracts" className={data.agreement.signedAt ? BUTTON_OUTLINE : BUTTON_PRIMARY}>
              {data.agreement.signedAt ? "View my agreement" : "Review and sign"}
            </Link>
          </div>
        )}
      </Section>

      {/* ── Travel & Flights guidance (the flight forms are questionnaires below) ── */}
      <Section id="travel-flights" title="Travel & Flights">
        <div className="rounded-xl border border-white/10 px-4 py-3">
          <p className="flex items-center gap-2 font-semibold text-white">
            <Plane aria-hidden className="size-4 text-gold" />
            {FLIGHT_GUIDANCE[data.flightGuidance.status]}
          </p>
          {data.flightGuidance.note && <p className="mt-1 whitespace-pre-wrap">{data.flightGuidance.note}</p>}
        </div>
        {retreat.airport && (
          <p>
            <span className="font-semibold text-white">Airport:</span> {retreat.airport}
          </p>
        )}
        {data.details.transportNote && <p>{data.details.transportNote}</p>}
        <ShuttleWindows data={data} />
        <p className="text-xs text-orchid-dim">
          You can complete your Retreat Profile before you book flights, and add your flight details later.
        </p>
      </Section>

      {/* ── Questionnaires (owner-built; each saves progress and can be updated later) ── */}
      {data.questionnaires.map((questionnaire) => (
        <Section key={questionnaire.key} id={`questionnaire-${questionnaire.key}`} title={questionnaire.title} status={questionnaire.status}>
          <QuestionnaireForm
            key={`${questionnaire.key}:${questionnaire.version}`}
            slug={slug}
            questionnaire={questionnaire}
            readOnly={readOnly}
            showAudienceTags={readOnly && data.audience === "all"}
            onSaved={onReload}
          />
        </Section>
      ))}

      {/* ── Passport & Preparation ─────────────────────────────────── */}
      <Section
        id="passport-preparation"
        title={data.passport.enabled ? "Passport & Preparation" : "Preparation"}
        status={data.passport.enabled ? data.passport.status : undefined}
      >
        {data.preparationMd.trim() ? (
          <RetreatMarkdown body={data.preparationMd} />
        ) : (
          <p>Preparation guidance will be posted here.</p>
        )}
        {data.passport.enabled && (
          <SelfReport slug={slug} taskKey="passport" status={data.passport.status} readOnly={readOnly} label="I've checked my passport" onSaved={onReload} />
        )}
      </Section>

      {/* ── Retreat Details & Itinerary ────────────────────────────── */}
      <Section id="details-itinerary" title="Retreat Details & Itinerary">
        <dl className="grid gap-3 sm:grid-cols-2">
          <Detail icon={<MapPin aria-hidden className="size-4 text-gold" />} label="Location" value={retreat.location} />
          <Detail icon={<CalendarDays aria-hidden className="size-4 text-gold" />} label="Dates" value={formatRetreatRange(retreat.startDate, retreat.endDate)} />
          <Detail label="Arrival" value={formatRetreatDate(retreat.startDate)} />
          <Detail label="Checkout" value={formatRetreatDate(retreat.endDate)} />
          {retreat.airport && <Detail icon={<Plane aria-hidden className="size-4 text-gold" />} label="Airport" value={retreat.airport} />}
        </dl>
        {data.details.transportNote && <p>{data.details.transportNote}</p>}
        <ShuttleWindows data={data} />
        {data.details.activities.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold text-white">Planned activities</h3>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {data.details.activities.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        )}
        {data.details.inclusions.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold text-white">Included in your retreat</h3>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {data.details.inclusions.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        )}
        <div>
          <h3 className="text-sm font-semibold text-white">Itinerary</h3>
          {data.details.itineraryMd.trim() ? (
            <RetreatMarkdown body={data.details.itineraryMd} className="mt-2" />
          ) : (
            <p className="mt-1">Your day-by-day itinerary will be shared here once every experience is confirmed.</p>
          )}
        </div>
      </Section>

      {/* ── Payments ───────────────────────────────────────────────── */}
      <Section id="payments" title="Payments" status={data.checklist.find((c) => c.key === "payments")?.status}>
        <PaymentsPanel data={data} />
      </Section>

      {/* ── Guest Connection & Group Call ──────────────────────────── */}
      {data.groupCall.enabled && (
        <Section id="guest-connection" title="Guest Connection & Group Call" status={data.checklist.find((c) => c.key === "group_call")?.status}>
          <GroupCall data={data} slug={slug} readOnly={readOnly} onSaved={onReload} />
        </Section>
      )}

      {/* ── Messages & Announcements ───────────────────────────────── */}
      <Section id="messages" title="Messages & Announcements">
        {data.announcements.length === 0 ? (
          <p className="text-orchid-dim">No announcements yet. Updates from our team will appear here.</p>
        ) : (
          <ul className="flex flex-col gap-4">
            {data.announcements.map((item) => (
              <li key={item.id} className="rounded-xl border border-white/10 px-4 py-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="font-semibold text-white">{item.title}</h3>
                  <p className="text-xs text-orchid-dim">{formatInstant(item.publishedAt)}</p>
                </div>
                <RetreatMarkdown body={item.bodyMd} className="mt-2" />
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* ── After the retreat ──────────────────────────────────────── */}
      {showPost(data.memories.available) && (
        <Section id="memories" title="Retreat Memories" tag={data.memories.available ? undefined : HIDDEN_TAG}>
          <MemoriesGallery slug={slug} readOnly={readOnly} loadMemories={loadMemories} />
        </Section>
      )}
      {showPost(data.feedback.available) && (
        <Section id="feedback" title="Your Reflection" tag={data.feedback.available ? undefined : HIDDEN_TAG}>
          <ReflectionForm slug={slug} labels={data.feedback.labels} initial={data.feedback.current} readOnly={readOnly} onSaved={onReload} />
        </Section>
      )}
      {showPost(data.interest.available) && (
        <Section id="interest" title="Where next?" tag={data.interest.available ? undefined : HIDDEN_TAG}>
          <InterestSelector slug={slug} initial={data.interest.current} readOnly={readOnly} onSaved={onReload} />
        </Section>
      )}
      {showPost(data.joinUsAgain.available) && (
        <Section id="join-us-again" title="Join Us Again" tag={data.joinUsAgain.available ? undefined : HIDDEN_TAG}>
          <JoinUsAgain intro={data.joinUsAgain.intro} cards={data.joinUsAgain.cards} readOnly={readOnly} />
        </Section>
      )}
    </div>
  );
}

/** Yvette, 22 Nov: unconfirmed shuttle windows and pre-trip call details read "Details coming soon". */
const COMING_SOON = "Details coming soon";

function ShuttleWindows({ data }: { data: RetreatDashboardData }) {
  return data.details.shuttle.confirmed && data.details.shuttle.details ? (
    <div>
      <h3 className="text-sm font-semibold text-white">Shuttle windows</h3>
      <p className="mt-1 whitespace-pre-wrap">{data.details.shuttle.details}</p>
    </div>
  ) : (
    <p>
      <span className="font-semibold text-white/85">Shuttle windows:</span> {COMING_SOON}
    </p>
  );
}

const FLIGHT_GUIDANCE: Record<RetreatDashboardData["flightGuidance"]["status"], string> = {
  researching: "We're researching flight options — please hold off on booking for now.",
  recommendations_available: "Flight recommendations are available.",
  booking_encouraged: "You can go ahead and book your flights.",
};

function formatInstant(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

function Countdown({ data }: { data: RetreatDashboardData }) {
  const { retreat } = data;
  return (
    <div className="flex flex-wrap items-center gap-x-8 gap-y-3 rounded-xl border border-gold/25 bg-gold/[0.05] px-5 py-4">
      <div>
        <p className="text-xs text-orchid-dim">Arrival</p>
        <p className="font-body text-lg font-bold text-white">{formatRetreatDate(retreat.startDate)}</p>
      </div>
      <div>
        <p className="text-xs text-orchid-dim">Retreat</p>
        <p className="font-body font-bold text-white">
          {retreat.location} · {formatRetreatRange(retreat.startDate, retreat.endDate)}
        </p>
      </div>
      <p className="text-sm text-white/90" aria-live="polite">
        {retreat.phase === "upcoming" && retreat.daysUntilStart !== null ? (
          retreat.daysUntilStart === 0 ? (
            "Arrival day is today."
          ) : (
            <>
              <span className="font-body text-2xl font-bold tabular-nums text-gold">{retreat.daysUntilStart}</span>{" "}
              {retreat.daysUntilStart === 1 ? "day" : "days"} to go
            </>
          )
        ) : retreat.phase === "in_progress" ? (
          "Your retreat is happening now."
        ) : (
          "Thank you for being with us."
        )}
      </p>
    </div>
  );
}

function Detail({ label, value, icon }: { label: string; value: string; icon?: ReactNode }) {
  return (
    <div className="rounded-xl border border-white/10 px-4 py-3">
      <dt className="flex items-center gap-2 text-xs text-orchid-dim">
        {icon}
        {label}
      </dt>
      <dd className="mt-0.5 font-body font-bold text-white">{value}</dd>
    </div>
  );
}

/**
 * The guest saying "I've done this". It can move a task to Submitted, never to
 * Verified — only the organizer's review does that, on the server.
 */
function SelfReport({
  slug,
  taskKey,
  status,
  readOnly,
  label,
  onSaved,
}: {
  slug: string;
  taskKey: "passport";
  status: TaskStatus;
  readOnly: boolean;
  label: string;
  onSaved?: () => void;
}) {
  const [current, setCurrent] = useState<TaskStatus>(status);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: "neutral" | "error" | "success" }>({ text: "", tone: "neutral" });
  const inFlight = useRef(false);
  useEffect(() => setCurrent(status), [status]);

  if (current === "verified") return <p className="text-sm text-emerald-200">Verified by our team. Thank you!</p>;
  const reported = current === "submitted";

  async function report(done: boolean) {
    if (readOnly || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      const result = await memberRetreatsApi.reportTask(slug, taskKey, done);
      setCurrent(result.status);
      setMessage(done ? { text: "Thanks — we'll take it from here.", tone: "success" } : { text: "Updated.", tone: "neutral" });
      onSaved?.();
    } catch (error) {
      setMessage({ text: errorMessage(error, "That didn't save. Please try again."), tone: "error" });
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        {reported ? (
          <button type="button" className={BUTTON_OUTLINE} disabled={readOnly || busy} onClick={() => void report(false)}>
            I haven't finished this yet
          </button>
        ) : (
          <button type="button" className={BUTTON_OUTLINE} disabled={readOnly || busy} onClick={() => void report(true)}>
            {label}
          </button>
        )}
      </div>
      {readOnly ? <PreviewNote /> : <SaveStatus text={message.text} tone={message.tone} />}
    </div>
  );
}

function PaymentsPanel({ data }: { data: RetreatDashboardData }) {
  const payments = data.payments;
  if (payments.status === "incomplete") {
    return (
      <p>
        Contact us about your payment schedule:{" "}
        <a className={LINK} href={`mailto:${data.supportEmail}`}>
          {data.supportEmail}
        </a>
      </p>
    );
  }
  const money = (cents: number | null) => formatCents(cents, payments.currency);
  return (
    <div className="flex flex-col gap-5">
      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {payments.roomLabel && <Figure label="Your room" value={payments.roomLabel} />}
        <Figure label="Agreed retreat price" value={money(payments.agreedCents)} />
        <Figure label="Amount paid" value={money(payments.paidCents)} />
        <Figure label="Balance due" value={money(payments.balanceCents)} />
        <Figure
          label="Next scheduled payment"
          value={payments.nextPayment ? `${money(payments.nextPayment.amountCents)} on ${formatRetreatDate(payments.nextPayment.dueDate)}` : "None scheduled"}
        />
        {payments.finalPaymentDue && <Figure label="Final payment deadline" value={formatRetreatDate(payments.finalPaymentDue)} />}
      </dl>
      {payments.arrangement && <p>{payments.arrangement}</p>}
      {payments.installments.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[22rem] text-left text-sm">
            <caption className="sr-only">Payment schedule</caption>
            <thead className="text-xs text-orchid-dim">
              <tr>
                <th scope="col" className="py-2 pr-4 font-semibold">Payment</th>
                <th scope="col" className="py-2 pr-4 font-semibold">Due</th>
                <th scope="col" className="py-2 pr-4 font-semibold">Amount</th>
                <th scope="col" className="py-2 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.07]">
              {payments.installments.map((row) => (
                <tr key={row.sequence}>
                  <td className={cn("py-2 pr-4", FIGURE)}>{row.sequence}</td>
                  <td className="py-2 pr-4 text-white/85">{formatRetreatDate(row.dueDate)}</td>
                  <td className={cn("py-2 pr-4", FIGURE)}>{money(row.amountCents)}</td>
                  <td className="py-2">{row.paid ? <span className="text-emerald-200">Paid</span> : <span className="text-orchid-dim">Scheduled</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-orchid-dim">
        These figures come from your payment records. Questions?{" "}
        <a className={LINK} href={`mailto:${data.supportEmail}`}>
          {data.supportEmail}
        </a>
      </p>
    </div>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 px-4 py-3">
      <dt className="text-xs text-orchid-dim">{label}</dt>
      <dd className={cn("mt-0.5 text-base", FIGURE)}>{value}</dd>
    </div>
  );
}

function GroupCall({
  data,
  slug,
  readOnly,
  onSaved,
}: {
  data: RetreatDashboardData;
  slug: string;
  readOnly: boolean;
  onSaved?: () => void;
}) {
  const call = data.groupCall;
  const [rsvp, setRsvp] = useState(call.rsvp);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: "neutral" | "error" | "success" }>({ text: "", tone: "neutral" });

  if (!call.confirmed) {
    return (
      <>
        <p>
          <span className="font-semibold text-white/85">Pre-trip group call:</span> {COMING_SOON}
        </p>
      </>
    );
  }

  async function answer(value: "yes" | "no" | "maybe") {
    if (readOnly || busy) return;
    setBusy(true);
    try {
      await memberRetreatsApi.rsvp(slug, value);
      setRsvp(value);
      setMessage({ text: "Thanks — your RSVP is saved.", tone: "success" });
      onSaved?.();
    } catch (error) {
      setMessage({ text: errorMessage(error, "That didn't save. Please try again."), tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="text-sm font-semibold text-white">Pre-trip group call</h3>
        {call.startsAt && <p className="mt-1 font-body font-bold text-white">{formatCallTime(call.startsAt, call.timezone)}</p>}
        {call.notes && <p className="mt-1 whitespace-pre-wrap">{call.notes}</p>}
      </div>
      {call.joinUrl && (
        <div>
          <a href={call.joinUrl} target="_blank" rel="noopener noreferrer" className={BUTTON_PRIMARY}>
            Join the call <ExternalLink aria-hidden className="size-3.5" />
          </a>
        </div>
      )}
      <fieldset className="flex flex-col gap-2" disabled={readOnly || busy}>
        <legend className="mb-1 text-sm font-semibold text-white/90">Will you join us?</legend>
        <div className="flex flex-wrap gap-2">
          {(["yes", "maybe", "no"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={rsvp === value}
              onClick={() => void answer(value)}
              className={cn(BUTTON_OUTLINE, rsvp === value && "border-gold/70 bg-gold/[0.10] text-white")}
            >
              {value === "yes" ? "Yes" : value === "maybe" ? "Maybe" : "No"}
            </button>
          ))}
        </div>
      </fieldset>
      {readOnly ? <PreviewNote /> : <SaveStatus text={message.text} tone={message.tone} />}
    </div>
  );
}

function formatCallTime(iso: string, timezone: string | null): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  try {
    return new Intl.DateTimeFormat("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: timezone || undefined,
      timeZoneName: "short",
    }).format(date);
  } catch {
    return date.toLocaleString("en-US");
  }
}
