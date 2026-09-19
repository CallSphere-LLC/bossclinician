import { GlassCard, type Accent } from "@/components/luxe/GlassCard";
import { LuxeButton } from "@/components/luxe/LuxeButton";
import { LuxePageHero } from "@/components/luxe/LuxePageHero";
import { Section, SectionTitle } from "@/components/luxe/Section";
import { RevealGroup, RevealItem } from "@/components/ui/Reveal";
import { Seo } from "@/components/Seo";
import { cn } from "@/lib/cn";
import { ORGANIZATION_ID, absoluteUrl } from "@/seo/schema";
import type { JsonLdNode } from "@/seo/types";
import { useHeadContext } from "@/ssr/context";

/**
 * Store — the Obsidian Luxe rebuild of the .com's consulting storefront.
 *
 * The live page is deliberately short: a banner label, one promise, one
 * all-caps section heading, and three priced services. It is rebuilt at that
 * length rather than padded out — a storefront's job is to put the three
 * decisions on screen, and anything inserted between the promise and the grid
 * is scroll the buyer did not ask for.
 *
 * Every string below is reproduced verbatim from bossclinician.com/store,
 * prices included down to the "USD" suffix.
 *
 * The three actions are internal. They used to leave for the Kajabi offer pages
 * (bossclinician.com/offers/<token>), which after the domain cutover are this
 * app — and the redirect map sends those tokens back to /store, so each button
 * was a loop. None of the three services has an offer row here yet, so each
 * button goes to the application form; once an offer is published in the admin,
 * set the card's `to` to `/checkout/<offer-slug>`.
 */

/* ── Copy, verbatim from the live page ───────────────────────────────────── */

const EYEBROW = "The Boss Clinician Store";

const HEADLINE = "Build a smoother, more profitable practice with support!";

const SERVICES_HEADING = "THE BOSS BOARDROOM";

/**
 * Break the headline at its natural clause so the second half can be set in
 * foil italic on its own line. Splitting the source string rather than
 * retyping the halves keeps the sentence byte-identical to the live page —
 * only the space at the seam becomes a line break.
 */
function splitOnce(text: string, marker: string): [string, string | undefined] {
  const at = text.indexOf(marker);
  if (at < 0) return [text, undefined];
  return [text.slice(0, at), text.slice(at + 1)];
}

const [HERO_TITLE, HERO_ACCENT] = splitOnce(HEADLINE, " more profitable");

interface Service {
  name: string;
  price: string;
  /** Internal route. `/checkout/<offer-slug>` once the offer exists in the admin. */
  to: string;
  image: string;
  accent: Accent;
}

/**
 * Accent cycles green → plum → gold so three siblings read as a set rather
 * than as a good/better/best ladder: only the tint, hairline and hover glow
 * change, while geometry, type scale and CTA weight stay identical.
 */
const SERVICES: readonly Service[] = [
  {
    name: "The Boss Boardroom",
    price: "$12,000.00 USD",
    to: "/apply",
    image:
      "/images/migrated-840e01072ac7.png",
    accent: "gold",
  },
];

/* ── Structured data ─────────────────────────────────────────────────────── */

/**
 * The three services as priced products.
 *
 * A storefront that shows a price and a way to pay is a shopping result waiting
 * to happen, so each card is declared as a Product with the offer it carries.
 * The price is read out of the same string the card prints rather than restated
 * beside it, which is what stops the page and the markup quoting different
 * money; a line that does not parse contributes no Offer at all, because an
 * offer without a price is worse to a crawler than no offer.
 */
function offerNode(origin: string, service: Service): JsonLdNode | null {
  const match = /([\d,]+(?:\.\d{2})?)\s*([A-Z]{3})/.exec(service.price);
  if (!match) return null;

  return {
    "@type": "Offer",
    url: absoluteUrl(origin, service.to),
    price: match[1].replace(/,/g, ""),
    priceCurrency: match[2],
    availability: "https://schema.org/InStock",
    seller: { "@id": `${origin}/${ORGANIZATION_ID}` },
  };
}

function serviceNodes(origin: string): JsonLdNode[] {
  return SERVICES.map((service) => {
    const offer = offerNode(origin, service);

    return {
      "@type": "Product",
      name: service.name,
      // The storefront is where these three live until each has a checkout.
      url: absoluteUrl(origin, "/store"),
      image: absoluteUrl(origin, service.image),
      brand: { "@id": `${origin}/${ORGANIZATION_ID}` },
      ...(offer ? { offers: offer } : {}),
    };
  });
}

/**
 * The cover has to stop being a rectangle pasted onto the panel. Two passes do
 * that: a violet multiply that pulls bright brand whites into the page's
 * palette, then this scrim, whose bottom stop matches the composited glass so
 * the image dissolves into the card instead of ending at it.
 */
const COVER_SCRIM =
  "linear-gradient(to top, rgb(var(--c-night, 9 6 17) / 0.96) 0%, rgb(var(--c-night, 9 6 17) / 0.72) 18%, rgb(var(--c-night, 9 6 17) / 0.26) 46%, rgb(var(--c-night, 9 6 17) / 0) 76%)";

