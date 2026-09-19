import { stripeTestMode } from "@/lib/paymentMode";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router";
import { motion, useReducedMotion } from "motion/react";
import { Seo } from "@/components/Seo";
import { GlassCard } from "@/components/luxe/GlassCard";
import { LuxeButton } from "@/components/luxe/LuxeButton";
import { GoldRule, Section } from "@/components/luxe/Section";
import { api } from "@/lib/api";
import { commerceApi, type OrderReceipt } from "@/lib/commerceApi";
import { cn } from "@/lib/cn";
import type { CheckoutOrder } from "@/types";

const POLL_INTERVAL_MS = 1500;
const MAX_POLLS = 12; // ~18s, then stop and tell the buyer it's still settling

const EASE_LUXE: [number, number, number, number] = [0.22, 1, 0.36, 1];

/**
 * What the panel needs, whichever checkout the buyer arrived from.
 *
 * Two of them reach this page. Every offer goes through the Payment Element on
 * `/checkout/:offerSlug`, which sends the buyer here with the order id and the
 * receipt token it was issued at checkout. The hosted Stripe Checkout behind the
 * legacy buy buttons comes back with a session id instead. Both are looked up
 * server-side, and neither browser can talk this page into saying "paid".
 */
interface Confirmation {
  status: string;
  title: string;
  email: string;
  amountCents: number;
  currency: string;
  /**
   * Where the receipt and the access email have got to, read from the delivery
   * log. Absent for the legacy hosted checkout, which has no such report — the
   * page then promises nothing either way.
   */
  receiptEmail?: OrderEmailState;
  accessEmail?: OrderEmailState;
}

/** Mirrors the order endpoint: sent, still on its way, tried and failed, or never meant to go. */
type OrderEmailState = "sent" | "pending" | "failed" | "off";

/**
 * The order endpoint's email report. Typed here rather than on `OrderReceipt`
 * so an older API that does not send it yet still satisfies the shape.
 */
interface OrderReceiptWithEmails extends OrderReceipt {
  receiptEmail?: OrderEmailState;
  accessEmail?: OrderEmailState;
}

function fromSession(order: CheckoutOrder): Confirmation {
  return {
    status: order.status,
    title: order.courseTitle,
    email: order.email,
    amountCents: order.amountCents,
    currency: order.currency,
  };
}

function fromReceipt(receipt: OrderReceiptWithEmails): Confirmation {
  return {
    receiptEmail: receipt.receiptEmail,
    accessEmail: receipt.accessEmail,
    status: receipt.status,
    // An order can carry several things; the offer is what was bought.
    title: receipt.offerTitle ?? receipt.items[0]?.title ?? "your order",
    email: receipt.email,
    amountCents: receipt.totalCents,
    currency: receipt.currency,
  };
}

/**
 * What the page may truthfully say about the receipt.
 *
 * It used to say "and sent a receipt to …" the moment the order turned paid,
 * whether or not a receipt had gone — including when receipts were switched off
 * and when the transport had refused it.
 */
function receiptSentence(order: Confirmation): string {
  const to = order.email ? ` to ${order.email}` : "";
  switch (order.receiptEmail) {
    case "sent":
      return `We've sent a receipt${to}.`;
    case "pending":
      return `Your receipt is on its way${to}.`;
    case "failed":
      return "We couldn't email your receipt just now — get in touch and we'll send you a copy.";
    case "off":
      return "";
    default:
      return order.email ? `Your receipt will be emailed to ${order.email}.` : "";
  }
}

/** And about the email that tells them how to get in. */
function accessSentence(order: Confirmation): string {
  switch (order.accessEmail) {
    case "sent":
      return "Your access details are in your inbox.";
    case "pending":
      return "Your access details are on their way to your inbox.";
    case "failed":
      return order.email
        ? `We couldn't email your access details just now, but your access is ready. Go to your library and sign in with ${order.email} — choose "Forgot password" if you haven't set one yet.`
        : "We couldn't email your access details just now, but your access is ready in your library.";
    case "off":
      return "Your access is ready and waiting in your library.";
    default:
      return "Your access details will follow by email, and everything is waiting in your library.";
  }
}

function formatAmount(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: (currency || "usd").toUpperCase(),
  }).format(cents / 100);
}

/**
 * One rise recipe for the panel's stack; only the delay changes.
 *
 * `animate`, not `whileInView`: the panel is the whole screen on arrival, and
 * each state's block mounts fresh when the poll resolves — an in-view observer
 * would be measuring an element that is already past its trigger. Reduced
 * motion gets `initial={false}`, i.e. the finished state on mount.
 */
function rise(reduce: boolean | null, delay: number) {
  return {
    initial: reduce ? false : { opacity: 0, y: 18 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.7, delay: reduce ? 0 : delay, ease: EASE_LUXE },
  };
}

const MEDALLION_TONE = {
  gold: "border-gold/30 bg-gold/[0.08] text-gold",
  plum: "border-plum-bright/35 bg-plum-bright/[0.12] text-lilac",
} as const;

