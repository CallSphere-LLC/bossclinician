import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, useParams } from "react-router";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { CalendarCheck2, CalendarDays, CheckCircle2, ChevronLeft, Clock, Download, Loader2, Video } from "lucide-react";
import { Seo } from "@/components/Seo";
import { useHoneypot } from "@/components/forms/useHoneypot";
import { GlassCard } from "@/components/luxe/GlassCard";
import { LuxeButton, LuxePill } from "@/components/luxe/LuxeButton";
import { LuxeInput, LuxeSelect, LuxeTextarea } from "@/components/luxe/LuxeField";
import { LuxePageHero } from "@/components/luxe/LuxePageHero";
import { GoldRule, Section } from "@/components/luxe/Section";
import { AddToCalendar } from "@/components/booking/AddToCalendar";
import { SlotPicker } from "@/components/booking/SlotPicker";
import {
  FALLBACK_TIMEZONE,
  addDays,
  detectTimezone,
  durationLabel,
  formatFullDateTime,
  sameClock,
  timezoneOptionsWith,
  zoneSentence,
} from "@/components/booking/timezone";
import { ApiError } from "@/lib/api";
import {
  bookACallApi,
  type CallBooking,
  type CallDetail,
  type CallQuestion,
  type CallSummary,
} from "@/lib/bookACallApi";
import type { CoachingSlot } from "@/lib/coachingApi";
import { cn } from "@/lib/cn";
import { contactPage } from "@/content/site";
import NotFound from "@/pages/NotFound";

/**
 * Book A Call — Yvette's calls, booked here instead of on TidyCal.
 *
 *   /book-a-call                  every call she offers, the free one first
 *   /book-a-call/:slug            one call: what it is, a time, the intake
 *   /book-a-call/manage/:token    the guest's own booking (from their email)
 *
 * The slots come from the server as UTC instants and are drawn in the
 * visitor's own zone by the same SlotPicker members book coaching with; the
 * server re-checks the chosen instant under the calendar lock when it books.
 */

const DAYS_PER_WINDOW = 14;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ALIGNMENT_SLUG = "practice-alignment-call";

const CAPTION = "text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-orchid";
/** Numbers in the body face, bold and tabular — never the display serif. */
const FIGURE = "font-body font-semibold tabular-nums";

/** Internal links in a description stay in the app; anything else is plain text. */
const markdownComponents: Components = {
  a: ({ href, children }) =>
    href && href.startsWith("/") && !href.startsWith("//") ? (
      <Link to={href} className="text-gold underline decoration-gold/40 underline-offset-4 hover:text-gold-bright">
        {children}
      </Link>
    ) : (
      <span>{children}</span>
    ),
};

function Markdown({ children }: { children: string }) {
  return (
    <div className="prose-boss break-words">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {children}
      </ReactMarkdown>
    </div>
  );
}

/** The visitor's zone, read after hydration so the server and client agree on first paint. */
function useVisitorTimezone(): [string, (zone: string) => void] {
  const [zone, setZone] = useState(FALLBACK_TIMEZONE);
  useEffect(() => {
    setZone(detectTimezone());
  }, []);
  return [zone, setZone];
}

function Loading({ label }: { label: string }) {
  return (
    <Section
      surface="deep"
      space="xl"
      aurora="violet"
      auroraIntensity={0.55}
      seam={false}
      aria-label={label}
      containerClassName="flex min-h-[40vh] flex-col items-center justify-center text-center"
    >
      <GoldRule className="mx-auto" />
      <p role="status" className="copy-luxe mt-6">
        Loading…
      </p>
    </Section>
  );
}

function Facts({ call }: { call: CallSummary }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <LuxePill accent={call.free ? "green" : "gold"}>
        <span className={FIGURE}>{call.priceLabel}</span>
      </LuxePill>
      <LuxePill accent="plum">
        <Clock aria-hidden className="mr-1.5 inline size-3.5" />
        <span className={FIGURE}>{durationLabel(call.durationMinutes)}</span>
      </LuxePill>
      <LuxePill accent="neutral">
        <Video aria-hidden className="mr-1.5 inline size-3.5" />
        {call.locationLabel}
      </LuxePill>
    </div>
  );
}