export default function Store() {
  const { origin } = useHeadContext();

  return (
    <>
      {/* No `image`: the hero is set in type, and the three covers below it are
          deliberately equal siblings, so promoting one of them to the share
          card would rank a set the page refuses to rank. */}
      <Seo
        title="Start Your Journey to a Profitable Private Practice"
        description="Discover how to launch and grow your profitable private therapy practice with expert guidance from Yvette. Get started today!"
        jsonLd={serviceNodes(origin)}
      />

      <LuxePageHero
        eyebrow={EYEBROW}
        title={HERO_TITLE}
        titleAccent={HERO_ACCENT}
        tone="violet"
        align="center"
      />

      <Section
        surface="base"
        space="md"
        aurora="mixed"
        auroraIntensity={0.55}
        aria-label="The Boss Boardroom"
      >
        {/* The live heading is a single all-caps line. Caps at the default
            SectionTitle scale would run to three lines on a phone, so the size
            is stepped down and the tracking opened instead. */}
        <SectionTitle
          title={SERVICES_HEADING}
          titleClassName="text-[1.5rem] tracking-[0.06em] sm:text-[2rem] sm:tracking-[0.08em] lg:text-[2.4rem]"
        />

        {/* Straight from one column to three: at 640px a half-width card is
            still a comfortable measure, but a 2-up grid of three items leaves
            an orphan, which reads as a missing fourth service. */}
        <div className="mt-8 flex flex-wrap justify-center gap-4">
          <LuxeButton to="/courses" variant="outline">Explore Courses</LuxeButton>
          <LuxeButton to="/resources" variant="outline">Browse Free Resources</LuxeButton>
        </div>
        <RevealGroup
          as="ul"
          className="mx-auto mt-10 grid max-w-md list-none grid-cols-1 items-stretch gap-6 sm:max-w-xl sm:gap-7 lg:max-w-xl"
        >
          {SERVICES.map((service) => (
            <RevealItem key={service.name} as="li" className="h-full">
              <ServiceCard service={service} />
            </RevealItem>
          ))}
        </RevealGroup>
      </Section>
    </>
  );
}

/* ── Card ─────────────────────────────────────────────────────────────────── */

function ServiceCard({ service }: { service: Service }) {
  return (
    <GlassCard
      as="article"
      accent={service.accent}
      className="group flex h-full flex-col overflow-hidden"
    >
      {/* Cover, graded down before it is composited so a bright brand plate
          sits *in* the near-black page instead of glowing on top of it. The
          plate's only words are the service's name, which the heading beneath
          it already states, so it is decorative to a screen reader. */}
      <div className="relative aspect-[16/9] w-full overflow-hidden bg-night-deep">
        <img
          src={service.image}
          alt=""
          width={1280}
          height={720}
          loading="lazy"
          decoding="async"
          className={cn(
            "h-full w-full max-w-full object-cover",
            "brightness-[0.8] contrast-[1.06] saturate-[0.8]",
            "transition-transform duration-700 ease-luxe group-hover:scale-[1.06]",
          )}
        />
        <div
          aria-hidden
          className="absolute inset-0 bg-glow-violet/40 mix-blend-multiply transition-opacity duration-700 ease-luxe group-hover:opacity-70"
        />
        <div aria-hidden className="absolute inset-0" style={{ background: COVER_SCRIM }} />
        {/* Foil hairline along the join between plate and panel — what stops
            the cover reading as a pasted-in box. */}
        <div
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-gold/45 to-transparent"
        />
      </div>

      <div className="flex flex-1 flex-col px-6 pb-6 pt-6 sm:px-7 sm:pb-7">
        <h3 className="text-balance font-display text-[1.3rem] font-medium leading-[1.28] text-white sm:text-[1.45rem]">
          {service.name}
        </h3>

        {/* mt-auto on the footer — not flex-1 on a wrapper — is what bottom
            -aligns price and action across cards whose names wrap to
            different depths. */}
        <div className="mt-auto pt-6">
          <div aria-hidden className="rule-faint w-full" />

          {/* The price is this section's one foil accent, so it gets a bloom
              behind it: flat foil reads dull at display size. */}
          <p className="relative mt-5">
            <span
              aria-hidden
              className="pointer-events-none absolute -left-6 -top-7 h-24 w-40 rounded-full blur-2xl"
              style={{
                background: "radial-gradient(circle, rgba(201,164,106,0.18) 0%, transparent 70%)",
              }}
            />
            <span className="text-foil relative font-display text-[1.6rem] font-medium leading-none tracking-tight sm:text-[1.75rem]">
              {service.price}
            </span>
          </p>

          <LuxeButton
            variant="glass"
            size="sm"
            to={service.to}
            className="mt-6 min-h-[44px] w-full tracking-[0.14em]"
          >
            Get Started
            <span className="sr-only"> with {service.name}</span>
          </LuxeButton>
        </div>
      </div>
    </GlassCard>
  );
}
