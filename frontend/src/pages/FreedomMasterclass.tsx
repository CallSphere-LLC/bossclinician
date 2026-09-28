import { motion } from "motion/react";
import { Seo } from "@/components/Seo";
import { Cta, ProgramFaq, QuoteCard, rise } from "@/components/home/luxe/ProgramSections";
import { GlassCard } from "@/components/luxe/GlassCard";
import { LuxePill } from "@/components/luxe/LuxeButton";
import { LuxePageHero } from "@/components/luxe/LuxePageHero";
import { GoldRule, Section, SectionTitle } from "@/components/luxe/Section";
import { MasterclassSignup } from "@/components/masterclass/MasterclassSignup";
import { freedomMasterclass as fm } from "@/content/freedomMasterclass";
import { useEntranceMotion } from "@/hooks/useEntranceMotion";
import { useHashScroll } from "@/hooks/useHashScroll";
import { faqPageNode } from "@/seo/schema";
import { useHeadContext } from "@/ssr/context";

/** Every call to action on the page scrolls to the first sign-up box. */
const REGISTER = "#register";

/**
 * The Freedom Masterclass sign-up — /freedom-masterclass.
 *
 * Her Kajabi page, section for section and word for word
 * (content/freedomMasterclass.ts), in this site's luxe language: the page hero,
 * glass cards, the programme pages' FAQ and quote blocks. Until this page
 * existed every masterclass button on the site went to the /resources hub, and
 * this address was a redirect there (migration 061, removed by 077).
 *
 * The form (components/masterclass/MasterclassSignup) files the registration
 * and sends the visitor to /watch-now, where the video is.
 *
 * What changed in the move: her form's three extra dropdowns (confirm your
 * email, license type, practice status) are not carried over — the request was
 * first name and email, and every extra box on an opt-in costs sign-ups.
 */
export default function FreedomMasterclass() {
  const { origin } = useHeadContext();
  // Links to /freedom-masterclass#register arrive through the router, which
  // does not scroll to fragments on its own.
  useHashScroll();

  return (
    <>
      <Seo
        title={fm.seo.title}
        description={fm.seo.description}
        image="/images/masterclass/masterclass-cover.jpg"
        jsonLd={[faqPageNode(origin, "/freedom-masterclass", fm.faq.items)]}
      />

      <LuxePageHero
        eyebrow={fm.hero.eyebrow}
        title={fm.hero.title}
        titleAccent={fm.hero.titleAccent}
        lede={fm.hero.lede}
        tone="mixed"
        align="center"
        actions={<Cta label={fm.hero.cta} to={REGISTER} className="w-full" />}
      />

      <RegisterSection />
      <ForYouSection />
      <DiscoverSection />
      <ProofSection />
      <HostSection />
      <ProgramFaq eyebrow={fm.faq.eyebrow} title={fm.faq.title} items={fm.faq.items}>
        <Cta label={fm.discover.cta} to={REGISTER} />
      </ProgramFaq>
      <ClosingSection />
    </>
  );
}

/* ── The promise, and the first sign-up box ──────────────────────────── */

function SignupCard() {
  return (
    <GlassCard accent="gold" interactive={false} spotlight={false} className="p-6 sm:p-8">
      <span className="eyebrow-luxe">{fm.register.card.eyebrow}</span>
      <h2 className="font-display text-[1.6rem] font-medium leading-[1.15] text-white sm:text-[1.85rem]">
        {fm.register.card.title}
        <span className="text-foil block italic">{fm.register.card.titleAccent}</span>
      </h2>
      <GoldRule className="mt-5" width="w-14" />
      <MasterclassSignup className="mt-6" />
    </GlassCard>
  );
}

function RegisterSection() {
  const reduce = useEntranceMotion();

  return (
    // `base` because the page hero fades its bottom edge into night.
    <Section
      id="register"
      surface="base"
      space="lg"
      aurora="plum"
      auroraIntensity={0.7}
      aria-label="Register for the free masterclass"
      className="scroll-mt-20"
      containerClassName="max-w-6xl"
    >
      <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:gap-16">
        <motion.div {...rise(reduce)} className="min-w-0">
          <h2 className="text-balance font-display text-[1.95rem] font-normal leading-[1.14] text-white sm:text-[2.5rem] lg:text-[2.85rem]">
            {fm.register.titleLead}{" "}
            <span className="text-foil italic">{fm.register.titleAccent}</span>{" "}
            <span className="font-medium">{fm.register.titleTail}</span>
          </h2>
          <GoldRule className="mt-7" />
          <p className="copy-luxe mt-7 max-w-[48ch] text-pretty">{fm.register.body}</p>
          <LuxePill accent="gold" className="mt-7 !normal-case !tracking-[0.04em]">
            <span aria-hidden className="mr-2">&#9733;</span>
            {fm.register.included}
          </LuxePill>
        </motion.div>

        <motion.div {...rise(reduce, 0.12)} className="min-w-0">
          <SignupCard />
          <p className="copy-luxe mt-5 text-pretty text-center text-sm">{fm.register.alsoIncluded}</p>
        </motion.div>
      </div>
    </Section>
  );
}

