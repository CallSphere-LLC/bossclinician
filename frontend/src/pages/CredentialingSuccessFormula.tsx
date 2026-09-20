import { Link } from "react-router";
import { motion } from "motion/react";
import { ShieldCheck } from "lucide-react";
import { Seo } from "@/components/Seo";
import {
  Cta,
  MarkedList,
  ProgramFaq,
  Prose,
  Pull,
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
  CSF_CTA_LABEL,
  CSF_INVESTMENT_ANCHOR,
  CSF_MOCKUP,
  CSF_SLUG,
  csf,
} from "@/content/credentialingSuccessFormula";
import { useEntranceMotion } from "@/hooks/useEntranceMotion";
import { usePageData } from "@/hooks/usePageData";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { stripeTestMode } from "@/lib/paymentMode";
import { courseNode, faqPageNode, productNode } from "@/seo/schema";
import { useHeadContext } from "@/ssr/context";
import { ssrKeys } from "@/ssr/keys";

/**
 * The Credentialing Success Formula — the owner's own sales page, rebuilt.
 *
 * It occupies `/courses/credentialing-success-formula`, a static route declared
 * ahead of `/courses/:slug` so this one product argues for itself while the
 * other thirteen keep the generic catalogue layout. The backend already seeds
 * the course payload for anything under `/courses/:slug`, so nothing on the
 * server had to learn this page exists.
 *
 * Price and availability come from the same API the generic page reads. That
 * matters more here than anywhere else on the site: this page names the figure
 * four times, and a sales page that hardcodes a price is a sales page that goes
 * stale the first time the owner changes one.
 *
 * Mid-page actions scroll to the investment band rather than each holding a
 * buy button of their own — follows /club, and keeps the "enrollment opens when
 * materials are ready" notice from appearing six times down the page.
 */

const PORTRAIT = "/images/5f84052ec83a.jpg";

