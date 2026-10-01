import { useId, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { Seo } from "@/components/Seo";
import { useHoneypot } from "@/components/forms/useHoneypot";
import { GlassCard } from "@/components/luxe/GlassCard";
import { LuxeButton } from "@/components/luxe/LuxeButton";
import { LuxeInput } from "@/components/luxe/LuxeField";
import { GoldRule, Section } from "@/components/luxe/Section";
import { api } from "@/lib/api";
import { PRACTICE_QUIZ_GATE, PRACTICE_QUIZ_RESULTS, type BuilderType } from "@/content/practiceQuiz";
import { EMAIL_PATTERN, FormError, submitErrorMessage, useAlive } from "./shared";

/**
 * /visionary-form, /careful-form, /steady-form and /reluctant-form.
 *
 * On Kajabi the Practice Set Up Quiz ends by sending the visitor to one of
 * these four pages, one per builder type, each a "One More Step" form asking
 * First Name, Last Name and Email; the form then leads to
 * /practice-set-up-quiz-ty and the result arrives by email. Rebuilt the same
 * way: the copy is the practice quiz's own (content/practiceQuiz.ts), the form
 * is that type's builder form from migration 091 (which tags the contact), and
 * its automation from migration 095 emails the result and action plan. The
 * quiz on this site (/practice-quiz/take) does not pass through here; these
 * addresses exist for links and emails that still point at them.
 */
export function PracticeResultForm({ type }: { type: BuilderType }) {
  const navigate = useNavigate();
  const alive = useAlive();
  const errorId = useId();
  const [honeypot, honeypotField] = useHoneypot();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const result = PRACTICE_QUIZ_RESULTS[type];
  const gate = PRACTICE_QUIZ_GATE;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending) return;
    const first = firstName.trim();
    const last = lastName.trim();
    const address = email.trim().toLowerCase();
    if (!first || !last) {
      setError("Please enter your first and last name.");
      return;
    }
    if (!EMAIL_PATTERN.test(address)) {
      setError("Please enter a valid email address.");
      return;
    }
    setSending(true);
    setError(null);
    try {
      await api.submitForm(
        result.formSlug,
        { first_name: first, last_name: last, email: address, result: result.archetype },
        address,
        honeypot(),
      );
      if (!alive.current) return;
      navigate("/practice-set-up-quiz-ty", { state: { firstName: first } });
    } catch (err) {
      if (alive.current) setError(submitErrorMessage(err));
    } finally {
      if (alive.current) setSending(false);
    }
  }

  return (
    <>
      <Seo
        title={`${result.archetype} | Practice Set Up Quiz`}
        description={gate.sub}
        canonicalPath="/practice-quiz"
        noindex
      />
      <Section
        surface="deep"
        space="md"
        aurora="violet"
        auroraIntensity={0.6}
        seam={false}
        aria-label="Practice Set Up Quiz"
        containerClassName="max-w-2xl"
      >
        <GlassCard accent="gold" interactive={false} spotlight={false} className="p-6 sm:p-9">
          <p className="text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-orchid">{gate.eyebrow}</p>
          <h1 className="mt-3 text-balance font-display text-[1.6rem] font-medium leading-[1.2] text-white sm:text-[2.1rem]">
            {gate.heading}
          </h1>
          <GoldRule className="mt-5" />
          <p className="copy-luxe mt-5 text-pretty">{gate.sub}</p>

          <form onSubmit={handleSubmit} noValidate className="relative mt-7 space-y-5">
            {honeypotField}
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <LuxeInput
                label={gate.firstName}
                name="first_name"
                type="text"
                autoComplete="given-name"
                required
                value={firstName}
                onChange={(e) => {
                  setFirstName(e.target.value);
                  setError(null);
                }}
                className="min-h-[44px]"
              />
              <LuxeInput
                label={gate.lastName}
                name="last_name"
                type="text"
                autoComplete="family-name"
                required
                value={lastName}
                onChange={(e) => {
                  setLastName(e.target.value);
                  setError(null);
                }}
                className="min-h-[44px]"
              />
            </div>
            <LuxeInput
              label={gate.email}
              name="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setError(null);
              }}
              aria-describedby={error ? errorId : undefined}
              className="min-h-[44px]"
            />
            {error && <FormError id={errorId}>{error}</FormError>}
            <LuxeButton variant="foil" size="md" type="submit" disabled={sending} className="min-h-[44px]">
              {sending ? "Sending…" : gate.submit}
            </LuxeButton>
            <p className="text-xs leading-relaxed text-orchid-faint">{gate.disclaimer}</p>
          </form>
        </GlassCard>

        <p className="mt-6 text-center text-sm text-white/70">
          Haven't taken the quiz yet?{" "}
          <Link to="/practice-quiz/take" className="font-semibold text-orchid underline underline-offset-4 hover:text-gold">
            Take the Practice Set Up Quiz
          </Link>
        </p>
      </Section>
    </>
  );
}

export function VisionaryForm() {
  return <PracticeResultForm type="V" />;
}
export function CarefulForm() {
  return <PracticeResultForm type="C" />;
}
export function SteadyForm() {
  return <PracticeResultForm type="S" />;
}
export function ReluctantForm() {
  return <PracticeResultForm type="R" />;
}
