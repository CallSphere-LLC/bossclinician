import { motion } from "motion/react";
import { Seo } from "@/components/Seo";
import {
  Cta,
  MarkedList,
  Prose,
  accentAt,
  rise,
} from "@/components/home/luxe/ProgramSections";
import {
  priceLabel,
  type CourseDetailResponse,
  type CourseOffer,
} from "@/components/course/CoursePriceLabel";
import { GlassCard } from "@/components/luxe/GlassCard";
import { LuxeButton, LuxePill } from "@/components/luxe/LuxeButton";
import { LuxePageHero } from "@/components/luxe/LuxePageHero";
import { GoldRule, Section, SectionTitle } from "@/components/luxe/Section";
import { Container } from "@/components/ui/Container";
import { RevealGroup, RevealItem } from "@/components/ui/Reveal";
import {
  CWC_COURSE_SLUG,
  CWC_INVESTMENT_ANCHOR,
  credentialWithConfidence as cwc,
  type CwcMailLine,
} from "@/content/credentialWithConfidence";
import { useEntranceMotion } from "@/hooks/useEntranceMotion";
import { usePageData } from "@/hooks/usePageData";
import { api } from "@/lib/api";
import { stripeTestMode } from "@/lib/paymentMode";
import { courseNode, productNode } from "@/seo/schema";
import { useHeadContext } from "@/ssr/context";
import { ssrKeys } from "@/ssr/keys";

/**
 * Credential with Confidence — the on-site rebuild of the Kajabi sales page at
 * bossclinician.com/credentialsolo, serving `/courses/credential-with-confidence`
 * in place of the generic CourseDetail layout.
 *
 * The argument runs in the source page's order: compliance line → promise →
 * the bundle → what you will understand / stop doing → the programme and its
 * numbers → the ten learning objectives → what is inside → how the certificate
 * is earned → the presenter → the investment → the refund and grievance policy
 * → the NBCC statement. Copy lives in content/credentialWithConfidence.ts and
 * is the published wording.
 *
 * The page still reads the live course, exactly as CourseDetail does, for the
 * one reason that matters: this is a CE product sold under an NBCC approval,
 * and the price, the availability and whether the reader already owns it are
 * facts the database holds — not facts a transcript of a marketing page can be
 * trusted with. Nothing here prints money that did not come out of an offer.
 *
 * Every mid-page action scrolls to the investment band (`#investment`); only
 * that band's own button leaves the page for checkout.
 */

/** The offer a buyer is being quoted, in the hero and in the investment band. */
function primaryOffer(offers: readonly CourseOffer[]): CourseOffer | undefined {
  return offers.find((offer) => offer.available) ?? offers[0];
}

/** A published sentence that carries an email address in the middle of it. */
function MailSentence({ line, className }: { line: CwcMailLine; className?: string }) {
  return (
    <p className={className}>
      {line.before}
      <a
        href={`mailto:${line.email}`}
        className="text-gold underline decoration-gold/40 underline-offset-[6px] transition-colors duration-300 ease-luxe hover:decoration-gold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gold"
      >
        {line.email}
      </a>
      {line.after}
    </p>
  );
}

