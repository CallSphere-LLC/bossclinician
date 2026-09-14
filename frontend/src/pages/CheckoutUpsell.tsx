import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import { motion, useReducedMotion } from "motion/react";
import { AlertCircle, Check, Loader2 } from "lucide-react";
import { Seo } from "@/components/Seo";
import { GlassCard } from "@/components/luxe/GlassCard";
import { LuxeButton, LuxePill } from "@/components/luxe/LuxeButton";
import { GoldRule, Section } from "@/components/luxe/Section";
import {
  forgetReceipt,
  recallReceipt,
  successPath,
  type CheckoutReceipt,
} from "@/components/checkout/receipt";
import { getStripe } from "@/components/checkout/stripeClient";
import { commerceApi, commerceErrorMessage, type PublicOffer } from "@/lib/commerceApi";
import { formatCurrency } from "@/lib/format";

const EASE_LUXE: [number, number, number, number] = [0.22, 1, 0.36, 1];

/** How long to wait for the webhook to mark the first order paid. */
const SETTLE_POLL_MS = 1500;
const SETTLE_MAX_POLLS = 10;

/**
 * `/checkout/:offerSlug/upsell/:step` — one decision, plainly put.
 *
 * The card the customer just paid with is already on file, so accepting is a
 * single click with no re-entry. That convenience is exactly why the decline has
 * to be as visible as the acceptance: a one-click charge behind a hidden "no
 * thanks" is how a funnel earns its refunds, and every refund costs more than
 * the sale it reverses.
 *
 * Nothing here is priced in the browser. The step's offer, its price and whether
 * it may be charged at all are the server's answers; this page shows them and
 * relays the customer's yes or no.
 */