/**
 * Status glyph above the headline. Decoration, so it carries the state's
 * colour and nothing else — the sentence underneath is what actually says
 * what happened.
 */
function Medallion({
  tone,
  pulse = false,
  children,
}: {
  tone: keyof typeof MEDALLION_TONE;
  pulse?: boolean;
  children: ReactNode;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "relative mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-full border",
        MEDALLION_TONE[tone],
      )}
    >
      {pulse && (
        <span
          className={cn(
            "absolute inset-[-6px] animate-pulse-glow rounded-full border",
            tone === "gold" ? "border-gold/20" : "border-plum-bright/25",
          )}
        />
      )}
      {children}
    </span>
  );
}

/**
 * Landing page for Stripe's success_url.
 *
 * Payment is confirmed by the webhook, not by this page — arriving here only
 * means the browser was redirected. So we poll the order until the webhook has
 * flipped it to `paid` rather than claiming success on arrival.
 *
 * Visually: one centred glass panel on a deep band, tall enough (min-h) that
 * the footer stays at the bottom of the screen. Accent and aurora follow the
 * outcome — gold once the money has actually landed, plum while it hasn't.
 */
export default function CheckoutSuccess() {
  const [params] = useSearchParams();
  const sessionId = params.get("session_id");
  const orderParam = params.get("order");
  const orderToken = params.get("token");
  const orderId = Number(orderParam);

  const [order, setOrder] = useState<Confirmation | null>(null);
  const [settling, setSettling] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const polls = useRef(0);
  const reduce = useReducedMotion();

  useEffect(() => {
    polls.current = 0;
    setOrder(null);
    setError(null);
    setSettling(true);
    const read: (() => Promise<Confirmation>) | null =
      orderToken !== null && Number.isInteger(orderId) && orderId > 0
        ? () =>
            commerceApi
              .getOrder(orderId, orderToken)
              .then((receipt) => fromReceipt(receipt as OrderReceiptWithEmails))
        : sessionId !== null
          ? () => api.checkoutOrder(sessionId).then(fromSession)
          : null;

    if (!read) {
      setError("We could not tell which order this is.");
      setSettling(false);
      return;
    }
    // Bound to a non-null local: `poll` is hoisted, so the narrowing above does
    // not reach inside it.
    const load = read;

    let cancelled = false;
    let timer: number | undefined;

    async function poll() {
      try {
        const result = await load();
        if (cancelled) return;
        setOrder(result);
        // A successful retry can arrive before its webhook, while the order
        // still holds the previous card decline. Keep checking within the same
        // bounded window; only the server's paid status confirms the purchase.
        if (result.status === "paid") {
          setSettling(false);
          // The emails go out just after the order turns paid, so the first
          // 'paid' read can be a moment early. Keep reading, quietly, until both
          // have an answer — the panel is already showing, only its wording
          // about the emails is still to settle.
          const waiting = result.receiptEmail === "pending" || result.accessEmail === "pending";
          if (!waiting) return;
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Could not load your order.");
        setSettling(false);
        return;
      }
      polls.current += 1;
      if (polls.current >= MAX_POLLS) {
        setSettling(false);
        return;
      }
      timer = window.setTimeout(() => void poll(), POLL_INTERVAL_MS);
    }

    void poll();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [sessionId, orderId, orderToken]);

  const paid = order?.status === "paid";
  const celebratory = !settling && paid && order !== null;

  return (
    <>
      {/* One person's receipt, reachable only with their own order token — and
          eight already-indexed legacy thank-you URLs redirect here, so without
          this the confirmation page is what a search for the course finds. */}
      <Seo
        title="Order Confirmation - Boss Clinician"
        description="Your Boss Clinician order."
        noindex
      />

      <Section
        surface="deep"
        space="lg"
        aurora={celebratory ? "gold" : "violet"}
        auroraIntensity={celebratory ? 1 : 0.8}
        seam={false}
        aria-label="Order confirmation"
        containerClassName="flex min-h-[56vh] items-center justify-center"
      >
        <motion.div
          initial={reduce ? false : { opacity: 0, y: 26, scale: 0.985 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.85, ease: EASE_LUXE }}
          className="w-full max-w-2xl"
        >
          <GlassCard
            accent={celebratory ? "gold" : "plum"}
            interactive={false}
            className="overflow-hidden px-6 py-10 text-center sm:px-10 sm:py-12"
          >
            {settling && (
              <>
                <Medallion tone="plum" pulse>
                  <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6">
                    <circle
                      cx="12"
                      cy="12"
                      r="9"
                      stroke="currentColor"
                      strokeWidth="1.1"
                      opacity="0.45"
                    />
                    <path
                      d="M12 6.75V12l3.4 2"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                    />
                  </svg>
                </Medallion>

                <motion.span {...rise(reduce, 0.06)} className="eyebrow-luxe">
                  Confirming
                </motion.span>

                <motion.h1
                  {...rise(reduce, 0.14)}
                  className="text-balance font-display text-[1.85rem] font-normal leading-[1.12] text-white sm:text-[2.4rem]"
                >
                  Finalizing your enrollment…
                </motion.h1>

                <motion.div {...rise(reduce, 0.22)}>
                  <GoldRule className="mx-auto mt-8" />
                </motion.div>

                <motion.p
                  {...rise(reduce, 0.3)}
                  role="status"
                  className="copy-luxe mx-auto mt-6 max-w-lg text-pretty"
                >
                  This usually takes a few seconds. You can safely leave this page — nothing else
                  is needed from you.
                </motion.p>
              </>
            )}

            {!settling && paid && order && (
              <>
                {/* Foil seam along the top edge — the one flourish reserved for
                    the state where the money actually landed. */}
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gold-foil opacity-80"
                />

                <Medallion tone="gold">
                  <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6">
                    <circle
                      cx="12"
                      cy="12"
                      r="9.25"
                      stroke="currentColor"
                      strokeWidth="1.1"
                      opacity="0.5"
                    />
                    <path
                      d="m8 12.3 2.7 2.7L16.2 9.5"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </Medallion>

                <motion.span {...rise(reduce, 0.06)} className="eyebrow-luxe">
                  Payment Received
                </motion.span>

                <motion.h1
                  {...rise(reduce, 0.14)}
                  className="text-balance font-display text-[1.85rem] font-normal leading-[1.12] text-white sm:text-[2.4rem]"
                >
                  You're in.{" "}
                  <span className="text-foil block font-display italic [overflow-wrap:anywhere]">
                    Welcome to {order.title}.
                  </span>
                </motion.h1>

                <motion.div {...rise(reduce, 0.22)}>
                  <GoldRule className="mx-auto mt-8" />
                </motion.div>

                <motion.p
                  {...rise(reduce, 0.3)}
                  className="copy-luxe mx-auto mt-6 max-w-lg text-pretty [overflow-wrap:anywhere]"
                >
                  {stripeTestMode() ? "Test payment completed for " : "We charged "}
                  <span className="font-normal text-white">
                    {formatAmount(order.amountCents, order.currency)}
                  </span>
                  . {stripeTestMode() ? "No real money was charged. Test purchase emails are disabled. Your receipt is available in your account." : [receiptSentence(order), accessSentence(order)].filter(Boolean).join(" ")}
                </motion.p>

                <motion.div
                  {...rise(reduce, 0.4)}
                  className="mt-10 flex flex-wrap items-center justify-center gap-4"
                >
                  <LuxeButton variant="foil" to="/library" className="min-h-[44px]">
                    Go to your library
                  </LuxeButton>
                  <LuxeButton variant="outline" to="/courses" className="min-h-[44px]">
                    Browse More Courses
                  </LuxeButton>
                  <LuxeButton variant="outline" to="/" className="min-h-[44px]">
                    Back to Home
                  </LuxeButton>
                </motion.div>
              </>
            )}

            {!settling && !paid && (
              <>
                <Medallion tone="plum">
                  <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6">
                    <circle
                      cx="12"
                      cy="12"
                      r="9.25"
                      stroke="currentColor"
                      strokeWidth="1.1"
                      opacity="0.5"
                    />
                    <path
                      d="M12 7.6v5.2"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                    />
                    <circle cx="12" cy="16.1" r="0.95" fill="currentColor" />
                  </svg>
                </Medallion>

                <motion.span {...rise(reduce, 0.06)} className="eyebrow-luxe">
                  Still Processing
                </motion.span>

                <motion.h1
                  {...rise(reduce, 0.14)}
                  className="text-balance font-display text-[1.85rem] font-normal leading-[1.12] text-white sm:text-[2.4rem]"
                >
                  We haven't confirmed this payment yet.
                </motion.h1>

                <motion.div {...rise(reduce, 0.22)}>
                  <GoldRule className="mx-auto mt-8" />
                </motion.div>

                <motion.p
                  {...rise(reduce, 0.3)}
                  className="copy-luxe mx-auto mt-6 max-w-lg text-pretty [overflow-wrap:anywhere]"
                >
                  {error ??
                    "Some payment methods take a little longer to settle. If you were charged, your receipt will arrive by email and your access follows right after — nothing else is needed from you."}
                </motion.p>

                {/* Flex row rather than an inline link: it is what lets the
                    link carry a 44px tap target without pushing the sentence
                    apart on a phone. */}
                <motion.p
                  {...rise(reduce, 0.38)}
                  className="mt-4 flex flex-wrap items-center justify-center gap-x-2 text-sm text-orchid-dim"
                >
                  <span>Questions?</span>
                  <Link
                    to="/contact"
                    className="inline-flex min-h-[44px] items-center rounded-sm text-gold underline decoration-gold/35 underline-offset-4 transition-colors duration-300 ease-luxe hover:text-gold-bright hover:decoration-gold-bright/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gold"
                  >
                    Get in touch
                  </Link>
                  <span>and we'll sort it out.</span>
                </motion.p>
              </>
            )}
          </GlassCard>
        </motion.div>
      </Section>
    </>
  );
}
