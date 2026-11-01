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

/** The store presents the audit as a service and the letter as a download. */

/* ── Copy, verbatim from the live page ───────────────────────────────────── */

const EYEBROW = "The Boss Clinician Store";

const HEADLINE = "Build a smoother, more profitable practice with support!";

const SERVICES_HEADING = "SERVICES";

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
    name: "The Boardroom",
    price: "",
    // The mastermind's own page, where the application is. No checkout: the
    // Boardroom is by application and invitation.
    to: "/boardroom",
    image:
      "/images/migrated-840e01072ac7.png",
    accent: "gold",
  },
  {
    name: "Directory Makeover Audit",
    price: "",
    to: "/services/directory-makeover-audit",
    image: "/images/87e2e475b3ec.webp",
    accent: "plum",
  },
];

/* ── Structured data ─────────────────────────────────────────────────────── */

/** Price markup for the two service cards. */
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
      "@type": "Service",
      name: service.name,
      url: absoluteUrl(origin, service.to),
      image: absoluteUrl(origin, service.image),
      provider: { "@id": `${origin}/${ORGANIZATION_ID}` },
      ...(offer ? { offers: offer } : {}),
    };
  });
}

export default function Store() {
  const { origin } = useHeadContext();

  return (
    <>
      {/* Product images remain on their own cards. */}
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
        aria-label="Services"
      >
        {/* The live heading is a single all-caps line. Caps at the default
            SectionTitle scale would run to three lines on a phone, so the size
            is stepped down and the tracking opened instead. */}
        <SectionTitle
          title={SERVICES_HEADING}
          titleClassName="text-[1.5rem] tracking-[0.06em] sm:text-[2rem] sm:tracking-[0.08em] lg:text-[2.4rem]"
        />

        {/* Service cards share one responsive grid. */}
        <div className="mt-8 flex flex-wrap justify-center gap-4">
          <LuxeButton to="/courses" variant="outline">Explore Courses</LuxeButton>
          <LuxeButton to="/resources" variant="outline">Browse Free Resources</LuxeButton>
        </div>
        <RevealGroup
          as="ul"
          className="mx-auto mt-10 grid max-w-md list-none grid-cols-1 items-stretch gap-6 sm:max-w-xl sm:gap-7 lg:max-w-4xl lg:grid-cols-2"
        >
          {SERVICES.map((service) => (
            <RevealItem key={service.name} as="li" className="h-full">
              <ServiceCard service={service} />
            </RevealItem>
          ))}
        </RevealGroup>
      </Section>
      <Section surface="raised" space="md" aria-label="Downloads">
        <SectionTitle title="Downloads" body="Templates and tools to keep and use in your practice." />
        <div className="mx-auto mt-10 max-w-md">
          <ServiceCard service={{
            name: "Rate Negotiation Letter Template",
            price: "",
            to: "/downloads/rate-negotiation-letter-template",
            image: "/images/fb13cb030751.webp",
            accent: "green",
          }} />
        </div>
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
      {/* Cover, at full strength: no dimming grade, violet multiply or fading
          scrim (on the light theme the scrim was white and washed the plate
          out). It ends on a crisp hairline instead. The plate's only words are
          the service's name, which the heading beneath it already states, so
          it is decorative to a screen reader. */}
      <div className="relative aspect-[16/9] w-full overflow-hidden border-b border-hairline bg-night-deep">
        <img
          src={service.image}
          alt=""
          width={1280}
          height={720}
          loading="lazy"
          decoding="async"
          className={cn(
            "h-full w-full max-w-full object-cover",
            "transition-transform duration-700 ease-luxe group-hover:scale-[1.04]",
          )}
        />
        {/* Foil hairline along the join between plate and panel. */}
        <div
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-gold/60 to-transparent"
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

          {/* Offer prices are read on the detail page, so new cards cannot quote stale amounts. */}
          {service.price ? (
            <p className="relative mt-5">
              <span className="text-foil font-display text-[1.6rem] font-medium leading-none tracking-tight sm:text-[1.75rem]">
                {service.price}
              </span>
            </p>
          ) : (
            <p className="mt-5 text-sm text-orchid">See current options and prices</p>
          )}

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
