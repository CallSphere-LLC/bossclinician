import { Link, useParams } from "react-router-dom";
import { motion } from "motion/react";
import { Check, Clock, Lock, PlayCircle, ShieldCheck } from "lucide-react";
import { Seo } from "@/components/Seo";
import { BuyButton } from "@/components/BuyButton";
import { GlassCard } from "@/components/luxe/GlassCard";
import { LuxeButton, LuxePill } from "@/components/luxe/LuxeButton";
import { GoldRule, Section } from "@/components/luxe/Section";
import { Container } from "@/components/ui/Container";
import { RevealGroup, RevealItem } from "@/components/ui/Reveal";
import { useEntranceMotion } from "@/hooks/useEntranceMotion";
import { usePageData } from "@/hooks/usePageData";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { courseNode, productNode } from "@/seo/schema";
import { useHeadContext } from "@/ssr/context";
import { ssrKeys } from "@/ssr/keys";
import { isPurchasable, type Course } from "@/types";

/**
 * The sales page for one course.
 *
 * Every product URL the business has ever published points here. The redirect
 * map sends 55 legacy bossclinician.com paths — `/fullybooked`,
 * `/credentialwithconfidencekit`, `/Practice-Protection-Pack` and the rest — to
 * `/courses/<slug>`, so this route is what stands between those links and a
 * 404 on the day the domain moves.
 *
 * The curriculum is shown as an outline because it sells: fourteen lesson
 * titles say more about what someone is buying than a paragraph does. The API
 * sends titles and lengths only — no bodies, no video URLs — so there is
 * nothing here to gate.
 */

interface CurriculumLesson {
  id: number;
  title: string;
  slug: string;
  durationMinutes: number;
  contentType: string;
  preview: boolean;
}

interface CurriculumModule {
  id: number;
  title: string;
  summary: string;
  lessons: CurriculumLesson[];
}

interface CourseOffer {
  slug: string;
  title: string;
  pricingType: "one_time" | "subscription" | "payment_plan" | "free" | "pwyw";
  amountCents: number;
  currency: string;
  interval: string | null;
  intervalCount: number;
  installmentCount: number | null;
  checkoutHeadline: string;
}

interface CourseDetailResponse extends Course {
  modules: CurriculumModule[];
  offers: CourseOffer[];
  owned: boolean;
}

const money = (cents: number, currency = "usd") =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);

/**
 * How an offer's price reads to a buyer.
 *
 * A payment plan states the instalment AND the total. Someone who thinks they
 * are paying $1,250 and then watches $3,750 leave their account over three
 * months raises a chargeback, and they are right to.
 */
function priceLabel(offer: CourseOffer): string {
  switch (offer.pricingType) {
    case "free":
      return "Free";
    case "pwyw":
      return "Pay what you can";
    case "subscription": {
      const every =
        offer.intervalCount > 1
          ? `every ${offer.intervalCount} ${offer.interval}s`
          : `a ${offer.interval}`;
      return `${money(offer.amountCents, offer.currency)} ${every}`;
    }
    case "payment_plan": {
      const count = offer.installmentCount ?? 1;
      const total = money(offer.amountCents * count, offer.currency);
      return `${count} payments of ${money(offer.amountCents, offer.currency)} — ${total} in total`;
    }
    default:
      return money(offer.amountCents, offer.currency);
  }
}

function totalMinutes(modules: CurriculumModule[]): number {
  return modules.reduce(
    (sum, m) => sum + m.lessons.reduce((s, l) => s + (l.durationMinutes || 0), 0),
    0,
  );
}

function lessonCount(modules: CurriculumModule[]): number {
  return modules.reduce((sum, m) => sum + m.lessons.length, 0);
}

