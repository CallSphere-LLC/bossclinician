import { useId, useState, type FormEvent } from "react";
import { motion, useReducedMotion } from "motion/react";
import { useEntranceMotion } from "@/hooks/useEntranceMotion";
import { Section, SectionTitle, GoldRule } from "@/components/luxe/Section";
import { GlassCard } from "@/components/luxe/GlassCard";
import { LuxeButton } from "@/components/luxe/LuxeButton";
import { LuxeInput } from "@/components/luxe/LuxeField";
import { useHoneypot } from "@/components/forms/useHoneypot";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];
const VIEWPORT = { once: true, margin: "-12% 0px -8% 0px" } as const;

interface SliderProps {
  id: string;
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  /** Large display value shown beside the label. */
  display: string;
  /** Human-readable value for assistive tech. */
  valueText: string;
  minLabel: string;
  maxLabel: string;
  onChange: (value: number) => void;
  className?: string;
}

/**
 * A range input on the dark theme.
 *
 * The gold chrome (`.range-gold`) is unchanged, but the painted track is lifted
 * out of the control's own background and onto a decorative sibling. That lets
 * the input itself be a transparent 44px-tall hit strip — a 6px control is a
 * hairline to aim at on a phone — while the visible track keeps its 6px height
 * and rounded ends.
 */
function Slider({
  id,
  label,
  min,
  max,
  step,
  value,
  display,
  valueText,
  minLabel,
  maxLabel,
  onChange,
  className,
}: SliderProps) {
  const percent = ((value - min) / (max - min)) * 100;

  return (
    <div className={className}>
      <div className="mb-2 flex items-center justify-between gap-4">
        <label
          htmlFor={id}
          className="text-[0.72rem] font-semibold uppercase tracking-[0.1em] text-orchid sm:text-[0.68rem] sm:tracking-[0.16em]"
        >
          {label}
        </label>
        <span
          aria-hidden
          className="font-display text-[1.35rem] font-medium leading-none text-white"
        >
          {display}
        </span>
      </div>

      <div className="relative flex h-11 items-center">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full"
          style={{
            background: `linear-gradient(to right, #C9A46A ${percent}%, rgb(var(--c-ink) / 0.15) ${percent}%)`,
          }}
        />
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          aria-valuetext={valueText}
          onChange={(event) => onChange(Number(event.target.value))}
          className="range-gold relative w-full"
          style={{ height: "2.75rem", background: "transparent" }}
        />
      </div>

      <div
        aria-hidden
        className="mt-1 flex justify-between gap-4 text-[0.72rem] text-orchid-dim"
      >
        <span>{minLabel}</span>
        <span>{maxLabel}</span>
      </div>
    </div>
  );
}

interface ResultsCaptureProps {
  rate: number;
  clients: number;
  weeks: number;
  annual: number;
  /** Passed down rather than re-derived, so one pluralisation rule serves both. */
  clientWord: string;
}

/**
 * The opt-in that follows the answer.
 *
 * It sits *after* the readout and never in front of it: the number is this
 * band's whole argument, and gating it behind an address would trade the
 * argument away to win the address. Anyone who ignores this step still gets
 * the full tool.
 *
 * Every slider position and every figure derived from it rides along in the
 * lead's `meta`, so the follow-up conversation can open with the reader's own
 * numbers instead of asking for them a second time.
 *
 * Behaviour (state machine, single error region, aria wiring) deliberately
 * mirrors `components/forms/LeadForm`; the markup does not, because this form
 * is a band inside a card that already owns its own panel and headings.
 */