export default function CredentialWithConfidence() {
  const { origin } = useHeadContext();

  // `owned` is the one field an anonymous server render cannot know, so a
  // signed-in reader — and only a signed-in reader — re-reads the course.
  const request = usePageData<CourseDetailResponse>(
    ssrKeys.courseDetail(CWC_COURSE_SLUG),
    () => api.courseDetail(CWC_COURSE_SLUG) as Promise<CourseDetailResponse>,
    { revalidateForMembers: true },
  );

  if (request.status === "loading") {
    return (
      <>
        {/* On the server this branch means only one thing: the loader could not
            read the course. Answering 200 would file the page in the index
            under the site's default title and description, so the crawler is
            told it is temporarily unavailable and to come back. */}
        <Seo title="Loading… | Boss Clinician" noindex httpStatus={503} />
        <div className="flex min-h-[60vh] items-center justify-center">
          <span
            className="size-9 animate-spin rounded-full border-2 border-lilac border-t-plum"
            role="status"
            aria-label="Loading"
          />
        </div>
      </>
    );
  }

  // Checked ahead of the missing branch: an API that is merely unreachable must
  // not answer a live product URL with "retired" — and, since this page is
  // server-rendered, must not answer it with HTTP 404 either. That would drop
  // the page out of the index over an outage that lasted a minute.
  if (request.status === "error") {
    return (
      <Section className="py-24">
        <Container className="max-w-2xl text-center">
          <h1 className="font-display text-3xl text-ink">Something went wrong</h1>
          <p className="mt-4 text-orchid">Please refresh the page — this is on us, not you.</p>
        </Container>
      </Section>
    );
  }

  if (request.status === "missing") {
    return (
      <>
        <Seo
          title="Course not found · Boss Clinician"
          description="This course is no longer available."
          httpStatus={404}
          noindex
        />
        <Section className="py-24">
          <Container className="max-w-2xl text-center">
            <h1 className="font-display text-4xl text-ink">We couldn't find that one</h1>
            <p className="mt-4 text-orchid">
              It may have been renamed or retired. Everything currently available is in the
              training library.
            </p>
            <div className="mt-8 flex justify-center gap-3">
              <LuxeButton to="/courses" variant="foil">
                Browse the library
              </LuxeButton>
              <LuxeButton to="/contact" variant="outline">
                Ask Yvette
              </LuxeButton>
            </div>
          </Container>
        </Section>
      </>
    );
  }

  const course = request.data;
  const offer = primaryOffer(course.offers);

  const schemaInput = {
    title: course.title,
    description: cwc.seo.description,
    slug: course.slug,
    // The page's own bundle shot rather than the library thumbnail: the OG card
    // and the structured data should show what this page shows.
    image: cwc.bundle.src,
    offers: course.offers,
  };

  // The hero's label is the source's — "Start the Program for" — completed by
  // the offer rather than by a figure typed here. A course with no offer on it
  // has no price to quote, so it falls back to the enrol label.
  const heroCta = offer ? `${cwc.hero.ctaPrefix} ${priceLabel(offer)}` : cwc.pricing.cta;

  return (
    <>
      <Seo
        title={cwc.seo.title}
        description={cwc.seo.description}
        image={cwc.bundle.src}
        jsonLd={[
          courseNode(origin, schemaInput),
          // A sales page is a course and a thing with a price at the same time,
          // and merchant results are built from Product/Offer rather than
          // Course/Offer. Both describe the one URL.
          productNode(origin, schemaInput),
        ]}
      />

      <LuxePageHero
        title={cwc.hero.title}
        titleAccent={cwc.hero.titleAccent}
        tone="mixed"
        align="center"
        lede={cwc.hero.sub}
        actions={
          <div className="flex w-full flex-col items-center gap-5">
            <div className="flex flex-wrap justify-center gap-2.5">
              {cwc.hero.badges.map((badge, i) => (
                <LuxePill key={badge} accent={i === 0 ? "neutral" : "gold"}>
                  {badge}
                </LuxePill>
              ))}
              {course.owned && <LuxePill accent="green">You own this</LuxePill>}
            </div>
            {/* An owner is not sold to twice: their button is the one action
                the investment band would offer them anyway, so it goes
                straight there rather than scrolling to a price they have
                already paid. Everyone else scrolls to the band. */}
            {course.owned ? (
              <LuxeButton
                variant="foil"
                size="lg"
                to="/library"
                className="w-full tracking-[0.14em] sm:w-auto sm:tracking-[0.2em]"
              >
                Open it
              </LuxeButton>
            ) : (
              <LuxeButton
                variant="foil"
                size="lg"
                href={CWC_INVESTMENT_ANCHOR}
                className="w-full tracking-[0.14em] sm:w-auto sm:tracking-[0.2em]"
              >
                {heroCta}
              </LuxeButton>
            )}
            <p className="copy-luxe max-w-xl text-pretty text-sm">{cwc.hero.priceNote}</p>
          </div>
        }
      />

      <ComplianceBand />
      <BundleSection />
      <OutcomesSection />
      <ProgramSection />
      <ObjectivesSection />
      <InsideSection owned={course.owned} />
      <CertificateSection />
      <PresenterSection owned={course.owned} />
      <InvestmentSection course={course} />
      <PolicySection />
      <AccreditationSection />
    </>
  );
}

