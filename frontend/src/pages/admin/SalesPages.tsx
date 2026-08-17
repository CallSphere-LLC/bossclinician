import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import {
  CreditCard,
  ExternalLink,
  FileText,
  Plus,
  Receipt,
  RefreshCw,
  Tag,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { adminApi } from "@/lib/api";
import type { Coupon, Invoice, Payment, Plan, Subscription } from "@/types/admin";
import { formatCurrency, formatDate } from "@/lib/format";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNotice,
  Field,
  Input,
  PageHeader,
  Textarea,
  type BadgeProps,
} from "@/pages/admin/ui/primitives";
import { DataTable, RowActions } from "@/pages/admin/ui/DataTable";
import { Modal, useConfirm } from "@/pages/admin/ui/Dialog";
import { StripeBanner } from "@/pages/admin/ui/StripeBanner";
import { friendlyError, humanizeKey, orNone, pluralize, PUBLISH_LABEL } from "@/pages/admin/ui/friendly";

/**
 * Every machine status that can reach these screens — a one-off order, a
 * payment attempt, a membership, an invoice — said the way the owner would say
 * it about her own money.
 *
 * One map rather than one per table: "past_due" has to mean the same thing on
 * Subscriptions as it does on Invoices, and none of these words ("succeeded",
 * "requires_payment_method", "incomplete_expired") tell her whether she has
 * been paid. Anything not listed falls back to a readable version of the raw
 * value instead of printing it verbatim.
 */
const MONEY_STATUS: Record<string, { label: string; tone: NonNullable<BadgeProps["tone"]> }> = {
  // One-off purchases and payment attempts
  paid: { label: "Paid", tone: "green" },
  succeeded: { label: "Paid", tone: "green" },
  pending: { label: "Waiting to be paid", tone: "gold" },
  processing: { label: "Payment going through", tone: "gold" },
  requires_payment_method: { label: "Payment failed", tone: "red" },
  requires_action: { label: "Waiting on them to confirm", tone: "gold" },
  requires_confirmation: { label: "Not finished yet", tone: "gold" },
  failed: { label: "Payment failed", tone: "red" },
  expired: { label: "Never finished", tone: "slate" },
  refunded: { label: "Refunded", tone: "slate" },

  // Memberships and plans
  active: { label: "Paying", tone: "green" },
  trialing: { label: "On a free trial", tone: "blue" },
  past_due: { label: "Payment overdue", tone: "gold" },
  unpaid: { label: "Not paying any more", tone: "red" },
  canceled: { label: "Cancelled", tone: "slate" },
  cancelled: { label: "Cancelled", tone: "slate" },
  incomplete: { label: "Never started", tone: "slate" },
  incomplete_expired: { label: "Never started", tone: "slate" },
  paused: { label: "Paused", tone: "slate" },

  // Invoices
  open: { label: "Waiting to be paid", tone: "gold" },
  draft: { label: "Not sent yet", tone: "slate" },
  uncollectible: { label: "Written off", tone: "red" },
  void: { label: "Cancelled", tone: "slate" },
};

function moneyStatus(status: string): { label: string; tone: NonNullable<BadgeProps["tone"]> } {
  return MONEY_STATUS[status] ?? { label: humanizeKey(status), tone: "neutral" };
}

function MoneyStatusBadge({ status }: { status: string }) {
  const { label, tone } = moneyStatus(status);
  return <Badge tone={tone}>{label}</Badge>;
}

/**
 * "497", "$497.00", "1,200.50" → the whole number of cents billing works in.
 *
 * She types a price the way she'd write it on an invoice; the conversion lives
 * here so "Price (cents)" never has to appear on a screen again.
 */
function dollarsToCents(input: string): number {
  const value = Number.parseFloat(input.replace(/[^0-9.]/g, ""));
  return Number.isFinite(value) ? Math.round(value * 100) : 0;
}

/* ---------------------------------------------------------------- Payments */