function ResultsCapture({ rate, clients, weeks, annual, clientWord }: ResultsCaptureProps) {
  // The confirmation card and the error region are both consequences of a
  // submission, so they appear long after the page settled and answer to the
  // reader's live preference rather than to the first paint.
  const reduce = useReducedMotion();
  const errorId = useId();
  const [honeypot, honeypotField] = useHoneypot();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim() || !email.trim()) {
      setError("Please share your name and email so I know where to send them.");
      return;
    }
    setStatus("loading");
    try {
      await api.submitLead({
        name: name.trim(),
        email: email.trim(),
        source: "income-calculator",
        // The new-lead notification email prints `message` but not `meta`, so
        // the scenario is written out twice: once in prose for the inbox, once
        // as structured data for the admin panel.
        message: `Modelled ${clients} ${clientWord} per week at $${rate} per session across ${weeks} weeks — $${annual.toLocaleString()} a year.`,
        meta: {
          sessionRate: rate,
          clientsPerWeek: clients,
          weeksPerYear: weeks,
          // Derived alongside the raw inputs so the inbox never has to redo the
          // arithmetic to understand what the reader was looking at.
          sessionsPerYear: clients * weeks,
          annualIncome: annual,
          monthlyIncome: Math.round(annual / 12),
        },
        ...honeypot(),
      });
      setStatus("success");
    } catch {
      setStatus("error");
      setError(
        "Something went wrong sending your results. Please email bossclinician@gmail.com and I'll send them over.",
      );
    }
  }

  // Success is terminal for the visit: the sliders keep moving underneath, but
  // one set of numbers per reader is the honest amount of mail to send.
  if (status === "success") {
    return (
      <motion.div
        initial={reduce ? false : { opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: EASE }}
        role="status"
        className="text-center"
      >
        <span
          aria-hidden
          className="mx-auto flex h-11 w-11 items-center justify-center rounded-full border border-gold/30 bg-gold/[0.08] text-gold"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-5 w-5"
          >
            <path d="m4.75 12.5 4.75 4.75 9.75-10.5" />
          </svg>
        </span>

        <h3 className="mt-5 text-balance font-display text-[1.2rem] font-medium text-white">
          On its way.
        </h3>

        <GoldRule className="mx-auto mt-5" width="w-16" />

        <p className="copy-luxe mx-auto mt-5 max-w-[46ch] text-pretty text-sm">
          I've got your ${annual.toLocaleString()} projection and the numbers behind it. Check
          your inbox — and reply to that email if you want to talk through what it would take.
        </p>
      </motion.div>
    );
  }

  // The form's only validation rule, mirrored here so the offending controls
  // can be flagged for assistive tech without repeating the message under each
  // field. Both flags clear themselves as soon as the field is filled.
  const invalidSubmit = error !== null && status !== "error";
  const nameInvalid = invalidSubmit && !name.trim();
  const emailInvalid = invalidSubmit && !email.trim();

  return (
    <div>
      <p className="text-center text-[0.72rem] font-bold uppercase tracking-[0.14em] text-gold sm:text-[0.66rem] sm:tracking-[0.22em]">
        Keep Your Numbers
      </p>
      <h3 className="mt-3 text-balance text-center font-display text-[1.2rem] font-medium text-white">
        Email me my results
      </h3>
      <p className="copy-luxe mx-auto mt-3 max-w-[48ch] text-balance text-center text-sm">
        I'll send this projection to your inbox with the pricing math behind it, so you can sit
        with the number before you decide anything.
      </p>

      <form
        onSubmit={handleSubmit}
        noValidate
        aria-busy={status === "loading"}
        className="relative mt-7 space-y-5"
      >
        {honeypotField}

        <div className="grid gap-5 sm:grid-cols-2">
          <LuxeInput
            label="Full name"
            name="name"
            type="text"
            autoComplete="name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={nameInvalid ? true : undefined}
            aria-describedby={nameInvalid ? errorId : undefined}
          />
          <LuxeInput
            label="Email address"
            name="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={emailInvalid ? true : undefined}
            aria-describedby={emailInvalid ? errorId : undefined}
          />
        </div>

        {error && (
          <motion.p
            id={errorId}
            role="alert"
            initial={reduce ? false : { opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: EASE }}
            className="flex items-start gap-2.5 rounded-xl border border-red-400/30 bg-red-500/[0.09] px-4 py-3 text-sm font-medium leading-relaxed text-red-300"
          >
            <svg
              aria-hidden
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              className="mt-0.5 h-4 w-4 shrink-0"
            >
              <circle cx="12" cy="12" r="9.25" />
              <path d="M12 7.5v5.25M12 16.25v.01" />
            </svg>
            {/* min-w-0 lets a long address (bossclinician@gmail.com) wrap
                instead of forcing the card wider than a 360px viewport. */}
            <span className="min-w-0 break-words">{error}</span>
          </motion.p>
        )}

        <LuxeButton
          variant="foil"
          size="md"
          type="submit"
          disabled={status === "loading"}
          className="min-h-[44px] w-full"
        >
          {status === "loading" ? "Sending…" : "Email My Results"}
          {status === "loading" ? (
            <svg
              aria-hidden
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.1"
              strokeLinecap="round"
              className="h-4 w-4 animate-spin"
            >
              <circle cx="12" cy="12" r="9" opacity="0.3" />
              <path d="M21 12a9 9 0 0 0-9-9" />
            </svg>
          ) : (
            <svg
              aria-hidden
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-3.5 w-3.5 transition-transform duration-500 ease-luxe group-hover:translate-x-1"
            >
              <path d="M2.5 8h11M9.5 4l4 4-4 4" />
            </svg>
          )}
        </LuxeButton>

        <p className="text-center text-xs text-orchid-dim">
          One email with your numbers. Unsubscribe any time.
        </p>
      </form>
    </div>
  );
}