/* ── The compliance bar the source page opens with ────────────────────── */

function ComplianceBand() {
  return (
    <Section surface="raised" space="sm" aria-label="NBCC approval">
      <p className="mx-auto max-w-3xl text-balance text-center text-[0.78rem] font-semibold uppercase leading-[1.9] tracking-[0.16em] text-gold/90">
        {cwc.compliance}
      </p>
    </Section>
  );
}

/* ── The bundle shot ──────────────────────────────────────────────────── */

function BundleSection() {
  const reduce = useEntranceMotion();

  return (
    <Section surface="base" space="md" aria-label="What comes with the program">
      {/* Unmatted on purpose: the file is a cut-out on a transparent ground, so
          a glass card behind it would frame the empty air around the laptops
          rather than the picture. It floats on the band, as it does on the
          source page. */}
      <motion.img
        {...rise(reduce)}
        src={cwc.bundle.src}
        alt={cwc.bundle.alt}
        width={cwc.bundle.width}
        height={cwc.bundle.height}
        loading="lazy"
        decoding="async"
        className="mx-auto h-auto w-full max-w-4xl"
      />
    </Section>
  );
}

/* ── What you will understand, and what you will stop doing ───────────── */

function OutcomesSection() {
  return (
    <Section surface="raised" space="lg" aurora="plum" auroraIntensity={0.45} aria-label={cwc.understand.title}>
      <RevealGroup
        as="ul"
        className="mx-auto grid max-w-4xl list-none grid-cols-1 items-stretch gap-6 md:grid-cols-2"
      >
        <RevealItem as="li" className="h-full">
          <GlassCard as="article" accent="green" className="flex h-full flex-col p-7 sm:p-8">
            <h2 className="text-balance font-display text-[1.4rem] font-medium leading-[1.25] text-white">
              {cwc.understand.title}
            </h2>
            <GoldRule width="w-10" className="mt-5" />
            <MarkedList items={cwc.understand.items} variant="check" className="mt-6" />
          </GlassCard>
        </RevealItem>
        <RevealItem as="li" className="h-full">
          <GlassCard as="article" accent="plum" className="flex h-full flex-col p-7 sm:p-8">
            <h2 className="text-balance font-display text-[1.4rem] font-medium leading-[1.25] text-white">
              {cwc.stop.title}
            </h2>
            <GoldRule width="w-10" className="mt-5" />
            <MarkedList items={cwc.stop.items} variant="cross" className="mt-6" />
          </GlassCard>
        </RevealItem>
      </RevealGroup>
    </Section>
  );
}

/* ── The programme, and the four numbers that define the CE credit ────── */

