import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { motion } from "motion/react";
import { Seo } from "@/components/Seo";
import { GlassCard } from "@/components/luxe/GlassCard";
import { LuxeButton } from "@/components/luxe/LuxeButton";
import { LuxeInput } from "@/components/luxe/LuxeField";
import { GoldRule, Section } from "@/components/luxe/Section";
import { useHoneypot } from "@/components/forms/useHoneypot";
import { useEntranceMotion } from "@/hooks/useEntranceMotion";
import { ApiError, api } from "@/lib/api";
import { cn } from "@/lib/cn";
import {
  readiness as copy,
  readinessQuestions as questions,
  scoreReadiness,
  type ReadinessKey,
} from "@/content/kajabiPagesQuiz";
import { PolicyLinks, rise } from "./shared";

/**
 * /private-practice-for-you — "Is Private Practice Actually Right for You
 * Right Now?", rebuilt from the Kajabi custom-code quiz.
 *
 * Kajabi ran it as three screens and then left the page: the last answer sent
 * the visitor to one of three separate opt-in pages (/notyet-form,
 * /almost-form, /ready-form) chosen by the tally. Here that opt-in is the
 * quiz's own last screen, carrying the matching page's copy, and the reply
 * goes to our `private-practice-for-you` form with the result and the six
 * answers alongside the name and email — then on to the thank-you page, as
 * the almost/ready forms did on Kajabi.
 */

type Screen = "intro" | "quiz" | "capture";

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function scrollTop() {
  window.scrollTo({ top: 0, behavior: "smooth" });
}

export default function PrivatePracticeForYou() {
  const [screen, setScreen] = useState<Screen>("intro");
  const [current, setCurrent] = useState(0);
  const [answers, setAnswers] = useState<(number | null)[]>(() => questions.map(() => null));
  const [result, setResult] = useState<ReadinessKey | null>(null);

  function start() {
    setScreen("quiz");
    scrollTop();
  }

  function select(idx: number) {
    setAnswers((prev) => prev.map((a, i) => (i === current ? idx : a)));
  }

  function next() {
    if (answers[current] === null) return;
    if (current < questions.length - 1) {
      setCurrent(current + 1);
      return;
    }
    setResult(scoreReadiness(answers));
    setScreen("capture");
    scrollTop();
  }

  function prev() {
    if (current > 0) setCurrent(current - 1);
  }

  return (
    <>
      <Seo title={copy.seo.title} description={copy.seo.description} />

      <Section
        surface="deep"
        space="lg"
        aurora="violet"
        auroraIntensity={0.85}
        containerClassName="max-w-3xl"
        className="min-h-[70vh]"
        aria-label="Private practice readiness quiz"
      >
        <div className="mb-8">
          <LuxeButton variant="quiet" size="sm" to="/resource-hub">
            {copy.backLabel}
          </LuxeButton>
        </div>

        {screen === "intro" && <Intro onStart={start} />}
        {screen === "quiz" && (
          <QuestionScreen
            index={current}
            selected={answers[current]}
            onSelect={select}
            onNext={next}
            onPrev={prev}
          />
        )}
        {screen === "capture" && result && (
          <Capture
            result={result}
            answers={answers}
          />
        )}

        <PolicyLinks
          links={[
            { label: "Privacy Policy", to: "/privacy-policy" },
            { label: "Disclaimer", to: "/disclaimer" },
          ]}
        />
      </Section>
    </>
  );
}

/* ── Intro ─────────────────────────────────────────────────────────────── */

function Intro({ onStart }: { onStart: () => void }) {
  const reduce = useEntranceMotion();
  return (
    <motion.div {...rise(reduce)}>
      <GlassCard accent="gold" interactive={false} className="p-7 text-center sm:p-12">
        <span className="eyebrow-luxe">{copy.intro.eyebrow}</span>
        <h1 className="text-balance font-display text-[2.2rem] font-normal leading-[1.08] text-white sm:text-[3rem]">
          {copy.intro.title}{" "}
          <span className="text-foil block font-display italic">{copy.intro.titleAccent}</span>
        </h1>
        <GoldRule className="mx-auto mt-6" />
        <p className="copy-luxe mx-auto mt-6 max-w-[56ch] text-pretty">{copy.intro.sub}</p>
        <ul className="mx-auto mt-8 grid max-w-md grid-cols-1 gap-3 text-left sm:grid-cols-2">
          {copy.intro.meta.map((item) => (
            <li key={item} className="flex items-center gap-3 text-sm text-orchid">
              <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-gold" />
              {item}
            </li>
          ))}
        </ul>
        <div className="mt-10">
          <LuxeButton variant="foil" size="lg" onClick={onStart}>
            {copy.intro.start}
          </LuxeButton>
        </div>
        <p className="mt-5 text-sm font-light text-orchid-faint">{copy.intro.note}</p>
      </GlassCard>
    </motion.div>
  );
}

/* ── One question ──────────────────────────────────────────────────────── */

