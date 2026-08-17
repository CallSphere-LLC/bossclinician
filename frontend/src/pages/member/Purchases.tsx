import { useEffect, useState } from "react";
import { ArrowUpRight, Receipt } from "lucide-react";
import { Seo } from "@/components/Seo";
import { MemberShell } from "@/components/member/MemberShell";
import { GlassCard } from "@/components/luxe/GlassCard";
import { LuxeButton, LuxePill } from "@/components/luxe/LuxeButton";
import { formatCurrency, formatDate } from "@/lib/format";
import { billingApi, type MemberPurchase, type PurchaseItem } from "@/lib/billingApi";

/**
 * Purchases.
 *
 * The member's own record of what they have paid this business, which makes
 * completeness the whole point: a refunded order stays on the list with the
 * refund written next to it, and a failed payment says plainly that nothing was
 * taken. Quietly dropping either would leave someone comparing this page against
 * a bank statement and finding it wrong.
 *
 * Anything that granted access carries a link into the library, because "where
 * is the thing I bought" is the question this page is opened to answer far more
 * often than "what did it cost".
 */
export default function Purchases() {
  const [purchases, setPurchases] = useState<MemberPurchase[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rows = await billingApi.purchases();
        if (cancelled) return;
        // Newest first is the promise this page makes; ordering it here keeps
        // that true regardless of how the list arrives.
        setPurchases(
          [...rows].sort(
            (a, b) => new Date(b.purchasedAt).getTime() - new Date(a.purchasedAt).getTime(),
          ),
        );
        setError("");
      } catch {
        if (!cancelled) {
          setError("We could not load your purchases just now. Please try again in a moment.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <MemberShell
      title="Purchases"
      description="Every course, retreat and resource you have bought, with a receipt for each one."
    >
      <Seo title="Your Purchases | Boss Clinician" />

      <div aria-live="polite">
        {error && (
          <GlassCard spotlight={false} interactive={false} className="p-6 sm:p-8">
            <p role="alert" className="text-sm font-medium text-red-400">
              {error}
            </p>
          </GlassCard>
        )}

        {!error && purchases === null && (
          <GlassCard spotlight={false} interactive={false} className="p-6 sm:p-8">
            <p className="text-sm text-orchid-dim">Loading your purchases…</p>
          </GlassCard>
        )}

        {!error && purchases !== null && purchases.length === 0 && <NothingYet />}

        {!error && purchases !== null && purchases.length > 0 && (
          <>
            <ul className="grid gap-5">
              {purchases.map((purchase) => (
                <li key={purchase.id}>
                  <PurchaseCard purchase={purchase} />
                </li>
              ))}
            </ul>

            <p className="mt-8 flex flex-wrap items-center gap-x-2 text-sm text-orchid-dim">
              Your plans, instalments and the card you pay with live in
              <LuxeButton to="/account/billing" variant="quiet" className={QUIET_LINK}>
                Billing
              </LuxeButton>
            </p>
          </>
        )}
      </div>
    </MemberShell>
  );
}

/**
 * The `quiet` variant carries no padding of its own, so a text link in a list
 * needs the tap target adding back — these rows are read on a phone.
 */
const QUIET_LINK = "min-h-[44px] text-[0.72rem] tracking-[0.14em]";

function NothingYet() {
  return (
    <GlassCard
      spotlight={false}
      interactive={false}
      className="flex flex-col items-center px-6 py-16 text-center sm:px-8"
    >
      <span
        aria-hidden
        className="grid size-14 place-items-center rounded-full border border-gold/25 bg-gold/[0.08]"
      >
        <Receipt className="size-6 text-gold" />
      </span>

      <h2 className="mt-6 font-display text-2xl text-white">Nothing here yet</h2>
      <p className="copy-luxe mt-3 max-w-md text-balance text-sm">
        Your invoices and receipts will appear here after your first purchase — you will never have
        to dig through your email to find one.
      </p>

      <div className="mt-8">
        <LuxeButton to="/courses" variant="foil" size="sm">
          See what is available
        </LuxeButton>
      </div>
    </GlassCard>
  );
}

function PurchaseCard({ purchase }: { purchase: MemberPurchase }) {
  const { pill, note } = describePurchase(purchase);
  const charged = purchase.state === "paid";
  const openable = purchase.items.filter((item) => item.libraryPath !== "");

  return (
    <GlassCard spotlight={false} interactive={false} className="p-6 sm:p-7">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between sm:gap-8">
        <div className="min-w-0">
          <h2 className="flex flex-wrap items-center gap-2.5 font-display text-lg text-white">
            {purchase.title}
            {pill && <LuxePill accent={pill.accent}>{pill.label}</LuxePill>}
          </h2>
          <p className="mt-1.5 text-xs text-orchid-faint">
            {formatDate(purchase.purchasedAt)}
            {purchase.cardBrand && purchase.cardLast4 && (
              <>
                {" · "}
                <span className="capitalize">{purchase.cardBrand}</span> ending{" "}
                {purchase.cardLast4}
              </>
            )}
          </p>
        </div>

        <div className="shrink-0 sm:text-right">
          <p className="font-display text-xl text-white">
            {formatCurrency(purchase.totalCents, purchase.currency)}
          </p>
          <p className="mt-0.5 text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-orchid-faint">
            {charged ? "Paid" : "Not charged"}
          </p>
        </div>
      </div>

      {note && <p className="copy-luxe mt-4 text-sm">{note}</p>}

      {purchase.items.length > 1 && (
        <ul className="mt-5 divide-y divide-white/[0.05] border-y border-white/[0.05]">
          {purchase.items.map((item) => (
            <li
              key={item.id}
              className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1.5 py-3"
            >
              <span className="min-w-0 text-sm text-orchid">
                {item.title}
                {item.quantity > 1 && ` × ${item.quantity}`}
              </span>
              <span className="flex items-center gap-5">
                <span className="text-sm text-orchid-dim">
                  {formatCurrency(item.amountCents, purchase.currency)}
                </span>
                <ItemLibraryLink item={item} />
              </span>
            </li>
          ))}
        </ul>
      )}

      <MoneyBreakdown purchase={purchase} />

      {purchase.refunds.length > 0 && (
        <ul className="mt-4 grid gap-1.5">
          {purchase.refunds.map((refund) => (
            <li key={refund.id} className="text-sm text-lilac">
              {formatCurrency(refund.amountCents, purchase.currency)} was refunded to you on{" "}
              {formatDate(refund.refundedAt)}.
              {refund.revokedAccess && " Access to what it covered was closed at the same time."}
            </li>
          ))}
        </ul>
      )}

      {/* Skipped entirely for an order that was never charged and granted
          nothing — an empty row of actions is just a gap in the card. */}
      {(charged || openable.length > 0) && (
        <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-3">
          {purchase.items.length === 1 && <ItemLibraryLink item={purchase.items[0]} />}

          {purchase.items.length > 1 && openable.length > 0 && (
            <LuxeButton to="/library" variant="quiet" className={QUIET_LINK}>
              Open your library
            </LuxeButton>
          )}

          {purchase.receiptUrl ? (
            <LuxeButton
              href={purchase.receiptUrl}
              variant="quiet"
              target="_blank"
              className={QUIET_LINK}
            >
              View receipt
            </LuxeButton>
          ) : (
            charged && (
              <span className="text-xs text-orchid-faint">
                Ask us if you need a receipt for this one
              </span>
            )
          )}
        </div>
      )}
    </GlassCard>
  );
}

function ItemLibraryLink({ item }: { item: PurchaseItem }) {
  if (!item.libraryPath) return null;
  return (
    <LuxeButton to={item.libraryPath} variant="quiet" className={QUIET_LINK}>
      <span className="inline-flex items-center gap-1.5">
        Open
        <ArrowUpRight aria-hidden className="size-3.5" />
      </span>
    </LuxeButton>
  );
}

/**
 * Only the lines that actually happened. A row of "Discount $0.00 / Tax $0.00"
 * on every receipt trains people to stop reading the one that matters.
 */
function MoneyBreakdown({ purchase }: { purchase: MemberPurchase }) {
  const hasDiscount = purchase.discountCents > 0;
  const hasTax = purchase.taxCents > 0;
  const hasRefund = purchase.refundedCents > 0;
  if (!hasDiscount && !hasTax && !hasRefund) return null;

  return (
    <dl className="mt-5 grid max-w-xs gap-1.5 text-sm">
      <Line label="Before discount" value={formatCurrency(purchase.subtotalCents, purchase.currency)} />
      {hasDiscount && (
        <Line
          label={purchase.couponCode ? `Discount (${purchase.couponCode})` : "Discount"}
          value={`−${formatCurrency(purchase.discountCents, purchase.currency)}`}
        />
      )}
      {hasTax && <Line label="Tax" value={formatCurrency(purchase.taxCents, purchase.currency)} />}
      <Line
        label="You paid"
        value={formatCurrency(purchase.totalCents, purchase.currency)}
        emphasis
      />
      {hasRefund && (
        <Line
          label="Refunded"
          value={`−${formatCurrency(purchase.refundedCents, purchase.currency)}`}
        />
      )}
    </dl>
  );
}

function Line({
  label,
  value,
  emphasis = false,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-6">
      <dt className={emphasis ? "text-white" : "text-orchid-dim"}>{label}</dt>
      <dd className={emphasis ? "font-medium text-white" : "text-orchid"}>{value}</dd>
    </div>
  );
}

interface StatePill {
  label: string;
  accent: "neutral" | "gold" | "plum" | "green";
}

function describePurchase(purchase: MemberPurchase): { pill: StatePill | null; note: string } {
  if (purchase.state === "failed") {
    return {
      pill: { label: "Payment did not go through", accent: "gold" },
      note: "Nothing was taken from your card, so there is nothing to refund. You are welcome to try again whenever you like.",
    };
  }

  if (purchase.state === "pending") {
    return {
      pill: { label: "Waiting on payment", accent: "gold" },
      note: "We have not taken a payment for this yet. If you meant to buy it, starting the checkout again will pick up where you left off.",
    };
  }

  if (purchase.state === "expired") {
    return {
      pill: { label: "Never completed", accent: "neutral" },
      note: "This checkout was left unfinished, so nothing was charged.",
    };
  }

  if (purchase.refundedCents >= purchase.totalCents && purchase.refundedCents > 0) {
    return { pill: { label: "Refunded", accent: "neutral" }, note: "" };
  }

  if (purchase.refundedCents > 0) {
    return { pill: { label: "Partly refunded", accent: "neutral" }, note: "" };
  }

  return { pill: null, note: "" };
}
