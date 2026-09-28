import { useEffect, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router";
import { ArrowLeft, CalendarClock, CreditCard, Package, ReceiptText, UserRound } from "lucide-react";
import {
  accessDateText,
  purchasesApi,
  transactionTone,
  type Purchase,
  type PurchaseDetail as Detail,
} from "@/lib/purchasesApi";
import { Badge, Card, CardHeader, ErrorNotice, Skeleton } from "@/pages/admin/ui/primitives";
import { friendlyError, pluralize } from "@/pages/admin/ui/friendly";
import { useSiteTime } from "@/pages/admin/ui/siteTime";

/**
 * One purchase's View Details page (/admin/purchases/:id), laid out as
 * Kajabi's is (QA sheet row 30).
 *
 * For a payment plan: the heading "Payment Plan", the customer, the offer with
 * its status, "Part of order no. #1004", when it started and what is due next
 * ("Payments paused" or "$250.00 USD on 2026-10-20"); then the Payment Plan
 * details and Customer details cards side by side, the item with its access
 * dates, and every transaction — paid, refunded, and the one still to come
 * ("Upcoming · Scheduled for Oct 20, 2026").
 *
 * A one-time purchase or a grant gets the same page with what applies to it:
 * Kajabi links a grant to its own simpler page, and so does this.
 */
export default function PurchaseDetail() {
  const { id = "" } = useParams();
  const time = useSiteTime();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    setDetail(null);
    setError(null);
    purchasesApi
      .get(id)
      .then((body) => current && setDetail(body))
      .catch((err) => current && setError(friendlyError(err, "purchase")));
    return () => {
      current = false;
    };
  }, [id]);

  if (error) {
    return (
      <div className="space-y-6">
        <Link
          to="/admin/contacts"
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-soft transition-colors hover:text-plum"
        >
          <ArrowLeft className="size-4" />
          Back to contacts
        </Link>
        <ErrorNotice message={error} />
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="space-y-6" aria-busy="true">
        <Skeleton className="h-5 w-72" />
        <Skeleton className="h-28 w-full" />
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <Skeleton className="h-56 w-full" />
          <Skeleton className="h-56 w-full" />
        </div>
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const { purchase, contact, customer } = detail;
  const plan = purchase.plan;
  const who = contact?.name || contact?.email || customer.name || "Customer";
  const profile = contact ? `/admin/contacts/${contact.id}?tab=purchases` : null;
  const statusBadge = purchase.billing
    ? { label: purchase.billing.label, tone: purchase.billing.tone }
    : purchase.kind === "grant"
      ? { label: "Granted", tone: "slate" as const }
      : purchase.status === "refunded"
        ? { label: "Refunded", tone: "slate" as const }
        : null;

  return (
    <div className="space-y-6">
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-2 text-sm">
        <Link to="/admin/contacts" className="font-semibold text-ink-soft transition-colors hover:text-plum">
          Contacts
        </Link>
        <Slash />
        {profile ? (
          <Link to={profile} className="max-w-[16rem] truncate font-semibold text-ink-soft transition-colors hover:text-plum">
            {who}
          </Link>
        ) : (
          <span className="font-semibold text-ink-soft">{who}</span>
        )}
        <Slash />
        {profile ? (
          <Link to={profile} className="font-semibold text-ink-soft transition-colors hover:text-plum">
            Purchases
          </Link>
        ) : (
          <span className="font-semibold text-ink-soft">Purchases</span>
        )}
        <Slash />
        <span className="max-w-[20rem] truncate font-semibold text-ink" aria-current="page">
          {purchase.offerTitle || detail.heading}
        </span>
      </nav>

      <header className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-soft">{detail.heading}</p>
        <h1 className="font-display text-3xl text-ink">
          {profile ? (
            <Link to={profile} className="hover:text-plum">
              {who}
            </Link>
          ) : (
            who
          )}
        </h1>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-semibold text-ink">{purchase.offerTitle || "A purchase"}</span>
          {statusBadge && <Badge tone={statusBadge.tone}>{statusBadge.label}</Badge>}
        </div>
        <dl className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
          {purchase.orderNo && (
            <Fact label="Part of order no." value={<span className="font-bold tabular-nums">#{purchase.orderNo}</span>} />
          )}
          <Fact
            label={plan || purchase.kind === "subscription" ? "Started on" : purchase.dateLabel}
            value={time.date(purchase.purchasedAt)}
          />
          {plan?.upcomingText && <Fact label="Upcoming payment" value={<Upcoming text={plan.upcomingText} />} />}
        </dl>
      </header>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {plan ? (
          <Card>
            <CardHeader title="Payment Plan details" icon={<CalendarClock className="size-4" />} />
            <dl className="divide-y divide-hairline/60 px-5 text-sm">
              <Row label="Started on" value={time.date(plan.startedAt)} />
              <Row label="Setup fee" value={<Amount>{plan.setupFeeText ?? "None"}</Amount>} />
              <Row label="Billing interval" value={plan.billingIntervalText ?? "Not known"} />
              <Row
                label="Remaining payments"
                value={plan.remainingPayments === null ? "Not known" : <Amount>{plan.remainingPayments}</Amount>}
              />
              {purchase.billing?.progressText && (
                <Row label="Payments completed" value={<Amount>{purchase.billing.progressText}</Amount>} />
              )}
              {purchase.billing?.pausedBy && <Row label="Paused by" value={purchase.billing.pausedBy} />}
              {purchase.billing?.endedAt && purchase.status === "completed" && (
                <Row label="Completed on" value={time.date(purchase.billing.endedAt)} />
              )}
            </dl>
          </Card>
        ) : (
          <Card>
            <CardHeader
              title={purchase.kind === "grant" ? "Grant details" : "Purchase details"}
              icon={<ReceiptText className="size-4" />}
            />
            <dl className="divide-y divide-hairline/60 px-5 text-sm">
              <Row label={purchase.dateLabel} value={time.date(purchase.purchasedAt)} />
              <Row label="Total" value={<Amount>{purchase.totalText}</Amount>} />
              {purchase.refundedCents > 0 && (
                <Row label="Refunded" value={<Amount>{refundText(detail)}</Amount>} />
              )}
              {purchase.note && <Row label="Note" value={<span className="whitespace-pre-wrap">{purchase.note}</span>} />}
            </dl>
          </Card>
        )}

        <Card>
          <CardHeader title="Customer details" icon={<UserRound className="size-4" />} />
          <dl className="divide-y divide-hairline/60 px-5 text-sm">
            <Row
              label="Customer"
              value={
                <span className="block min-w-0">
                  {profile ? (
                    <Link to={profile} className="font-semibold text-ink underline underline-offset-2 hover:text-plum">
                      {customer.name || who}
                    </Link>
                  ) : (
                    <span className="font-semibold">{customer.name || who}</span>
                  )}
                  {customer.email && (
                    <a href={`mailto:${customer.email}`} className="block break-all text-ink-soft hover:text-plum">
                      {customer.email}
                    </a>
                  )}
                </span>
              }
            />
            <Row
              label="Address"
              value={
                customer.address.length > 0 ? (
                  <span className="block">
                    {customer.address.map((line) => (
                      <span key={line} className="block">
                        {line}
                      </span>
                    ))}
                  </span>
                ) : (
                  <Muted>Not given</Muted>
                )
              }
            />
            <Row label="Phone number" value={customer.phone ?? <Muted>Not given</Muted>} />
            <Row
              label="Payment method"
              value={
                customer.paymentMethod ? (
                  <span className="inline-flex items-center gap-2">
                    <CreditCard className="size-4 text-ink-soft" aria-hidden />
                    <span className="tabular-nums">{customer.paymentMethod}</span>
                  </span>
                ) : (
                  <Muted>{purchase.source === "kajabi" ? "Held by Kajabi" : "Not on file"}</Muted>
                )
              }
            />
          </dl>
        </Card>
      </div>

      <Card>
        <CardHeader title={pluralize(detail.items.length, "item")} icon={<Package className="size-4" />} />
        <ul className="divide-y divide-hairline/60">
          {detail.items.map((item) => (
            <ItemRow key={item.key} item={item} formatDay={time.date} />
          ))}
        </ul>
      </Card>

      <Card>
        <CardHeader title="Transactions" icon={<ReceiptText className="size-4" />} />
        {detail.transactions.length === 0 ? (
          <p className="px-5 py-6 text-sm text-ink-soft">
            {purchase.kind === "grant"
              ? "Nothing was charged — this offer was granted."
              : purchase.kind === "free"
                ? "Nothing was charged — this offer was free."
                : "No payments are recorded for this purchase."}
          </p>
        ) : (
          <ul className="divide-y divide-hairline/60">
            {detail.transactions.map((line) => (
              <li key={line.key} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-5 py-3.5 text-sm">
                <span className="min-w-[7.5rem] font-bold tabular-nums text-ink">
                  {line.status === "refunded" ? `−${line.amountText}` : line.amountText}
                </span>
                <Badge tone={transactionTone(line.status)}>{line.statusText}</Badge>
                <span className="ml-auto text-ink-soft">
                  {line.status === "upcoming" ? `Scheduled for ${time.date(line.at)}` : time.dateTime(line.at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

/** Refunds, summed from the Transactions list so the figure always agrees with it. */
function refundText(detail: Detail): string {
  const refunds = detail.transactions.filter((t) => t.status === "refunded");
  if (refunds.length === 1) return refunds[0].amountText;
  const currency = detail.purchase.currency.toUpperCase();
  const cents = detail.purchase.refundedCents;
  return `${new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: 2 }).format(cents / 100)} ${currency}`;
}

/** One offer of the purchase: picture, title, price, quantity, and the dates it gave access. */
function ItemRow({ item, formatDay }: { item: Purchase; formatDay: (value: string) => string }) {
  return (
    <li className="flex flex-col gap-4 px-5 py-4 sm:flex-row sm:items-start">
      {item.offerThumbnailUrl ? (
        <img
          src={item.offerThumbnailUrl}
          alt=""
          className="h-20 w-32 shrink-0 rounded-lg border border-hairline object-cover"
          loading="lazy"
        />
      ) : (
        <span className="grid h-20 w-32 shrink-0 place-items-center rounded-lg border border-hairline bg-white/[0.04] text-ink-soft">
          <Package className="size-6" aria-hidden />
        </span>
      )}
      <dl className="grid min-w-0 flex-1 grid-cols-[7rem_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
        <dt className="text-ink-soft">Offer</dt>
        <dd className="font-semibold text-ink">
          {item.offerId ? (
            <Link to={`/admin/offers/${item.offerId}`} className="underline underline-offset-2 hover:text-plum">
              {item.offerTitle || "An offer"}
            </Link>
          ) : (
            item.offerTitle || "A purchase"
          )}
        </dd>
        <dt className="text-ink-soft">Price</dt>
        <dd className="flex flex-wrap items-center gap-2 text-ink">
          {item.pricePill && <Badge tone="slate">{item.pricePill}</Badge>}
          <span className="font-bold tabular-nums">{item.priceText}</span>
        </dd>
        <dt className="text-ink-soft">Quantity</dt>
        <dd className="font-bold tabular-nums text-ink">{item.quantity}</dd>
        <dt className="text-ink-soft">Access date</dt>
        <dd className="text-ink">{accessDateText(item.access, formatDay)}</dd>
        {item.access.revoked && (
          <>
            <dt className="text-ink-soft">Access</dt>
            <dd className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <Badge tone="red">Access revoked</Badge>
              {item.access.revokedBy && <span className="text-ink-soft">by {item.access.revokedBy}</span>}
            </dd>
          </>
        )}
      </dl>
    </li>
  );
}

/** "Payments paused" reads as a state; "$250.00 USD on 2026-10-20" as a figure. */
function Upcoming({ text }: { text: string }) {
  return /\d/.test(text) ? <span className="font-bold tabular-nums">{text}</span> : <span>{text}</span>;
}

function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-ink-soft">{label}</dt>
      <dd className="mt-0.5 font-semibold text-ink">{value}</dd>
    </div>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-1 py-3 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-4">
      <dt className="text-ink-soft">{label}</dt>
      <dd className="min-w-0 break-words text-ink">{value}</dd>
    </div>
  );
}

function Amount({ children }: { children: ReactNode }) {
  return <span className="font-bold tabular-nums">{children}</span>;
}

function Muted({ children }: { children: ReactNode }) {
  return <span className="text-ink-soft">{children}</span>;
}

function Slash() {
  return (
    <span className="text-ink-soft" aria-hidden>
      /
    </span>
  );
}
