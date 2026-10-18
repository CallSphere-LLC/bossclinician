import { useState } from "react";
import { Copy, CreditCard, ExternalLink, Link2, Power } from "lucide-react";
import { toast } from "sonner";
import {
  adminCommerceApi,
  commerceMessage,
  priceSummary,
  type OfferDetail,
  type OfferPaymentLinkPrice,
} from "@/lib/adminCommerceApi";
import { Badge, Button, Card, CardHeader } from "@/pages/admin/ui/primitives";
import { shareLink } from "@/pages/admin/ui/friendly";

type Confirm = (options: {
  title: string;
  description?: string;
  confirmLabel?: string;
  destructive?: boolean;
}) => Promise<boolean>;

/**
 * "Can we add a stripe pay link to check out" (QA row 92).
 *
 * A link to send someone, for every price on the offer's checkout:
 *  - the checkout link — this site's own checkout, opened on that price; it
 *    handles every kind of price, order bumps, coupons and tax;
 *  - a Stripe payment link — a stripe.com page for that one price, made only
 *    when she presses the button. A payment through it is fulfilled like a
 *    checkout order: account, access, receipt and sign-in email.
 */
export default function OfferPaymentLinks({
  offer,
  onChanged,
  confirm,
}: {
  offer: OfferDetail;
  onChanged: () => void;
  confirm: Confirm;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const prices: OfferPaymentLinkPrice[] =
    offer.paymentLinkPrices ??
    // An older server: no Stripe links, but the checkout links still work.
    [null, ...offer.pricingOptions.map((option) => option.id)].map((pricingOptionId) => ({
      pricingOptionId,
      label: "",
      supported: false,
      reason: null,
      link: null,
      outOfDate: false,
    }));
  const hasOptions = offer.pricingOptions.length > 0;

  function describe(price: OfferPaymentLinkPrice): { name: string; summary: string } {
    if (price.pricingOptionId === null) return { name: "Main price", summary: priceSummary(offer) };
    const option = offer.pricingOptions.find((entry) => entry.id === price.pricingOptionId);
    return {
      name: option?.label || price.label || "Payment option",
      summary: option ? priceSummary(option) : "",
    };
  }

  /** The checkout opened on this price; `option=0` is the main price. */
  function checkoutLink(price: OfferPaymentLinkPrice): string {
    const base = shareLink("checkout", offer.slug);
    return hasOptions ? `${base}?option=${price.pricingOptionId ?? 0}` : base;
  }

  async function copy(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${what} copied`);
    } catch {
      toast.error("Your browser didn't let us copy. Select the link and copy it instead.");
    }
  }

  async function create(price: OfferPaymentLinkPrice) {
    const { name, summary } = describe(price);
    const ok = await confirm({
      title: "Create a Stripe payment link?",
      description: `Anyone with the link can pay ${summary || "this price"} on stripe.com and gets this offer straight away, with the same receipt and sign-in email as the checkout. Order bumps, coupons and tax aren't added on Stripe's page.`,
      confirmLabel: "Create link",
    });
    if (!ok) return;
    setBusy(`create-${price.pricingOptionId ?? 0}`);
    try {
      const link = await adminCommerceApi.paymentLinkCreate(offer.id, price.pricingOptionId);
      toast.success(`Stripe payment link ready for ${name}`);
      void copy(link.url, "Payment link");
      onChanged();
    } catch (err) {
      toast.error(commerceMessage(err, "payment link"));
    } finally {
      setBusy(null);
    }
  }

  async function deactivate(price: OfferPaymentLinkPrice) {
    if (!price.link) return;
    const ok = await confirm({
      title: "Switch this payment link off?",
      description:
        "Anyone who opens it will be told it's no longer available. Everyone who already paid keeps what they bought. You can make a new link afterwards.",
      confirmLabel: "Switch it off",
      destructive: true,
    });
    if (!ok) return;
    setBusy(`off-${price.link.id}`);
    try {
      await adminCommerceApi.paymentLinkDeactivate(offer.id, price.link.id);
      toast.success("Payment link switched off");
      onChanged();
    } catch (err) {
      toast.error(commerceMessage(err, "payment link"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader
        icon={<Link2 className="size-4" />}
        title="Payment links"
        subtitle="A link to send someone for each price — this site's checkout, or a Stripe payment page"
      />
      <ul className="space-y-2 p-5 pt-0">
        {prices.map((price) => {
          const { name, summary } = describe(price);
          const key = price.pricingOptionId ?? 0;
          return (
            <li key={key} className="rounded-xl border border-hairline px-4 py-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink">{name}</p>
                  {summary && <p className="text-xs font-semibold tabular-nums text-ink-soft">{summary}</p>}
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => void copy(checkoutLink(price), "Checkout link")}
                >
                  <Copy />
                  Copy checkout link
                </Button>
              </div>

              <div className="mt-3 border-t border-hairline/70 pt-3">
                {price.link ? (
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone="green">Stripe link live</Badge>
                      {price.outOfDate && <Badge tone="red">Price changed</Badge>}
                    </div>
                    <p className="break-all text-xs text-ink-soft">{price.link.url}</p>
                    {price.outOfDate && (
                      <p className="text-xs text-red-300">
                        This link still charges the old price. Switch it off and make a new one.
                      </p>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" size="sm" variant="secondary" onClick={() => void copy(price.link!.url, "Payment link")}>
                        <Copy />
                        Copy
                      </Button>
                      <Button asChild size="sm" variant="secondary">
                        <a href={price.link.url} target="_blank" rel="noreferrer">
                          <ExternalLink />
                          Open
                        </a>
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="dangerGhost"
                        disabled={busy === `off-${price.link.id}`}
                        onClick={() => void deactivate(price)}
                      >
                        <Power />
                        {busy === `off-${price.link.id}` ? "Switching off…" : "Switch off"}
                      </Button>
                    </div>
                  </div>
                ) : price.supported ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={busy === `create-${key}`}
                    onClick={() => void create(price)}
                  >
                    <CreditCard />
                    {busy === `create-${key}` ? "Creating…" : "Create Stripe payment link"}
                  </Button>
                ) : (
                  price.reason && (
                    <p className="text-xs text-ink-soft">
                      <span className="font-semibold text-ink">No Stripe payment link: </span>
                      {price.reason}
                    </p>
                  )
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
