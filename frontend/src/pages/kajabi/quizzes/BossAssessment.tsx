import { useId, useRef, useState, type FormEvent, type ReactElement } from "react";
import { Link } from "react-router";
import { motion, useReducedMotion } from "motion/react";
import { Seo } from "@/components/Seo";
import { useHoneypot, type HoneypotPayload } from "@/components/forms/useHoneypot";
import { GlassCard } from "@/components/luxe/GlassCard";
import { LuxeButton } from "@/components/luxe/LuxeButton";
import { LuxeInput, LuxeTextarea } from "@/components/luxe/LuxeField";
import { Section } from "@/components/luxe/Section";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import {
  BOSS_ASSESSMENT as A,
  BOSS_ASSESSMENT_AREAS,
  BOSS_ASSESSMENT_CHOICES,
  BOSS_ASSESSMENT_QUESTIONS,
  bossAssessmentResultText,
  scoreBossAssessment,
  type BossAssessmentResult,
} from "@/content/bossAssessment";
import {
  Arrow,
  EMAIL_PATTERN,
  FormError,
  QuizProgress,
  scrollToEl,
  submitErrorMessage,
  useAlive,
  useFocusOnChange,
  useSwap,
} from "./shared";

/**
 * /boss-assessment: the group practice self-assessment, rebuilt from the owner's
 * source page (content/bossAssessment.ts).
 *
 * As on the source: ten statements one at a time, Next commits a choice and asks
 * for one if none is picked, Back keeps earlier choices, and the result is on
 * screen without anyone giving an address. "Email my results" is optional. It
 * files the taker under the `boss-assessment` form with their ten answers, and
 * the server works the result out again before emailing it, so the page sends
 * answers and never a score.
 */

const TOTAL = BOSS_ASSESSMENT_QUESTIONS.length;
type Stage = "intro" | "quiz" | "results";

function emptyAnswers(): (number | null)[] {
  return new Array<number | null>(TOTAL).fill(null);
}

