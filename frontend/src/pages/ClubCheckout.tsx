import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Check, Gift, Loader2, Lock, ShieldCheck } from "lucide-react";
import { Seo } from "@/components/Seo";
import { GlassCard } from "@/components/luxe/GlassCard";
import { LuxeButton } from "@/components/luxe/LuxeButton";
import { Section } from "@/components/luxe/Section";
import { stripeTestMode } from "@/components/checkout/stripeClient";
import { CLUB_OFFER_SLUG, clubCheckout } from "@/content/club";
import { commerceApi, commerceErrorMessage, type PublicOffer } from "@/lib/commerceApi";
import { CheckoutExperience } from "./Checkout";

/**
 * `/club/checkout` — the Club's own checkout, in place of Kajabi's hosted one
 * (www.bossclinician.com/offers/tzgjALKU/checkout), which every Join button on
 * /club used to leave the site for.
 *
 * It carries the source page's argument — the mockup, the headline, what is
 * included, the bonuses, the NBCC statement, the refund and security notes and
 * the service agreement — around the site's ordinary order form. The form is
 * `CheckoutExperience`, the same one `/checkout/:offerSlug` and the cart use:
 * payment options (pay in full / 6 monthly payments), Stripe, coupons, the
 * receipt and access grants all come from there, and every price comes from the
 * offer (`the-club`), never from this file.
 *
 * Client-rendered like every checkout: the offer is fetched after mount, so the
 * server render and first client render are the static copy plus a loading
 * line, and nothing here reads `window` while rendering.
 */
/**
 * The hero's mockup on the site's own charcoal. The source file
 * (`clubCheckout.image.src`, still the share image) sits on a flat slate
 * blue-green field that fought the plum and gold around it; this is the same
 * picture with only that field repainted, the devices and photos untouched.
 */
const HERO_MOCKUP_SRC = "/images/club/club-program-mockup-night.jpg";

