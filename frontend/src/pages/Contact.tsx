import { Seo } from "@/components/Seo";
import { LeadForm } from "@/components/forms/LeadForm";
import { GlassCard, type Accent } from "@/components/luxe/GlassCard";
import { LuxeButton } from "@/components/luxe/LuxeButton";
import { LuxePageHero } from "@/components/luxe/LuxePageHero";
import { GoldRule, Section, SectionTitle } from "@/components/luxe/Section";
import { RevealGroup, RevealItem } from "@/components/ui/Reveal";
import { contactPage } from "@/content/site";

/** Card accents cycle so three siblings read as a set, not as a ranking. */
const ACCENTS: readonly Accent[] = ["green", "plum", "gold"];

/** Held once: the hero plate renders it and the page's share card points at it. */
const HERO_PORTRAIT = "/images/f5f2cec6b858.jpg";

const ADDRESS_LINK =
  "break-all text-gold underline decoration-gold/30 underline-offset-[6px] transition-colors duration-300 ease-luxe hover:text-gold-bright hover:decoration-gold-bright/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold";

/**
 * Contact — the Obsidian Luxe rebuild of bossclinician.com/contact.
 *
 * The source page is a help desk in five parts, and this follows it part for
 * part in its order and wording (content/site.ts → `contactPage`): which
 * programme is right for you, help getting into a purchase, billing, the next
 * retreat, and an address for everything else.
 *
 * One band is this site's own: the message form. On the source every enquiry
 * leaves through a mailto and lands in a personal inbox; here it also posts to
 * /api/leads with source "contact", so a question is answerable from the admin
 * Leads inbox. It sits directly under the greeting, above the source's blocks.
 */