export default function BossAssessment() {
  const reduce = useReducedMotion();
  const { arm, focusOnMount } = useFocusOnChange();
  const topRef = useRef<HTMLDivElement>(null);
  // Held here rather than in the email card: the fill time it reports starts at
  // arrival, so ten statements are behind anyone who reaches the form.
  const [honeypot, honeypotField] = useHoneypot();

  const [stage, setStage] = useState<Stage>("intro");
  const [index, setIndex] = useState(0);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [answers, setAnswers] = useState<(number | null)[]>(emptyAnswers);
  const [chooseFirst, setChooseFirst] = useState(false);
  const [commitment, setCommitment] = useState("");
  const [round, setRound] = useState(0);
  const swap = useSwap(direction);

  const item = BOSS_ASSESSMENT_QUESTIONS[index];
  const picked = answers[index];
  const isLast = index === TOTAL - 1;

  function show(next: Stage, nextIndex: number, dir: 1 | -1) {
    arm();
    setDirection(dir);
    setChooseFirst(false);
    setStage(next);
    setIndex(nextIndex);
    scrollToEl(topRef.current, reduce);
  }

  function choose(value: number) {
    setChooseFirst(false);
    setAnswers((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  }

  function handleNext() {
    if (picked === null) {
      setChooseFirst(true);
      return;
    }
    if (isLast) show("results", index, 1);
    else show("quiz", index + 1, 1);
  }

  function retake() {
    setAnswers(emptyAnswers());
    setCommitment("");
    setRound((r) => r + 1);
    show("quiz", 0, -1);
  }

  const complete = answers.every((answer) => answer !== null);
  const result = stage === "results" && complete ? scoreBossAssessment(answers as number[]) : null;

  return (
    <>
      <Seo title={A.seoTitle} description={A.seoDescription} canonicalPath="/boss-assessment" />
      <Section
        surface="deep"
        space="md"
        aurora="violet"
        auroraIntensity={0.6}
        seam={false}
        aria-label="Group Practice Self-Assessment"
        containerClassName="max-w-[54rem]"
      >
        <header className="mx-auto max-w-2xl text-center">
          <p className="text-[0.7rem] font-semibold uppercase tracking-[0.2em] text-gold/90">{A.eyebrow}</p>
          <h1 className="mt-4 text-balance font-display text-[2rem] font-medium leading-[1.12] text-white sm:text-[2.6rem]">
            {A.titleLead} <em className="italic text-gold">{A.titleAccent}</em>
          </h1>
          <p className="copy-luxe mx-auto mt-4 max-w-[52ch] text-pretty">{A.sub}</p>
          {stage === "intro" && (
            <LuxeButton variant="foil" size="md" onClick={() => show("quiz", 0, 1)} className="mt-7 min-h-[44px] max-w-full">
              {A.start}
              <Arrow />
            </LuxeButton>
          )}
        </header>

        <div ref={topRef} className="mt-9">
          {stage === "intro" && (
            <GlassCard accent="gold" interactive={false} spotlight={false} className="p-6 sm:p-9">
              <h2 className="font-display text-[1.5rem] font-medium leading-tight text-white sm:text-[1.8rem]">
                {A.intro.heading}
              </h2>
              <p className="copy-luxe mt-4 text-pretty">{A.intro.body}</p>
              <p className="copy-luxe mt-4 text-pretty">
                {A.intro.howLead}
                <strong className="font-bold tabular-nums text-white">{A.intro.howLow}</strong>
                {A.intro.howTo}
                <strong className="font-bold tabular-nums text-white">{A.intro.howHigh}</strong>
                {A.intro.howRest}
              </p>
            </GlassCard>
          )}

          {stage === "quiz" && item && (
            <>
              <QuizProgress
                label={`${item.areaIndex + 1} / ${BOSS_ASSESSMENT_AREAS.length} · ${BOSS_ASSESSMENT_AREAS[item.areaIndex].title}`}
                right={`Question ${index + 1} of ${TOTAL}`}
                pct={Math.round(((index + 1) / TOTAL) * 100)}
              />
              <motion.div key={`q${index}-${round}`} {...swap} className="mt-7">
                <GlassCard accent="gold" interactive={false} spotlight={false} className="p-5 sm:p-9">
                  <p
                    id="boss-assessment-question"
                    ref={focusOnMount}
                    tabIndex={-1}
                    className="text-[1.15rem] font-bold leading-[1.4] text-white outline-none sm:text-[1.25rem]"
                  >
                    {item.text}
                  </p>
                  <div
                    role="group"
                    aria-label={A.quiz.choiceGroup}
                    aria-describedby="boss-assessment-question"
                    className="mt-6 grid grid-cols-5 gap-1 sm:gap-2.5"
                  >
                    {BOSS_ASSESSMENT_CHOICES.map((label, i) => (
                      <ChoiceButton key={label} value={i + 1} label={label} on={picked === i + 1} onClick={() => choose(i + 1)} />
                    ))}
                  </div>
                  <p className="mt-4 text-xs font-bold tabular-nums text-orchid-faint">{A.quiz.scale}</p>
                  {chooseFirst && (
                    <div className="mt-4">
                      <FormError>{A.quiz.chooseFirst}</FormError>
                    </div>
                  )}
                  <div className="mt-7 flex flex-wrap items-center justify-between gap-3">
                    <LuxeButton
                      variant="outline"
                      size="sm"
                      disabled={index === 0}
                      onClick={() => show("quiz", index - 1, -1)}
                      className="min-h-[44px]"
                    >
                      <Arrow back />
                      {A.quiz.back}
                    </LuxeButton>
                    <LuxeButton variant="foil" size="sm" onClick={handleNext} className="min-h-[44px]">
                      {isLast ? A.quiz.finish : A.quiz.next}
                      <Arrow />
                    </LuxeButton>
                  </div>
                </GlassCard>
              </motion.div>
            </>
          )}

          {result && (
            <motion.div key={`result-${round}`} {...swap} className="flex flex-col gap-5">
              <ResultCard result={result} focusRef={focusOnMount} />
              <MoveCard result={result} commitment={commitment} onCommitment={setCommitment} onRetake={retake} />
              <EmailCard
                key={`email-${round}`}
                answers={answers as number[]}
                commitment={commitment}
                honeypot={honeypot}
                honeypotField={honeypotField}
              />
              <BoardroomCard />
            </motion.div>
          )}
        </div>

        <p className="mt-8 text-center text-xs leading-relaxed text-orchid-faint">
          {A.footer}{" "}
          <Link to={A.terms.to} className="underline underline-offset-2 hover:text-gold">
            {A.terms.label}
          </Link>
        </p>
      </Section>
    </>
  );
}

function ChoiceButton({
  value,
  label,
  on,
  onClick,
}: {
  value: number;
  label: string;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "flex min-h-[64px] min-w-0 flex-col items-center justify-center gap-0.5 rounded-xl border px-0.5 py-2.5",
        "transition-colors duration-300",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold/70",
        on
          ? "border-gold/60 bg-gold/[0.10] text-white"
          : "border-white/12 bg-white/[0.04] text-white/85 hover:border-white/25 hover:bg-white/[0.06]",
      )}
    >
      <span className="text-[1.05rem] font-bold tabular-nums">{value}</span>
      <span className="text-[0.5625rem] font-medium leading-tight tracking-tight sm:text-xs">{label}</span>
    </button>
  );
}

