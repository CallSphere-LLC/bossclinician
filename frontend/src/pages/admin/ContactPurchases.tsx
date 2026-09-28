import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { DollarSign, Receipt } from "lucide-react";
import { formatCurrency } from "@/lib/format";
import { groupPurchaseCards, purchasesApi, type Purchase } from "@/lib/purchasesApi";
import { Badge, Button, EmptyState, ErrorNotice, Skeleton } from "@/pages/admin/ui/primitives";
import { friendlyError } from "@/pages/admin/ui/friendly";
import { useSiteTime } from "@/pages/admin/ui/siteTime";

/**
 * A person's Purchases tab, drawn the way Kajabi's is.
 *
 * QA sheet rows 28–31: the tab used to draw one card per *payment*, so a
 * payment plan showed as "Paid on Sep 12 $400 Payment plan instalment 2" and
 * "Paid on Aug 13 $500 instalment 1", a grant did not show at all, and every
 * card carried "Order #33 From Kajabi" — an internal number Kajabi never shows.
 * The owner compares the two admins side by side, and that read as data lost.
 *
 * Now one card is one purchase: a grey band with when ("Paid on" / "Granted
 * on"), "Total" and Kajabi's total words (the amount, "Granted", or the whole
 * plan sentence), and View Details on the right; then Offer, Price, Quantity,
 * and — only where Kajabi draws them — Billing status ("Active", "1/10 payments
 * completed", "by …" when somebody paused it) and Access ("Access revoked by …").
 *
 * Self-contained so the profile only has to mount it: it loads its own data,
 * and `refreshKey` refetches when the profile reloads (after a manual purchase).
 */
export default function ContactPurchases({
  contactId,
  onCreateManual,
  refreshKey,
}: {
  contactId: number;
  /** Opens the profile's "Create a manual purchase" dialog from the empty state. */
  onCreateManual?: () => void;
  refreshKey?: unknown;
}) {
  const [purchases, setPurchases] = useState<Purchase[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    let current = true;
    purchasesApi
      .forContact(contactId)
      .then((body) => {
        if (!current) return;
        setPurchases(body.purchases);
        setError(null);
      })
      .catch((err) => current && setError(friendlyError(err, "purchase")));
    return () => {
      current = false;
    };
  }, [contactId]);

  useEffect(() => load(), [load, refreshKey]);

  if (error) return <ErrorNotice message={error} />;

  if (purchases === null) {
    return (
      <div className="space-y-4" aria-busy="true">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (purchases.length === 0) {
    return (
      <EmptyState
        icon={<Receipt />}
        title="No purchases yet"
        description="Purchases appear here the moment a payment goes through, when you grant an offer, or when you record one by hand."
        action={
          onCreateManual ? (
            <Button size="sm" variant="secondary" onClick={onCreateManual}>
              <DollarSign />
              Create a manual purchase
            </Button>
          ) : undefined
        }
      />
    );
  }

  return (
    <ul className="space-y-4">
      {groupPurchaseCards(purchases).map((card) => (
        <PurchaseCard key={card[0].key} items={card} />
      ))}
    </ul>
  );
}

/** The amount a multi-item order card totals to, in Kajabi's "$127.00 USD" form. */
function cardTotal(items: Purchase[]): string {
  if (items.length === 1) return items[0].totalText;
  const currency = items[0].currency;
  const cents = items.reduce((sum, item) => sum + item.totalCents, 0);
  return `${formatCurrency(cents, currency)} ${currency.toUpperCase()}`;
}

function PurchaseCard({ items }: { items: Purchase[] }) {
  const time = useSiteTime();
  const first = items[0];
  return (
    <li className="overflow-hidden rounded-xl border border-hairline">
      <div className="flex flex-wrap items-start gap-x-8 gap-y-3 bg-white/[0.05] px-4 py-3">
        <div>
          <p className="text-xs text-ink-soft">{first.dateLabel}</p>
          <p className="mt-0.5 whitespace-nowrap text-sm font-semibold text-ink">{time.date(first.purchasedAt)}</p>
        </div>
        <div className="min-w-0 flex-1 basis-48">
          <p className="text-xs text-ink-soft">Total</p>
          <p className="mt-0.5 text-sm font-bold tabular-nums text-ink">{cardTotal(items)}</p>
        </div>
        <div className="ml-auto self-center text-right">
          <Link
            to={`/admin/purchases/${first.key}`}
            className="inline-block whitespace-nowrap text-sm font-semibold text-ink underline underline-offset-2 transition-colors hover:text-plum"
          >
            View Details
          </Link>
        </div>
      </div>
      <div className="divide-y divide-hairline/60">
        {items.map((item) => (
          <PurchaseItem key={item.key} item={item} />
        ))}
      </div>
    </li>
  );
}

/** Offer / Price / Quantity / Billing status / Access — Kajabi's rows, in its order. */
function PurchaseItem({ item }: { item: Purchase }) {
  return (
    <dl className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-4 gap-y-2.5 px-4 py-4 text-sm sm:grid-cols-[8rem_minmax(0,1fr)] sm:px-8">
      <dt className="text-ink-soft">Offer</dt>
      <dd className="font-semibold text-ink">
        {item.offerId ? (
          <Link to={`/admin/offers/${item.offerId}`} className="underline underline-offset-2 hover:text-plum">
            {item.offerTitle || "An offer"}
          </Link>
        ) : (
          item.offerTitle || "A purchase"
        )}
        {item.gift && (
          <Badge tone="plum" className="ml-2 align-middle">
            Gift
          </Badge>
        )}
      </dd>

      <dt className="text-ink-soft">Price</dt>
      <dd className="flex flex-wrap items-center gap-2 text-ink">
        {item.pricePill && <Badge tone="slate">{item.pricePill}</Badge>}
        <span className="font-bold tabular-nums">{item.priceText}</span>
      </dd>

      <dt className="text-ink-soft">Quantity</dt>
      <dd className="font-bold tabular-nums text-ink">{item.quantity}</dd>

      {item.billing && (
        <>
          <dt className="text-ink-soft">Billing status</dt>
          <dd className="flex flex-wrap items-center gap-x-2 gap-y-1 text-ink">
            <Badge tone={item.billing.tone}>{item.billing.label}</Badge>
            {item.billing.pausedBy && <span className="text-ink-soft">by {item.billing.pausedBy}</span>}
            {item.billing.progressText && (
              <span className="basis-full font-bold tabular-nums">{item.billing.progressText}</span>
            )}
          </dd>
        </>
      )}

      {item.access.revoked && (
        <>
          <dt className="text-ink-soft">Access</dt>
          <dd className="flex flex-wrap items-center gap-x-2 gap-y-1 text-ink">
            <Badge tone="red">Access revoked</Badge>
            {item.access.revokedBy && <span className="text-ink-soft">by {item.access.revokedBy}</span>}
          </dd>
        </>
      )}

      {item.note && (
        <>
          <dt className="text-ink-soft">Note</dt>
          <dd className="whitespace-pre-wrap text-ink">{item.note}</dd>
        </>
      )}
    </dl>
  );
}