function ProgramSection() {
  const reduce = useEntranceMotion();

  return (
    <Section
      surface="deep"
      space="lg"
      aurora="gold"
      auroraIntensity={0.4}
      aria-label={cwc.program.title}
      containerClassName="max-w-4xl"
    >
      <motion.div {...rise(reduce)}>
        <GlassCard accent="gold" interactive={false} className="p-7 sm:p-10">
          <span className="eyebrow-luxe">{cwc.program.eyebrow}</span>
          <h2 className="text-balance font-display text-[1.6rem] font-medium leading-[1.2] text-white sm:text-[2rem]">
            {cwc.program.title}
          </h2>
          <GoldRule className="mt-6" />
          <p className="copy-luxe mt-6 text-pretty">{cwc.program.body}</p>

          <dl className="mt-9 grid grid-cols-2 gap-6 border-t border-white/[0.07] pt-8 sm:grid-cols-4">
            {cwc.program.stats.map((stat) => (
              <div key={stat.label} className="text-center">
                <dt className="sr-only">{stat.label}</dt>
                <dd>
                  <span className="text-foil block font-display text-[2rem] font-medium leading-none tracking-tight sm:text-[2.4rem]">
                    {stat.num}
                  </span>
                  <span className="mt-2.5 block text-pretty text-[0.68rem] font-semibold uppercase leading-[1.5] tracking-[0.16em] text-orchid">
                    {stat.label}
                  </span>
                </dd>
              </div>
            ))}
          </dl>
        </GlassCard>
      </motion.div>
    </Section>
  );
}

/* ── The ten learning objectives ──────────────────────────────────────── */

/**
 * Kept as a real ordered list. These ten lines are what the NBCC approval is
 * granted against, and "objective 7" has to mean the same thing to a reader,
 * a screen reader and an auditor — which a bulleted list cannot promise.
 */
function ObjectivesSection() {
  const reduce = useEntranceMotion();

  return (
    <Section surface="base" space="lg" aria-label={cwc.objectives.title} containerClassName="max-w-3xl">
      <SectionTitle align="left" title={cwc.objectives.title} body={cwc.objectives.intro} />
      <motion.ol {...rise(reduce, 0.1)} className="mt-8 list-none space-y-0">
        {cwc.objectives.items.map((item, i) => (
          <li key={item} className="flex gap-5 border-t border-white/[0.07] py-4 first:border-0 first:pt-0">
            <span aria-hidden className="shrink-0 font-display text-sm text-gold">
              {String(i + 1).padStart(2, "0")}
            </span>
            <span className="copy-luxe min-w-0 text-pretty text-[0.95rem]">{item}</span>
          </li>
        ))}
      </motion.ol>
    </Section>
  );
}

/* ── What is inside: the CE content, and the bonus tools that are not ─── */

function InsideSection({ owned }: { owned: boolean }) {
  return (
    <Section surface="raised" space="lg" aurora="violet" auroraIntensity={0.45} aria-label={cwc.inside.title}>
      <SectionTitle align="left" title={cwc.inside.title} body={cwc.inside.intro} />

      <RevealGroup
        as="ul"
        className="mt-8 grid list-none grid-cols-1 items-stretch gap-6 sm:mt-10 md:grid-cols-2"
      >
        <RevealItem as="li" className="h-full">
          <GlassCard as="article" accent="gold" className="flex h-full flex-col p-7 sm:p-8">
            <LuxePill accent="gold" className="self-start">
              {cwc.inside.ce.tag}
            </LuxePill>
            <ul className="mt-7 space-y-4">
              {cwc.inside.ce.items.map((item) => (
                <li key={item.detail} className="copy-luxe text-pretty text-[0.95rem]">
                  {/* The two training names are set bold on the source and the
                      rest of the line runs on from them. */}
                  {item.name && <strong className="font-semibold text-white">{item.name}</strong>}
                  {item.name ? " " : null}
                  {item.detail}
                </li>
              ))}
            </ul>
          </GlassCard>
        </RevealItem>

        <RevealItem as="li" className="h-full">
          <GlassCard as="article" accent="plum" className="flex h-full flex-col p-7 sm:p-8">
            <LuxePill accent="plum" className="self-start">
              {cwc.inside.bonus.tag}
            </LuxePill>
            <MarkedList items={cwc.inside.bonus.items} className="mt-7" />
          </GlassCard>
        </RevealItem>
      </RevealGroup>

      {!owned && <Cta label={cwc.pricing.cta} to={CWC_INVESTMENT_ANCHOR} className="mt-9 sm:mt-10" />}
    </Section>
  );
}