function ResultCard({
  result,
  focusRef,
}: {
  result: BossAssessmentResult;
  focusRef: (el: HTMLElement | null) => void;
}) {
  const leaders = result.leaders.map((i) => BOSS_ASSESSMENT_AREAS[i]);
  return (
    <GlassCard accent="gold" interactive={false} spotlight={false} className="p-6 sm:p-9">
      <p className="text-[0.7rem] font-semibold uppercase tracking-[0.2em] text-gold/90">{A.results.eyebrow}</p>
      <h2
        ref={focusRef}
        tabIndex={-1}
        className="mt-3 text-balance font-display text-[1.6rem] font-medium leading-tight text-white outline-none sm:text-[1.9rem]"
      >
        {A.results.heading}
      </h2>

      <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.04] p-5 sm:p-6">
        <p className="text-sm text-orchid-faint">{A.results.totalLabel}</p>
        <p className="mt-1 font-bold tabular-nums text-white">
          <span className="text-[3.25rem] leading-none">{result.sum}</span>{" "}
          <span className="text-[1.4rem]">{A.results.outOf}</span>
        </p>
        <p className="mt-3 font-bold text-white">{result.tierTitle}</p>
        <p className="copy-luxe mt-2 text-pretty">{result.tierText}</p>
      </div>

      <h3 className="mt-7 font-display text-[1.2rem] font-medium text-white">{A.results.blockersHeading}</h3>
      <ul className="mt-2 list-none">
        {BOSS_ASSESSMENT_AREAS.map((area, i) => (
          <li key={area.title} className="flex items-center gap-4 border-b border-white/10 py-3">
            <div className="min-w-0 flex-1">
              <p className="font-bold text-white">{area.title}</p>
              <div aria-hidden className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-gold/15">
                <div className="h-full rounded-full bg-gold-foil" style={{ width: `${result.totals[i] * 10}%` }} />
              </div>
            </div>
            <p className="w-12 shrink-0 text-right font-bold tabular-nums text-white">{result.totals[i]}/10</p>
          </li>
        ))}
      </ul>

      <div className="mt-6 rounded-r-xl border-l-4 border-gold bg-gold/[0.07] px-5 py-5">
        <p className="text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-gold/90">{A.results.startingEyebrow}</p>
        <h3 className="mt-2 font-display text-[1.2rem] font-medium leading-snug text-white">
          {leaders.map((area) => area.title).join(" + ")}
        </h3>
        <p className="copy-luxe mt-2 text-pretty">{leaders.map((area) => area.description).join(" ")}</p>
        <p className="mt-3 font-bold leading-relaxed text-white">
          {A.results.tryFirst}
          {leaders.map((area) => area.action).join(" ")}
        </p>
      </div>

      <p className="mt-5 text-xs leading-relaxed text-orchid-faint">{A.results.disclaimer}</p>
    </GlassCard>
  );
}

function MoveCard({
  result,
  commitment,
  onCommitment,
  onRetake,
}: {
  result: BossAssessmentResult;
  commitment: string;
  onCommitment: (value: string) => void;
  onRetake: () => void;
}) {
  const [status, setStatus] = useState("");

  async function copy() {
    try {
      const url = `${window.location.origin}${A.boardroom.to}`;
      await navigator.clipboard.writeText(bossAssessmentResultText(result, commitment, url));
      setStatus(A.move.copied);
    } catch {
      setStatus(A.move.copyFailed);
    }
  }

  return (
    <GlassCard accent="gold" interactive={false} spotlight={false} className="p-6 sm:p-9">
      <h2 className="font-display text-[1.5rem] font-medium leading-tight text-white sm:text-[1.8rem]">{A.move.heading}</h2>
      <p className="copy-luxe mt-3 text-pretty">{A.move.body}</p>
      <LuxeTextarea
        label={A.move.commitLabel}
        placeholder={A.move.commitPlaceholder}
        rows={3}
        maxLength={2000}
        value={commitment}
        onChange={(e) => onCommitment(e.target.value)}
        wrapperClassName="mt-6"
      />
      <div className="mt-5 flex flex-wrap justify-between gap-3">
        <LuxeButton variant="outline" size="sm" onClick={() => void copy()} className="min-h-[44px]">
          {A.move.copy}
        </LuxeButton>
        <LuxeButton variant="outline" size="sm" onClick={onRetake} className="min-h-[44px]">
          {A.move.retake}
        </LuxeButton>
      </div>
      <p role="status" className="mt-3 min-h-[1.25rem] text-xs text-orchid-faint">
        {status}
      </p>
    </GlassCard>
  );
}