export function PaymentsPage() {
  const [rows, setRows] = useState<Payment[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    adminApi
      .payments()
      .then(setRows)
      .catch(() => setError("We couldn't load your payments. Try refreshing the page."));
  }, []);

  const columns = useMemo<ColumnDef<Payment, unknown>[]>(
    () => [
      {
        accessorKey: "courseTitle",
        header: "What they bought",
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="truncate font-semibold text-ink">
              {row.original.courseTitle || "A one-off purchase"}
            </p>
            <p className="truncate text-xs text-ink-soft">
              {row.original.email || "No email given"}
            </p>
          </div>
        ),
      },
      {
        accessorKey: "amountCents",
        header: "How much",
        cell: ({ row }) => (
          <span className="font-semibold tabular-nums text-ink">
            {formatCurrency(row.original.amountCents, row.original.currency)}
          </span>
        ),
      },
      {
        accessorKey: "status",
        header: "How it went",
        cell: ({ row }) => <MoneyStatusBadge status={row.original.status} />,
      },
      {
        accessorKey: "createdAt",
        header: "When",
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-sm text-ink-soft">
            {formatDate(row.original.createdAt)}
          </span>
        ),
      },
    ],
    [],
  );

  const totalPaid = (rows ?? [])
    .filter((r) => r.status === "paid")
    .reduce((sum, r) => sum + r.amountCents, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Sales"
        title="Payments"
        description="Every one-off purchase from your site — courses and anything else people buy outright."
        actions={rows && <Badge tone="green">{formatCurrency(totalPaid)} collected so far</Badge>}
      />
      <StripeBanner />
      {error && <ErrorNotice message={error} />}
      <DataTable
        columns={columns}
        data={rows}
        searchPlaceholder="Search your payments…"
        itemNoun={{ one: "payment", many: "payments" }}
        emptyState={
          <EmptyState
            icon={<CreditCard />}
            title="No payments yet"
            description="Every time someone buys from you, the purchase shows up here."
          />
        }
      />
    </div>
  );
}

/* ------------------------------------------------------------------- Plans */

