import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router";
import { toast } from "sonner";
import { ArrowLeft, Check, Copy, Plus, Trash2 } from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/format";
import { adminCommerceApi, type Offer } from "@/lib/adminCommerceApi";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorNotice,
  Field,
  Input,
  PageHeader,
  selectStyles,
  Skeleton,
  Textarea,
} from "@/pages/admin/ui/primitives";
import { RowActions } from "@/pages/admin/ui/DataTable";
import { useConfirm } from "@/pages/admin/ui/Dialog";
import { friendlyError } from "@/pages/admin/ui/friendly";
import {
  adminAffiliateApi,
  type AdminCommissionRow,
  type AdminPartnerDetail,
} from "@/lib/affiliateApi";

/**
 * One partner.
 *
 * The screen is arranged in the order the questions get asked: who are they and
 * are they active, what do they earn, what have they actually sold, and what is
 * still owed. The commission editor is the part that had to stay in her
 * vocabulary — a percentage typed as a percentage, an amount typed as money, and
 * "everything" as a real option rather than an empty field.
 */

const STATUS_LABEL: Record<string, string> = {
  pending: "Waiting on you",
  approved: "Active",
  suspended: "On hold",
  rejected: "Turned down",
};

const STATUS_TONE: Record<string, "blue" | "green" | "gold" | "slate"> = {
  pending: "blue",
  approved: "green",
  suspended: "gold",
  rejected: "slate",
};

interface RuleDraft {
  offerId: number | null;
  kind: "percent" | "fixed" | "none";
  /**
   * Both numbers are held as the text she is typing, not as a number.
   * Re-formatting a money box on every keystroke means "50" becomes "5.00"
   * after the first digit and the second one lands after the decimal point —
   * she could never type a rate above $9.99, or a half-percent at all.
   */
  percent: string;
  amount: string;
  payOnEveryRenewal: boolean;
}

const EMPTY_RULE: RuleDraft = {
  offerId: null,
  kind: "percent",
  percent: "30",
  amount: "",
  payOnEveryRenewal: false,
};

/** Stored pennies → what she typed: 5000 → "50", 5050 → "50.50". */
function centsToInput(cents: number): string {
  if (!cents) return "";
  return (cents / 100).toFixed(2).replace(/\.00$/, "");
}

