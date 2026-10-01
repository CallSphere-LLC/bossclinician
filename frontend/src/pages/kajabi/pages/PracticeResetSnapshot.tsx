import { useState } from "react";
import { motion } from "motion/react";
import { Seo } from "@/components/Seo";
import { GlassCard } from "@/components/luxe/GlassCard";
import { LuxeButton } from "@/components/luxe/LuxeButton";
import { LuxePageHero } from "@/components/luxe/LuxePageHero";
import { GoldRule, Section } from "@/components/luxe/Section";
import { useEntranceMotion } from "@/hooks/useEntranceMotion";
import { cn } from "@/lib/cn";
import { luxeControlClass } from "@/components/luxe/LuxeField";
import {
  scoreSnapshot,
  snapshot as copy,
  type BoldLead,
  type SnapshotQuestion,
  type SnapshotResultKey,
} from "@/content/kajabiPagesQuiz";
import { rise } from "./shared";

/**
 * /practice-reset-snapshot — the Boss Clinician Lounge's onboarding
 * self-assessment, rebuilt from the Kajabi custom-code page.
 *
 * Same flow and the same arithmetic: eleven required questions (ten scored
 * 1–4, one directional), an optional reflection that is never sent anywhere
 * ("Nobody sees this but you"), then one of three results with its first five
 * moves. The Kajabi page posted nothing — everything happens in the browser —
 * and so does this one.
 */

const QUESTION_ID = (n: number) => `snapshot-q${n}`;

function Bold({ lead }: { lead: BoldLead }) {
  return (
    <>
      <strong className="font-semibold text-white">{lead.strong}</strong>
      {lead.text}
    </>
  );
}

export default function PracticeResetSnapshot() {
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [reflection, setReflection] = useState("");
  const [warn, setWarn] = useState(false);
  const [result, setResult] = useState<SnapshotResultKey | null>(null);

  const answered = Object.keys(answers).filter((k) => Number(k) <= copy.requiredCount).length;

  function choose(question: number, value: string) {
    setAnswers((prev) => ({ ...prev, [question]: value }));
    setWarn(false);
  }

  function seeResults() {
    for (let i = 1; i <= copy.requiredCount; i += 1) {
      if (!answers[i]) {
        setWarn(true);
        document.getElementById(QUESTION_ID(i))?.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }
    }
    setResult(scoreSnapshot(answers));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function retake() {
    setAnswers({});
    setReflection("");
    setWarn(false);
    setResult(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <>
      <Seo title={copy.seo.title} description={copy.seo.description} />

      <LuxePageHero
        eyebrow={copy.hero.eyebrow}
        title={copy.hero.title}
        titleAccent={copy.hero.tagline}
        tone="violet"
        align="center"
        lede={copy.hero.intro}
      />

      {result ? (
        <Results resultKey={result} onRetake={retake} />
      ) : (
        <>
          <ProgressBar answered={answered} />
          <Section surface="base" space="md" containerClassName="max-w-3xl" aria-label="Snapshot questions">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                seeResults();
              }}
              noValidate
            >
              {copy.sections.map((section) => (
                <div key={section.heading} className="mt-12 first:mt-0">
                  <div className="mb-6 flex items-center gap-4">
                    <GoldRule width="w-10" />
                    <h2 className="text-balance font-display text-[1.35rem] font-medium leading-snug text-white sm:text-[1.6rem]">
                      {section.heading}
                    </h2>
                  </div>
                  <div className="space-y-5">
                    {section.questions.map((q) => (
                      <QuestionCard
                        key={q.number}
                        question={q}
                        value={answers[q.number]}
                        onChoose={(value) => choose(q.number, value)}
                      />
                    ))}
                  </div>
                </div>
              ))}

              <GlassCard accent="neutral" interactive={false} spotlight={false} className="mt-5 p-6 sm:p-8">
                <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-gold">
                  {copy.reflection.number}
                </p>
                <label htmlFor="snapshot-q12" className="mt-3 block font-display text-[1.15rem] font-medium leading-snug text-white sm:text-[1.3rem]">
                  {copy.reflection.text}
                </label>
                <p className="mt-2 text-sm italic leading-[1.7] text-orchid-dim">{copy.reflection.sub}</p>
                <textarea
                  id="snapshot-q12"
                  name="q12"
                  rows={4}
                  value={reflection}
                  onChange={(e) => setReflection(e.target.value)}
                  placeholder={copy.reflection.placeholder}
                  className={cn(luxeControlClass, "mt-5 resize-y leading-relaxed")}
                />
              </GlassCard>

              <div className="mt-10 text-center">
                <LuxeButton type="submit" variant="foil" size="lg">
                  {copy.submitLabel}
                </LuxeButton>
                {warn && (
                  <p role="alert" className="mt-4 text-sm text-red-300">
                    {copy.warning}
                  </p>
                )}
              </div>
            </form>
            <SnapshotFooter />
          </Section>
        </>
      )}
    </>
  );
}

