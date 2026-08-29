import { Seo } from "@/components/Seo";
import { LeadForm } from "@/components/forms/LeadForm";
import { GlassCard, type Accent } from "@/components/luxe/GlassCard";
import { LuxePageHero } from "@/components/luxe/LuxePageHero";
import { GoldRule, Section, SectionTitle } from "@/components/luxe/Section";
import { RevealGroup, RevealItem } from "@/components/ui/Reveal";
import { contactPage } from "@/content/site";

/**
 * The questions the live page lists under the address, in its order and
 * wording. They carry no published answers, so each one opens a pre-addressed
 * email instead of an accordion — a question you can send in a tap is the
 * shortest path for anyone who would rather not fill anything in.
 */
const QUESTIONS: readonly string[] = [
  "How Can I get coaching with Yvette",
  "I purchased a product from you but I can't log in to access my product or didn't get a confirmation email",
  "How do I cancel my Boss Clinician Lounge Membership subscription?",
  "How can you help me build my private practice",
  "When is your next retreat",
];

/** Card accents cycle so a stack of five never reads as one flat block. */
const ACCENTS: readonly Accent[] = ["green", "plum", "gold"];

/** Held once: the hero plate renders it and the page's share card points at it. */
const HERO_PORTRAIT = "/images/f5f2cec6b858.jpg";

/**
 * Contact — the Obsidian Luxe rebuild.
 *
 * The page is deliberately spare: a greeting, one way in, and the five
 * questions people actually arrive with. What it used to lack was a way in the
 * business could see — every enquiry left through a mailto and landed in a
 * personal inbox, never in the admin Leads inbox. So the form leads now, and
 * the address and the pre-addressed questions keep their place underneath it
 * as alternates for anyone who would rather write from their own mail client.
 */