function EmailCard({
  answers,
  commitment,
  honeypot,
  honeypotField,
}: {
  answers: number[];
  commitment: string;
  honeypot: () => HoneypotPayload;
  honeypotField: ReactElement;
}) {
  const alive = useAlive();
  const errorId = useId();
  const [firstName, setFirstName] = useState("");
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [sending, setSending] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [notSent, setNotSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending) return;
    const first = firstName.trim();
    const address = email.trim().toLowerCase();
    if (!first) {
      setError("Please enter your first name.");
      return;
    }
    if (!EMAIL_PATTERN.test(address)) {
      setError("Please enter a valid email address.");
      return;
    }

    setSending(true);
    setError(null);
    setNotSent(false);
    try {
      const reply = await api.submitForm(
        A.formSlug,
        { first_name: first, email: address, answers, marketing_consent: consent, commitment },
        address,
        honeypot(),
      );
      if (!alive.current) return;
      if (reply.resultsEmailed === false) setNotSent(true);
      else setSentTo(address);
    } catch (err) {
      if (alive.current) setError(submitErrorMessage(err));
    } finally {
      if (alive.current) setSending(false);
    }
  }

  return (
    <GlassCard accent="gold" interactive={false} spotlight={false} className="p-6 sm:p-9">
      <p className="text-[0.7rem] font-semibold uppercase tracking-[0.2em] text-gold/90">{A.email.eyebrow}</p>
      <h2 className="mt-2 text-balance font-display text-[1.5rem] font-medium leading-tight text-white sm:text-[1.8rem]">
        {A.email.heading}
      </h2>
      {sentTo ? (
        <p role="status" className="copy-luxe mt-4 text-pretty">
          {A.email.sentTo} <strong className="font-semibold text-white">{sentTo}</strong>.
        </p>
      ) : (
        <>
          <p className="copy-luxe mt-3 text-pretty">{A.email.sub}</p>
          <form onSubmit={handleSubmit} noValidate className="relative mt-6 space-y-5">
            {honeypotField}
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <LuxeInput
                label={A.email.firstName}
                name="first_name"
                type="text"
                autoComplete="given-name"
                required
                maxLength={40}
                value={firstName}
                onChange={(e) => {
                  setFirstName(e.target.value);
                  setError(null);
                }}
                className="min-h-[44px]"
              />
              <LuxeInput
                label={A.email.address}
                name="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setError(null);
                  setNotSent(false);
                }}
                aria-describedby={error ? errorId : undefined}
                className="min-h-[44px]"
              />
            </div>
            <label className="flex cursor-pointer items-start gap-3 text-sm leading-relaxed text-white/85">
              <input
                type="checkbox"
                name="marketing_consent"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                className="mt-1 h-4 w-4 shrink-0 accent-gold"
              />
              <span>{A.email.consent}</span>
            </label>
            {error && <FormError id={errorId}>{error}</FormError>}
            {notSent && <FormError>{A.email.notSent}</FormError>}
            <LuxeButton variant="foil" size="md" type="submit" disabled={sending || notSent} className="min-h-[44px]">
              {sending ? A.email.sending : A.email.submit}
            </LuxeButton>
          </form>
        </>
      )}
    </GlassCard>
  );
}

function BoardroomCard() {
  return (
    <GlassCard accent="gold" interactive={false} spotlight={false} className="p-6 sm:p-9">
      <p className="text-[0.7rem] font-semibold uppercase tracking-[0.2em] text-gold/90">{A.boardroom.eyebrow}</p>
      <h2 className="mt-2 font-display text-[1.5rem] font-medium leading-tight text-white sm:text-[1.8rem]">
        {A.boardroom.heading}
      </h2>
      <p className="copy-luxe mt-3 text-pretty">{A.boardroom.body}</p>
      <LuxeButton variant="foil" size="md" to={A.boardroom.to} className="mt-6 min-h-[44px] max-w-full">
        {A.boardroom.cta}
        <Arrow />
      </LuxeButton>
      <p className="mt-3 text-xs text-orchid-faint">{A.boardroom.fine}</p>
    </GlassCard>
  );
}