/* ── This is for you if ──────────────────────────────────────────────── */

function CheckMark() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="mt-[0.2rem] h-4 w-4 shrink-0 text-green-bright"
    >
      <path d="M3 8.4 6.3 11.7 13 4.7" />
    </svg>
  );
}

function ForYouSection() {
  const reduce = useEntranceMotion();

  return (
    <Section surface="raised" space="lg" aria-label={fm.forYou.eyebrow} containerClassName="max-w-4xl">
      <SectionTitle
        eyebrow={fm.forYou.eyebrow}
        title={
          <>
            {fm.forYou.title}
            <span className="text-foil block italic">{fm.forYou.titleAccent}</span>
          </>
        }
      />

      <ul className="mt-10 grid list-none gap-4 sm:grid-cols-2">
        {fm.forYou.items.map((item, i) => (
          <motion.li
            key={item}
            {...rise(reduce, 0.05 * i)}
            // The fifth reads as the conclusion of the four, as on her page.
            className={i === fm.forYou.items.length - 1 ? "sm:col-span-2" : undefined}
          >
            <GlassCard accent="green" interactive={false} spotlight={false} className="flex h-full gap-3.5 p-5 sm:p-6">
              <CheckMark />
              <span className="copy-luxe min-w-0 text-pretty text-[0.95rem]">{item}</span>
            </GlassCard>
          </motion.li>
        ))}
      </ul>

      <motion.div {...rise(reduce, 0.1)} className="mx-auto mt-14 max-w-2xl text-center">
        <GoldRule className="mx-auto" />
        <p className="mt-7 text-balance font-display text-[1.45rem] leading-[1.4] text-white sm:text-[1.75rem]">
          {fm.forYou.pullLead}{" "}
          <span className="text-foil italic">{fm.forYou.pullAccent}</span>
        </p>
      </motion.div>

      <p className="copy-luxe mx-auto mt-10 max-w-xl text-pretty text-center text-sm italic">
        {fm.forYou.notFor}
      </p>

      <Cta label={fm.forYou.cta} to={REGISTER} className="mt-10" />
    </Section>
  );
}

/* ── What you will discover ──────────────────────────────────────────── */

function DiscoverSection() {
  const reduce = useEntranceMotion();

  return (
    <Section
      surface="base"
      space="lg"
      aurora="violet"
      auroraIntensity={0.45}
      aria-label={fm.discover.eyebrow}
      containerClassName="max-w-4xl"
    >
      <SectionTitle
        eyebrow={fm.discover.eyebrow}
        title={
          <>
            {fm.discover.title}
            <span className="text-foil block italic">{fm.discover.titleAccent}</span>
          </>
        }
      />

      <ol className="mt-12 list-none space-y-4">
        {fm.discover.points.map((point, i) => (
          <motion.li key={point.title} {...rise(reduce, 0.06 * i)}>
            <GlassCard accent="gold" interactive={false} className="flex gap-5 p-6 sm:gap-8 sm:p-8">
              <span
                aria-hidden
                className="text-foil shrink-0 font-display text-[2rem] leading-none sm:text-[2.6rem]"
              >
                {String(i + 1).padStart(2, "0")}
              </span>
              <div className="min-w-0">
                <h3 className="text-balance font-display text-[1.2rem] font-medium leading-snug text-white sm:text-[1.4rem]">
                  {point.title}
                </h3>
                <p className="copy-luxe mt-3 text-pretty text-[0.95rem]">{point.body}</p>
              </div>
            </GlassCard>
          </motion.li>
        ))}
      </ol>

      <motion.div {...rise(reduce, 0.1)} className="mx-auto mt-12 max-w-2xl space-y-5 text-center">
        <p className="copy-luxe text-pretty">{fm.discover.areas}</p>
        <p className="copy-luxe text-pretty text-sm">{fm.discover.alsoIncluded}</p>
      </motion.div>

      <Cta label={fm.discover.cta} to={REGISTER} className="mt-10" />
    </Section>
  );
}

/* ── A client, then Yvette, in their own words ───────────────────────── */