export default function CheckoutUpsell() {
  const { offerSlug = "", step = "" } = useParams<{ offerSlug: string; step: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const reduce = useReducedMotion();

  const stepNumber = Number(step);
  const receipt = useMemo(
    () => receiptFromState(location.state) ?? recallReceipt(offerSlug),
    [location.state, offerSlug]
  );

  const [offer, setOffer] = useState<PublicOffer | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  /** Whether the first order has actually been paid, per the webhook. */
  const [settled, setSettled] = useState(false);
  const [settleChecked, setSettleChecked] = useState(false);

  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDownsell, setShowDownsell] = useState(false);

  useEffect(() => {
    let cancelled = false;
    commerceApi
      .getOffer(offerSlug)
      .then((result) => {
        if (!cancelled) setOffer(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setLoadError(commerceErrorMessage(err, "We couldn't load this offer."));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [offerSlug]);

  // The charge below is off-session against the first order's card, which the
  // server refuses until that order is genuinely paid. Polling here turns a
  // confusing rejection into a two-second wait.
  useEffect(() => {
    if (!receipt) return;

    let cancelled = false;
    let timer: number | undefined;
    let polls = 0;

    const poll = async () => {
      try {
        const order = await commerceApi.getOrder(receipt.orderId, receipt.orderToken);
        if (cancelled) return;
        if (order.status === "paid") {
          setSettled(true);
          setSettleChecked(true);
          return;
        }
      } catch {
        // A read that fails is not a payment that failed; keep waiting.
      }
      polls += 1;
      if (polls >= SETTLE_MAX_POLLS) {
        // The server is the real gate. Letting the button through after a slow
        // webhook beats stranding someone whose money has already moved.
        if (!cancelled) setSettleChecked(true);
        return;
      }
      timer = window.setTimeout(() => void poll(), SETTLE_POLL_MS);
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [receipt]);

  const upsell = offer?.upsells.find((u) => u.step === stepNumber) ?? null;

  const finishFlow = useCallback(() => {
    forgetReceipt(offerSlug);
    if (offer?.redirectUrl) {
      window.location.assign(offer.redirectUrl);
      return;
    }
    navigate(receipt ? successPath(receipt) : "/account/purchases", { replace: true });
  }, [navigate, offer?.redirectUrl, offerSlug, receipt]);

  const goNext = useCallback(() => {
    const next = offer?.upsells.find((u) => u.step > stepNumber);
    if (next) {
      navigate(`/checkout/${offerSlug}/upsell/${next.step}`, { state: receipt, replace: true });
      return;
    }
    finishFlow();
  }, [finishFlow, navigate, offer?.upsells, offerSlug, receipt, stepNumber]);

  // A step that does not exist is not an error the customer should read about;
  // it just means the flow is over.
  const missingStep = offer !== null && upsell === null;
  useEffect(() => {
    if (missingStep) finishFlow();
  }, [missingStep, finishFlow]);

  const advanceTimer = useRef<number | undefined>(undefined);
  useEffect(
    () => () => {
      if (advanceTimer.current) window.clearTimeout(advanceTimer.current);
    },
    []
  );

  async function accept() {
    if (!receipt || !upsell || busy) return;
    setBusy(true);
    setError(null);

    try {
      const result = await commerceApi.buyUpsell(offerSlug, stepNumber, {
        parentOrderId: receipt.orderId,
        orderToken: receipt.orderToken,
      });

      // The bank wants the customer present. Raising the challenge here is the
      // difference between a completed sale and a decline they could have
      // cleared with a thumbprint.
      if (result.status === "requires_action" && result.clientSecret) {
        const loading = getStripe();
        const stripe = loading ? await loading : null;
        if (!stripe) {
          setError("We couldn't open the security check. Nothing was charged.");
          return;
        }
        const confirmation = await stripe.confirmCardPayment(result.clientSecret);
        if (confirmation.error) {
          setError(
            confirmation.error.message ??
              "Your bank didn't approve that. Nothing has been added to your order."
          );
          return;
        }
      }

      setAdded(true);
      advanceTimer.current = window.setTimeout(goNext, 900);
    } catch (err) {
      setError(commerceErrorMessage(err, "We couldn't add that to your order."));
    } finally {
      setBusy(false);
    }
  }

  function decline() {
    if (upsell?.downsell && !showDownsell) {
      setShowDownsell(true);
      return;
    }
    goNext();
  }

  /* ---- render ---- */

  if (loadError !== null) {
    return (
      <UpsellShell>
        <Panel>
          <h1 className="font-display text-[1.8rem] leading-tight text-white">
            We couldn't load this page
          </h1>
          <p className="copy-luxe mt-4">
            {loadError} Your purchase is safe — nothing here affects it.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-4">
            <LuxeButton variant="foil" to="/account/purchases" className="min-h-[44px]">
              Go to my purchases
            </LuxeButton>
          </div>
        </Panel>
      </UpsellShell>
    );
  }

  if (!receipt) {
    return (
      <UpsellShell>
        <Panel>
          <h1 className="font-display text-[1.8rem] leading-tight text-white">
            We can't find that order
          </h1>
          <p className="copy-luxe mt-4">
            This page only works straight after a purchase, in the same browser tab. If you have
            already paid, everything you bought is waiting in your account.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-4">
            <LuxeButton variant="foil" to="/account/purchases" className="min-h-[44px]">
              Go to my purchases
            </LuxeButton>
            <LuxeButton variant="outline" to="/contact" className="min-h-[44px]">
              Get in touch
            </LuxeButton>
          </div>
        </Panel>
      </UpsellShell>
    );
  }

  if (offer === null || upsell === null) {
    return (
      <UpsellShell>
        <div
          role="status"
          aria-live="polite"
          className="flex min-h-[30vh] items-center justify-center gap-3 text-orchid-dim"
        >
          <Loader2 aria-hidden className="h-5 w-5 animate-spin text-gold" />
          One moment…
        </div>
      </UpsellShell>
    );
  }

  const price = formatCurrency(upsell.offer.amountCents, upsell.offer.currency || offer.currency);
  const recurring =
    upsell.offer.pricingType === "subscription" || upsell.offer.pricingType === "payment_plan";
  const waiting = !settled && !settleChecked;

  return (
    <>
      <Seo
        title={`${upsell.offer.title} - Boss Clinician`}
        description={upsell.body || upsell.offer.description}
      />
      <UpsellShell>
        <motion.div
          initial={reduce ? false : { opacity: 0, y: 22 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: EASE_LUXE }}
          className="mx-auto w-full max-w-2xl"
        >
          <GlassCard
            accent="gold"
            spotlight={false}
            interactive={false}
            className="overflow-hidden px-6 py-9 text-center sm:px-10 sm:py-11"
          >
            <span
              aria-hidden
              className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gold-foil opacity-80"
            />

            <LuxePill accent="green">Your order is confirmed</LuxePill>

            {showDownsell && upsell.downsell ? (
              <Downsell
                title={upsell.downsell.title ?? "One more option"}
                slug={upsell.downsell.slug}
                amountCents={upsell.downsell.amountCents}
                currency={upsell.offer.currency || offer.currency}
                onSkip={goNext}
              />
            ) : (
              <>
                <h1 className="mt-6 text-balance font-display text-[1.85rem] font-normal leading-[1.14] text-white sm:text-[2.35rem]">
                  {upsell.headline || `Add ${upsell.offer.title}?`}
                </h1>

                <GoldRule className="mx-auto mt-7" />

                {(upsell.body || upsell.offer.description) && (
                  <p className="copy-luxe mx-auto mt-6 max-w-lg text-pretty">
                    {upsell.body || upsell.offer.description}
                  </p>
                )}

                {upsell.offer.thumbnailUrl && (
                  <img
                    src={upsell.offer.thumbnailUrl}
                    alt=""
                    className="mx-auto mt-8 h-40 w-full max-w-sm rounded-2xl border border-white/10 object-cover"
                  />
                )}

                <p className="mt-8 font-display text-3xl text-white">{price}</p>
                <p className="mt-2 text-sm text-orchid-dim">
                  {recurring
                    ? "This one is billed on its own schedule, so it has its own checkout."
                    : "One payment, added to the order you just placed."}
                </p>

                {added ? (
                  <p
                    role="status"
                    className="mt-8 flex items-center justify-center gap-2 text-sm font-medium text-green-bright"
                  >
                    <Check aria-hidden className="h-4 w-4" />
                    Added to your order.
                  </p>
                ) : (
                  <div className="mt-8">
                    {recurring ? (
                      <LuxeButton
                        variant="foil"
                        size="lg"
                        to={`/checkout/${upsell.offer.slug}`}
                        className="w-full min-h-[52px] sm:w-auto"
                      >
                        Take a look
                      </LuxeButton>
                    ) : (
                      <LuxeButton
                        variant="foil"
                        size="lg"
                        type="button"
                        onClick={() => void accept()}
                        disabled={busy || waiting}
                        className="w-full min-h-[52px] sm:w-auto"
                      >
                        {busy && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}
                        {busy ? "Adding…" : `Yes, add this for ${price}`}
                      </LuxeButton>
                    )}

                    {!recurring && (
                      <p className="mt-4 text-xs leading-relaxed text-orchid-faint">
                        {waiting
                          ? "Just finishing off your first payment…"
                          : "We'll charge the card you just used. No card details to re-enter."}
                      </p>
                    )}
                  </div>
                )}

                {error && (
                  <p
                    role="alert"
                    className="mx-auto mt-6 flex max-w-md items-start gap-3 rounded-xl border border-red-400/40 bg-red-500/[0.08] px-4 py-3.5 text-left text-sm leading-relaxed text-red-200"
                  >
                    <AlertCircle aria-hidden className="mt-0.5 h-4 w-4 flex-none text-red-400" />
                    {error}
                  </p>
                )}

                {/* A decline that has to be hunted for is a dark pattern, and it
                    comes back as a chargeback rather than a lost upsell. */}
                {!added && (
                  <button
                    type="button"
                    onClick={decline}
                    disabled={busy}
                    className="mx-auto mt-7 flex min-h-[44px] items-center justify-center rounded-sm px-4 text-sm text-orchid underline decoration-white/25 underline-offset-[6px] transition-colors duration-300 ease-luxe hover:text-white hover:decoration-white/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gold disabled:opacity-50"
                  >
                    No thanks — I don't want this
                  </button>
                )}
              </>
            )}
          </GlassCard>

          <p className="mt-6 text-center text-xs text-orchid-faint">
            Whatever you choose here, the order you already placed is complete and on its way to
            your inbox.
          </p>
        </motion.div>
      </UpsellShell>
    </>
  );
}

/* ── Pieces ─────────────────────────────────────────────────────────────── */

function UpsellShell({ children }: { children: ReactNode }) {
  return (
    <Section
      surface="deep"
      space="lg"
      aurora="gold"
      auroraIntensity={0.75}
      seam={false}
      aria-label="One more thing"
      containerClassName="flex min-h-[50vh] items-center justify-center"
    >
      {children}
    </Section>
  );
}

function Panel({ children }: { children: ReactNode }) {
  return (
    <GlassCard
      accent="plum"
      interactive={false}
      className="mx-auto max-w-xl px-6 py-10 text-center sm:px-10"
    >
      {children}
    </GlassCard>
  );
}

/**
 * The second-chance offer attached to a declined step.
 *
 * It links to its own checkout rather than charging on the spot: the customer
 * has just said no to a one-click charge, and the honest way to make a smaller
 * offer is to let them choose it deliberately.
 */
function Downsell({
  title,
  slug,
  amountCents,
  currency,
  onSkip,
}: {
  title: string;
  slug: string;
  amountCents: number | null;
  currency: string;
  onSkip: () => void;
}) {
  return (
    <>
      <h1 className="mt-6 text-balance font-display text-[1.7rem] font-normal leading-[1.16] text-white sm:text-[2.1rem]">
        Before you go — would this suit you better?
      </h1>
      <GoldRule className="mx-auto mt-7" />
      <p className="copy-luxe mx-auto mt-6 max-w-lg text-pretty">{title}</p>
      {amountCents !== null && (
        <p className="mt-6 font-display text-3xl text-white">
          {formatCurrency(amountCents, currency)}
        </p>
      )}
      <div className="mt-8">
        <LuxeButton
          variant="foil"
          size="lg"
          to={`/checkout/${slug}`}
          className="w-full min-h-[52px] sm:w-auto"
        >
          Show me this one
        </LuxeButton>
      </div>
      <button
        type="button"
        onClick={onSkip}
        className="mx-auto mt-7 flex min-h-[44px] items-center justify-center rounded-sm px-4 text-sm text-orchid underline decoration-white/25 underline-offset-[6px] transition-colors duration-300 ease-luxe hover:text-white hover:decoration-white/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gold"
      >
        No thanks — take me to my purchase
      </button>
    </>
  );
}

/* ── Helpers ────────────────────────────────────────────────────────────── */

/** The receipt handed over by the checkout navigation, if this is one. */
function receiptFromState(state: unknown): CheckoutReceipt | null {
  if (typeof state !== "object" || state === null) return null;
  const { orderId, orderToken } = state as Partial<CheckoutReceipt>;
  if (typeof orderId !== "number" || typeof orderToken !== "string") return null;
  return { orderId, orderToken };
}