export default function CourseDetail() {
  const { slug = "" } = useParams();
  const { origin } = useHeadContext();
  const reduceMotion = useEntranceMotion();

  // `owned` is the one field an anonymous server render cannot know, so a
  // signed-in reader — and only a signed-in reader — re-reads the course.
  const request = usePageData<CourseDetailResponse>(
    ssrKeys.courseDetail(slug),
    () => api.courseDetail(slug) as Promise<CourseDetailResponse>,
    { revalidateForMembers: true },
  );

  if (request.status === "loading") {
    return (
      <>
        {/* On the server this branch means only one thing: the loader could not
            read the course. This is where 55 legacy product URLs land, and
            answering 200 would file every one of them in the index under the
            site's default title and description, so the crawler is told the
            page is temporarily unavailable and to come back. */}
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
          <p className="mt-4 text-orchid">
            Please refresh the page — this is on us, not you.
          </p>
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

  const minutes = totalMinutes(course.modules);
  const lessons = lessonCount(course.modules);
  const hasCurriculum = lessons > 0;
  const features = Array.isArray(course.features) ? (course.features as string[]) : [];

  const schemaInput = {
    title: course.title,
    description: course.description || course.subtitle,
    slug: course.slug,
    image: course.image,
    offers: course.offers,
    totalMinutes: minutes,
  };

  return (
    <>
      <Seo
        title={`${course.title} · Boss Clinician`}
        description={course.description || course.subtitle}
        image={course.image}
        jsonLd={[
          courseNode(origin, schemaInput),
          // A sales page is a course and a thing with a price at the same time,
          // and merchant results are built from Product/Offer rather than
          // Course/Offer. Both describe the one URL.
          productNode(origin, schemaInput),
        ]}
      />

      <Section className="pt-16 sm:pt-24">
        <Container>
          <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
            <motion.div
              initial={reduceMotion ? false : { opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            >
              <Link
                to="/courses"
                className="text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-orchid-dim transition-colors hover:text-gold"
              >
                ← The training library
              </Link>

              <h1 className="mt-5 font-display text-4xl leading-tight text-ink sm:text-5xl">
                {course.title}
              </h1>

              {course.subtitle && (
                <p className="mt-4 text-lg leading-relaxed text-orchid">{course.subtitle}</p>
              )}

              <div className="mt-6 flex flex-wrap items-center gap-2.5">
                {course.owned && <LuxePill accent="green">You own this</LuxePill>}
                {hasCurriculum && (
                  <LuxePill accent="neutral">
                    {lessons} {lessons === 1 ? "lesson" : "lessons"}
                  </LuxePill>
                )}
                {minutes > 0 && (
                  <LuxePill accent="neutral">
                    {minutes < 60 ? `${minutes} min` : `${Math.round(minutes / 60)} hours`}
                  </LuxePill>
                )}
                <LuxePill accent="gold">Lifetime access</LuxePill>
              </div>

              {course.description && (
                <p className="mt-8 whitespace-pre-line text-[1.05rem] leading-relaxed text-orchid">
                  {course.description}
                </p>
              )}

              {features.length > 0 && (
                <div className="mt-10">
                  <GoldRule />
                  <h2 className="mt-8 font-display text-2xl text-ink">What's inside</h2>
                  <ul className="mt-5 grid gap-3 sm:grid-cols-2">
                    {features.map((feature) => (
                      <li key={feature} className="flex gap-3 text-orchid">
                        <Check className="mt-0.5 size-4 shrink-0 text-gold" aria-hidden />
                        <span className="text-[0.95rem] leading-relaxed">{feature}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </motion.div>

            {/* The buy panel sticks on desktop: the curriculum below is long,
                and a price that scrolls away is a price nobody acts on. */}
            <aside className="lg:sticky lg:top-28">
              <GlassCard accent="gold" spotlight={false} interactive={false} className="p-7">
                {course.image && (
                  <img
                    src={course.image}
                    alt=""
                    className="mb-6 aspect-[4/3] w-full rounded-xl object-cover"
                    loading="lazy"
                  />
                )}

                {course.owned ? (
                  <>
                    <p className="text-sm text-orchid">
                      This is already in your library.
                    </p>
                    <LuxeButton to="/library" variant="foil" className="mt-5 w-full">
                      Open it
                    </LuxeButton>
                  </>
                ) : course.offers.length > 0 ? (
                  <div className="space-y-5">
                    {course.offers.map((offer) => (
                      <div key={offer.slug} className="border-b border-hairline pb-5 last:border-0 last:pb-0">
                        <p className="font-display text-2xl text-ink">{priceLabel(offer)}</p>
                        {offer.checkoutHeadline && (
                          <p className="mt-1.5 text-sm text-orchid-dim">{offer.checkoutHeadline}</p>
                        )}
                        <LuxeButton
                          to={`/checkout/${offer.slug}`}
                          variant="foil"
                          className="mt-4 w-full"
                        >
                          {offer.pricingType === "free" ? "Get it free" : "Enroll now"}
                        </LuxeButton>
                      </div>
                    ))}
                  </div>
                ) : isPurchasable(course) ? (
                  <>
                    {course.priceText && (
                      <p className="font-display text-2xl text-ink">{course.priceText}</p>
                    )}
                    <BuyButton slug={course.slug} label="Enroll now" size="md" className="mt-4 block" />
                  </>
                ) : (
                  <>
                    <p className="text-sm leading-relaxed text-orchid">
                      {course.priceText
                        ? course.priceText
                        : "Enrollment for this one opens by application."}
                    </p>
                    <LuxeButton to="/apply" variant="foil" className="mt-5 w-full">
                      Apply to join
                    </LuxeButton>
                  </>
                )}

                <p className="mt-6 flex items-start gap-2.5 text-xs leading-relaxed text-orchid-faint">
                  <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-gold/70" aria-hidden />
                  Secure checkout. Your card details never touch our servers.
                </p>
              </GlassCard>
            </aside>
          </div>
        </Container>
      </Section>

      {hasCurriculum && (
        <Section className="pb-24">
          <Container className="max-w-3xl">
            <GoldRule />
            <h2 className="mt-10 font-display text-3xl text-ink">What you'll work through</h2>

            <RevealGroup className="mt-8 space-y-5">
              {course.modules.map((module, index) => (
                <RevealItem key={module.id}>
                  <GlassCard spotlight={false} interactive={false} className="p-6">
                    <div className="flex items-baseline gap-3">
                      <span className="font-display text-sm text-gold">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <h3 className="font-display text-xl text-ink">{module.title}</h3>
                    </div>

                    {module.summary && (
                      <p className="mt-2.5 text-sm leading-relaxed text-orchid-dim">
                        {module.summary}
                      </p>
                    )}

                    {module.lessons.length > 0 && (
                      <ul className="mt-5 space-y-1">
                        {module.lessons.map((lesson) => (
                          <li
                            key={lesson.id}
                            className="flex items-center gap-3 border-t border-hairline py-2.5 first:border-0"
                          >
                            {lesson.preview ? (
                              <PlayCircle className="size-4 shrink-0 text-gold" aria-hidden />
                            ) : (
                              <Lock className="size-4 shrink-0 text-orchid-faint" aria-hidden />
                            )}
                            <span className="min-w-0 flex-1 truncate text-[0.95rem] text-orchid">
                              {lesson.title}
                            </span>
                            {lesson.preview && (
                              <span className="text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-gold">
                                Free preview
                              </span>
                            )}
                            {lesson.durationMinutes > 0 && (
                              <span
                                className={cn(
                                  "flex shrink-0 items-center gap-1 text-xs text-orchid-faint",
                                )}
                              >
                                <Clock className="size-3" aria-hidden />
                                {lesson.durationMinutes}m
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </GlassCard>
                </RevealItem>
              ))}
            </RevealGroup>
          </Container>
        </Section>
      )}
    </>
  );
}