function ProofSection() {
  const reduce = useEntranceMotion();

  return (
    <Section surface="deep" space="lg" aurora="gold" auroraIntensity={0.4} aria-label="In their words" containerClassName="max-w-3xl">
      <motion.div {...rise(reduce)}>
        <QuoteCard quote={fm.proof.testimonial.quote} name={fm.proof.testimonial.name} accent="plum" />
      </motion.div>

      <motion.figure {...rise(reduce, 0.1)} className="mx-auto mt-16 max-w-2xl text-center">
        <GoldRule className="mx-auto" />
        <blockquote className="mt-7 text-balance font-display text-[1.45rem] leading-[1.4] text-white sm:text-[1.8rem]">
          &ldquo;{fm.proof.quote.lead}{" "}
          <span className="text-foil italic">{fm.proof.quote.accent}</span>&rdquo;
        </blockquote>
        <figcaption className="mt-6 text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-gold">
          {fm.proof.quote.name}
        </figcaption>
      </motion.figure>
    </Section>
  );
}

/* ── Meet your host ──────────────────────────────────────────────────── */

function HostSection() {
  const reduce = useEntranceMotion();
  const { photo } = fm.host;

  return (
    <Section
      surface="raised"
      space="lg"
      aurora="plum"
      auroraIntensity={0.5}
      aria-label={fm.host.eyebrow}
      containerClassName="max-w-6xl"
    >
      <div className="grid items-start gap-12 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
        <motion.div {...rise(reduce)} className="mx-auto w-full max-w-sm lg:sticky lg:top-28">
          <GlassCard interactive={false} spotlight={false} className="overflow-hidden p-2">
            <img
              src={photo.src}
              alt={photo.alt}
              width={photo.width}
              height={photo.height}
              loading="lazy"
              decoding="async"
              className="aspect-[4/5] h-auto w-full max-w-full rounded-xl object-cover object-top"
            />
          </GlassCard>
        </motion.div>

        <motion.div {...rise(reduce, 0.1)} className="min-w-0">
          <span className="eyebrow-luxe">{fm.host.eyebrow}</span>
          <h2 className="font-display text-[2rem] font-medium leading-[1.14] text-white sm:text-[2.6rem]">
            {fm.host.name}
          </h2>
          <p className="mt-3 text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-gold">
            {fm.host.credential}
          </p>
          <GoldRule className="mt-8" />
          <p className="mt-8 text-balance font-display text-[1.3rem] italic leading-[1.4] text-white sm:text-[1.5rem]">
            {fm.host.lead}
          </p>
          <div className="mt-6 space-y-5">
            {fm.host.paragraphs.map((text) => (
              <p key={text} className="copy-luxe text-pretty">
                {text}
              </p>
            ))}
          </div>
        </motion.div>
      </div>

      <ul className="mt-14 grid list-none gap-4 md:grid-cols-3">
        {fm.host.proofs.map((proof, i) => (
          <motion.li key={proof.label} {...rise(reduce, 0.06 * i)}>
            <GlassCard accent="gold" interactive={false} spotlight={false} className="h-full p-6 sm:p-7">
              <p className="text-foil font-display text-[1.35rem] italic">{proof.label}</p>
              <p className="copy-luxe mt-3 text-pretty text-[0.95rem]">{proof.body}</p>
            </GlassCard>
          </motion.li>
        ))}
      </ul>
    </Section>
  );
}

/* ── The closing sign-up ─────────────────────────────────────────────── */

function ClosingSection() {
  const reduce = useEntranceMotion();

  return (
    <Section
      surface="deep"
      space="xl"
      aurora="mixed"
      auroraIntensity={0.9}
      aria-label="Register for the free masterclass"
      containerClassName="max-w-5xl"
    >
      <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
        <motion.div {...rise(reduce)} className="min-w-0 text-center lg:text-left">
          <h2 className="text-balance font-display text-[2rem] font-normal leading-[1.12] text-white sm:text-[2.6rem]">
            {fm.closing.title}
            <span className="text-foil block italic">{fm.closing.titleAccent}</span>
          </h2>
          <GoldRule className="mx-auto mt-7 lg:mx-0" />
          <p className="copy-luxe mx-auto mt-7 max-w-[46ch] text-pretty lg:mx-0">{fm.closing.body}</p>
        </motion.div>

        <motion.div {...rise(reduce, 0.12)} className="min-w-0">
          <SignupCard />
          <p className="copy-luxe mt-5 text-center text-sm">{fm.closing.note}</p>
        </motion.div>
      </div>
    </Section>
  );
}
