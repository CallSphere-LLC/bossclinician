import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router";
import { Seo } from "@/components/Seo";
import { GlassCard, type Accent } from "@/components/luxe/GlassCard";
import { LuxeButton } from "@/components/luxe/LuxeButton";
import { GoldRule, Section } from "@/components/luxe/Section";

/**
 * /practice-set-up-quiz-ty — "You're In", the page after the Practice Set Up
 * Quiz's result forms (/visionary-form and the rest).
 *
 * Copy verbatim from the Kajabi page of the same path. Its heading carries
 * Kajabi's `{{first_name}}`; here the form that sends people here passes the
 * first name along, and the line reads without it when there is none (a
 * bookmark, a reload in another tab). Kajabi's links go to this site's own
 * pages: the Resource Hub, the three offers, and the offer quiz.
 */

const COPY = {
  check: "✓",
  eyebrow: "You're In · Boss Clinician",
  headingNamed: (name: string) => `Your result is on its way, ${name}.`,
  heading: "Your result is on its way.",
  sub: "Your personalized practice builder result and your free action plan with 3 specific next steps are heading to your inbox right now.",
  inbox: "📬 Check your inbox — and your spam folder just in case",
  waitEyebrow: "While You Wait",
  waitTag: "Free Resources",
  waitTitle: "Not sure where to start? The Resource Hub has tools for every stage.",
  waitBody: "Guides, planners, audits, and assessments — all free, all built for clinicians building private practices at every level.",
  waitCta: { label: "Visit the Resource Hub →", to: "/resource-hub" },
  deeperEyebrow: "Ready to Go Deeper?",
  deeperTitle: "Find the right Boss Clinician offer for where you are right now",
  offers: [
    { tag: "6-Month Coaching Program", name: "Boss Clinician Club", body: "Just starting or rebuilding from agency or platform work", to: "/club", accent: "green" },
    { tag: "Monthly Membership", name: "Boss Clinician Lounge", body: "Fully booked but income-capped or burning out", to: "/lounge", accent: "plum" },
    { tag: "Annual Mastermind", name: "Boss Clinician Boardroom", body: "Running a group practice and done doing it alone", to: "/boardroom", accent: "gold" },
  ] as const satisfies readonly { tag: string; name: string; body: string; to: string; accent: Accent }[],
  quizLead: "Not sure which offer fits?",
  quizLabel: "Take the full offer quiz →",
  quizTo: "/offer-quiz",
} as const;

export default function PracticeQuizThankYou() {
  const location = useLocation();
  // After mount: history state survives a reload, which the server cannot see,
  // so reading it during render would make the two renders disagree.
  const [name, setName] = useState("");
  useEffect(() => {
    const first = (location.state as { firstName?: unknown } | null)?.firstName;
    setName(typeof first === "string" ? first.trim().slice(0, 60) : "");
  }, [location.state]);

  return (
    <>
      <Seo title="You're In! | Boss Clinician" description={COPY.sub} canonicalPath="/practice-set-up-quiz-ty" noindex />
      <Section
        surface="deep"
        space="md"
        aurora="violet"
        auroraIntensity={0.6}
        seam={false}
        aria-label="You're In"
        containerClassName="max-w-3xl"
      >
        <header className="text-center">
          <span
            aria-hidden
            className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-gold-foil text-2xl font-bold text-night-deep"
          >
            {COPY.check}
          </span>
          <p className="mt-6 text-[0.7rem] font-semibold uppercase tracking-[0.2em] text-gold/90">{COPY.eyebrow}</p>
          <h1 className="mt-4 text-balance font-display text-[2rem] font-medium leading-[1.12] text-white sm:text-[2.6rem]">
            {name ? COPY.headingNamed(name) : COPY.heading}
          </h1>
          <p className="copy-luxe mx-auto mt-4 max-w-[52ch] text-pretty">{COPY.sub}</p>
          <p className="mt-5 inline-flex rounded-full border border-white/12 bg-white/[0.05] px-4 py-2 text-sm text-white/85">
            {COPY.inbox}
          </p>
        </header>

        <GlassCard accent="green" interactive={false} spotlight={false} className="mt-10 p-6 sm:p-9">
          <p className="text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-orchid">{COPY.waitEyebrow}</p>
          <p className="mt-3 text-xs font-semibold uppercase tracking-[0.16em] text-gold/85">{COPY.waitTag}</p>
          <h2 className="mt-2 text-balance font-display text-[1.4rem] font-medium leading-snug text-white sm:text-[1.7rem]">
            {COPY.waitTitle}
          </h2>
          <p className="copy-luxe mt-3 text-pretty">{COPY.waitBody}</p>
          <LuxeButton variant="foil" size="md" to={COPY.waitCta.to} className="mt-6 min-h-[44px]">
            {COPY.waitCta.label}
          </LuxeButton>
        </GlassCard>

        <div className="mt-12 text-center">
          <p className="text-[0.7rem] font-semibold uppercase tracking-[0.2em] text-gold/90">{COPY.deeperEyebrow}</p>
          <h2 className="mt-3 text-balance font-display text-[1.5rem] font-medium leading-snug text-white sm:text-[1.9rem]">
            {COPY.deeperTitle}
          </h2>
          <GoldRule className="mx-auto mt-5" />
        </div>
        <ul className="mt-8 grid list-none grid-cols-1 gap-4 sm:grid-cols-3">
          {COPY.offers.map((offer) => (
            <li key={offer.name}>
              <Link to={offer.to} className="group block h-full rounded-2xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold">
                <GlassCard accent={offer.accent} className="flex h-full flex-col p-6">
                  <p className="text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-orchid">{offer.tag}</p>
                  <h3 className="mt-2 font-display text-[1.2rem] font-medium leading-snug text-white">{offer.name}</h3>
                  <p className="mt-2 flex-1 text-sm leading-relaxed text-white/75">{offer.body}</p>
                  <span aria-hidden className="mt-4 text-lg text-gold transition-transform duration-300 group-hover:translate-x-1">
                    →
                  </span>
                </GlassCard>
              </Link>
            </li>
          ))}
        </ul>
        <p className="mt-8 text-center text-sm text-white/75">
          {COPY.quizLead}{" "}
          <Link to={COPY.quizTo} className="font-semibold text-orchid underline underline-offset-4 hover:text-gold">
            {COPY.quizLabel}
          </Link>
        </p>
      </Section>
    </>
  );
}
