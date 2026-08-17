import { useEffect, useState, type FormEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { motion, useReducedMotion } from "motion/react";
import { CheckCircle2 } from "lucide-react";
import { Seo } from "@/components/Seo";
import { GlassCard } from "@/components/luxe/GlassCard";
import { LuxePageHero } from "@/components/luxe/LuxePageHero";
import { GoldRule, Section, SectionTitle } from "@/components/luxe/Section";
import { LuxeButton } from "@/components/luxe/LuxeButton";
import { LuxeInput, LuxeTextarea } from "@/components/luxe/LuxeField";
import { formatCurrency } from "@/lib/format";
import { publicAffiliateApi, type ProgramSummary } from "@/lib/affiliateApi";

/**
 * The partner application.
 *
 * Two bands and no more, for the same reason the Apply page has two: everything
 * between the promise and the first input is scroll an applicant has to pay for.
 * The promise itself is read from the program settings rather than written into
 * this file, so the rate on the page and the rate a partner is actually paid
 * cannot drift apart.
 */

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];
const VIEWPORT = { once: true, margin: "-12% 0px -8% 0px" } as const;

function commissionHeadline(program: ProgramSummary | null): string {
  if (!program) return "Earn on every sale you send";
  if (program.commission.kind === "fixed") {
    return `Earn ${formatCurrency(program.commission.amountCents ?? 0)} on every sale you send`;
  }
  return `Earn ${program.commission.percent ?? 0}% on every sale you send`;
}

export default function AffiliateSignup() {
  const reduce = useReducedMotion();

  const [program, setProgram] = useState<ProgramSummary | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [audience, setAudience] = useState("");
  const [website, setWebsite] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    publicAffiliateApi
      .program()
      .then((data) => !cancelled && setProgram(data))
      // The form still works without the pitch; a failed read is not a reason to
      // stop somebody applying.
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!accepted) {
      setError("Please tick the box to accept the partner terms.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const result = await publicAffiliateApi.apply({
        name: name.trim(),
        email: email.trim(),
        audience: audience.trim() || undefined,
        website: website.trim() || undefined,
        acceptedTerms: true,
      });
      setDone(result.message);
    } catch {
      setError("We couldn't send that just now. Please try again in a moment.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Seo
        title="Partner Program | Boss Clinician"
        description="Recommend Boss Clinician to the clinicians you already talk to, and earn on every sale you send."
      />

      <LuxePageHero
        eyebrow="Partner Program"
        title={commissionHeadline(program)}
        lede="If you already point clinicians towards this work, there's no reason you shouldn't be paid for it."
        tone="gold"
      />

      {program?.pitchMd && (
        <Section surface="base" space="md" aurora="plum" auroraIntensity={0.4} aria-label="How it works">
          <motion.div
            initial={reduce ? false : { opacity: 0, y: 26 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={VIEWPORT}
            transition={{ duration: 0.85, ease: EASE }}
            className="mx-auto max-w-4xl"
          >
            <GlassCard accent="plum" interactive={false} spotlight={false} className="p-6 sm:p-10">
              <span
                aria-hidden
                className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gold-foil opacity-75"
              />
              <div className="prose-boss max-w-[62ch] break-words">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{program.pitchMd}</ReactMarkdown>
              </div>
              <GoldRule className="mt-8" />
              <p className="mt-6 text-sm text-orchid-dim">
                We remember your referral for {program.cookieWindowDays} days after somebody clicks
                your link
                {program.recurring ? ", and you're paid again on every renewal." : "."}
              </p>
            </GlassCard>
          </motion.div>
        </Section>
      )}

      <Section
        id="partner-form"
        surface="raised"
        space="lg"
        aurora="gold"
        auroraIntensity={0.6}
        aria-label="Partner application"
      >
        <SectionTitle
          align="center"
          title="Apply to become a partner"
          body="Tell us a little about who you'd be sharing this with. We read every application."
        />

        <motion.div
          initial={reduce ? false : { opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={VIEWPORT}
          transition={{ duration: 0.8, delay: reduce ? 0 : 0.12, ease: EASE }}
          className="mx-auto mt-10 max-w-2xl"
        >
          <GlassCard accent="gold" interactive={false} spotlight={false} className="p-6 sm:p-9">
            {done ? (
              <div className="flex flex-col items-center py-8 text-center" role="status">
                <CheckCircle2 aria-hidden className="size-10 text-gold" />
                <p className="mt-5 font-display text-[1.4rem] leading-tight text-white">
                  Thank you
                </p>
                <p className="copy-luxe mt-3 max-w-sm">{done}</p>
              </div>
            ) : (
              <form onSubmit={submit} className="grid gap-5">
                <LuxeInput
                  label="Your name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={200}
                  autoComplete="name"
                  required
                />
                <LuxeInput
                  label="Email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  maxLength={320}
                  autoComplete="email"
                  required
                />
                <LuxeInput
                  label="Your website or profile"
                  hint="Optional"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  maxLength={500}
                  placeholder="instagram.com/yourhandle"
                />
                <LuxeTextarea
                  label="Who would you be sharing this with?"
                  hint="Optional, but it helps"
                  value={audience}
                  onChange={(e) => setAudience(e.target.value)}
                  maxLength={2000}
                  rows={4}
                  placeholder="A few hundred private-practice therapists on my email list."
                />

                <label className="flex cursor-pointer items-start gap-3 text-sm text-white/80">
                  <input
                    type="checkbox"
                    checked={accepted}
                    onChange={(e) => setAccepted(e.target.checked)}
                    className="mt-0.5 size-4 shrink-0 rounded border-white/25 bg-transparent text-gold"
                  />
                  <span>I've read and accept the partner terms below.</span>
                </label>

                {error && (
                  <p role="alert" className="text-sm font-medium text-red-400">
                    {error}
                  </p>
                )}

                <div>
                  <LuxeButton disabled={submitting}>
                    {submitting ? "Sending…" : "Apply to join"}
                  </LuxeButton>
                </div>
              </form>
            )}

            {program?.termsMd && (
              <>
                <div aria-hidden className="rule-faint mt-8 w-full" />
                <details className="mt-6">
                  <summary className="cursor-pointer text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-orchid">
                    Partner terms
                  </summary>
                  <div className="prose-boss mt-4 break-words text-sm">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{program.termsMd}</ReactMarkdown>
                  </div>
                </details>
              </>
            )}
          </GlassCard>
        </motion.div>
      </Section>
    </>
  );
}