export function PlansPage() {
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  // `price` is held as she typed it ("49", "49.00") and converted to cents on
  // save, so the number she reads back is always the number she meant.
  const [form, setForm] = useState({
    name: "",
    description: "",
    price: "49",
    interval: "month",
    trialDays: 0,
  });
  const [confirm, confirmDialog] = useConfirm();

  const load = useCallback(() => {
    adminApi
      .plans()
      .then(setPlans)
      .catch(() => setError("We couldn't load your plans. Try refreshing the page."));
  }, []);

  useEffect(load, [load]);

  const priceCents = dollarsToCents(form.price);
  // Only complain when there's no number in there at all — a blank box and a
  // typed 0 both mean "free for now", which was always allowed.
  const priceLooksWrong = form.price.trim() !== "" && !/\d/.test(form.price);

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || priceLooksWrong) return;
    setSaving(true);
    try {
      await adminApi.planCreate({
        name: form.name,
        description: form.description,
        priceCents,
        interval: form.interval,
        trialDays: form.trialDays,
      });
      toast.success("Plan created — people can subscribe to it now");
      setCreating(false);
      setForm({ name: "", description: "", price: "49", interval: "month", trialDays: 0 });
      load();
    } catch (err) {
      toast.error(friendlyError(err, "plan"));
    } finally {
      setSaving(false);
    }
  }

  async function remove(plan: Plan) {
    const ok = await confirm({
      title: `Delete “${plan.name}”?`,
      description:
        "Anyone already paying for it keeps being charged — stop their payments in Stripe first if that's not what you want.",
      confirmLabel: "Delete plan",
      destructive: true,
    });
    if (!ok) return;
    try {
      await adminApi.planDelete(plan.id);
      toast.success("Plan deleted");
      load();
    } catch (err) {
      toast.error(friendlyError(err, "plan"));
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Sales"
        title="Plans & Pricing"
        description="What people pay you every month or every year — for memberships and paid communities."
        actions={
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus />
            New plan
          </Button>
        }
      />
      <StripeBanner />
      {error && <ErrorNotice message={error} />}

      {plans === null ? (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <Card key={i} className="h-56 animate-pulse" />
          ))}
        </div>
      ) : plans.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Tag />}
            title="No plans yet"
            description="Set up a monthly or yearly plan and people can start paying you regularly."
            action={
              <Button size="sm" onClick={() => setCreating(true)}>
                Create plan
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {plans.map((plan) => (
            <Card key={plan.id} className="flex flex-col p-5">
              <div className="flex items-start justify-between gap-3">
                <h3 className="font-display text-lg text-ink">{plan.name}</h3>
                {!plan.published && <Badge tone="slate">{PUBLISH_LABEL.draft}</Badge>}
              </div>
              <p className="mt-1 line-clamp-2 min-h-[2.5rem] text-sm text-ink-soft">
                {plan.description || "No description yet."}
              </p>

              <p className="mt-3 font-display text-[1.7rem] leading-none text-ink">
                {formatCurrency(plan.priceCents, plan.currency)}
                <span className="ml-1 text-sm font-normal text-ink-soft">
                  {plan.interval === "year" ? "a year" : "a month"}
                </span>
              </p>
              {plan.trialDays > 0 && (
                <p className="mt-1.5 text-xs text-ink-soft">
                  Starts with {plan.trialDays} free {plan.trialDays === 1 ? "day" : "days"}
                </p>
              )}

              <div className="mt-4 flex items-center justify-between border-t border-hairline/70 pt-3">
                <span className="text-xs text-ink-soft">
                  <strong className="text-ink">{plan.activeSubscribers}</strong>{" "}
                  {plan.activeSubscribers === 1 ? "person paying" : "people paying"}
                </span>
                {/* A plan with no price set up on Stripe's side exists but can't
                    be bought — say that, rather than naming the missing object. */}
                {plan.stripePriceId ? (
                  <Badge tone="green">Ready to sell</Badge>
                ) : (
                  <Badge tone="gold">Can’t be bought yet</Badge>
                )}
              </div>

              <Button
                variant="dangerGhost"
                size="sm"
                className="mt-3 w-full"
                onClick={() => remove(plan)}
              >
                <Trash2 />
                Delete plan
              </Button>
            </Card>
          ))}
        </div>
      )}

      <Modal
        open={creating}
        onOpenChange={setCreating}
        title="New plan"
        description="Once it's saved, people can start paying for it from your site."
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button size="sm" type="submit" form="new-plan" disabled={saving || priceLooksWrong}>
              {saving ? "Creating…" : "Create plan"}
            </Button>
          </>
        }
      >
        <form id="new-plan" onSubmit={create} className="space-y-4">
          <Field label="What's this plan called?" htmlFor="plan-name">
            <Input
              id="plan-name"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Collective Membership"
              required
              autoFocus
            />
          </Field>
          <Field
            label="What do they get?"
            hint="shown next to the price"
            htmlFor="plan-desc"
          >
            <Textarea
              id="plan-desc"
              rows={2}
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="Monthly group calls, the private community and every masterclass."
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field
              label="Price"
              hint="in dollars"
              htmlFor="plan-price"
              error={priceLooksWrong ? "Type a price like 49 or 49.00." : undefined}
            >
              <div className="relative">
                <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm text-ink-soft">
                  $
                </span>
                <Input
                  id="plan-price"
                  inputMode="decimal"
                  className="pl-7"
                  value={form.price}
                  onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
                  placeholder="49"
                />
              </div>
            </Field>
            <Field label="How often?" htmlFor="plan-interval">
              <select
                id="plan-interval"
                value={form.interval}
                onChange={(e) => setForm((f) => ({ ...f, interval: e.target.value }))}
                className="h-11 w-full rounded-xl border border-hairline bg-surface px-3 text-sm outline-none focus-visible:border-plum focus-visible:ring-4 focus-visible:ring-plum/12"
              >
                <option value="month">Every month</option>
                <option value="year">Every year</option>
              </select>
            </Field>
            <Field label="Free trial" hint="days — 0 for none" htmlFor="plan-trial">
              <Input
                id="plan-trial"
                type="number"
                min={0}
                value={form.trialDays}
                onChange={(e) => setForm((f) => ({ ...f, trialDays: Number(e.target.value) }))}
              />
            </Field>
          </div>
          <p className="rounded-xl bg-cream px-3.5 py-2.5 text-xs text-ink-soft">
            They'll pay <strong className="text-ink">{formatCurrency(priceCents)}</strong>{" "}
            {form.interval === "year" ? "every year" : "every month"}
            {form.trialDays > 0
              ? `, starting after ${form.trialDays} free ${form.trialDays === 1 ? "day" : "days"}.`
              : ", starting straight away."}
          </p>
        </form>
      </Modal>

      {confirmDialog}
    </div>
  );
}