export default function ClubCheckout() {
  const [offer, setOffer] = useState<PublicOffer | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    commerceApi
      .getOffer(CLUB_OFFER_SLUG)
      .then((result) => {
        if (!cancelled) setOffer(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(commerceErrorMessage(err, clubCheckout.unavailable.body));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // The order form prints its own headline and the offer's description. The
  // description is this page's copy again (one paragraph per line), which is
  // laid out properly around the form here, so the form gets a short headline
  // and no description rather than a second copy of everything above it.
  const formOffer = offer && { ...offer, checkoutHeadline: clubCheckout.formHeadline, description: "" };

  return (
    <>
      <Seo
        title={clubCheckout.seo.title}
        description={clubCheckout.seo.description}
        image={clubCheckout.image.src}
      />

      {/* 1 · The source's left column, opening lines: mockup, headline, promise. */}
      <Section surface="deep" space="md" aurora="mixed" auroraIntensity={0.5} seam={false} aria-label="The Club">
        <div className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-12">
          <GlassCard accent="gold" interactive={false} spotlight={false} className="overflow-hidden p-2">
            <img
              src={HERO_MOCKUP_SRC}
              alt={clubCheckout.image.alt}
              width={clubCheckout.image.width}
              height={clubCheckout.image.height}
              decoding="async"
              className="h-auto w-full max-w-full rounded-xl object-cover"
            />
          </GlassCard>
          <div className="min-w-0">
            <span className="eyebrow-luxe">{clubCheckout.eyebrow}</span>
            <h1 className="mt-3 text-balance font-display text-[2rem] font-normal leading-[1.12] text-white sm:text-[2.6rem] lg:text-[2.9rem]">
              {clubCheckout.title}
            </h1>
            <p className="copy-luxe mt-5 max-w-xl text-pretty text-[1.08rem] sm:text-[1.15rem]">
              {clubCheckout.subtitle}
            </p>
            <p className="mt-6 text-sm text-orchid-faint">
              <a href="#club-includes" className="text-gold underline underline-offset-4 hover:text-gold-bright">
                See everything included
              </a>
              <span aria-hidden className="mx-2">·</span>
              <Link to="/club" className="underline underline-offset-4 hover:text-white">
                Back to the Club
              </Link>
            </p>
          </div>
        </div>
      </Section>

      {/* 2 · The order form, with the service agreement it asks you to accept. */}
      <Section surface="deep" space="md" aria-label="Checkout">
        <div className="mx-auto max-w-6xl space-y-5">
          <GlassCard
            accent="gold"
            interactive={false}
            spotlight={false}
            className="p-5 sm:p-6"
          >
            <h2 id="enrollment-terms" className="text-sm font-semibold uppercase tracking-[0.14em] text-gold">
              {clubCheckout.agreement.title}
            </h2>
            <p className="mt-3 max-h-40 overflow-y-auto pr-2 text-sm leading-relaxed text-orchid">
              {clubCheckout.agreement.body}
            </p>
            <p className="mt-3 text-xs text-orchid-faint">{clubCheckout.agreement.note}</p>
          </GlassCard>

          {loadError !== null ? (
            <GlassCard accent="plum" interactive={false} className="mx-auto max-w-xl px-6 py-10 text-center sm:px-10">
              <h2 className="font-display text-[1.8rem] leading-tight text-white">{clubCheckout.unavailable.title}</h2>
              <p role="alert" className="copy-luxe mt-4">{loadError}</p>
              <div className="mt-8 flex flex-wrap justify-center gap-4">
                <LuxeButton variant="foil" to="/contact" className="min-h-[44px]">
                  Get in touch
                </LuxeButton>
                <LuxeButton variant="outline" to="/club" className="min-h-[44px]">
                  Back to the Club
                </LuxeButton>
              </div>
            </GlassCard>
          ) : formOffer === null ? (
            <div
              role="status"
              aria-live="polite"
              className="flex min-h-[30vh] items-center justify-center gap-3 text-orchid-dim"
            >
              <Loader2 aria-hidden className="h-5 w-5 animate-spin text-gold" />
              Opening your checkout…
            </div>
          ) : (
            <>
              {/* The same warning CheckoutShell shows on /checkout/:offerSlug. */}
              {stripeTestMode() && (
                <div role="status" className="rounded-xl border border-gold/40 bg-gold/10 px-5 py-4 text-center text-sm text-gold">
                  Test checkout — no real money will be charged. Use Stripe test card 4242 4242 4242 4242 with any future expiry and any three-digit CVC.
                </div>
              )}
              <CheckoutExperience offer={formOffer} />
            </>
          )}
        </div>
      </Section>

      {/* 3 · The rest of the source's left column: what is included, the bonuses. */}
      <Section id="club-includes" surface="base" space="lg" aria-label="What is included">
        <div className="mx-auto grid max-w-6xl grid-cols-1 gap-10 lg:grid-cols-2 lg:gap-14">
          <div className="min-w-0">
            <h2 className="text-balance font-display text-[1.6rem] leading-tight text-white sm:text-[1.9rem]">
              {clubCheckout.includesTitle}
            </h2>
            <ul className="mt-6 space-y-5">
              {clubCheckout.includes.map((item) => (
                <li key={item.title} className="flex gap-3.5">
                  <span
                    aria-hidden
                    className="mt-0.5 flex size-6 flex-none items-center justify-center rounded-full bg-green-bright/15 text-green-bright"
                  >
                    <Check className="size-3.5" />
                  </span>
                  <p className="copy-luxe min-w-0 text-pretty">
                    <strong className="font-semibold text-white">{item.title}</strong> - {item.body}
                  </p>
                </li>
              ))}
            </ul>
          </div>

          <div className="min-w-0">
            <h2 className="text-balance font-display text-[1.6rem] leading-tight text-white sm:text-[1.9rem]">
              {clubCheckout.bonusesTitle}
            </h2>
            <ul className="mt-6 space-y-4">
              {clubCheckout.bonuses.map((bonus) => (
                <li key={bonus.title}>
                  <GlassCard accent="gold" interactive={false} spotlight={false} className="p-5">
                    <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-gold">
                      <Gift aria-hidden className="size-4" />
                      {bonus.label}
                    </p>
                    <h3 className="mt-2 font-semibold text-white">{bonus.title}</h3>
                    <p className="copy-luxe mt-2 text-pretty text-sm">{bonus.body}</p>
                  </GlassCard>
                </li>
              ))}
            </ul>
          </div>
        </div>

      </Section>

      {/* 4 · The source's footer band: NBCC statement, refund and security notes. */}
      <Section surface="deep" space="md" aria-label="Policies">
        <div className="mx-auto grid max-w-6xl grid-cols-1 gap-8 lg:grid-cols-2 lg:gap-12">
          <p className="text-pretty text-sm leading-relaxed text-orchid-dim">{clubCheckout.nbcc}</p>
          <div className="space-y-6">
            <div className="flex gap-3.5">
              <ShieldCheck aria-hidden className="mt-0.5 size-5 flex-none text-gold" />
              <div className="min-w-0">
                <h2 className="font-semibold text-white">{clubCheckout.refund.title}</h2>
                <p className="mt-1.5 text-pretty text-sm leading-relaxed text-orchid">
                  {clubCheckout.refund.body}{" "}
                  <Link
                    to={clubCheckout.refund.link.to}
                    className="text-gold underline underline-offset-4 hover:text-gold-bright"
                  >
                    {clubCheckout.refund.link.label}
                  </Link>
                </p>
              </div>
            </div>
            <div className="flex gap-3.5">
              <Lock aria-hidden className="mt-0.5 size-5 flex-none text-gold" />
              <div className="min-w-0">
                <h2 className="font-semibold text-white">{clubCheckout.security.title}</h2>
                <p className="mt-1.5 text-pretty text-sm leading-relaxed text-orchid">{clubCheckout.security.body}</p>
              </div>
            </div>
          </div>
        </div>
      </Section>
    </>
  );
}