/* ── How the certificate is earned ────────────────────────────────────── */

function CertificateSection() {
  return (
    <Section surface="deep" space="lg" aria-label={cwc.certificate.title}>
      <SectionTitle title={cwc.certificate.title} />
      <RevealGroup
        as="ol"
        className="mx-auto mt-8 grid max-w-5xl list-none grid-cols-1 gap-6 sm:mt-10 sm:grid-cols-2 lg:grid-cols-4"
      >
        {cwc.certificate.steps.map((step, i) => (
          <RevealItem key={step.title} as="li" className="h-full">
            <GlassCard as="article" accent={accentAt(i)} className="flex h-full flex-col p-7">
              <span aria-hidden className="text-foil font-display text-[1.6rem] leading-none">
                {String(i + 1).padStart(2, "0")}
              </span>
              <h3 className="mt-4 text-balance font-display text-[1.15rem] font-medium leading-[1.25] text-white">
                {step.title}
              </h3>
              <p className="copy-luxe mt-3 flex-1 text-pretty text-sm">{step.body}</p>
            </GlassCard>
          </RevealItem>
        ))}
      </RevealGroup>
    </Section>
  );
}

/* ── The presenter ────────────────────────────────────────────────────── */

/**
 * Deliberately not `FounderLetter`: that block is a first-person letter with a
 * signature, and this is a third-person biography carrying two credentials.
 * The portrait file is already an oval cut-out on a transparent ground, so it
 * gets no mat, no crop and no ring: a square crop would clip the top of her
 * hair, and a circular ring cannot follow an oval edge.
 */
function PresenterSection({ owned }: { owned: boolean }) {
  const reduce = useEntranceMotion();

  return (
    <Section surface="base" space="lg" aurora="plum" auroraIntensity={0.4} aria-label={cwc.presenter.title}>
      <div className="mx-auto grid max-w-5xl items-center gap-8 lg:grid-cols-[0.75fr_1.25fr] lg:gap-14">
        <motion.div {...rise(reduce)} className="mx-auto w-full max-w-[16rem] lg:max-w-xs">
          <img
            src={cwc.presenter.portrait.src}
            alt={cwc.presenter.portrait.alt}
            width={cwc.presenter.portrait.width}
            height={cwc.presenter.portrait.height}
            loading="lazy"
            decoding="async"
            className="h-auto w-full max-w-full"
          />
        </motion.div>

        <motion.div {...rise(reduce, 0.1)}>
          <span className="eyebrow-luxe">{cwc.presenter.title}</span>
          <h2 className="text-balance font-display text-[1.7rem] font-medium leading-[1.2] text-white sm:text-[2.1rem]">
            {cwc.presenter.name}
          </h2>
          <div className="mt-5 flex flex-wrap gap-2.5">
            {cwc.presenter.creds.map((cred) => (
              <LuxePill key={cred} accent="neutral">
                {cred}
              </LuxePill>
            ))}
          </div>
          <GoldRule className="mt-6" />
          <Prose paragraphs={cwc.presenter.paragraphs} className="mt-6" />
        </motion.div>
      </div>

      {!owned && <Cta label={cwc.pricing.cta} to={CWC_INVESTMENT_ANCHOR} className="mt-9 sm:mt-10" />}
    </Section>
  );
}

/* ── The investment — the only band that leaves the page ──────────────── */