export default function AffiliateDetail() {
  const { id } = useParams<{ id: string }>();
  const partnerId = Number(id);

  const [data, setData] = useState<AdminPartnerDetail | null>(null);
  const [ledger, setLedger] = useState<AdminCommissionRow[]>([]);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [savingDetails, setSavingDetails] = useState(false);
  const [rule, setRule] = useState<RuleDraft | null>(null);
  const [savingRule, setSavingRule] = useState(false);
  const [confirm, confirmDialog] = useConfirm();

  const [notes, setNotes] = useState("");
  const [payoutMethod, setPayoutMethod] = useState("");
  const [payoutDetails, setPayoutDetails] = useState("");

  const load = useCallback(() => {
    if (!Number.isInteger(partnerId) || partnerId <= 0) {
      setError("We couldn't find that partner.");
      return;
    }
    adminAffiliateApi
      .detail(partnerId)
      .then((detail) => {
        setData(detail);
        setNotes(detail.partner.notes);
        setPayoutMethod(detail.partner.payoutMethod);
        setPayoutDetails(detail.partner.payoutDetails);
        setError(null);
      })
      .catch((err) => setError(friendlyError(err, "partner")));

    adminAffiliateApi
      .transactions({ affiliateId: partnerId, limit: 50 })
      .then((page) => setLedger(page.transactions))
      .catch(() => undefined);
  }, [partnerId]);

  useEffect(load, [load]);

  useEffect(() => {
    adminCommerceApi
      .offerList()
      .then(setOffers)
      // Without the offer list the per-offer rule editor simply offers
      // "everything", which is still a usable screen.
      .catch(() => undefined);
  }, []);

  async function saveDetails(event: FormEvent) {
    event.preventDefault();
    setSavingDetails(true);
    try {
      await adminAffiliateApi.update(partnerId, { notes, payoutMethod, payoutDetails });
      toast.success("Saved");
      load();
    } catch (err) {
      toast.error(friendlyError(err, "partner"));
    } finally {
      setSavingDetails(false);
    }
  }

  async function saveRule(event: FormEvent) {
    event.preventDefault();
    if (!rule) return;
    const percent = Number(rule.percent) || 0;
    // The server caps a share at 100 and answers with a form error she cannot
    // act on, because nothing on screen is highlighted. Said here instead.
    if (rule.kind === "percent" && percent > 100) {
      toast.error("A share can't be more than 100%.");
      return;
    }
    setSavingRule(true);
    try {
      await adminAffiliateApi.saveRule({
        affiliateId: partnerId,
        offerId: rule.offerId,
        kind: rule.kind,
        percent,
        amountCents: Math.round((Number(rule.amount) || 0) * 100),
        payOnEveryRenewal: rule.payOnEveryRenewal,
      });
      toast.success("Saved");
      setRule(null);
      load();
    } catch (err) {
      toast.error(friendlyError(err, "rule"));
    } finally {
      setSavingRule(false);
    }
  }

  async function removeRule(ruleId: number, appliesTo: string) {
    const ok = await confirm({
      title: `Remove the rule for ${appliesTo}?`,
      description: "They'll go back to earning whatever everyone else earns.",
      confirmLabel: "Yes, remove it",
      destructive: true,
    });
    if (!ok) return;
    try {
      await adminAffiliateApi.deleteRule(ruleId);
      load();
    } catch (err) {
      toast.error(friendlyError(err, "rule"));
    }
  }

  async function setStatus(approve: boolean) {
    try {
      if (approve) await adminAffiliateApi.approve(partnerId);
      else await adminAffiliateApi.reject(partnerId, { suspend: true });
      toast.success("Saved");
      load();
    } catch (err) {
      toast.error(friendlyError(err, "partner"));
    }
  }

  if (error) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/admin/partners">
            <ArrowLeft />
            Back to your partners
          </Link>
        </Button>
        <ErrorNotice message={error} />
      </div>
    );
  }

  if (!data) return <Skeleton className="h-96 w-full" />;

  const partner = data.partner;

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" asChild>
        <Link to="/admin/partners">
          <ArrowLeft />
          Back to your partners
        </Link>
      </Button>

      <PageHeader
        eyebrow="Partner"
        title={partner.name}
        description={partner.email}
        actions={
          <>
            <Badge tone={STATUS_TONE[partner.status] ?? "neutral"}>
              {STATUS_LABEL[partner.status] ?? partner.status}
            </Badge>
            {partner.status === "approved" ? (
              <Button variant="secondary" size="sm" onClick={() => void setStatus(false)}>
                Put on hold
              </Button>
            ) : (
              <Button size="sm" onClick={() => void setStatus(true)}>
                <Check />
                Make them active
              </Button>
            )}
          </>
        }
      />

      <div className="grid gap-5 lg:grid-cols-4">
        {[
          { label: "Sales sent", value: String(partner.sales) },
          { label: "Clicks", value: String(partner.clicks) },
          { label: "Earned", value: formatCurrency(partner.earnedCents) },
          { label: "Still owed", value: formatCurrency(partner.owedCents) },
        ].map((tile) => (
          <Card key={tile.label} className="p-5">
            <p className="text-[0.68rem] font-bold uppercase tracking-[0.1em] text-ink-soft">
              {tile.label}
            </p>
            <p className="mt-2 font-display text-2xl text-ink">{tile.value}</p>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader title="Their link" subtitle="This is what they share." />
        <div className="flex flex-wrap items-center gap-3 p-5">
          <code className="min-w-0 flex-1 truncate rounded-xl border border-hairline bg-white/[0.04] px-4 py-3 text-sm text-ink">
            {partner.shareLink}
          </code>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              void navigator.clipboard
                .writeText(partner.shareLink)
                .then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                })
                .catch(() => toast.error("Your browser wouldn't let us copy that."));
            }}
          >
            {copied ? <Check /> : <Copy />}
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="What they earn"
          subtitle={`On everything, unless a rule below says otherwise: ${partner.commission.label}.`}
          action={
            <Button size="sm" onClick={() => setRule({ ...EMPTY_RULE })}>
              <Plus />
              Set a different rate
            </Button>
          }
        />

        {data.rules.length === 0 ? (
          <EmptyState
            icon={<Plus />}
            title="No special rates"
            description="They earn the same as every other partner. Set a different rate for one of your offers if you've agreed something else."
          />
        ) : (
          <ul className="divide-y divide-hairline/60">
            {data.rules.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center gap-4 px-5 py-3.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">{row.appliesTo}</p>
                  <p className="text-xs text-ink-soft">
                    {row.commission.label}
                    {row.payOnEveryRenewal ? " · paid again on every renewal" : ""}
                  </p>
                </div>
                <RowActions>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      setRule({
                        offerId: row.offerId,
                        kind: row.commissionKind,
                        percent: String(row.commissionPercent),
                        amount: centsToInput(row.commissionAmountCents),
                        payOnEveryRenewal: row.payOnEveryRenewal,
                      })
                    }
                  >
                    Edit
                  </Button>
                  <Button
                    variant="dangerGhost"
                    size="iconSm"
                    aria-label={`Remove the rule for ${row.appliesTo}`}
                    onClick={() => void removeRule(row.id, row.appliesTo)}
                  >
                    <Trash2 />
                  </Button>
                </RowActions>
              </li>
            ))}
          </ul>
        )}

        {rule && (
          <form onSubmit={saveRule} className="grid gap-4 border-t border-hairline/60 p-5 sm:grid-cols-2">
            <Field label="This applies to">
              <select
                value={rule.offerId ?? ""}
                onChange={(e) =>
                  setRule({ ...rule, offerId: e.target.value ? Number(e.target.value) : null })
                }
                className={selectStyles}
              >
                <option value="">Everything they sell</option>
                {offers.map((offer) => (
                  <option key={offer.id} value={offer.id}>
                    {offer.title}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="How they're paid">
              <select
                value={rule.kind}
                onChange={(e) =>
                  setRule({ ...rule, kind: e.target.value as RuleDraft["kind"] })
                }
                className={selectStyles}
              >
                <option value="percent">A share of each sale</option>
                <option value="fixed">A fixed amount per sale</option>
                <option value="none">Nothing at all</option>
              </select>
            </Field>

            {rule.kind === "percent" && (
              <Field label="Their share">
                <div className="relative">
                  <Input
                    inputMode="decimal"
                    value={rule.percent}
                    onChange={(e) =>
                      setRule({ ...rule, percent: e.target.value.replace(/[^0-9.]/g, "") })
                    }
                    className="pr-8"
                  />
                  <span
                    aria-hidden
                    className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-sm font-semibold text-ink-soft"
                  >
                    %
                  </span>
                </div>
              </Field>
            )}

            {rule.kind === "fixed" && (
              <Field label="Amount per sale">
                <div className="relative">
                  <span
                    aria-hidden
                    className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-semibold text-ink-soft"
                  >
                    $
                  </span>
                  <Input
                    className="pl-8"
                    inputMode="decimal"
                    value={rule.amount}
                    onChange={(e) =>
                      setRule({ ...rule, amount: e.target.value.replace(/[^0-9.]/g, "") })
                    }
                  />
                </div>
              </Field>
            )}

            <label className="flex cursor-pointer items-center gap-2.5 text-sm font-medium text-ink sm:col-span-2">
              <input
                type="checkbox"
                checked={rule.payOnEveryRenewal}
                onChange={(e) => setRule({ ...rule, payOnEveryRenewal: e.target.checked })}
                className="size-4 rounded border-hairline text-plum"
              />
              Pay them again every time a subscription renews
            </label>

            <div className="flex gap-2 sm:col-span-2">
              <Button type="submit" size="sm" disabled={savingRule}>
                {savingRule ? "Saving…" : "Save this rate"}
              </Button>
              <Button type="button" variant="secondary" size="sm" onClick={() => setRule(null)}>
                Cancel
              </Button>
            </div>
          </form>
        )}
      </Card>

      <Card>
        <CardHeader title="What they've earned" subtitle="Every sale, and every refund that reversed one." />
        {ledger.length === 0 ? (
          <EmptyState
            icon={<Plus />}
            title="Nothing yet"
            description="Earnings appear here as soon as somebody buys through their link."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[38rem] text-left text-sm">
              <thead className="bg-cream/70">
                <tr className="text-[0.68rem] uppercase tracking-[0.1em] text-ink-soft">
                  <th scope="col" className="px-5 py-3 font-bold">
                    What
                  </th>
                  <th scope="col" className="px-5 py-3 font-bold">
                    Customer
                  </th>
                  <th scope="col" className="px-5 py-3 font-bold">
                    When
                  </th>
                  <th scope="col" className="px-5 py-3 text-right font-bold">
                    They earned
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline/60">
                {ledger.map((row) => (
                  <tr key={row.id}>
                    <td className="px-5 py-3 text-ink">
                      {row.kind === "clawback"
                        ? `Refunded — ${row.offerTitle ?? "a purchase"}`
                        : (row.offerTitle ?? "A purchase")}
                    </td>
                    <td className="px-5 py-3 text-ink-soft">{row.customerEmail ?? "—"}</td>
                    <td className="px-5 py-3 text-ink-soft">{formatDate(row.createdAt)}</td>
                    <td
                      className={
                        row.amountCents < 0
                          ? "px-5 py-3 text-right tabular-nums text-red-300"
                          : "px-5 py-3 text-right tabular-nums text-ink"
                      }
                    >
                      {formatCurrency(row.amountCents, row.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <CardHeader title="Sales they've sent" />
        {data.orders.length === 0 ? (
          <EmptyState icon={<Plus />} title="No sales yet" />
        ) : (
          <ul className="divide-y divide-hairline/60">
            {data.orders.map((order) => (
              <li key={order.id} className="flex flex-wrap items-center gap-4 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-ink">{order.offerTitle ?? "A purchase"}</p>
                  <p className="truncate text-xs text-ink-soft">{order.customerEmail}</p>
                </div>
                <span className="text-xs text-ink-soft">{formatDate(order.createdAt)}</span>
                <span className="whitespace-nowrap tabular-nums text-sm text-ink">
                  {formatCurrency(order.totalCents)}
                </span>
                {order.status === "refunded" && <Badge tone="slate">Refunded</Badge>}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader title="How you pay them, and anything you want to remember" />
        <form onSubmit={saveDetails} className="grid gap-4 p-5 sm:grid-cols-2">
          <Field label="How they want to be paid">
            <Input
              value={payoutMethod}
              onChange={(e) => setPayoutMethod(e.target.value)}
              placeholder="PayPal"
            />
          </Field>
          <Field label="Where to send it">
            <Input
              value={payoutDetails}
              onChange={(e) => setPayoutDetails(e.target.value)}
              placeholder="them@example.com"
            />
          </Field>
          <Field label="Your notes" className="sm:col-span-2">
            <Textarea
              rows={4}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Only you can see this."
            />
          </Field>
          <div className="sm:col-span-2">
            <Button type="submit" size="sm" disabled={savingDetails}>
              {savingDetails ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      </Card>

      {confirmDialog}
    </div>
  );
}