export default function CredentialingSuccessFormula() {
  const { origin } = useHeadContext();
  const reduce = useEntranceMotion();

  // `owned` is the one field an anonymous server render cannot know, so a
  // signed-in reader — and only a signed-in reader — re-reads the course.
  const request = usePageData<CourseDetailResponse>(
    ssrKeys.courseDetail(CSF_SLUG),
    () => api.courseDetail(CSF_SLUG) as Promise<CourseDetailResponse>,
    { revalidateForMembers: true },
  );

  if (request.status === "loading") {
    return (
      <>
        {/* On the server this branch means the loader could not read the
            course. Answering 200 would file the URL in the index under the
            site's default title, so the crawler is told to come back. */}
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
  // not answer a live product URL with "retired", or with HTTP 404.
  if (request.status === "error") {
    return (
      <Section space="xl">
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
        <Section space="xl">
          <Container className="max-w-2xl text-center">
            <h1 className="font-display text-4xl text-ink">We couldn't find that one</h1>
            <p className="mt-4 text-orchid">
              It may have been renamed or retired. Everything currently available is in the training
              library.
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
  // One offer is what this product has ever had; the first is the one the page
  // quotes. If the owner ever adds a plan, the investment band lists them all.
  const [headline] = course.offers;
  const price = headline ? priceLabel(headline) : course.priceText;

  const schemaInput = {
    title: course.title,
    description: course.description || course.subtitle,
    slug: course.slug,
    image: course.image,
    offers: course.offers,
    totalMinutes: 0,
  };

  return (
    <>
      <Seo
        title={`${course.title} · Boss Clinician`}
        description={csf.hero.lede}
        image={CSF_MOCKUP.src}
        jsonLd={[
          courseNode(origin, schemaInput),
          // A sales page is a course and a thing with a price at the same time,
          // and merchant results are built from Product/Offer.
          productNode(origin, schemaInput),
          faqPageNode(origin, `/courses/${CSF_SLUG}`, csf.faq.items),
        ]}
      />

      <LuxePageHero
        eyebrow={csf.hero.eyebrow}
        title={csf.hero.title}
        titleAccent={csf.hero.titleAccent}
        lede={csf.hero.lede}
        tone="violet"
        actions={
          <div className="flex flex-col items-start gap-5">
            <p className="text-balance font-display text-[1.15rem] italic text-white">
              {csf.hero.boldLine}
            </p>
            <div className="flex flex-wrap items-center gap-3">
              {price && <LuxePill accent="gold">{price}</LuxePill>}
              <LuxePill accent="neutral">{csf.hero.terms}</LuxePill>
              {course.owned && <LuxePill accent="green">You own this</LuxePill>}
            </div>
            <LuxeButton
              variant="foil"
              size="lg"
              href={CSF_INVESTMENT_ANCHOR}
              className="w-full max-w-full text-center leading-[1.4] tracking-[0.12em] sm:w-auto sm:tracking-[0.18em]"
            >
              {CSF_CTA_LABEL}
            </LuxeButton>
          </div>
        }
        aside={
          <GlassCard interactive={false} spotlight={false} className="overflow-hidden p-2">
            <img
              src={CSF_MOCKUP.src}
              alt={CSF_MOCKUP.alt}
              width={CSF_MOCKUP.width}
              height={CSF_MOCKUP.height}
              // The hero image: the one picture on the page worth blocking on.
              loading="eager"
              decoding="async"
              className="h-auto w-full rounded-xl"
            />
          </GlassCard>
        }
      />

      <Section surface="base" space="sm">
        <p className="copy-luxe mx-auto max-w-2xl text-pretty text-center text-[0.95rem]">
          {csf.hero.designerNote}
        </p>
      </Section>

      {/* ── The problem ────────────────────────────────────────────────── */}
      <Section surface="raised" space="lg" aurora="plum" auroraIntensity={0.45}>
        <SectionTitle align="center" title={csf.problem.title} />
        <Prose paragraphs={csf.problem.paragraphs} className="mx-auto mt-10 max-w-2xl" />
        <Pull className="mt-10">{csf.problem.pull}</Pull>
        <Prose paragraphs={[csf.problem.closing]} className="mx-auto mt-10 max-w-2xl" />
      </Section>

      {/* ── Why it should be a system ──────────────────────────────────── */}
      <Section surface="base" space="lg">
        <SectionTitle align="center" title={csf.system.title} />
        <Prose paragraphs={csf.system.paragraphs} className="mx-auto mt-10 max-w-2xl" />
        <Pull className="mt-10">{csf.system.pull}</Pull>
      </Section>

      {/* ── Introducing ────────────────────────────────────────────────── */}
      <Section surface="raised" space="lg" aurora="violet" auroraIntensity={0.5}>
        <SectionTitle
          align="center"
          eyebrow={csf.intro.eyebrow}
          title={csf.intro.title}
          body={csf.intro.boldLine}
        />
        <div className="mx-auto mt-10 max-w-2xl">
          <Prose paragraphs={[csf.intro.body]} align="center" />
          <MarkedList items={csf.intro.bullets} className="mx-auto mt-8 max-w-md" />
          <Prose paragraphs={[csf.intro.closing]} align="center" className="mt-8" />
        </div>
        <Cta label={CSF_CTA_LABEL} to={CSF_INVESTMENT_ANCHOR} className="mt-10" />
      </Section>

      {/* ── New hire → billable ────────────────────────────────────────── */}
      <Section surface="base" space="lg">
        <SectionTitle align="center" title={csf.flow.title} />
        <ol className="mx-auto mt-10 flex max-w-md list-none flex-col items-center gap-0">
          {csf.flow.steps.map((step, i) => (
            <motion.li key={step.label} {...rise(reduce, Math.min(i, 6) * 0.04)} className="w-full">
              <div
                className={cn(
                  "rounded-xl px-5 py-3.5 text-center text-[0.95rem] font-medium",
                  "billable" in step && step.billable
                    ? "bg-gold text-night-deep"
                    : "border border-hairline bg-white/[0.04] text-white",
                )}
              >
                {step.label}
              </div>
              {i < csf.flow.steps.length - 1 && (
                <div aria-hidden className="py-1.5 text-center text-lg leading-none text-gold">
                  ↓
                </div>
              )}
            </motion.li>
          ))}
        </ol>
      </Section>

      {/* ── What's included ────────────────────────────────────────────── */}
      <Section surface="raised" space="lg" aurora="plum" auroraIntensity={0.45}>
        <SectionTitle align="center" title={csf.included.title} />
        <RevealGroup className="mx-auto mt-10 max-w-3xl space-y-5">
          {csf.included.items.map((item, i) => (
            <RevealItem key={item.title}>
              <GlassCard accent={accentAt(i)} interactive={false} spotlight={false} className="p-7">
                <div className="flex items-baseline gap-3.5">
                  <span className="font-display text-sm text-gold">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <h3 className="text-balance font-display text-xl text-white">{item.title}</h3>
                </div>
                <p className="copy-luxe mt-3 text-pretty text-[0.95rem]">{item.desc}</p>
                {item.bullets.length > 0 && <MarkedList items={item.bullets} className="mt-5" />}
                {item.note && (
                  <p className="mt-5 text-pretty text-sm italic leading-relaxed text-orchid">
                    {item.note}
                  </p>
                )}
              </GlassCard>
            </RevealItem>
          ))}
        </RevealGroup>
      </Section>

      {/* ── Train your admin ───────────────────────────────────────────── */}
      <Section surface="base" space="lg">
        <SectionTitle align="center" title={csf.admin.title} body={csf.admin.boldLine} />
        <div className="mx-auto mt-10 max-w-2xl">
          <Prose paragraphs={[csf.admin.body]} align="center" />
          <MarkedList items={csf.admin.roles} className="mx-auto mt-8 max-w-sm" />
          <Prose paragraphs={[csf.admin.handoff]} align="center" className="mt-8" />
        </div>
        <Pull className="mt-10">{csf.admin.pull}</Pull>
        <Prose paragraphs={[csf.admin.closing]} className="mx-auto mt-10 max-w-2xl" />
      </Section>

      {/* ── Even if you outsource ──────────────────────────────────────── */}
      <Section surface="raised" space="lg" aurora="violet" auroraIntensity={0.45}>
        <SectionTitle align="center" title={csf.outsource.title} />
        <div className="mx-auto mt-10 max-w-2xl">
          <Prose paragraphs={[csf.outsource.body]} align="center" />
          <MarkedList items={csf.outsource.questions} className="mx-auto mt-8 max-w-md" />
        </div>
        <Pull className="mt-10">{csf.outsource.pull}</Pull>
      </Section>

      {/* ── Why it matters beyond credentialing ────────────────────────── */}
      <Section surface="base" space="lg">
        <SectionTitle align="center" title={csf.whyItMatters.title} />
        <div className="mx-auto mt-10 max-w-2xl">
          <Prose paragraphs={[csf.whyItMatters.body]} align="center" />
          <MarkedList items={csf.whyItMatters.touches} className="mx-auto mt-8 max-w-md" />
          <p className="mt-10 text-balance text-center font-display text-[1.2rem] italic text-white">
            {csf.whyItMatters.boldLine}
          </p>
        </div>
      </Section>

      {/* ── For you / not for you ──────────────────────────────────────── */}
      <Section surface="raised" space="lg">
        <div className="mx-auto grid max-w-4xl gap-6 md:grid-cols-2">
          <GlassCard accent="green" interactive={false} spotlight={false} className="p-7">
            <h3 className="font-display text-xl text-white">{csf.fit.forTitle}</h3>
            <MarkedList items={csf.fit.forYou} variant="check" className="mt-6" />
          </GlassCard>
          <GlassCard accent="plum" interactive={false} spotlight={false} className="p-7">
            <h3 className="font-display text-xl text-white">{csf.fit.notTitle}</h3>
            <MarkedList items={csf.fit.notForYou} variant="cross" className="mt-6" />
            {/* The card names the solo product; naming it without linking it
                sends that reader back to the catalogue to hunt for it. */}
            <Link
              to={csf.fit.soloLink.to}
              className="mt-6 inline-block text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-gold transition-colors hover:text-white"
            >
              {csf.fit.soloLink.label} →
            </Link>
          </GlassCard>
        </div>
        <Prose paragraphs={[csf.fit.closing]} align="center" className="mx-auto mt-10 max-w-2xl" />
      </Section>

      {/* ── Who made it ────────────────────────────────────────────────── */}
      <Section surface="base" space="lg" aurora="plum" auroraIntensity={0.5}>
        <div className="grid items-start gap-12 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
          <motion.div {...rise(reduce)} className="mx-auto w-full max-w-sm lg:sticky lg:top-28">
            <GlassCard interactive={false} spotlight={false} className="overflow-hidden p-2">
              <img
                src={PORTRAIT}
                alt="Yvette Howard, LCSW"
                width={720}
                height={900}
                loading="lazy"
                decoding="async"
                className="aspect-[4/5] h-auto w-full rounded-xl object-cover object-top"
              />
            </GlassCard>
          </motion.div>

          <motion.div {...rise(reduce, 0.1)}>
            <span className="eyebrow-luxe">{csf.bio.eyebrow}</span>
            <h2 className="text-balance font-display text-[2rem] font-medium leading-[1.14] text-white sm:text-[2.6rem]">
              {csf.bio.title}
            </h2>
            <GoldRule className="mt-8" />
            <Prose paragraphs={csf.bio.paragraphs} className="mt-8" />
            <p className="mt-8 text-pretty font-display text-[1.2rem] italic leading-[1.4] text-white">
              {csf.bio.strong}
            </p>
            <p className="mt-6 text-sm uppercase tracking-[0.18em] text-orchid">
              {csf.bio.signature}
            </p>
          </motion.div>
        </div>
      </Section>

      {/* ── What's included, as a table ────────────────────────────────── */}
      <Section surface="raised" space="lg">
        <SectionTitle align="center" title={csf.table.title} />
        <div className="mx-auto mt-10 max-w-3xl overflow-hidden rounded-2xl border border-hairline">
          <table className="w-full border-collapse text-left">
            <caption className="sr-only">{csf.table.title}</caption>
            <thead>
              <tr className="bg-white/[0.06]">
                {csf.table.head.map((cell) => (
                  <th
                    key={cell}
                    scope="col"
                    className="px-5 py-3.5 text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-gold"
                  >
                    {cell}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {csf.table.rows.map(([resource, helps]) => (
                <tr key={resource} className="border-t border-hairline align-top">
                  <th scope="row" className="px-5 py-4 text-[0.95rem] font-medium text-white">
                    {resource}
                  </th>
                  <td className="copy-luxe px-5 py-4 text-[0.95rem]">{helps}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {/* ── The investment: the one band on the page that transacts ────── */}
      <Section id="investment" surface="base" space="xl" className="scroll-mt-24">
        <GlassCard
          accent="gold"
          interactive={false}
          spotlight={false}
          className="mx-auto max-w-2xl p-8 text-center sm:p-10"
        >
          <p className="text-balance font-display text-[1.35rem] italic leading-[1.4] text-white">
            {csf.investment.boldLine}
          </p>

          {stripeTestMode() && (
            <p
              role="status"
              className="mt-6 rounded-xl border border-gold/40 bg-gold/10 p-4 text-sm text-gold"
            >
              Test mode — no real payments.
            </p>
          )}

          {course.owned ? (
            <>
              <p className="copy-luxe mt-7">This is already in your library.</p>
              <LuxeButton to="/library" variant="foil" size="lg" className="mt-7">
                Open it
              </LuxeButton>
            </>
          ) : course.offers.length > 0 ? (
            <div className="mt-7 space-y-8">
              {course.offers.map((offer: CourseOffer) => (
                <div key={offer.slug} className="border-t border-hairline pt-8 first:border-0 first:pt-0">
                  <p className="font-display text-[3rem] leading-none text-white sm:text-[3.4rem]">
                    {priceLabel(offer)}
                  </p>
                  <p className="copy-luxe mt-3 text-[0.95rem]">
                    {offer.checkoutHeadline || csf.investment.terms}
                  </p>
                  {offer.available ? (
                    <LuxeButton
                      to={`/checkout/${offer.slug}`}
                      variant="foil"
                      size="lg"
                      className="mt-7 w-full max-w-full text-center leading-[1.4] tracking-[0.12em] sm:w-auto sm:tracking-[0.18em]"
                    >
                      {CSF_CTA_LABEL}
                    </LuxeButton>
                  ) : (
                    // Said plainly rather than hidden: the offer is priced and
                    // published, but checkout refuses to sell a course whose
                    // lessons are not in place yet.
                    <p className="copy-luxe mt-7 text-[0.95rem]">{offer.unavailableReason}</p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <>
              <p className="copy-luxe mt-7">
                {course.priceText ||
                  "Enrollment will open when this course's price and materials are ready."}
              </p>
              <LuxeButton to="/contact" variant="foil" size="lg" className="mt-7">
                Ask about this course
              </LuxeButton>
            </>
          )}

          <p className="mt-8 flex items-start justify-center gap-2.5 text-xs leading-relaxed text-orchid-faint">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-gold/70" aria-hidden />
            Secure checkout. Your card details never touch our servers.
          </p>
        </GlassCard>
      </Section>

      <ProgramFaq title={csf.faq.title} items={csf.faq.items} />

      {/* ── The last word ──────────────────────────────────────────────── */}
      <Section surface="raised" space="xl" aurora="violet" auroraIntensity={0.6}>
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="text-balance font-display text-[2rem] font-medium leading-[1.14] text-white sm:text-[2.6rem]">
            {csf.finalCta.title}
          </h2>
          <GoldRule className="mx-auto mt-8" />
          <Prose paragraphs={[csf.finalCta.body]} align="center" className="mt-8" />
          <p className="mt-8 text-balance font-display text-[1.25rem] italic leading-[1.4] text-gold">
            {csf.finalCta.boldLine}
          </p>
          {price && (
            <p className="mt-8 font-display text-[1.4rem] text-white">
              {course.title} — {price}
            </p>
          )}
          <Cta label={csf.finalCta.label} to={CSF_INVESTMENT_ANCHOR} className="mt-8" />
        </div>
      </Section>
    </>
  );
}
