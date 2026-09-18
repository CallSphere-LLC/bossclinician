import { addToCart, writeCart } from "@/lib/cart";
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { Elements, ExpressCheckoutElement, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import type { StripeElementsOptions, StripeExpressCheckoutElementConfirmEvent } from "@stripe/stripe-js";
import { motion, useReducedMotion } from "motion/react";
import { AlertCircle, Check, Loader2, ShieldCheck } from "lucide-react";
import { Seo } from "@/components/Seo";
import { GlassCard } from "@/components/luxe/GlassCard";
import { LuxeButton } from "@/components/luxe/LuxeButton";
import { Section } from "@/components/luxe/Section";
import { LuxeInput } from "@/components/luxe/LuxeField";
import { BillingAddressFields, EMPTY_ADDRESS, type AddressValue } from "@/components/checkout/BillingAddressFields";
import { CouponField } from "@/components/checkout/CouponField";
import { CHECKBOX_YES, CustomFieldInputs } from "@/components/checkout/CustomFieldInputs";
import { OrderBumps } from "@/components/checkout/OrderBumps";
import { OrderSummary } from "@/components/checkout/OrderSummary";
import { describeBilling } from "@/components/checkout/billingLanguage";
import { rememberReceipt, successPath } from "@/components/checkout/receipt";
import {
  appearanceForTheme,
  getStripe,
  paymentElementOptions,
  stripeConfigured,
} from "@/components/checkout/stripeClient";
import { useOfferQuote } from "@/components/checkout/useOfferQuote";
import { useMember } from "@/hooks/useMember";
import { useSiteTheme } from "@/lib/siteTheme";
import {
  commerceApi,
  commerceErrorMessage,
  type CheckoutInput,
  type CheckoutResult,
  type PublicOffer,
  type PublicPricingOption,
} from "@/lib/commerceApi";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/cn";
import { api } from "@/lib/api";
import { checkoutButtonStyle } from "@/components/checkout/checkoutStyle";

const EASE_LUXE: [number, number, number, number] = [0.22, 1, 0.36, 1];

/** Deliberately permissive. The server owns the real rule; this catches typos. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * `/checkout/:offerSlug` — the page the whole business runs through.
 *
 * One page, one form, no hosted redirect: the Payment Element renders card,
 * Apple Pay, Google Pay and the 3DS challenge in place, which is what makes
 * order bumps and one-click upsells possible at all.
 *
 * Two rules shape everything below.
 *
 * The first is that this page never decides what anything costs. Every figure
 * comes from `/quote` or from the checkout response, both of which run the same
 * server-side arithmetic the charge itself uses. A total assembled in the
 * browser would eventually disagree with the one Stripe is handed, and the
 * customer would be the one to find out.
 *
 * The second is that the commitment is stated in words before the button, not
 * only in figures. Someone who believes they are paying $1,250 and then watches
 * $3,750 leave their account over three months does not file a support ticket.
 * They file a chargeback.
 */
export default function Checkout() {
  const { offerSlug = "" } = useParams<{ offerSlug: string }>();
  const [offer, setOffer] = useState<PublicOffer | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setOffer(null);
    setLoadError(null);

    commerceApi
      .getOffer(offerSlug)
      .then((result) => {
        if (!cancelled) setOffer(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setLoadError(
            commerceErrorMessage(err, "We couldn't open this checkout. Please try again.")
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [offerSlug]);

  if (loadError !== null) {
    return (
      <>
        <Seo title="Checkout - Boss Clinician" />
        <CheckoutShell>
          <GlassCard
            accent="plum"
            interactive={false}
            className="mx-auto max-w-xl px-6 py-10 text-center sm:px-10"
          >
            <h1 className="font-display text-[1.8rem] leading-tight text-white">
              This checkout isn't available
            </h1>
            <p className="copy-luxe mt-4">{loadError}</p>
            <div className="mt-8 flex flex-wrap justify-center gap-4">
              <LuxeButton variant="foil" to="/courses" className="min-h-[44px]">
                Browse the courses
              </LuxeButton>
              <LuxeButton variant="outline" to="/contact" className="min-h-[44px]">
                Get in touch
              </LuxeButton>
            </div>
          </GlassCard>
        </CheckoutShell>
      </>
    );
  }

  if (offer === null) {
    return (
      <>
        <Seo title="Checkout - Boss Clinician" />
        <CheckoutShell>
          <div
            role="status"
            aria-live="polite"
            className="flex min-h-[40vh] items-center justify-center gap-3 text-orchid-dim"
          >
            <Loader2 aria-hidden className="h-5 w-5 animate-spin text-gold" />
            Opening your checkout…
          </div>
        </CheckoutShell>
      </>
    );
  }

  return (
    <>
      <Seo
        title={`${offer.title} - Checkout - Boss Clinician`}
        description={offer.description || `Complete your order for ${offer.title}.`}
      />
      <CheckoutShell>
        <CheckoutExperience offer={offer} />
      </CheckoutShell>
    </>
  );
}

function CheckoutShell({ children }: { children: ReactNode }) {
  // This route is declared outside `Layout`, which is what normally supplies
  // `theme-luxe`. Without that ancestor none of the themed colour variables —
  // dark or light — reach the page, so the shell carries the class itself.
  return (
    <div className="theme-luxe flex min-h-screen flex-col bg-night-deep">
      <Section
        surface="deep"
        space="md"
        aurora="mixed"
        auroraIntensity={0.6}
        seam={false}
        aria-label="Checkout"
      >
        {children}
      </Section>
    </div>
  );
}

/* ── Stripe context ─────────────────────────────────────────────────────── */

type ElementsMode = "payment" | "subscription" | "setup";

/**
 * Which kind of Stripe object this offer will end up creating.
 *
 * Fixed for the life of the page, and deliberately so: the Elements instance
 * cannot change mode without being torn down, and tearing it down in the middle
 * of a checkout would empty the card field the buyer had already filled in.
 */
function elementsModeFor(offer: PublicOffer): ElementsMode {
  const { pricingType, trialDays } = offer.billing;
  if (pricingType !== "subscription" && pricingType !== "payment_plan") return "payment";
  // A trial has nothing to charge today, so Stripe hands back a SetupIntent and
  // the Element collects a card rather than a payment.
  return trialDays > 0 ? "setup" : "subscription";
}

/**
 * Holds the amount the Payment Element is showing, which the form below reports
 * up whenever the quote changes.
 *
 * It lives here rather than inside the form because `Elements` needs it as an
 * option, and the form needs `useStripe`/`useElements`, which only exist inside
 * `Elements`.
 */
export function CheckoutExperience({ offer }: { offer: PublicOffer }) {
  const [pricingOptionId, setPricingOptionId] = useState<number | null>(offer.selectedPricingOptionId);
  const selectedPricing = offer.pricingOptions.find((option) => option.id === pricingOptionId)
    ?? offer.pricingOptions[0];
  const pricedOffer = useMemo(
    () => ({ ...offer, currency: selectedPricing.currency, amountCents: selectedPricing.amountCents, billing: selectedPricing.billing, quote: selectedPricing.quote }),
    [offer, selectedPricing],
  );
  const mode = useMemo(() => elementsModeFor(pricedOffer), [pricedOffer]);
  const [amountCents, setAmountCents] = useState(selectedPricing.quote.totalCents);
  const stripePromise = useMemo(() => getStripe(), []);
  // The Payment Element is an iframe, so the site theme has to be handed to it.
  // `<Elements>` forwards a changed `appearance` through `elements.update`, so a
  // theme toggle repaints the card field without remounting (and emptying) it.
  const siteTheme = useSiteTheme();

  useEffect(() => setAmountCents(selectedPricing.quote.totalCents), [selectedPricing]);

  function choosePricingOption(option: PublicPricingOption) {
    setAmountCents(option.quote.totalCents);
    setPricingOptionId(option.id);
  }

  const options = useMemo<StripeElementsOptions>(() => {
    const currency = (selectedPricing.currency || "usd").toLowerCase();
    const appearance = appearanceForTheme(siteTheme);
    if (mode === "setup") {
      return { mode: "setup", currency, setupFutureUsage: "off_session", appearance };
    }
    if (mode === "subscription") {
      return { mode: "subscription", currency, amount: Math.max(amountCents, 1), appearance };
    }
    return {
      mode: "payment",
      currency,
      // Stripe rejects a zero amount, and a fully discounted order never reaches
      // confirmation anyway — the server settles it without a charge.
      amount: Math.max(amountCents, 1),
      // Mirrors what the server puts on the PaymentIntent. A mismatch here is
      // refused at confirmation time, and keeping the card on file is what makes
      // the upsell one click instead of a second card entry.
      setupFutureUsage: "off_session",
      appearance,
    };
  }, [mode, amountCents, selectedPricing.currency, siteTheme]);

  return (
    <div className="space-y-5">
      {offer.pricingOptions.length > 1 && (
        <GlassCard accent="plum" interactive={false} className="mx-auto max-w-5xl p-4 sm:p-5">
          <fieldset>
            <legend className="px-1 text-sm font-semibold text-white">Choose how you would like to pay</legend>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {offer.pricingOptions.map((option) => {
                const selected = option.id === pricingOptionId;
                return (
                  <label key={option.id ?? "base"} className={cn(
                    "flex min-h-16 cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 transition-colors",
                    selected ? "border-gold bg-gold/10" : "border-white/10 bg-white/[0.02] hover:border-white/25",
                  )}>
                    <input type="radio" name="pricing-option" checked={selected} onChange={() => choosePricingOption(option)} className="size-4 accent-[#c9a46a]" />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1 font-semibold text-white">
                        {option.label}
                        {option.recommended && <span className="rounded-full bg-gold/15 px-2 py-0.5 text-[0.65rem] uppercase tracking-wide text-gold">Recommended</span>}
                      </span>
                      <span className="mt-0.5 block text-sm text-orchid-faint">
                        {(() => {
                          const words = describeBilling({ billing: option.billing, amountCents: option.amountCents, currency: option.currency, coupon: null, hasBumps: false });
                          return words.commitment || words.detail || words.badge;
                        })()}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        </GlassCard>
      )}
      <Elements key={`${pricingOptionId ?? "base"}:${mode}`} stripe={stripePromise} options={options}>
        <CheckoutForm offer={pricedOffer} pricingOption={selectedPricing} mode={mode} onAmountChange={setAmountCents} />
      </Elements>
    </div>
  );
}

/* ── The form ───────────────────────────────────────────────────────────── */

interface CheckoutFormProps {
  offer: PublicOffer;
  pricingOption: PublicPricingOption;
  mode: ElementsMode;
  onAmountChange: (cents: number) => void;
}

function CheckoutForm({ offer, pricingOption, mode, onAmountChange }: CheckoutFormProps) {
  const navigate = useNavigate();
  const stripe = useStripe();
  const elements = useElements();
  const { member } = useMember();
  const reduce = useReducedMotion();

  const { orderForm, billing } = offer;
  const currency = offer.currency || "usd";

  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [isGift, setIsGift] = useState(false);
  const [giftRecipientEmail, setGiftRecipientEmail] = useState("");
  const [giftMessage, setGiftMessage] = useState("");
  const [checkoutSettings, setCheckoutSettings] = useState<Record<string, unknown>>({});
  useEffect(() => { void api.settings().then(settings => setCheckoutSettings((settings.checkout ?? {}) as Record<string, unknown>)).catch(() => undefined); }, []);
  const [address, setAddress] = useState<AddressValue>(EMPTY_ADDRESS);
  const [customValues, setCustomValues] = useState<Record<string, string>>({});
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [couponCode, setCouponCode] = useState(offer.initialCouponCode ?? "");
  const [selectedBumps, setSelectedBumps] = useState<number[]>([]);
  const [pwywInput, setPwywInput] = useState(() =>
    billing.pricingType === "pwyw" ? centsToInput(billing.minAmountCents ?? 0) : ""
  );

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [customErrors, setCustomErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [formNotice, setFormNotice] = useState<string | null>(null);

  // A signed-in buyer's own address is what the server will bill against
  // whatever the form says, so the field shows it rather than pretending to
  // accept another one.
  const signedInEmail = member?.email ?? "";
  useEffect(() => {
    if (signedInEmail) setEmail(signedInEmail);
  }, [signedInEmail]);
  useEffect(() => {
    if (member?.name) setName((current) => (current === "" ? member.name : current));
  }, [member?.name]);

  const pwywAmountCents = billing.pricingType === "pwyw" ? inputToCents(pwywInput) : undefined;

  const quoteState = useOfferQuote(offer.slug, offer.quote, {
    cartItems: offer.cartItems,
    pricingOptionId: pricingOption.id,
    couponCode,
    bumpProductIds: selectedBumps,
    pwywAmountCents,
    taxAddress: orderForm.collectTax
      ? { country: address.country, state: address.state, postalCode: address.postalCode }
      : undefined,
  });

  const { quote } = quoteState;
  const recurring = billing.pricingType === "subscription" || billing.pricingType === "payment_plan";
  const paymentRequired = recurring || quote.totalCents > 0;
  const paymentUnavailable = paymentRequired && !stripeConfigured();

  const wording = useMemo(
    () =>
      describeBilling({
        billing,
        amountCents: offer.amountCents,
        currency,
        coupon: quoteState.coupon,
        hasBumps: selectedBumps.length > 0,
      }),
    [billing, offer.amountCents, currency, quoteState.coupon, selectedBumps.length]
  );

  useEffect(() => {
    onAmountChange(quote.totalCents);
  }, [quote.totalCents, onAmountChange]);

  /* ---- abandoned capture ---- */

  const captured = useRef(false);
  function captureEmail() {
    const value = email.trim();
    if (captured.current || !EMAIL_PATTERN.test(value)) return;
    captured.current = true;
    // Fire and forget, in every sense: it cannot reject, and nothing waits on it.
    for (const item of offer.cartItems ?? [{slug:offer.slug}]) void commerceApi.captureAbandoned(item.slug, value, name.trim().split(/\s+/)[0] || undefined);
  }

  /* ---- editing ---- */

  const locked = submitting;

  function toggleBump(productId: number) {
    setSelectedBumps((current) =>
      current.includes(productId)
        ? current.filter((id) => id !== productId)
        : [...current, productId]
    );
  }

  function setCustomValue(key: string, value: string) {
    setCustomValues((current) => ({ ...current, [key]: value }));
    setCustomErrors((current) => (current[key] ? { ...current, [key]: "" } : current));
  }

  /* ---- validation ---- */

  function validate(): boolean {
    const next: Record<string, string> = {};
    const nextCustom: Record<string, string> = {};

    if (!EMAIL_PATTERN.test(email.trim())) {
      next.email = "Enter the email address your access should go to.";
    }
    if (isGift && !EMAIL_PATTERN.test(giftRecipientEmail.trim())) next.giftRecipientEmail = "Enter the recipient's email address.";
    if (name.trim() === "") {
      next.name = "Enter your name.";
    }
    if (orderForm.collectPhone && phone.trim() === "") {
      next.phone = "Enter a phone number.";
    }
    if (orderForm.collectAddress) {
      if (address.line1.trim() === "") next.line1 = "Enter your street address.";
      if (address.country.trim() === "") next.country = "Choose your country.";
    }
    if (orderForm.requireTerms && !acceptedTerms) {
      next.terms = "Please accept the terms to continue.";
    }
    if (billing.pricingType === "pwyw") {
      const minimum = billing.minAmountCents ?? 0;
      if (pwywAmountCents === undefined) {
        next.pwyw = "Enter the amount you'd like to pay.";
      } else if (pwywAmountCents < minimum) {
        next.pwyw = `The minimum for this one is ${formatCurrency(minimum, currency)}.`;
      }
    }
    for (const field of orderForm.customFields) {
      if (!field.required) continue;
      const value = (customValues[field.key] ?? "").trim();
      if (value === "" || (field.type === "checkbox" && value !== CHECKBOX_YES)) {
        nextCustom[field.key] = `${field.label || field.key} is required.`;
      }
    }

    setErrors(next);
    setCustomErrors(nextCustom);
    return Object.keys(next).length === 0 && Object.keys(nextCustom).length === 0;
  }

  /* ---- submission ---- */

  const payload: CheckoutInput = {
    cartItems: offer.cartItems,
    pricingOptionId: pricingOption.id,
    email: email.trim(),
    name: name.trim(),
    ...(isGift && !recurring ? { giftRecipientEmail: giftRecipientEmail.trim(), giftMessage: giftMessage.trim() } : {}),
    ...(orderForm.collectPhone || phone.trim() ? { phone: phone.trim() } : {}),
    ...(orderForm.collectAddress
      ? {
          address: {
            line1: address.line1.trim(),
            ...(address.line2.trim() ? { line2: address.line2.trim() } : {}),
            ...(address.city.trim() ? { city: address.city.trim() } : {}),
            ...(address.state.trim() ? { state: address.state.trim() } : {}),
            ...(address.postalCode.trim() ? { postalCode: address.postalCode.trim() } : {}),
            country: address.country.trim(),
          },
        }
      : {}),
    ...(orderForm.customFields.length > 0 ? { customFields: collectAnswers(customValues) } : {}),
    ...(couponCode.trim() ? { couponCode: couponCode.trim() } : {}),
    ...(selectedBumps.length > 0 ? { bumpProductIds: selectedBumps } : {}),
    ...(pwywAmountCents !== undefined ? { pwywAmountCents } : {}),
    ...(orderForm.requireTerms ? { acceptedTerms } : {}),
  };

  /**
   * The order already opened for exactly this basket.
   *
   * A declined card leaves a usable PaymentIntent behind, so a second attempt
   * confirms the same one rather than opening a second order and a second charge
   * against the customer's bank.
   */
  const opened = useRef<{ signature: string; result: CheckoutResult } | null>(null);
  const signature = JSON.stringify([payload, quote.totalCents]);

  async function handleSubmit(event?: FormEvent<HTMLFormElement>, wallet?: StripeExpressCheckoutElementConfirmEvent) {
    event?.preventDefault();
    if (submitting) { wallet?.paymentFailed({reason:"fail"}); return; }

    if (quoteState.pending || quoteState.error) {
      setFormNotice(quoteState.error || "One moment — we're updating your total.");
      wallet?.paymentFailed({reason:"fail"});
      return;
    }
    setFormNotice(null);
    setPaymentError(null);

    if (!validate()) {
      setFormNotice("Please check the highlighted fields and try again.");
      return;
    }

    setSubmitting(true);
    try {
      if (paymentRequired) {
        if (!stripe || !elements) {
          setPaymentError("The payment form is still loading. Give it a second and try again.");
          return;
        }
        // Deferred confirmation: the Element has to validate and tokenise before
        // the server is asked to create anything, or a declined card leaves an
        // order behind for a payment that was never attempted.
        const submitted = await elements.submit();
        if (submitted.error) {
          setPaymentError(submitted.error.message ?? "Please check your payment details.");
          return;
        }
      }

      let checkout = opened.current?.signature === signature ? opened.current.result : null;
      if (!checkout) {
        checkout = await commerceApi.createCheckout(offer.slug, payload);
        opened.current = { signature, result: checkout };
      }

      if (checkout.requiresPayment && checkout.clientSecret) {
        if (!stripe || !elements) {
          setPaymentError("The payment form is still loading. Give it a second and try again.");
          return;
        }

        const confirmParams = {
          return_url: `${window.location.origin}${successPath(checkout)}`,
          payment_method_data: {
            billing_details: {
              name: payload.name,
              email: payload.email,
              ...(payload.phone ? { phone: payload.phone } : {}),
              ...(payload.address
                ? {
                    address: {
                      line1: payload.address.line1 ?? "",
                      line2: payload.address.line2 ?? "",
                      city: payload.address.city ?? "",
                      state: payload.address.state ?? "",
                      postal_code: payload.address.postalCode ?? "",
                      country: payload.address.country ?? "",
                    },
                  }
                : {}),
            },
          },
        };

        const outcome =
          checkout.clientSecretType === "setup_intent"
            ? await stripe.confirmSetup({
                elements,
                clientSecret: checkout.clientSecret,
                confirmParams,
                redirect: "if_required",
              })
            : await stripe.confirmPayment({
                elements,
                clientSecret: checkout.clientSecret,
                confirmParams,
                redirect: "if_required",
              });

        if (outcome.error) {
          // The order stays open on purpose, so trying a different card is a
          // second attempt at the same purchase rather than a second purchase.
          setPaymentError(
            outcome.error.message ??
              "That payment didn't go through. Please check your card details or try another card."
          );
          return;
        }
      }

      wallet = undefined;
      if (offer.cartItems) writeCart([]);
      finish(checkout);
    } catch (err) {
      setPaymentError(commerceErrorMessage(err));
    } finally {
      wallet?.paymentFailed({ reason: "fail" });
      setSubmitting(false);
    }
  }

  function finish(checkout: CheckoutResult) {
    const receipt = { orderId: checkout.orderId, orderToken: checkout.orderToken };
    rememberReceipt(offer.slug, receipt);

    const firstUpsell = offer.upsells[0];
    if (firstUpsell) {
      navigate(`/checkout/${offer.slug}/upsell/${firstUpsell.step}`, { state: receipt });
      return;
    }
    // An offer can name its own thank-you page, which is often somewhere else
    // entirely — a community invite, a booking link, a members' area.
    if (offer.redirectUrl) {
      window.location.assign(offer.redirectUrl);
      return;
    }
    navigate(successPath(receipt));
  }

  /* ---- render ---- */

  const buttonLabel = submitting
    ? "Processing…"
    : !paymentRequired
      ? "Get instant access"
      : wording.nothingDueToday
        ? "Start my free trial"
        : `Pay ${quote.formatted.total}`;

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_25rem] lg:items-start lg:gap-12">
      {/* The summary leads on a phone, where it is collapsed to a single line,
          and sits beside the form on a desktop. */}
      <motion.aside
        initial={reduce ? false : { opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: EASE_LUXE }}
        className="order-1 lg:order-2"
        aria-label="Order summary"
      >
        <OrderSummary offer={offer} state={quoteState} wording={wording} />
      </motion.aside>

      <motion.div
        initial={reduce ? false : { opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: reduce ? 0 : 0.08, ease: EASE_LUXE }}
        className="order-2 min-w-0 lg:order-1"
      >
        <span className="eyebrow-luxe">Secure checkout</span>
        <h1 className="text-balance font-display text-[1.9rem] font-normal leading-[1.14] text-white sm:text-[2.5rem]">
          {offer.checkoutHeadline || offer.title}
        </h1>
        {offer.description && <p className="copy-luxe mt-4 max-w-xl text-pretty">{offer.description}</p>}
        {!offer.cartItems && ["one_time","free"].includes(billing.pricingType) && <div className="mt-4 flex flex-wrap gap-4 text-sm text-gold">
          <button type="button" className="underline underline-offset-4" onClick={()=>{addToCart({slug:offer.slug,pricingOptionId:pricingOption.id,bumpProductIds:selectedBumps});navigate('/cart');}}>Add to cart</button>
          <Link to="/cart" className="underline underline-offset-4">View cart</Link>
        </div>}
        {offer.cartItems && <Link to="/cart" onClick={()=>window.location.assign('/cart')} className="mt-4 inline-block text-sm text-gold underline">Edit cart</Link>}


        {offer.alreadyOwned && (
          <Notice tone="gold" className="mt-6">
            You already have access to this.{" "}
            <Link to="/account/purchases" className="underline underline-offset-4 hover:text-white">
              Open it from your account
            </Link>{" "}
            rather than buying it again.
          </Notice>
        )}

        {paymentUnavailable && (
          <Notice tone="bad" className="mt-6">
            Card payments aren't switched on yet, so this order can't be completed right now.{" "}
            <Link to="/contact" className="underline underline-offset-4 hover:text-white">
              Let us know
            </Link>{" "}
            and we'll sort it out.
          </Notice>
        )}

        <form onSubmit={handleSubmit} noValidate className="mt-8 space-y-8">
          <Fieldset legend="Your details">
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <LuxeInput
                label="Email address"
                type="email"
                required
                inputMode="email"
                autoComplete="email"
                wrapperClassName="sm:col-span-2"
                value={email}
                error={errors.email}
                disabled={locked || signedInEmail !== ""}
                hint={
                  signedInEmail !== ""
                    ? "You're signed in, so your order goes to this address."
                    : "Your receipt and access details go here."
                }
                onChange={(e) => setEmail(e.target.value)}
                onBlur={captureEmail}
              />
              <LuxeInput
                label="Full name"
                required
                autoComplete="name"
                wrapperClassName="sm:col-span-2"
                value={name}
                error={errors.name}
                disabled={locked}
                onChange={(e) => setName(e.target.value)}
              />
              {orderForm.collectPhone && (
                <LuxeInput
                  label="Phone number"
                  type="tel"
                  required
                  inputMode="tel"
                  autoComplete="tel"
                  wrapperClassName="sm:col-span-2"
                  value={phone}
                  error={errors.phone}
                  disabled={locked}
                  onChange={(e) => setPhone(e.target.value)}
                />
              )}
            </div>

            {orderForm.collectAddress && (
              <div className="mt-6">
                <p className="mb-4 text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-orchid-dim">
                  Billing address
                </p>
                <BillingAddressFields
                  value={address}
                  errors={errors}
                  disabled={locked}
                  onChange={(patch) => setAddress((current) => ({ ...current, ...patch }))}
                />
              </div>
            )}
          </Fieldset>

          {orderForm.allowGifting !== false && !recurring && <Fieldset legend="Send as a gift">
            <label className="flex items-center gap-3 text-sm text-orchid"><input type="checkbox" checked={isGift} disabled={locked} onChange={e => setIsGift(e.target.checked)} />Buy this for someone else</label>
            {isGift && <div className="mt-4 space-y-4">
              <LuxeInput label="Recipient's email" type="email" required value={giftRecipientEmail} error={errors.giftRecipientEmail} disabled={locked} onChange={e => setGiftRecipientEmail(e.target.value)} hint="They receive access after payment. Your receipt stays with you." />
              <label className="block text-sm text-orchid">Gift message (optional)<textarea value={giftMessage} maxLength={2000} disabled={locked} onChange={e => setGiftMessage(e.target.value)} className="mt-2 min-h-24 w-full rounded-lg border border-white/20 bg-white/5 p-3" /></label>
            </div>}
          </Fieldset>}

          {orderForm.customFields.length > 0 && (
            <Fieldset legend="A few questions">
              <CustomFieldInputs
                fields={orderForm.customFields}
                values={customValues}
                errors={customErrors}
                disabled={locked}
                onChange={setCustomValue}
              />
            </Fieldset>
          )}

          {offer.bumps.length > 0 && (
            <Fieldset legend="Add these too">
              <OrderBumps
                bumps={offer.bumps}
                selected={selectedBumps}
                disabled={locked}
                onToggle={toggleBump}
              />
            </Fieldset>
          )}

          <Fieldset legend={paymentRequired ? "Payment" : "Finish up"}>
            <div className="space-y-6">
              {billing.pricingType === "pwyw" && (
                <LuxeInput
                  label="What would you like to pay?"
                  type="number"
                  inputMode="decimal"
                  min={((billing.minAmountCents ?? 0) / 100).toString()}
                  step="0.01"
                  value={pwywInput}
                  error={errors.pwyw}
                  disabled={locked}
                  hint={
                    billing.minAmountCents && billing.minAmountCents > 0
                      ? `The minimum is ${formatCurrency(billing.minAmountCents, currency)}.`
                      : undefined
                  }
                  onChange={(e) => setPwywInput(e.target.value)}
                />
              )}

              {checkoutSettings.showCoupons !== false && <CouponField
                value={couponCode}
                onChange={setCouponCode}
                pending={quoteState.pending}
                applied={quoteState.coupon}
                error={quoteState.couponError}
                discount={quote.discountCents > 0 ? quote.formatted.discount : null}
                disabled={locked}
              />}

              {paymentRequired ? (
                stripeConfigured() && (
                  <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 sm:p-5">
                    <ExpressCheckoutElement
                      options={{buttonHeight: 48, layout: {maxColumns: 2, maxRows: 2}, paymentMethods: {applePay: "auto", googlePay: "auto"}}}
                      onClick={(event) => {
                        if (submitting || quoteState.pending || !validate()) {
                          setFormNotice("Complete your details and accept any required terms before opening your wallet.");
                          event.reject();
                        } else event.resolve();
                      }}
                      onConfirm={(event) => { void handleSubmit(undefined, event); }}
                    />
                    <PaymentElement
                      options={paymentElementOptions(orderForm.collectAddress)}
                      onChange={() => setPaymentError(null)}
                    />
                    {mode === "setup" && (
                      <p className="mt-4 text-xs leading-relaxed text-orchid-faint">
                        Your card is saved now and charged when the trial ends.
                      </p>
                    )}
                  </div>
                )
              ) : (
                <Notice tone="gold">
                  There's nothing to pay — finish below and your access is granted straight away.
                </Notice>
              )}

              {offer.cartTerms && offer.cartTerms.length > 0 && <ul className="space-y-2 text-sm text-orchid">
                {offer.cartTerms.map((term,i)=><li key={i}><a className="underline" href={term.url || "/terms"} target="_blank" rel="noreferrer">{term.title}: terms</a></li>)}
              </ul>}
              {orderForm.requireTerms && (
                <TermsCheckbox
                  checked={acceptedTerms}
                  termsUrl={orderForm.termsUrl}
                  error={errors.terms}
                  disabled={locked}
                  onChange={(value) => {
                    setAcceptedTerms(value);
                    if (value) setErrors((current) => ({ ...current, terms: "" }));
                  }}
                />
              )}
            </div>
          </Fieldset>

          {(paymentError || formNotice) && (
            <div role="alert" className="flex items-start gap-3 rounded-xl border border-red-400/40 bg-red-500/[0.08] px-4 py-3.5">
              <AlertCircle aria-hidden className="mt-0.5 h-4 w-4 flex-none text-red-400" />
              <p className="text-sm leading-relaxed text-red-200">{paymentError ?? formNotice}</p>
            </div>
          )}

          <div>
            <LuxeButton
              variant="foil"
              size="lg"
              type="submit"
              disabled={submitting || paymentUnavailable}
              className="w-full min-h-[52px]"
              style={checkoutButtonStyle(checkoutSettings)}
            >
              {submitting && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}
              {buttonLabel}
            </LuxeButton>

            {typeof checkoutSettings.termsUrl === "string" && /^https?:\/\//.test(checkoutSettings.termsUrl) && <p className="mt-3 text-center text-xs text-orchid"><a href={checkoutSettings.termsUrl} target="_blank" rel="noreferrer">Terms and conditions</a></p>}
            {/* The commitment restated at the point of no return, because this is
                where someone actually reads it. */}
            {wording.commitment && (
              <p className="mt-4 text-center text-sm leading-relaxed text-orchid">
                {wording.commitment}
              </p>
            )}

            <p className="mt-3 flex items-center justify-center gap-2 text-xs text-orchid-faint">
              <ShieldCheck aria-hidden className="h-3.5 w-3.5" />
              Secured by Stripe. {typeof checkoutSettings.supportEmail === "string" && checkoutSettings.supportEmail ? <a href={`mailto:${checkoutSettings.supportEmail}`}>Questions? Email us.</a> : "Questions before you buy? We're one email away."}
            </p>

            <p aria-live="polite" className="sr-only">
              {submitting ? "Processing your payment." : ""}
            </p>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

/* ── Small pieces ───────────────────────────────────────────────────────── */

function Fieldset({ legend, children }: { legend: string; children: ReactNode }) {
  return (
    <fieldset className="min-w-0 border-0 p-0">
      <legend className="mb-5 font-display text-xl text-white">{legend}</legend>
      {children}
    </fieldset>
  );
}

function Notice({
  tone,
  className,
  children,
}: {
  tone: "gold" | "bad";
  className?: string;
  children: ReactNode;
}) {
  return (
    <p
      className={cn(
        "rounded-xl border px-4 py-3.5 text-sm leading-relaxed",
        tone === "gold"
          ? "border-gold/30 bg-gold/[0.07] text-gold-bright"
          : "border-red-400/40 bg-red-500/[0.08] text-red-200",
        className,
      )}
    >
      {children}
    </p>
  );
}

function TermsCheckbox({
  checked,
  termsUrl,
  error,
  disabled,
  onChange,
}: {
  checked: boolean;
  termsUrl: string;
  error?: string;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div>
      <label
        className={cn(
          "flex min-h-[2.75rem] cursor-pointer items-start gap-3",
          disabled && "cursor-not-allowed opacity-60",
        )}
      >
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          onChange={(e) => onChange(e.target.checked)}
          className="sr-only"
        />
        <span
          aria-hidden
          className={cn(
            "mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-md border transition-colors duration-300 ease-luxe",
            checked
              ? "border-gold bg-gold-foil text-night-deep"
              : error
                ? "border-red-400/60"
                : "border-white/25",
          )}
        >
          {checked && <Check className="h-4 w-4" />}
        </span>
        <span className="text-sm leading-relaxed text-orchid">
          I agree to the{" "}
          {termsUrl ? (
            <a
              href={termsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-gold underline underline-offset-4 hover:text-gold-bright"
            >
              terms of this purchase
            </a>
          ) : (
            <Link
              to="/terms"
              className="text-gold underline underline-offset-4 hover:text-gold-bright"
            >
              terms of this purchase
            </Link>
          )}
          .
        </span>
      </label>
      {error && (
        <p role="alert" className="mt-1 text-xs font-medium text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}

/* ── Helpers ────────────────────────────────────────────────────────────── */

/** Only the questions that were answered; the server keeps what it asked for. */
function collectAnswers(values: Record<string, string>): Record<string, string> {
  const answers: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    const trimmed = value.trim();
    if (trimmed !== "") answers[key] = trimmed;
  }
  return answers;
}

function centsToInput(cents: number): string {
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
}

/**
 * Dollars typed into a box, as integer cents.
 *
 * Parsing, not pricing — the floor is enforced by the server, which is the only
 * place that decides what a pay-what-you-want offer will actually accept.
 */
function inputToCents(value: string): number | undefined {
  const trimmed = value.trim();
  if (trimmed === "") return undefined;
  const dollars = Number(trimmed);
  if (!Number.isFinite(dollars) || dollars < 0) return undefined;
  return Math.round(dollars * 100);
}