export default function Contact() {
  const { programs, access, billing, retreat, closing } = contactPage;

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
        actions={
          <p className="copy-luxe text-pretty text-sm">
            {contactPage.emailLabel}{" "}
            <a href={`mailto:${contactPage.email}`} className={ADDRESS_LINK}>
              {contactPage.email}
            </a>
          </p>
        }
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
                className="aspect-[4/3] w-full max-w-full object-cover"
              />
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
          Posts to /api/leads with source "contact", so a question asked here is
          answerable from the admin Leads inbox instead of only a mail client. */}
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

      {/* ── Which programme is right for you ───────────────────────────────── */}
      <Section surface="base" space="lg" aurora="mixed" auroraIntensity={0.45} aria-label={programs.title}>
        <SectionTitle title={programs.title} body={programs.body} />

        <RevealGroup
          as="ul"
          className="mx-auto mt-12 grid max-w-md list-none grid-cols-1 items-stretch gap-6 lg:max-w-none lg:grid-cols-3"
        >
          {programs.items.map((program, i) => (
            <RevealItem key={program.title} as="li" className="h-full">
              <GlassCard
                as="article"
                accent={ACCENTS[i % ACCENTS.length]}
                className="flex h-full flex-col p-7 sm:p-8"
              >
                <h3 className="text-balance font-display text-[1.35rem] font-medium leading-[1.25] text-white">
                  {program.title}
                </h3>
                <GoldRule width="w-10" className="mt-5" />
                <p className="copy-luxe mt-5 text-pretty text-[0.95rem]">{program.body}</p>
                <p className="mt-5 flex-1 text-pretty text-sm font-medium leading-[1.7] text-white/85">
                  {program.bestFit}
                </p>
                <LuxeButton
                  variant="glass"
                  size="sm"
                  to={program.to}
                  className="mt-7 min-h-[44px] w-full tracking-[0.12em]"
                >
                  {program.cta}
                </LuxeButton>
              </GlassCard>
            </RevealItem>
          ))}
        </RevealGroup>

        <p className="mt-12 text-balance text-center font-display text-[1.2rem] italic text-white sm:text-[1.4rem]">
          {programs.closing}
        </p>
      </Section>

      {/* ── Access and billing help ────────────────────────────────────────── */}
      <Section surface="raised" space="lg" aria-label="Help with a purchase or membership">
        <RevealGroup className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <RevealItem className="h-full">
            <GlassCard accent="plum" interactive={false} className="h-full p-7 sm:p-9">
              <h2 className="text-balance font-display text-[1.45rem] font-medium leading-[1.25] text-white">
                {access.title}
              </h2>
              <GoldRule width="w-10" className="mt-5" />
              <p className="copy-luxe mt-5 text-pretty text-[0.95rem]">{access.intro}</p>

              <ol className="mt-6 space-y-5">
                {access.steps.map((step, i) => (
                  <li key={step.title} className="flex gap-4">
                    <span
                      aria-hidden
                      className="text-foil shrink-0 font-display text-xl leading-none"
                    >
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <div className="min-w-0">
                      <p className="text-[0.95rem] font-medium text-white">{step.title}</p>
                      {step.body && (
                        <p className="copy-luxe mt-1 text-pretty text-sm">{step.body}</p>
                      )}
                    </div>
                  </li>
                ))}
              </ol>

              <p className="copy-luxe mt-6 text-pretty text-sm">
                {access.emailLead}{" "}
                <a href={`mailto:${contactPage.supportEmail}`} className={ADDRESS_LINK}>
                  {contactPage.supportEmail}
                </a>{" "}
                {access.emailWith}
              </p>
              <ul className="mt-3 list-disc space-y-1.5 pl-5 marker:text-gold">
                {access.include.map((item) => (
                  <li key={item} className="copy-luxe text-sm">
                    {item}
                  </li>
                ))}
              </ul>
              <p className="copy-luxe mt-5 text-pretty text-sm">{access.outro}</p>

              <div className="mt-7 flex flex-wrap gap-3">
                <LuxeButton variant="glass" size="sm" to="/login" className="min-h-[44px]">
                  Log In
                </LuxeButton>
                <LuxeButton variant="outline" size="sm" to="/forgot-password" className="min-h-[44px]">
                  Forgot Password
                </LuxeButton>
              </div>
            </GlassCard>
          </RevealItem>

          <RevealItem className="h-full">
            <GlassCard accent="green" interactive={false} className="flex h-full flex-col p-7 sm:p-9">
              <h2 className="text-balance font-display text-[1.45rem] font-medium leading-[1.25] text-white">
                {billing.title}
              </h2>
              <GoldRule width="w-10" className="mt-5" />
              <p className="copy-luxe mt-5 flex-1 text-pretty text-[0.95rem]">{billing.body}</p>
              <div className="mt-7">
                <LuxeButton variant="glass" size="sm" to="/account/billing" className="min-h-[44px]">
                  {billing.cta}
                </LuxeButton>
              </div>
            </GlassCard>
          </RevealItem>
        </RevealGroup>
      </Section>

      {/* ── The next retreat ───────────────────────────────────────────────── */}
      <Section
        surface="deep"
        space="lg"
        aurora="gold"
        auroraIntensity={0.45}
        aria-label={retreat.title}
        containerClassName="max-w-3xl text-center"
      >
        <RevealGroup>
          <RevealItem>
            <span className="eyebrow-luxe">{retreat.title}</span>
            <p className="copy-luxe mx-auto max-w-xl text-pretty">{retreat.body}</p>
            <p className="copy-luxe mt-6 text-sm">{retreat.lead}</p>
            <h2 className="text-foil mt-3 text-balance font-display text-[2.1rem] font-medium leading-[1.12] sm:text-[2.8rem]">
              {retreat.date}
            </h2>
            <GoldRule className="mx-auto mt-8" />
            <div className="mt-9">
              <LuxeButton variant="foil" size="lg" to="/retreats" className="w-full tracking-[0.12em] sm:w-auto sm:tracking-[0.18em]">
                {retreat.cta}
              </LuxeButton>
            </div>
          </RevealItem>
        </RevealGroup>
      </Section>

      {/* ── Anything else ──────────────────────────────────────────────────── */}
      <Section surface="base" space="md" aria-label={closing.title} containerClassName="max-w-3xl">
        <RevealGroup>
          <RevealItem className="mx-auto max-w-xl">
            {/* `break-all` keeps the address inside a 360px card instead of
                pushing the page into a horizontal scroll. */}
            <GlassCard
              accent="plum"
              interactive={false}
              spotlight={false}
              className="overflow-hidden p-6 text-center sm:p-8"
            >
              <h2 className="font-display text-[1.4rem] font-medium text-white">{closing.title}</h2>
              <p className="copy-luxe mt-3 text-pretty text-sm">{closing.body}</p>
              <GoldRule className="mx-auto mt-5" width="w-12" />
              <a
                href={`mailto:${contactPage.supportEmail}`}
                className="mt-4 flex min-h-[44px] items-center justify-center break-all rounded-lg px-1 font-display text-[1.05rem] leading-tight text-gold underline decoration-gold/30 underline-offset-[8px] transition-colors duration-300 ease-luxe hover:text-gold-bright hover:decoration-gold-bright/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold sm:text-[1.35rem]"
              >
                {contactPage.supportEmail}
              </a>
              <p className="copy-luxe mt-4 text-pretty text-sm">{closing.outro}</p>
            </GlassCard>
          </RevealItem>
        </RevealGroup>
      </Section>
    </>
  );
}