function InvestmentSection({ course }: { course: CourseDetailResponse }) {
  const reduce = useEntranceMotion();

  return (
    <Section
      id="investment"
      surface="raised"
      space="lg"
      aurora="mixed"
      auroraIntensity={0.55}
      aria-label={cwc.pricing.title}
      className="scroll-mt-24"
      containerClassName="max-w-3xl"
    >
      <motion.div {...rise(reduce)}>
        <GlassCard accent="gold" interactive={false} className="p-7 text-center sm:p-10">
          <h2 className="text-balance font-display text-[1.6rem] font-medium leading-[1.25] text-white sm:text-[2rem]">
            {cwc.pricing.title}
          </h2>
          <p className="copy-luxe mx-auto mt-5 max-w-xl text-pretty">{cwc.pricing.body}</p>

          {stripeTestMode() && (
            <p
              role="status"
              className="mx-auto mt-7 max-w-md rounded-xl border border-gold/40 bg-gold/10 p-4 text-sm text-gold"
            >
              Test mode — no real payments.
            </p>
          )}

          {course.owned ? (
            <>
              <p className="copy-luxe mt-8 text-sm">This is already in your library.</p>
              <Cta label="Open it" to="/library" className="mt-6" />
            </>
          ) : course.offers.length > 0 ? (
            // Every offer on the course is printed, not just the first: a
            // payment plan that the page silently dropped is a price the buyer
            // finds out about at checkout.
            <div className="mt-9 divide-y divide-white/[0.07] border-y border-white/[0.07]">
              {course.offers.map((offer) => (
                <div key={offer.slug} className="py-8">
                  <p className="text-foil font-display text-[2.4rem] font-medium leading-none tracking-tight sm:text-[2.9rem]">
                    {priceLabel(offer)}
                  </p>
                  {offer.checkoutHeadline && (
                    <p className="mt-3 text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-orchid">
                      {offer.checkoutHeadline}
                    </p>
                  )}
                  {offer.available ? (
                    <Cta label={cwc.pricing.cta} to={`/checkout/${offer.slug}`} className="mt-7" />
                  ) : (
                    <p className="copy-luxe mx-auto mt-6 max-w-md text-pretty text-sm">
                      {offer.unavailableReason}
                    </p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <>
              <p className="copy-luxe mt-8 text-pretty text-sm">
                {course.priceText
                  ? course.priceText
                  : "Enrollment will open when this course’s price and materials are ready."}
              </p>
              <Cta label="Ask about this course" to="/contact" className="mt-6" />
            </>
          )}

          <p className="mt-7 text-pretty text-xs leading-[1.7] text-orchid-faint">
            Secure checkout. Your card details never touch our servers.
          </p>
        </GlassCard>
      </motion.div>
    </Section>
  );
}

/* ── Refund and grievance policy ──────────────────────────────────────── */

function PolicySection() {
  const reduce = useEntranceMotion();

  return (
    <Section surface="base" space="lg" aria-label={cwc.policy.title} containerClassName="max-w-3xl">
      <motion.div {...rise(reduce)}>
        <GlassCard accent="neutral" interactive={false} spotlight={false} className="p-7 sm:p-9">
          <h2 className="font-display text-[1.3rem] font-medium leading-[1.25] text-white sm:text-[1.5rem]">
            {cwc.policy.title}
          </h2>
          <GoldRule width="w-10" className="mt-5" />
          <div className="mt-6 space-y-5">
            <p className="copy-luxe text-pretty text-[0.95rem]">{cwc.policy.opening}</p>
            <MailSentence line={cwc.policy.grievance} className="copy-luxe text-pretty text-[0.95rem]" />
            <p className="copy-luxe text-pretty text-[0.95rem]">{cwc.policy.closing}</p>
          </div>
        </GlassCard>
      </motion.div>
    </Section>
  );
}

/* ── The NBCC statement the source page closes on ─────────────────────── */

function AccreditationSection() {
  return (
    <Section surface="deep" space="sm" aria-label="Continuing education accreditation" containerClassName="max-w-3xl">
      <p className="text-pretty text-center text-xs leading-[1.8] text-orchid">{cwc.footer.nbcc}</p>
      <MailSentence
        line={cwc.footer.contact}
        className="mt-5 text-pretty text-center text-xs leading-[1.8] text-orchid"
      />
    </Section>
  );
}