function QuestionScreen({
  index,
  selected,
  onSelect,
  onNext,
  onPrev,
}: {
  index: number;
  selected: number | null;
  onSelect: (idx: number) => void;
  onNext: () => void;
  onPrev: () => void;
}) {
  const q = questions[index];
  const pct = Math.round((index / questions.length) * 100);
  const last = index === questions.length - 1;

  return (
    <div>
      <div className="mb-6">
        <div className="flex items-center justify-between text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-orchid">
          <span>
            Question <span className="font-sans font-bold tabular-nums">{index + 1}</span> of{" "}
            <span className="font-sans font-bold tabular-nums">{questions.length}</span>
          </span>
          <span className="font-sans font-bold tabular-nums text-gold">{pct}%</span>
        </div>
        <div
          className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          aria-label="Quiz progress"
        >
          <div className="h-full rounded-full bg-gold-foil transition-[width] duration-500 ease-luxe" style={{ width: `${pct}%` }} />
        </div>
      </div>

      <GlassCard accent="plum" interactive={false} spotlight={false} className="p-6 sm:p-10">
        <fieldset key={index}>
          <legend className="contents">
            <span className="block text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-gold">{q.eyebrow}</span>
            <span className="mt-4 block text-balance font-display text-[1.5rem] font-medium leading-snug text-white sm:text-[1.9rem]">
              {q.text}
            </span>
          </legend>
          <div className="mt-7 grid gap-3">
            {q.answers.map((answer, i) => {
              const isSelected = selected === i;
              return (
                <button
                  key={answer.text}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => onSelect(i)}
                  className={cn(
                    "flex min-h-[44px] w-full items-start gap-4 rounded-xl border px-4 py-4 text-left text-[0.95rem] leading-snug transition-colors duration-300",
                    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold",
                    isSelected
                      ? "border-gold/60 bg-gold/[0.08] text-white"
                      : "border-white/12 bg-white/[0.03] text-orchid hover:border-white/25 hover:text-white",
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border text-[0.7rem] font-bold",
                      isSelected ? "border-gold bg-gold text-night-deep" : "border-white/30",
                    )}
                  >
                    {isSelected ? "✓" : ""}
                  </span>
                  <span>{answer.text}</span>
                </button>
              );
            })}
          </div>
        </fieldset>

        <div className="mt-8 flex items-center justify-between gap-4">
          {index > 0 ? (
            <LuxeButton variant="quiet" size="sm" onClick={onPrev}>
              {copy.back}
            </LuxeButton>
          ) : (
            <span />
          )}
          <LuxeButton variant="foil" size="md" onClick={onNext} disabled={selected === null}>
            {last ? copy.finish : copy.next}
          </LuxeButton>
        </div>
      </GlassCard>
    </div>
  );
}

/* ── Result opt-in ─────────────────────────────────────────────────────── */

function Capture({ result, answers }: { result: ReadinessKey; answers: readonly (number | null)[] }) {
  const reduce = useEntranceMotion();
  const navigate = useNavigate();
  const [honeypot, trapField] = useHoneypot();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending) return;
    const name = firstName.trim();
    const last = lastName.trim();
    const address = email.trim();
    if (!name || !last) {
      setError("Please enter your first and last name.");
      return;
    }
    if (!EMAIL_SHAPE.test(address)) {
      setError("Please enter a valid email address.");
      return;
    }

    // Keys match the `private-practice-for-you` form in migration 100; the
    // server keeps only keys the stored form declares.
    const data: Record<string, string> = {
      name,
      last_name: last,
      email: address,
      result: copy.resultLabels[result],
    };
    questions.forEach((q, i) => {
      const pick = answers[i];
      if (pick !== null && pick !== undefined && q.answers[pick]) data[`q${i + 1}`] = q.answers[pick].text;
    });

    setSending(true);
    setError(null);
    try {
      await api.submitForm(copy.formSlug, data, address, honeypot());
      navigate(copy.thankYouPath);
    } catch (err) {
      setSending(false);
      setError(
        err instanceof ApiError && (err.status === 400 || err.status === 429) && err.message
          ? err.message
          : "We couldn't send that just now. Please try again in a moment.",
      );
    }
  }

  return (
    <motion.div {...rise(reduce)}>
      <GlassCard accent="gold" interactive={false} className="p-7 sm:p-10">
        <h1 className="text-balance text-center font-display text-[2rem] font-normal leading-[1.1] text-white sm:text-[2.5rem]">
          {copy.capture.heading}
        </h1>
        <GoldRule className="mx-auto mt-5" />
        <p className="copy-luxe mx-auto mt-6 max-w-[56ch] text-pretty text-center">{copy.capture.bodies[result]}</p>

        <form onSubmit={handleSubmit} noValidate className="relative mx-auto mt-8 grid max-w-xl grid-cols-1 gap-5 sm:grid-cols-2">
          {trapField}
          <LuxeInput
            label={copy.capture.firstName}
            name="first_name"
            autoComplete="given-name"
            required
            maxLength={100}
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            disabled={sending}
          />
          <LuxeInput
            label={copy.capture.lastName}
            name="last_name"
            autoComplete="family-name"
            required
            maxLength={100}
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            disabled={sending}
          />
          <LuxeInput
            label={copy.capture.email}
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            required
            maxLength={320}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={sending}
            wrapperClassName="sm:col-span-2"
          />
          {error && (
            <p role="alert" className="text-sm text-red-300 sm:col-span-2">
              {error}
            </p>
          )}
          <LuxeButton
            type="submit"
            variant="foil"
            size="lg"
            disabled={sending}
            aria-busy={sending || undefined}
            className="w-full sm:col-span-2"
          >
            {sending ? "Sending…" : copy.capture.submit}
          </LuxeButton>
        </form>
        <PolicyLinks
          links={[
            { label: "Financial Disclaimer", to: "/financial-disclaimer" },
            { label: "Privacy Policy", to: "/privacy-policy" },
            { label: "Terms of Use", to: "/terms-of-use" },
            { label: "Disclaimer", to: "/disclaimer" },
          ]}
        />
      </GlassCard>
    </motion.div>
  );
}