function ProgressBar({ answered }: { answered: number }) {
  const pct = (answered / copy.requiredCount) * 100;
  return (
    <div className="sticky top-20 z-20 border-b border-white/10 bg-night-deep/90 backdrop-blur-md">
      <div className="mx-auto max-w-3xl px-4 py-3 sm:px-6">
        <div className="flex items-center justify-between text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-orchid">
          <span>{copy.progressLabel}</span>
          <span className="font-sans font-bold tabular-nums text-gold" aria-live="polite">
            {answered} of {copy.requiredCount} answered
          </span>
        </div>
        <div
          className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={copy.requiredCount}
          aria-valuenow={answered}
          aria-label={copy.progressLabel}
        >
          <div
            className="h-full rounded-full bg-gold-foil transition-[width] duration-500 ease-luxe"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    </div>
  );
}

function QuestionCard({
  question,
  value,
  onChoose,
}: {
  question: SnapshotQuestion;
  value: string | undefined;
  onChoose: (value: string) => void;
}) {
  const answered = value !== undefined;
  return (
    <GlassCard
      accent={answered ? "gold" : "neutral"}
      interactive={false}
      spotlight={false}
      className={cn("scroll-mt-40 p-6 transition-colors duration-500 sm:p-8", answered && "border-gold/30")}
    >
      <fieldset id={QUESTION_ID(question.number)} className="scroll-mt-40">
        <legend className="contents">
          <span className="block text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-gold">
            Question <span className="font-sans font-bold tabular-nums">{question.number}</span>
          </span>
          <span className="mt-3 block text-pretty font-display text-[1.15rem] font-medium leading-snug text-white sm:text-[1.3rem]">
            {question.text}
          </span>
        </legend>
        {question.sub && <p className="mt-2 text-sm leading-[1.7] text-orchid-dim">{question.sub}</p>}
        <div className="mt-5 grid gap-3">
          {question.options.map((option) => {
            const checked = value === option.value;
            return (
              <label
                key={option.value}
                className={cn(
                  "flex min-h-[44px] cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 text-[0.95rem] leading-snug transition-colors duration-300",
                  checked
                    ? "border-gold/60 bg-gold/[0.08] text-white"
                    : "border-white/12 bg-white/[0.03] text-orchid hover:border-white/25",
                )}
              >
                <input
                  type="radio"
                  name={`q${question.number}`}
                  value={option.value}
                  checked={checked}
                  onChange={() => onChoose(option.value)}
                  className="size-4 shrink-0 accent-[rgb(201,164,106)]"
                />
                <span>{option.label}</span>
              </label>
            );
          })}
        </div>
      </fieldset>
    </GlassCard>
  );
}

function Results({ resultKey, onRetake }: { resultKey: SnapshotResultKey; onRetake: () => void }) {
  const reduce = useEntranceMotion();
  const r = copy.results[resultKey];
  return (
    <Section surface="base" space="lg" aurora="mixed" auroraIntensity={0.6} containerClassName="max-w-3xl" aria-label="Your results">
      <motion.div {...rise(reduce)} className="text-center" aria-live="polite">
        <span className="eyebrow-luxe">{copy.resultEyebrow}</span>
        <h2 className="text-balance font-display text-[2rem] font-medium leading-[1.14] text-white sm:text-[2.6rem]">
          {r.title}
        </h2>
        <p className="text-foil mt-4 font-display text-[1.2rem] italic leading-snug sm:text-[1.4rem]">{r.tag}</p>
        <GoldRule className="mx-auto mt-6" />
      </motion.div>

      <motion.p {...rise(reduce, 0.08)} className="copy-luxe mx-auto mt-10 max-w-[65ch] text-pretty">
        {r.lead}
      </motion.p>

      <motion.div {...rise(reduce, 0.14)} className="mt-12">
        <h3 className="text-center text-[0.76rem] font-bold uppercase tracking-[0.2em] text-gold">{copy.movesTitle}</h3>
        <ol className="mt-6 grid list-none gap-4">
          {r.moves.map((move, i) => (
            <li key={move.strong}>
              <GlassCard accent="gold" interactive={false} spotlight={false} className="flex items-start gap-5 p-5 sm:p-6">
                <span
                  aria-hidden
                  className="flex size-9 shrink-0 items-center justify-center rounded-full border border-gold/40 font-sans text-sm font-bold tabular-nums text-gold"
                >
                  {i + 1}
                </span>
                <p className="copy-luxe text-pretty text-sm sm:text-base">
                  <Bold lead={move} />
                </p>
              </GlassCard>
            </li>
          ))}
        </ol>
      </motion.div>

      <motion.div {...rise(reduce, 0.2)} className="mt-8">
        <GlassCard accent="plum" interactive={false} spotlight={false} className="p-6 sm:p-8">
          <p className="copy-luxe text-pretty">
            <Bold lead={r.close} />
          </p>
        </GlassCard>
      </motion.div>

      <div className="mt-10 text-center">
        <LuxeButton variant="glass" size="md" onClick={onRetake}>
          {copy.retakeLabel}
        </LuxeButton>
      </div>
      <SnapshotFooter />
    </Section>
  );
}

function SnapshotFooter() {
  return (
    <p className="mt-14 text-center text-xs tracking-[0.08em] text-orchid-faint">
      <strong className="font-semibold text-orchid">{copy.footer.strong}</strong> &nbsp;·&nbsp; {copy.footer.text}
    </p>
  );
}