/* ----------------------------------------------------------- Subscriptions */

export function SubscriptionsPage() {
  const [rows, setRows] = useState<Subscription[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    adminApi
      .subscriptions()
      .then(setRows)
      .catch(() => setError("We couldn't load your members' payments. Try refreshing the page."));
  }, []);

  const columns = useMemo<ColumnDef<Subscription, unknown>[]>(
    () => [
      {
        accessorKey: "email",
        header: "Who",
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="truncate font-semibold text-ink">
              {row.original.email || "No email given"}
            </p>
            <p className="truncate text-xs text-ink-soft">
              {row.original.planName ?? "Not on one of your plans"}
            </p>
          </div>
        ),
      },
      {
        accessorKey: "status",
        header: "How it's going",
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <MoneyStatusBadge status={row.original.status} />
            {row.original.cancelAtPeriodEnd && <Badge tone="gold">Won’t renew</Badge>}
          </div>
        ),
      },
      {
        accessorKey: "amountCents",
        header: "How much",
        cell: ({ row }) => (
          <span className="tabular-nums text-ink">
            {formatCurrency(row.original.amountCents, row.original.currency)}
          </span>
        ),
      },
      {
        accessorKey: "currentPeriodEnd",
        header: "Next payment",
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-sm text-ink-soft">
            {orNone(
              row.original.currentPeriodEnd ? formatDate(row.original.currentPeriodEnd) : null,
              "None scheduled",
            )}
          </span>
        ),
      },
    ],
    [],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Sales"
        title="Subscriptions"
        description="Everyone paying you regularly, and where each of them is up to."
      />
      <StripeBanner />
      {error && <ErrorNotice message={error} />}
      <DataTable
        columns={columns}
        data={rows}
        searchPlaceholder="Search by name, email or plan…"
        itemNoun={{ one: "subscription", many: "subscriptions" }}
        emptyState={
          <EmptyState
            icon={<RefreshCw />}
            title="Nobody's subscribed yet"
            description="Set up a plan and share it — everyone who signs up shows up here."
          />
        }
      />
    </div>
  );
}

/* ---------------------------------------------------------------- Invoices */

export function InvoicesPage() {
  const [rows, setRows] = useState<Invoice[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    adminApi
      .invoices()
      .then(setRows)
      .catch(() => setError("We couldn't load your receipts. Try refreshing the page."));
  }, []);

  const columns = useMemo<ColumnDef<Invoice, unknown>[]>(
    () => [
      {
        accessorKey: "email",
        header: "Who",
        cell: ({ row }) => (
          <span className="font-semibold text-ink">{row.original.email || "No email given"}</span>
        ),
      },
      {
        accessorKey: "amountPaidCents",
        header: "How much they paid",
        cell: ({ row }) => (
          <span className="tabular-nums text-ink">
            {formatCurrency(row.original.amountPaidCents, row.original.currency)}
          </span>
        ),
      },
      {
        accessorKey: "status",
        header: "How it went",
        cell: ({ row }) => <MoneyStatusBadge status={row.original.status} />,
      },
      {
        accessorKey: "createdAt",
        header: "When",
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-sm text-ink-soft">
            {formatDate(row.original.createdAt)}
          </span>
        ),
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        cell: ({ row }) =>
          row.original.hostedInvoiceUrl ? (
            <RowActions>
              <Button asChild variant="ghost" size="sm">
                <a href={row.original.hostedInvoiceUrl} target="_blank" rel="noreferrer">
                  See the receipt
                  <ExternalLink />
                </a>
              </Button>
            </RowActions>
          ) : null,
      },
    ],
    [],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Sales"
        title="Invoices"
        description="A receipt for every payment a member has made towards one of your plans."
      />
      <StripeBanner />
      {error && <ErrorNotice message={error} />}
      <DataTable
        columns={columns}
        data={rows}
        searchPlaceholder="Search by name or email…"
        itemNoun={{ one: "invoice", many: "invoices" }}
        emptyState={
          <EmptyState
            icon={<Receipt />}
            title="No invoices yet"
            description="Each time a member's payment goes through, their receipt lands here."
          />
        }
      />
    </div>
  );
}

