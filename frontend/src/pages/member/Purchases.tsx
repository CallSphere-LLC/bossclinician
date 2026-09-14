import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ArrowUpRight, ChevronDown, Loader2, Receipt } from "lucide-react";
import { Seo } from "@/components/Seo";
import { MemberShell } from "@/components/member/MemberShell";
import { GlassCard } from "@/components/luxe/GlassCard";
import { LuxeButton, LuxePill } from "@/components/luxe/LuxeButton";
import { ReceiptPdfLink } from "@/components/member/ReceiptPdfLink";
import { cn } from "@/lib/cn";
import { formatCurrency, formatDate } from "@/lib/format";
import {
  billingApi,
  billingErrorMessage,
  receiptPaths,
  type MemberOrder,
  type MemberOrderDetail,
} from "@/lib/billingApi";

/**
 * Purchases.
 *
 * The member's own record of what they have paid this business, which makes
 * completeness the whole point: a refunded order stays on the list with the
 * refund written next to it, in the same words a bank statement would use.
 * Quietly dropping it would leave someone comparing the two and finding this
 * one wrong.
 *
 * Anything still theirs carries a link into the library, because "where is the
 * thing I bought" is the question this page is opened to answer far more often
 * than "what did it cost".
 */

/** Enough to cover a year of buying without a second request for most people. */
const PAGE_SIZE = 25;