export default function Contact() {
  const mailto = `mailto:${contactPage.email}`;

  return (
    <>
      <Seo
        title="Contact Us"
        description="Have questions about working with Yvette Howard, LCSW? Reach out to Boss Clinician — private practice strategist for therapists, counselors, and healthcare clinicians."
        image={HERO_PORTRAIT}
      />

      <LuxePageHero
        eyebrow="Contact Us"
        title={contactPage.heading}
        lede={contactPage.intro}
        tone="violet"
        aside={
          <div className="relative isolate mx-auto max-w-sm lg:max-w-none">
            {/* Plum bloom behind the plate: without a light source of its own a
                photograph on near-black reads as a hole cut in the page. */}
            <div
              aria-hidden
              className="pointer-events-none absolute -inset-8 -z-10 rounded-[2.5rem] blur-3xl"
              style={{
                background:
                  "radial-gradient(60% 58% at 46% 34%, rgba(123,94,167,0.45) 0%, transparent 72%)",
              }}
            />

            <div className="relative overflow-hidden rounded-2xl border border-gold/25 shadow-[0_44px_100px_-36px_rgba(0,0,0,0.95)]">
              <img
                src={HERO_PORTRAIT}
                alt="Yvette Howard"
                decoding="async"
                className="aspect-[4/3] w-full max-w-full object-cover brightness-[0.8] contrast-[1.06] saturate-[0.8]"
              />
              {/* Vignette closes the corners; the violet soft-light pass pulls
                  the photograph's whites into the page's plum. */}
              <div
                aria-hidden
                className="absolute inset-0 bg-[radial-gradient(112%_80%_at_50%_26%,transparent_26%,rgba(10,7,19,0.52)_68%,rgba(6,4,11,0.9)_100%)]"
              />
              <div aria-hidden className="absolute inset-0 bg-glow-violet/20 mix-blend-soft-light" />
            </div>

            {/* Offset registration marks — the plate reads as mounted, not inline. */}
            <span
              aria-hidden
              className="pointer-events-none absolute -left-3 -top-3 h-14 w-14 rounded-tl-xl border-l border-t border-gold/45 sm:-left-4 sm:-top-4"
            />
            <span
              aria-hidden
              className="pointer-events-none absolute -bottom-3 -right-3 h-14 w-14 rounded-br-xl border-b border-r border-gold/45 sm:-bottom-4 sm:-right-4"
            />
          </div>
        }
      />

      {/* ── The message ──────────────────────────────────────────────────────
          The page's primary action. It posts to /api/leads with source
          "contact", so a question asked here is answerable from the admin Leads
          inbox instead of only from a mail client. */}
      <Section
        surface="raised"
        space="md"
        aurora="gold"
        auroraIntensity={0.45}
        aria-label="Send Yvette a message"
      >
        <SectionTitle
          align="center"
          title="Ask me here"
          body="Fill this in and it comes straight to me. I read every message myself and you'll hear back within 24 hours."
        />

        <RevealGroup className="mx-auto mt-10 max-w-3xl">
          <RevealItem>
            {/* No phone field: this is a general enquiry, and a number is a
                bigger ask than the question most people arrive with. */}
            <LeadForm
              source="contact"
              submitLabel="Send Message"
              messageLabel="How can I help?"
              messagePlaceholder="Tell me what you're building, what you're stuck on, or what you'd like to know…"
              showPhone={false}
              successTitle="Message sent."
              successBody="I read every message myself and you'll hear back from me within 24 hours."
            />
          </RevealItem>
        </RevealGroup>
      </Section>

      {/* ── The other ways in ────────────────────────────────────────────────
          The address and the five pre-addressed questions the page has always
          carried. They still work — they are simply no longer the only way
          through, so they sit under the form at a quieter weight. */}
      <Section
        surface="base"
        space="md"
        aria-label="Other ways to reach Yvette"
        containerClassName="max-w-3xl"
      >
        <RevealGroup>
          <RevealItem>
            <div className="text-center">
              <span className="eyebrow-luxe">Prefer email?</span>
              <h2 className="text-balance font-display text-[1.5rem] font-medium leading-snug text-white sm:text-[1.8rem]">
                Write to me from your own inbox.
              </h2>
            </div>
          </RevealItem>

          {/* `break-all` keeps the address inside a 360px card instead of
              pushing the page into a horizontal scroll. */}
          <RevealItem className="mx-auto mt-8 max-w-xl">
            <GlassCard
              accent="plum"
              interactive={false}
              spotlight={false}
              className="overflow-hidden p-6 text-center sm:p-8"
            >
              <p className="copy-luxe text-pretty text-sm">Send me an email at</p>

              <GoldRule className="mx-auto mt-4" width="w-12" />

              <a
                href={mailto}
                className="mt-4 flex min-h-[44px] items-center justify-center break-all rounded-lg px-1 font-display text-[1.05rem] leading-tight text-gold underline decoration-gold/30 underline-offset-[8px] transition-colors duration-300 ease-luxe hover:text-gold-bright hover:decoration-gold-bright/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold sm:text-[1.35rem]"
              >
                {contactPage.email}
              </a>
            </GlassCard>
          </RevealItem>

          <RevealItem>
            <p className="copy-luxe mt-10 text-center text-pretty text-sm">
              Or send one that's already written for you:
            </p>
          </RevealItem>
        </RevealGroup>

        <RevealGroup as="ul" className="mt-6 list-none space-y-3.5">
          {QUESTIONS.map((question, i) => (
            <RevealItem as="li" key={question}>
              <GlassCard
                accent={ACCENTS[i % ACCENTS.length]}
                spotlight={false}
                className="overflow-hidden"
              >
                <a
                  href={`${mailto}?subject=${encodeURIComponent(question)}`}
                  className="flex min-h-[64px] w-full items-center gap-4 px-5 py-4 transition-colors duration-300 ease-luxe hover:bg-white/[0.03] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-gold sm:gap-5 sm:px-6 sm:py-5"
                >
                  <span
                    aria-hidden
                    className="text-foil shrink-0 font-display text-xl leading-none sm:text-2xl"
                  >
                    {String(i + 1).padStart(2, "0")}
                  </span>

                  <span className="min-w-0 flex-1 text-pretty text-[0.95rem] font-medium leading-relaxed text-white">
                    {question}
                    <span className="sr-only"> — email Yvette about this</span>
                  </span>

                  <svg
                    aria-hidden
                    viewBox="0 0 8 8"
                    fill="none"
                    className="h-[7px] w-[7px] shrink-0 text-gold"
                  >
                    <path d="M4 0.5 7.5 4 4 7.5 0.5 4Z" fill="currentColor" />
                  </svg>
                </a>
              </GlassCard>
            </RevealItem>
          ))}
        </RevealGroup>
      </Section>
    </>
  );
}