/**
 * The Resource Hub's one interactive tool.
 *
 * Everything the reader changes is set in white; the single thing the tool
 * *returns* is the only foil on the band, printed on a gold-washed footer bled
 * to the panel's clipped corners so the answer reads as struck onto the card
 * rather than boxed inside it.
 */
export function IncomeCalculator() {
  const baseId = useId();
  const staticEntrance = useEntranceMotion();
  const [rate, setRate] = useState(175);
  const [clients, setClients] = useState(15);
  const [weeks, setWeeks] = useState(48);

  const annual = rate * clients * weeks;
  const clientWord = clients === 1 ? "client" : "clients";

  return (
    <Section
      surface="deep"
      space="md"
      aurora="gold"
      auroraIntensity={0.6}
      aria-label="Calculate Your Income Potential"
      containerClassName="max-w-3xl"
    >
      <SectionTitle
        align="center"
        eyebrow="Income Tool"
        title="Calculate Your Income Potential"
        titleClassName="text-[1.75rem] sm:text-[2.1rem] lg:text-[2.5rem]"
        body="Most therapists have never done this math — and it changes everything. Use this calculator to see exactly how much your practice could generate based on your session rate and caseload. Then ask yourself: are you charging what your expertise is worth?"
      />

      <motion.p
        initial={staticEntrance ? false : { opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={VIEWPORT}
        transition={{ duration: 0.8, delay: staticEntrance ? 0 : 0.1, ease: EASE }}
        className="copy-luxe mx-auto mt-8 max-w-[56ch] text-balance text-center text-sm"
      >
        For example — a therapist seeing{" "}
        <strong className="font-semibold text-white">15 clients per week</strong> at{" "}
        <strong className="font-semibold text-white">$175 per session</strong> generates over{" "}
        <strong className="font-semibold text-gold">$126,000 annually</strong>. That's a full-time
        income seeing fewer than 3 clients per day. Strategy matters more than hours.
      </motion.p>

      <motion.div
        initial={staticEntrance ? false : { opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={VIEWPORT}
        transition={{ duration: 0.85, delay: staticEntrance ? 0 : 0.18, ease: EASE }}
        className="mt-10"
      >
        <GlassCard accent="gold" interactive={false} spotlight={false} className="overflow-hidden">
          <div className="px-6 py-8 sm:px-9">
            <h3 className="text-center font-display text-[1.2rem] font-medium text-white">
              Your Practice Calculator
            </h3>
            <GoldRule className="mx-auto mt-5" width="w-16" />

            <div className="mt-8">
              <Slider
                id={`${baseId}-rate`}
                label="Session Rate"
                min={50}
                max={400}
                step={5}
                value={rate}
                display={`$${rate}`}
                valueText={`$${rate} per session`}
                minLabel="$50"
                maxLabel="$400"
                onChange={setRate}
                className="mb-6"
              />

              <Slider
                id={`${baseId}-clients`}
                label="Clients Per Week"
                min={1}
                max={50}
                step={1}
                value={clients}
                display={`${clients}`}
                valueText={`${clients} ${clientWord} per week`}
                minLabel="1"
                maxLabel="50"
                onChange={setClients}
                className="mb-6"
              />

              <Slider
                id={`${baseId}-weeks`}
                label="Weeks Per Year"
                min={20}
                max={52}
                step={1}
                value={weeks}
                display={`${weeks}`}
                valueText={`${weeks} weeks per year`}
                minLabel="20 weeks"
                maxLabel="52 weeks"
                onChange={setWeeks}
              />
            </div>
          </div>

          <div
            aria-hidden
            className="h-px w-full"
            style={{
              backgroundImage:
                "linear-gradient(90deg, rgba(201,164,106,0.55), rgba(201,164,106,0.16) 55%, transparent)",
            }}
          />

          <div className="relative bg-gold/[0.07] px-6 py-8 sm:px-9">
            <div
              aria-hidden
              className="pointer-events-none absolute -top-20 left-1/2 h-40 w-[70%] -translate-x-1/2 blur-3xl"
              style={{
                background:
                  "radial-gradient(ellipse at center, rgba(201,164,106,0.28) 0%, transparent 70%)",
              }}
            />

            <div aria-live="polite" aria-atomic="true" className="relative text-center">
              <p className="text-[0.72rem] font-bold uppercase tracking-[0.14em] text-gold sm:text-[0.66rem] sm:tracking-[0.22em]">
                Annual Income Potential
              </p>
              {/* Clamped rather than fixed: at $400 × 50 × 52 the readout is ten
                  glyphs wide, which overruns a 360px phone at any static size. */}
              <p
                className={cn(
                  "text-foil mt-3 max-w-full font-display font-medium leading-none",
                  "text-[clamp(2.1rem,10vw,3.6rem)]",
                )}
              >
                ${annual.toLocaleString()}
              </p>
              <p className="mt-3 text-pretty text-[0.88rem] italic text-orchid">
                {clients} {clientWord} &nbsp;·&nbsp; ${rate}/session &nbsp;·&nbsp; {weeks} weeks
              </p>
            </div>

            <div aria-hidden className="rule-faint relative mt-7 w-full" />

            {/* Design specifies rgba(255,255,255,0.2); raised to orchid-dim for
                AA contrast. */}
            <p className="relative mt-5 text-center text-[0.88rem] italic leading-relaxed text-orchid-dim">
              This calculator illustrates potential outcomes. Results depend on your market,
              niche, and implementation. Nothing is guaranteed.
            </p>
          </div>

          {/* The card's second foil seam. The capture step is a band of its own
              rather than a footnote under the answer, so the tool still reads as
              finished at the readout. */}
          <div
            aria-hidden
            className="h-px w-full"
            style={{
              backgroundImage:
                "linear-gradient(90deg, rgba(201,164,106,0.55), rgba(201,164,106,0.16) 55%, transparent)",
            }}
          />

          <div className="px-6 py-8 sm:px-9">
            <ResultsCapture
              rate={rate}
              clients={clients}
              weeks={weeks}
              annual={annual}
              clientWord={clientWord}
            />
          </div>
        </GlassCard>
      </motion.div>
    </Section>
  );
}