export default function Purchases() {
  const [orders, setOrders] = useState<MemberOrder[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const page = await billingApi.orders({ limit: PAGE_SIZE });
        if (cancelled) return;
        setOrders(page.orders);
        setTotal(page.total);
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

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const page = await billingApi.orders({ limit: PAGE_SIZE, offset: orders?.length ?? 0 });
      setOrders((prev) => [...(prev ?? []), ...page.orders]);
      setTotal(page.total);
    } catch (err) {
      toast.error(billingErrorMessage(err, "We could not load the rest just now."));
    } finally {
      setLoadingMore(false);
    }
  };

  const hasMore = orders !== null && orders.length < total;

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

        {!error && orders === null && (
          <GlassCard spotlight={false} interactive={false} className="p-6 sm:p-8">
            <p className="text-sm text-orchid-dim">Loading your purchases…</p>
          </GlassCard>
        )}

        {!error && orders !== null && orders.length === 0 && <NothingYet />}

        {!error && orders !== null && orders.length > 0 && (
          <>
            <ul className="grid gap-5">
              {orders.map((order) => (
                <li key={order.id}>
                  <PurchaseCard order={order} />
                </li>
              ))}
            </ul>

            {hasMore && (
              <div className="mt-8 flex justify-center">
                <LuxeButton
                  type="button"
                  variant="glass"
                  size="sm"
                  disabled={loadingMore}
                  onClick={() => void loadMore()}
                >
                  {loadingMore && <Loader2 aria-hidden className="size-4 animate-spin" />}
                  {loadingMore ? "Loading" : "Show earlier purchases"}
                </LuxeButton>
              </div>
            )}

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
 * The `quiet` variant carries no padding of its own, so a text action in a list
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

function PurchaseCard({ order }: { order: MemberOrder }) {
  const [detail, setDetail] = useState<MemberOrderDetail | null>(null);
  const [open, setOpen] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const detailId = `purchase-detail-${order.id}`;
  const refundedInFull = order.refundedCents > 0 && order.refundedCents >= order.totalCents;
  const partlyRefunded = order.refundedCents > 0 && !refundedInFull;
  const stillYours = order.refundedCents < order.totalCents;

  const toggle = async () => {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (detail !== null || loadingDetail) return;

    setLoadingDetail(true);
    try {
      setDetail(await billingApi.order(order.id));
    } catch (err) {
      toast.error(billingErrorMessage(err, "We could not load the detail of that one just now."));
      setOpen(false);
    } finally {
      setLoadingDetail(false);
    }
  };

  return (
    <GlassCard spotlight={false} interactive={false} className="p-6 sm:p-7">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between sm:gap-8">
        <div className="min-w-0">
          <h2 className="flex flex-wrap items-center gap-2.5 font-display text-lg text-white">
            {order.title}
            {refundedInFull && <LuxePill accent="neutral">Refunded</LuxePill>}
            {partlyRefunded && <LuxePill accent="neutral">Partly refunded</LuxePill>}
          </h2>
          <p className="mt-1.5 text-xs text-orchid-faint">{formatDate(order.createdAt)}</p>
        </div>

        <div className="shrink-0 sm:text-right">
          <p className="font-display text-xl text-white">
            {formatCurrency(order.totalCents, order.currency)}
          </p>
          <p className="mt-0.5 text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-orchid-faint">
            {refundedInFull ? "Refunded" : "Paid"}
          </p>
        </div>
      </div>

      {order.items.length > 1 && (
        <ul className="mt-5 divide-y divide-white/[0.05] border-y border-white/[0.05]">
          {order.items.map((item, index) => (
            <li
              key={`${item.title}-${index}`}
              className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1.5 py-3"
            >
              <span className="min-w-0 text-sm text-orchid">
                {item.title}
                {item.quantity > 1 && ` × ${item.quantity}`}
                {describeItemKind(item.kind) && (
                  <span className="ml-2 text-xs text-orchid-faint">
                    {describeItemKind(item.kind)}
                  </span>
                )}
              </span>
              <span className="text-sm text-orchid-dim">
                {formatCurrency(item.amountCents, order.currency)}
              </span>
            </li>
          ))}
        </ul>
      )}

      <MoneyBreakdown order={order} />

      {order.refundedCents > 0 && (
        <p className="mt-4 text-sm text-lilac">
          {refundedInFull
            ? `All ${formatCurrency(order.refundedCents, order.currency)} of this was refunded to you.`
            : `${formatCurrency(order.refundedCents, order.currency)} of this was refunded to you.`}
        </p>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-3">
        {stillYours && (
          <LuxeButton to="/library" variant="quiet" className={QUIET_LINK}>
            <span className="inline-flex items-center gap-1.5">
              Open in your library
              <ArrowUpRight aria-hidden className="size-3.5" />
            </span>
          </LuxeButton>
        )}

        {/* Every purchase on this page has a receipt, and both are ordinary
            links to the receipt's own address: the page opens in this tab,
            and the PDF downloads without leaving it. */}
        <LuxeButton
          to={receiptPaths({ orderId: order.id }).page}
          variant="quiet"
          className={QUIET_LINK}
        >
          View receipt
        </LuxeButton>

        <ReceiptPdfLink target={{ orderId: order.id }} className={QUIET_LINK}>
          Download PDF
        </ReceiptPdfLink>

        <button
          type="button"
          aria-expanded={open}
          aria-controls={detailId}
          onClick={() => void toggle()}
          className={cn(
            "inline-flex min-h-[44px] items-center gap-1.5 text-[0.72rem] font-semibold uppercase",
            "tracking-[0.14em] text-orchid transition-colors duration-300 hover:text-gold",
            "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gold",
          )}
        >
          {open ? "Hide the detail" : "See the detail"}
          <ChevronDown
            aria-hidden
            className={cn("size-3.5 transition-transform duration-300", open && "rotate-180")}
          />
        </button>
      </div>

      {open && (
        <div id={detailId} aria-live="polite" className="mt-5 border-t border-white/[0.06] pt-5">
          {loadingDetail && <p className="text-sm text-orchid-dim">Loading the detail…</p>}
          {detail && <PurchaseDetail detail={detail} />}
        </div>
      )}
    </GlassCard>
  );
}

/** What an extra line on the order actually was, in the buyer's own terms. */
function describeItemKind(kind: string): string {
  if (kind === "bump") return "added at checkout";
  if (kind === "upsell") return "added just after";
  return "";
}

function PurchaseDetail({ detail }: { detail: MemberOrderDetail }) {
  // Refunds have their own section below, where they can say what happened to
  // the access as well as to the money.
  const payments = detail.transactions.filter((t) => t.kind === "payment");

  return (
    <div className="grid gap-4">
      {payments.length > 0 && (
        <div>
          <h3 className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-orchid">
            Payments
          </h3>
          <ul className="mt-2 grid gap-1.5">
            {payments.map((payment) => (
              <li key={payment.id} className="text-sm text-orchid-dim">
                {payment.status === "succeeded" ? (
                  <>
                    {formatCurrency(payment.amountCents, payment.currency)} paid on{" "}
                    {formatDate(payment.occurredAt)}
                    {payment.cardLast4 && (
                      <>
                        {" · "}
                        {payment.cardBrand ? (
                          <span className="capitalize">{payment.cardBrand}</span>
                        ) : (
                          "card"
                        )}{" "}
                        ending {payment.cardLast4}
                      </>
                    )}
                  </>
                ) : (
                  <>
                    A payment of {formatCurrency(payment.amountCents, payment.currency)} did not go
                    through on {formatDate(payment.occurredAt)}. Nothing was taken.
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {detail.refunds.length > 0 && (
        <div>
          <h3 className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-orchid">
            Refunds
          </h3>
          <ul className="mt-2 grid gap-1.5">
            {detail.refunds.map((refund) => (
              <li key={refund.id} className="text-sm text-lilac">
                {formatCurrency(refund.amountCents, refund.currency)} was refunded to you on{" "}
                {formatDate(refund.createdAt)}.
                {refund.accessRemoved && " Access to what it covered was closed at the same time."}
              </li>
            ))}
          </ul>
        </div>
      )}

      {payments.length === 0 && detail.refunds.length === 0 && (
        <p className="text-sm text-orchid-dim">
          This one was arranged for you directly rather than paid through the website.
        </p>
      )}
    </div>
  );
}

/**
 * Only the lines that actually happened. A row of "Discount $0.00 / Tax $0.00"
 * on every receipt trains people to stop reading the one that matters.
 */
function MoneyBreakdown({ order }: { order: MemberOrder }) {
  const hasDiscount = order.discountCents > 0;
  const hasTax = order.taxCents > 0;
  if (!hasDiscount && !hasTax) return null;

  return (
    <dl className="mt-5 grid max-w-xs gap-1.5 text-sm">
      {/* An order taken by the older single-course checkout never recorded one. */}
      {order.subtotalCents > 0 && (
        <Line label="Before discount" value={formatCurrency(order.subtotalCents, order.currency)} />
      )}
      {hasDiscount && (
        <Line
          label={order.couponCode ? `Discount (${order.couponCode})` : "Discount"}
          value={`−${formatCurrency(order.discountCents, order.currency)}`}
        />
      )}
      {hasTax && <Line label="Tax" value={formatCurrency(order.taxCents, order.currency)} />}
      <Line label="You paid" value={formatCurrency(order.totalCents, order.currency)} emphasis />
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