/* ----------------------------------------------------------------- Coupons */

export function CouponsPage() {
  const [rows, setRows] = useState<Coupon[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ code: "", percentOff: 20, maxRedemptions: "" });
  const [confirm, confirmDialog] = useConfirm();

  const load = useCallback(() => {
    adminApi
      .coupons()
      .then(setRows)
      .catch(() => setError("We couldn't load your coupons. Try refreshing the page."));
  }, []);

  useEffect(load, [load]);

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!form.code.trim()) return;
    setSaving(true);
    try {
      await adminApi.couponCreate({
        code: form.code,
        percentOff: form.percentOff,
        ...(form.maxRedemptions ? { maxRedemptions: Number(form.maxRedemptions) } : {}),
      });
      toast.success("Coupon created — people can use it at checkout now");
      setCreating(false);
      setForm({ code: "", percentOff: 20, maxRedemptions: "" });
      load();
    } catch (err) {
      toast.error(friendlyError(err, "coupon"));
    } finally {
      setSaving(false);
    }
  }

  async function toggle(coupon: Coupon) {
    const turningOn = !coupon.active;
    try {
      await adminApi.couponToggle(coupon.id, turningOn);
      setRows((prev) =>
        prev?.map((c) => (c.id === coupon.id ? { ...c, active: turningOn } : c)) ?? prev,
      );
      // Switching a code off is silent otherwise, and the only visible change
      // is a badge — so say plainly what just happened at the checkout.
      toast.success(
        turningOn
          ? `${coupon.code} works again — people can use it at checkout.`
          : `${coupon.code} is switched off — nobody can use it now.`,
      );
    } catch (err) {
      toast.error(friendlyError(err, "coupon"));
    }
  }

  async function remove(coupon: Coupon) {
    const ok = await confirm({
      title: `Delete the code “${coupon.code}”?`,
      description:
        "Anyone who types it in from now on will be told it doesn't exist. Discounts people have already had stay exactly as they are.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    try {
      await adminApi.couponDelete(coupon.id);
      toast.success("Coupon deleted");
      load();
    } catch (err) {
      toast.error(friendlyError(err, "coupon"));
    }
  }

  const columns = useMemo<ColumnDef<Coupon, unknown>[]>(
    () => [
      {
        accessorKey: "code",
        header: "Code",
        cell: ({ row }) => (
          <code className="rounded-lg bg-cream px-2.5 py-1 font-mono text-sm font-bold text-plum-deep">
            {row.original.code}
          </code>
        ),
      },
      {
        id: "discount",
        header: "How much off",
        cell: ({ row }) => (
          <span className="font-semibold text-ink">
            {row.original.percentOff != null
              ? `${row.original.percentOff}% off`
              : formatCurrency(row.original.amountOffCents ?? 0, row.original.currency) + " off"}
          </span>
        ),
      },
      {
        id: "usage",
        header: "Used",
        cell: ({ row }) => (
          <span className="text-sm text-ink-soft">
            {row.original.maxRedemptions
              ? `${row.original.redeemed} of ${row.original.maxRedemptions}`
              : row.original.redeemed === 0
                ? "Not used yet"
                : `Used ${pluralize(row.original.redeemed, "time")}`}
          </span>
        ),
      },
      {
        accessorKey: "active",
        header: "Can it be used?",
        cell: ({ row }) => (
          <Badge tone={row.original.active ? "green" : "slate"}>
            {row.original.active ? "Yes — it works" : "Switched off"}
          </Badge>
        ),
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        cell: ({ row }) => (
          <RowActions>
            <Button variant="ghost" size="sm" onClick={() => toggle(row.original)}>
              {row.original.active ? "Switch off" : "Switch on"}
            </Button>
            <Button
              variant="dangerGhost"
              size="iconSm"
              aria-label={`Delete the coupon ${row.original.code}`}
              onClick={() => remove(row.original)}
            >
              <Trash2 />
            </Button>
          </RowActions>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Sales"
        title="Coupons"
        description="Discount codes people type in when they're paying, so they get money off."
        actions={
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus />
            New coupon
          </Button>
        }
      />
      <StripeBanner />
      {error && <ErrorNotice message={error} />}
      <DataTable
        columns={columns}
        data={rows}
        searchPlaceholder="Search your coupons…"
        itemNoun={{ one: "coupon", many: "coupons" }}
        emptyState={
          <EmptyState
            icon={<Tag />}
            title="No coupons yet"
            description="A code that only works for a few days is the simplest way to get people to buy now."
          />
        }
      />

      <p className="text-xs text-ink-soft">
        Switching a coupon off keeps it in this list but stops it working when someone tries to pay
        — useful when a launch ends and you might want to run the same offer again. Deleting it
        removes it for good.
      </p>

      <Modal
        open={creating}
        onOpenChange={setCreating}
        title="New coupon"
        description="A code people type in when they're paying, so they get money off. You'll see how many times it's been used."
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button size="sm" type="submit" form="new-coupon" disabled={saving}>
              {saving ? "Creating…" : "Create coupon"}
            </Button>
          </>
        }
      >
        <form id="new-coupon" onSubmit={create} className="space-y-4">
          <Field
            label="What do people type in?"
            hint="we'll make it capitals"
            htmlFor="coupon-code"
          >
            <Input
              id="coupon-code"
              value={form.code}
              onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))}
              placeholder="LAUNCH20"
              required
              autoFocus
              className="font-mono"
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="How much off?" hint="as a percentage" htmlFor="coupon-percent">
              <div className="relative">
                <Input
                  id="coupon-percent"
                  type="number"
                  min={1}
                  max={100}
                  className="pr-8"
                  value={form.percentOff}
                  onChange={(e) => setForm((f) => ({ ...f, percentOff: Number(e.target.value) }))}
                />
                <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-sm text-ink-soft">
                  %
                </span>
              </div>
            </Field>
            <Field
              label="How many people can use it?"
              hint="leave blank for no limit"
              htmlFor="coupon-limit"
            >
              <Input
                id="coupon-limit"
                type="number"
                min={1}
                value={form.maxRedemptions}
                onChange={(e) => setForm((f) => ({ ...f, maxRedemptions: e.target.value }))}
                placeholder="No limit"
              />
            </Field>
          </div>
          <p className="rounded-xl bg-cream px-3.5 py-2.5 text-xs text-ink-soft">
            {form.code ? (
              <>
                Someone typing <strong className="text-ink">{form.code}</strong> pays{" "}
                <strong className="text-ink">{form.percentOff}% less</strong>
                {form.maxRedemptions
                  ? `, until ${form.maxRedemptions} people have used it.`
                  : ", however many people use it."}
              </>
            ) : (
              "Pick something short and easy to type — people copy these out of an email."
            )}
          </p>
        </form>
      </Modal>

      {confirmDialog}
    </div>
  );
}

/* ---------------------------------------------------------------- Payouts */

export function PayoutsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Sales"
        title="Payouts"
        description="Money on its way from your payments account into your bank."
      />
      <Card>
        <EmptyState
          icon={<FileText />}
          title="Your payouts live in Stripe"
          description="Stripe holds your bank details and decides when each payment lands, so we send you straight there rather than keeping a second, slightly-out-of-date copy."
          action={
            <Button asChild size="sm">
              <a href="https://dashboard.stripe.com/payouts" target="_blank" rel="noreferrer">
                See what's on its way
                <ExternalLink />
              </a>
            </Button>
          }
        />
      </Card>
    </div>
  );
}