export default function BookACall() {
  const { slug, token } = useParams();
  // Keyed, because one component serves every path: moving from one call to
  // another must start a fresh booking, not carry the last one's picked time.
  if (token) return <ManageBooking key={token} token={token} />;
  if (slug) return <CallPage key={slug} slug={slug} />;
  return <Chooser />;
}

/* ── /book-a-call ───────────────────────────────────────────────────────── */

function Chooser() {
  const [calls, setCalls] = useState<CallSummary[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    bookACallApi
      .list()
      .then((res) => {
        if (!cancelled) setCalls(res.calls);
      })
      .catch(() => {
        if (!cancelled) {
          setCalls([]);
          setError("We couldn't load the calendar just now. Please refresh in a moment.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const featured = calls?.find((call) => call.featured) ?? null;
  const rest = (calls ?? []).filter((call) => call !== featured);

  return (
    <>
      <Seo
        title="Book A Call | Boss Clinician"
        description="Book a complimentary Practice Alignment Call with Yvette Howard, LCSW — or choose a strategy session for your private or group practice."
      />

      <LuxePageHero
        eyebrow="Book A Call"
        title="Let's talk about"
        titleAccent="your practice."
        lede="Pick the call that fits where you are. Most people start with the complimentary Practice Alignment Call — fifteen minutes to see what's stuck and what support makes sense next."
        tone="violet"
      />

      <Section surface="base" space="md" aria-label="Calls you can book" containerClassName="max-w-5xl">
        {calls === null ? (
          <p role="status" className="copy-luxe text-center">
            Loading…
          </p>
        ) : (
          <>
            {error && (
              <p role="alert" className="mb-6 text-center text-sm font-medium text-red-400">
                {error}
              </p>
            )}

            {featured && (
              <GlassCard accent="gold" interactive={false} spotlight={false} className="p-6 sm:p-10">
                <span className="eyebrow-luxe">Start here</span>
                <h2 className="mt-2 font-display text-[1.9rem] leading-tight text-white sm:text-[2.4rem]">
                  {featured.title}
                </h2>
                <p className="copy-luxe mt-3 max-w-2xl">{featured.summary}</p>
                <div className="mt-5">
                  <Facts call={featured} />
                </div>
                <LuxeButton to={`/book-a-call/${featured.slug}`} variant="foil" size="md" className="mt-7">
                  <CalendarDays aria-hidden className="size-4" />
                  Choose a time
                </LuxeButton>
              </GlassCard>
            )}

            {rest.length > 0 && (
              <ul className="mt-8 grid gap-5 md:grid-cols-2">
                {rest.map((call) => (
                  <li key={call.slug}>
                    <GlassCard
                      accent={call.free ? "plum" : "neutral"}
                      interactive={false}
                      spotlight={false}
                      className="flex h-full flex-col p-6 sm:p-7"
                    >
                      <h3 className="font-display text-[1.45rem] leading-snug text-white">{call.title}</h3>
                      <p className="copy-luxe mt-2 flex-1 text-[0.95rem]">{call.summary}</p>
                      <div className="mt-4">
                        <Facts call={call} />
                      </div>
                      <LuxeButton
                        to={`/book-a-call/${call.slug}`}
                        variant={call.bookable ? "glass" : "outline"}
                        size="sm"
                        className="mt-6 self-start"
                      >
                        {call.bookable ? "See times" : "Learn more"}
                      </LuxeButton>
                    </GlassCard>
                  </li>
                ))}
              </ul>
            )}

            <p className="copy-luxe mt-10 text-center text-sm">
              Already in a program? Your program's welcome lesson has the link for your program calls.
              Anything else, <Link to="/contact" className="text-gold underline underline-offset-4">get in touch</Link>.
            </p>
          </>
        )}
      </Section>
    </>
  );
}

/* ── /book-a-call/:slug ─────────────────────────────────────────────────── */

type Step = "time" | "details" | "done";

function CallPage({ slug }: { slug: string }) {
  const [call, setCall] = useState<CallDetail | null | undefined>(undefined);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setCall(undefined);
    bookACallApi
      .get(slug)
      .then((res) => {
        if (!cancelled) setCall(res.call);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) setCall(null);
        else {
          setLoadError("We couldn't load this call just now. Please refresh in a moment.");
          setCall(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  if (call === undefined) return <Loading label="Loading call" />;
  if (call === null) {
    if (!loadError) return <NotFound />;
    return (
      <Section surface="deep" space="xl" seam={false} aria-label="Book A Call" containerClassName="text-center">
        <p role="alert" className="copy-luxe">
          {loadError}
        </p>
      </Section>
    );
  }

  return (
    <>
      <Seo
        title={`${call.title} | Boss Clinician`}
        description={call.summary || `Book a ${call.title} with Yvette Howard, LCSW.`}
        // An old TidyCal slug resolves here too; index the one address.
        canonicalPath={`/book-a-call/${call.slug}`}
        noindex={!call.listed}
      />

      <LuxePageHero
        eyebrow={call.free ? "Complimentary call" : "Strategy session"}
        title={call.title}
        lede={call.summary}
        tone="violet"
        actions={
          <div className="flex flex-col items-start gap-5">
            <Facts call={call} />
            {call.bookable && (
              <LuxeButton variant="foil" size="md" href="#book" className="min-h-[44px]">
                <CalendarDays aria-hidden className="size-4" />
                Choose a time
              </LuxeButton>
            )}
          </div>
        }
      />

      <Section surface="base" space="md" aria-label={call.title} containerClassName="max-w-3xl">
        <Link
          to="/book-a-call"
          className="mb-8 inline-flex min-h-[2.75rem] items-center gap-1.5 text-sm text-orchid-dim hover:text-white"
        >
          <ChevronLeft aria-hidden className="size-4" />
          All calls
        </Link>

        {call.descriptionMd.trim() && <Markdown>{call.descriptionMd}</Markdown>}

        <div id="book" className="mt-10 scroll-mt-24">
          {call.bookable ? <BookingCard call={call} /> : <NotBookableCard call={call} />}
        </div>
      </Section>
    </>
  );
}

function NotBookableCard({ call }: { call: CallDetail }) {
  return (
    <GlassCard accent="gold" interactive={false} spotlight={false} className="p-6 sm:p-8">
      <p className={CAPTION}>How to book this session</p>
      <p className="mt-3 text-balance font-display text-xl leading-snug text-white sm:text-2xl">
        Start with a complimentary Practice Alignment Call.
      </p>
      <p className="copy-luxe mt-3">
        The {call.title} (<span className={FIGURE}>{call.priceLabel}</span>,{" "}
        <span className={FIGURE}>{durationLabel(call.durationMinutes)}</span>) is scheduled with Yvette directly.
        Book the free fifteen-minute alignment call and she'll confirm it's the right fit and set it up with you —
        or email <a href={`mailto:${contactPage.email}`} className="text-gold underline underline-offset-4">{contactPage.email}</a>.
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        <LuxeButton to={`/book-a-call/${ALIGNMENT_SLUG}`} variant="foil" size="sm">
          Book the free alignment call
        </LuxeButton>
        <LuxeButton to="/contact" variant="quiet">
          Contact Yvette
        </LuxeButton>
      </div>
    </GlassCard>
  );
}

/* ── The booking card ───────────────────────────────────────────────────── */

function useCallSlots(slug: string, timezone: string, horizonDays: number) {
  const [anchor] = useState(() => new Date());
  const [offsetDays, setOffsetDays] = useState(0);
  const [slots, setSlots] = useState<CoachingSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const zoneRef = useRef(timezone);
  zoneRef.current = timezone;

  const rangeStart = useMemo(() => addDays(anchor, offsetDays), [anchor, offsetDays]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const from = offsetDays === 0 ? anchor : rangeStart;
    const to = addDays(rangeStart, DAYS_PER_WINDOW);
    bookACallApi
      .slots(slug, { from: from.toISOString(), to: to.toISOString(), timezone: zoneRef.current })
      .then((res) => {
        if (cancelled) return;
        setSlots(res.slots);
        setError("");
      })
      .catch((err) => {
        if (cancelled) return;
        setSlots([]);
        setError(err instanceof ApiError ? err.message : "We couldn't load the calendar just now. Please try again.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // Not keyed on the zone: slots are instants, and a new zone only re-labels them.
  }, [slug, anchor, offsetDays, rangeStart, reloadKey]);

  const shift = useCallback((days: number) => setOffsetDays((current) => Math.max(0, current + days)), []);
  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  return {
    slots,
    loading,
    error,
    rangeStart,
    shift,
    reload,
    canGoBack: offsetDays > 0,
    canGoForward: offsetDays + DAYS_PER_WINDOW < Math.max(horizonDays, DAYS_PER_WINDOW),
  };
}

type Answers = Record<string, string | string[]>;

function BookingCard({ call }: { call: CallDetail }) {
  const [timezone, setTimezone] = useVisitorTimezone();
  const calendar = useCallSlots(call.slug, timezone, call.horizonDays);
  const [step, setStep] = useState<Step>("time");
  const [selected, setSelected] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [answers, setAnswers] = useState<Answers>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [booking, setBooking] = useState<CallBooking | null>(null);
  const [honeypot, honeypotField] = useHoneypot();
  const topRef = useRef<HTMLDivElement>(null);

  const scrollToCard = () => topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });

  const setAnswer = (id: string, value: string | string[]) => {
    setAnswers((current) => ({ ...current, [id]: value }));
    setErrors((current) => {
      if (!current[`answers.${id}`]) return current;
      const next = { ...current };
      delete next[`answers.${id}`];
      return next;
    });
  };

  const validate = (): Record<string, string> => {
    const found: Record<string, string> = {};
    if (!name.trim()) found.name = "Please tell us your name.";
    if (!EMAIL_PATTERN.test(email.trim())) found.email = "Please check your email address.";
    for (const question of call.questions) {
      if (!question.required) continue;
      const value = answers[question.id];
      const empty = Array.isArray(value) ? value.length === 0 : !String(value ?? "").trim();
      if (empty) {
        found[`answers.${question.id}`] =
          question.type === "checkbox"
            ? "Please choose at least one."
            : question.type === "radio"
              ? "Please choose one."
              : "Please answer this one.";
      }
    }
    return found;
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected) {
      setStep("time");
      return;
    }
    const found = validate();
    setErrors(found);
    setSubmitError("");
    if (Object.keys(found).length > 0) {
      setSubmitError("A few answers still need you — they're marked below.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await bookACallApi.book(call.slug, {
        startsAt: selected,
        name: name.trim(),
        email: email.trim(),
        timezone,
        answers,
        ...honeypot(),
      });
      setBooking(res.booking);
      setStep("done");
      scrollToCard();
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fieldErrors);
        setSubmitError(err.message);
        // The time was taken or is now too soon: back to the calendar, refreshed.
        if (err.status === 400 && Object.keys(err.fieldErrors).length === 0) {
          setSelected(null);
          setStep("time");
          calendar.reload();
          scrollToCard();
        }
      } else {
        setSubmitError("We couldn't book that just now. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (step === "done") {
    return (
      <div ref={topRef} className="scroll-mt-24">
        {booking ? (
          <BookedPanel booking={booking} />
        ) : (
          <GlassCard accent="green" interactive={false} spotlight={false} className="p-6 sm:p-8">
            <p role="status" className="font-display text-2xl text-white">
              You're booked.
            </p>
          </GlassCard>
        )}
      </div>
    );
  }

  return (
    <div ref={topRef} className="scroll-mt-24">
      <GlassCard interactive={false} spotlight={false} className="p-5 sm:p-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-xl text-white sm:text-2xl">
              {step === "time" ? "Choose a time" : "A few details"}
            </h2>
            <p className="copy-luxe mt-1.5 text-sm">
              {step === "time"
                ? "Times are shown in your own timezone."
                : "Yvette reads these before you meet, so the call starts on the real thing."}
            </p>
          </div>
          <ol className="flex items-center gap-2.5" aria-label="Booking steps">
            {(["time", "details"] as const).map((key, index) => (
              <li key={key} className="flex items-center gap-2.5">
                <span
                  aria-current={step === key ? "step" : undefined}
                  className={cn(
                    "text-[0.64rem] font-semibold uppercase tracking-[0.14em]",
                    step === key ? "text-gold" : "text-orchid-faint",
                  )}
                >
                  {key === "time" ? "Time" : "Details"}
                </span>
                {index === 0 && <span aria-hidden className="h-px w-5 bg-ink/15" />}
              </li>
            ))}
          </ol>
        </div>

        <div aria-hidden className="rule-faint my-6 w-full" />

        {step === "time" && (
          <div>
            <LuxeSelect
              label="Your timezone"
              value={timezone}
              onChange={(event) => setTimezone(event.target.value)}
              wrapperClassName="max-w-sm"
            >
              {timezoneOptionsWith(timezone).map((zone) => (
                <option key={zone.value} value={zone.value}>
                  {zone.label}
                </option>
              ))}
            </LuxeSelect>

            {submitError && (
              <p role="alert" className="mt-5 text-sm font-medium text-red-400">
                {submitError}
              </p>
            )}

            <div className="mt-6">
              <SlotPicker
                slots={calendar.slots}
                timezone={timezone}
                loading={calendar.loading}
                error={calendar.error}
                selected={selected}
                onSelect={setSelected}
                rangeStart={calendar.rangeStart}
                daysShown={DAYS_PER_WINDOW}
                onShiftRange={calendar.shift}
                canGoBack={calendar.canGoBack}
                canGoForward={calendar.canGoForward}
              />
            </div>

            <p aria-live="polite" className="mt-6 min-h-[1.5rem] text-sm text-orchid">
              {selected ? (
                <>
                  You've picked <strong className="font-semibold text-gold">{formatFullDateTime(selected, timezone)}</strong>
                </>
              ) : (
                "Pick a time above to carry on."
              )}
            </p>

            <div className="mt-4 flex justify-end">
              <LuxeButton
                type="button"
                variant="foil"
                size="sm"
                disabled={!selected}
                onClick={() => {
                  setSubmitError("");
                  setStep("details");
                  scrollToCard();
                }}
              >
                Continue
              </LuxeButton>
            </div>
          </div>
        )}

        {step === "details" && selected && (
          <form noValidate onSubmit={(event) => void submit(event)} className="relative">
            {honeypotField}

            <div className="rounded-2xl border border-gold/25 bg-gold/[0.06] p-5">
              <p className={cn(CAPTION, "text-gold")}>Your call</p>
              <p className="mt-2 text-balance font-display text-xl leading-snug text-white">
                {formatFullDateTime(selected, timezone)}
              </p>
              <p className="mt-1.5 text-sm text-orchid">
                <span className={FIGURE}>{durationLabel(call.durationMinutes)}</span> · {call.locationLabel} · times in{" "}
                {zoneSentence(timezone, selected)}.
                {!sameClock(call.hostTimezone, timezone, selected) &&
                  ` That's ${formatFullDateTime(selected, call.hostTimezone)} for Yvette.`}
              </p>
              <button
                type="button"
                onClick={() => {
                  setSubmitError("");
                  setStep("time");
                }}
                className="mt-3 inline-flex min-h-[2.75rem] items-center gap-1.5 text-sm text-gold underline decoration-gold/40 underline-offset-4 hover:text-gold-bright"
              >
                <ChevronLeft aria-hidden className="size-4" />
                Change the time
              </button>
            </div>

            <div className="mt-7 grid gap-5 sm:grid-cols-2">
              <LuxeInput
                label="Your name"
                required
                autoComplete="name"
                value={name}
                maxLength={200}
                onChange={(event) => setName(event.target.value)}
                error={errors.name}
              />
              <LuxeInput
                label="Your email"
                type="email"
                required
                autoComplete="email"
                value={email}
                maxLength={254}
                onChange={(event) => setEmail(event.target.value)}
                error={errors.email}
                hint="Your confirmation and calendar invitation go here."
              />
            </div>

            {call.questions.length > 0 && (
              <div className="mt-7 grid gap-6">
                {call.questions.map((question) => (
                  <QuestionField
                    key={question.id}
                    question={question}
                    value={answers[question.id]}
                    error={errors[`answers.${question.id}`]}
                    onChange={(value) => setAnswer(question.id, value)}
                  />
                ))}
              </div>
            )}

            <div aria-live="polite" className="mt-6 min-h-[1.25rem]">
              {submitError && (
                <p role="alert" className="text-sm font-medium text-red-400">
                  {submitError}
                </p>
              )}
            </div>

            <div className="mt-3 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-orchid-faint">
                By booking you agree to receive emails about this call from Boss Clinician.
              </p>
              <LuxeButton type="submit" variant="foil" size="sm" disabled={submitting}>
                {submitting && <Loader2 aria-hidden className="size-4 animate-spin" />}
                {submitting ? "Booking" : "Book this call"}
              </LuxeButton>
            </div>
          </form>
        )}
      </GlassCard>
    </div>
  );
}

const TICK =
  "mt-0.5 h-4 w-4 shrink-0 accent-gold outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold/70";

function choiceRow(invalid: boolean, checked: boolean): string {
  return cn(
    "flex min-h-[2.75rem] cursor-pointer items-start gap-3 rounded-xl border px-4 py-3",
    "text-[0.95rem] leading-snug text-white/90 transition-colors duration-300",
    invalid
      ? "border-red-400/60 bg-red-500/[0.06]"
      : checked
        ? "border-gold/50 bg-gold/[0.08]"
        : "border-white/12 bg-white/[0.04] hover:border-white/20",
  );
}

function QuestionField({
  question,
  value,
  error,
  onChange,
}: {
  question: CallQuestion;
  value: string | string[] | undefined;
  error?: string;
  onChange: (value: string | string[]) => void;
}) {
  if (question.type === "text") {
    return (
      <LuxeInput
        label={question.label}
        required={question.required}
        value={typeof value === "string" ? value : ""}
        maxLength={500}
        onChange={(event) => onChange(event.target.value)}
        error={error}
      />
    );
  }
  if (question.type === "textarea") {
    return (
      <LuxeTextarea
        label={question.label}
        required={question.required}
        rows={4}
        value={typeof value === "string" ? value : ""}
        maxLength={4000}
        onChange={(event) => onChange(event.target.value)}
        error={error}
      />
    );
  }

  const multiple = question.type === "checkbox";
  const picked = Array.isArray(value) ? value : typeof value === "string" && value ? [value] : [];

  return (
    <fieldset className="flex flex-col gap-2" aria-invalid={error ? true : undefined}>
      {/* The label styling of LuxeFieldShell, so a choice reads like every other field. */}
      <legend className={cn(CAPTION, "mb-2 normal-case tracking-[0.02em] text-[0.8rem] leading-snug")}>
        {question.label}
        {question.required && (
          <span aria-hidden className="ml-1 text-gold">
            *
          </span>
        )}
        {multiple && <span className="ml-2 text-orchid-faint">(choose any that apply)</span>}
      </legend>
      <div className="grid gap-2">
        {question.options.map((option) => {
          const checked = picked.includes(option);
          return (
            <label key={option} className={choiceRow(Boolean(error), checked)}>
              <input
                type={multiple ? "checkbox" : "radio"}
                name={`q-${question.id}`}
                value={option}
                checked={checked}
                onChange={(event) => {
                  if (!multiple) onChange(option);
                  else onChange(event.target.checked ? [...picked, option] : picked.filter((o) => o !== option));
                }}
                className={TICK}
              />
              <span>{option}</span>
            </label>
          );
        })}
      </div>
      {error && (
        <p role="alert" className="text-xs font-medium text-red-400">
          {error}
        </p>
      )}
    </fieldset>
  );
}

/* ── After booking, and the manage page ─────────────────────────────────── */

function CalendarButtons({ booking }: { booking: CallBooking }) {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
      <a
        href={booking.icsUrl}
        download
        className="inline-flex min-h-[2.75rem] items-center gap-2 rounded-full border border-white/15 bg-white/[0.05] px-5 text-sm font-semibold text-white transition-colors duration-300 hover:border-gold/45"
      >
        <Download aria-hidden className="size-4 text-gold" />
        Add to calendar (.ics)
      </a>
      <AddToCalendar
        title={`${booking.callTitle} with Yvette Howard`}
        startsAt={booking.startsAt}
        durationMinutes={booking.durationMinutes}
        meetingUrl={booking.meetingUrl}
        agenda=""
      />
    </div>
  );
}

function WhereToJoin({ booking }: { booking: CallBooking }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
      <p className={CAPTION}>Where to join</p>
      {booking.meetingUrl ? (
        <a
          href={booking.meetingUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2.5 inline-flex min-h-[2.75rem] items-center gap-2.5 break-all text-sm text-gold underline decoration-gold/40 underline-offset-4 hover:text-gold-bright"
        >
          <Video aria-hidden className="size-4 shrink-0" />
          {booking.meetingUrl}
        </a>
      ) : (
        <p className="copy-luxe mt-2.5 text-sm">
          {booking.locationLabel}. Yvette will email your link before the call.
        </p>
      )}
    </div>
  );
}

function BookedPanel({ booking }: { booking: CallBooking }) {
  return (
    <GlassCard accent="green" interactive={false} spotlight={false} className="p-5 sm:p-8">
      <div className="flex items-start gap-4">
        <span
          aria-hidden
          className="grid size-11 shrink-0 place-items-center rounded-full border border-green-bright/30 bg-green-bright/[0.12]"
        >
          <CheckCircle2 className="size-5 text-green-bright" />
        </span>
        <div role="status" className="min-w-0">
          <h2 className="font-display text-2xl text-white">You're booked.</h2>
          <p className="mt-2 text-balance text-lg text-white">{formatFullDateTime(booking.startsAt, booking.timezone)}</p>
          <p className="copy-luxe mt-1.5 text-sm">
            {booking.callTitle} with Yvette Howard, <span className={FIGURE}>{durationLabel(booking.durationMinutes)}</span>.
            A confirmation and calendar invitation are on their way to {booking.email}.
          </p>
        </div>
      </div>

      <div className="mt-6">
        <WhereToJoin booking={booking} />
      </div>

      <div className="mt-6">
        <CalendarButtons booking={booking} />
      </div>

      <div aria-hidden className="rule-faint my-6 w-full" />

      <p className="copy-luxe text-sm">
        Need to cancel or pick another time? Use the link in your email, or{" "}
        <Link to={`/book-a-call/manage/${booking.token}`} className="text-gold underline underline-offset-4">
          manage your booking here
        </Link>
        .
      </p>
    </GlassCard>
  );
}

function ManageBooking({ token }: { token: string }) {
  const [booking, setBooking] = useState<CallBooking | null | undefined>(undefined);
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [timezone] = useVisitorTimezone();

  useEffect(() => {
    let cancelled = false;
    bookACallApi
      .booking(token)
      .then((res) => {
        if (!cancelled) setBooking(res.booking);
      })
      .catch(() => {
        if (!cancelled) setBooking(null);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const cancel = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await bookACallApi.cancel(token, reason.trim());
      setBooking(res.booking);
      setConfirming(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "We couldn't cancel just now. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const seo = <Seo title="Your booking | Boss Clinician" noindex />;

  if (booking === undefined) return <>{seo}<Loading label="Loading your booking" /></>;

  let body: ReactNode;
  if (booking === null) {
    body = (
      <GlassCard interactive={false} spotlight={false} className="p-6 text-center sm:p-8">
        <p className="font-display text-xl text-white">We couldn't find that booking.</p>
        <p className="copy-luxe mt-2 text-sm">
          The link may be incomplete. Copy it again from your confirmation email, or{" "}
          <Link to="/contact" className="text-gold underline underline-offset-4">get in touch</Link>.
        </p>
        <LuxeButton to="/book-a-call" variant="glass" size="sm" className="mt-6">
          Book a call
        </LuxeButton>
      </GlassCard>
    );
  } else {
    const zone = timezone || booking.timezone;
    body = (
      <GlassCard
        accent={booking.cancelled ? "neutral" : "green"}
        interactive={false}
        spotlight={false}
        className="p-5 sm:p-8"
      >
        <p className={CAPTION}>{booking.cancelled ? "Cancelled" : "Your call"}</p>
        <h2 className={cn("mt-2 font-display text-2xl text-white", booking.cancelled && "line-through decoration-white/40")}>
          {booking.callTitle}
        </h2>
        <p className="mt-2 text-balance text-lg text-white">{formatFullDateTime(booking.startsAt, zone)}</p>
        <p className="copy-luxe mt-1 text-sm">
          <span className={FIGURE}>{durationLabel(booking.durationMinutes)}</span> with Yvette Howard · booked for{" "}
          {booking.name || booking.email}
        </p>

        {!booking.cancelled && (
          <>
            <div className="mt-6">
              <WhereToJoin booking={booking} />
            </div>
            <div className="mt-6">
              <CalendarButtons booking={booking} />
            </div>
          </>
        )}

        <div aria-hidden className="rule-faint my-6 w-full" />

        {booking.cancelled ? (
          <div>
            <p className="copy-luxe text-sm">This call is cancelled. Pick another time whenever you're ready.</p>
            <LuxeButton to={`/book-a-call/${booking.callSlug}`} variant="foil" size="sm" className="mt-5">
              <CalendarCheck2 aria-hidden className="size-4" />
              Book another time
            </LuxeButton>
          </div>
        ) : booking.canCancel ? (
          confirming ? (
            <div>
              <LuxeTextarea
                label="Anything Yvette should know? (optional)"
                rows={3}
                maxLength={500}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
              <div aria-live="polite" className="mt-3 min-h-[1.25rem]">
                {error && (
                  <p role="alert" className="text-sm font-medium text-red-400">
                    {error}
                  </p>
                )}
              </div>
              <div className="mt-3 flex flex-wrap gap-3">
                <LuxeButton type="button" variant="foil" size="sm" disabled={busy} onClick={() => void cancel()}>
                  {busy && <Loader2 aria-hidden className="size-4 animate-spin" />}
                  {busy ? "Cancelling" : "Yes, cancel this call"}
                </LuxeButton>
                <LuxeButton type="button" variant="quiet" onClick={() => setConfirming(false)}>
                  Keep my call
                </LuxeButton>
              </div>
            </div>
          ) : (
            <div>
              <p className="copy-luxe text-sm">
                Can't make it? Cancel here and book a new time — it takes a minute, and it frees the slot for someone
                else.
              </p>
              <div className="mt-5 flex flex-wrap gap-3">
                <LuxeButton type="button" variant="outline" size="sm" onClick={() => setConfirming(true)}>
                  Cancel this call
                </LuxeButton>
                <LuxeButton to={`/book-a-call/${booking.callSlug}`} variant="quiet">
                  See other times
                </LuxeButton>
              </div>
            </div>
          )
        ) : (
          <p className="copy-luxe text-sm">
            This call has already started or finished. For anything else,{" "}
            <Link to="/contact" className="text-gold underline underline-offset-4">get in touch</Link>.
          </p>
        )}
      </GlassCard>
    );
  }

  return (
    <>
      {seo}
      <LuxePageHero eyebrow="Book A Call" title="Your booking" tone="violet" />
      <Section surface="base" space="md" aria-label="Your booking" containerClassName="max-w-2xl">
        {body}
      </Section>
    </>
  );
}
