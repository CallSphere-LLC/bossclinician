import { Field, Input, selectStyles } from "@/pages/admin/ui/primitives";
import type { AdminAccessGroup } from "@/types/admin";

/**
 * An access group's price, with Kajabi's choices: Free, or Paid as a
 * One-time payment, a Subscription (monthly or yearly, optional free trial)
 * or Multiple payments (N payments of $X, one every week/month/year). Saving
 * writes them onto the group's checkout offer, which the checkout charges as
 * one_time / subscription / payment_plan.
 */
export type GroupPricingType =
  | "free"
  | "one_time"
  | "subscription"
  | "payment_plan";
export type GroupInterval = "week" | "month" | "year";

export interface GroupPricingForm {
  /** "" = leave the group's pricing as it is (edit form only). */
  pricingType: GroupPricingType | "";
  /** Dollars. For Multiple payments, ONE payment, not the total. */
  amount: string;
  currency: string;
  interval: GroupInterval;
  /** Subscription only: days before the first charge. */
  trialDays: string;
  /** Multiple payments only: how many payments in total. */
  installmentCount: string;
}

export const PAID_PRICE_TYPES: { value: Exclude<GroupPricingType, "free">; label: string }[] = [
  { value: "one_time", label: "One-time payment" },
  { value: "subscription", label: "Subscription" },
  { value: "payment_plan", label: "Multiple payments" },
];

const EVERY: Record<GroupInterval, string> = {
  week: "weekly",
  month: "monthly",
  year: "yearly",
};

export function groupPricingForm(group?: AdminAccessGroup): GroupPricingForm {
  return {
    pricingType: (group?.pricingType ??
      (group ? "" : "free")) as GroupPricingForm["pricingType"],
    amount:
      group?.amountCents == null ? "" : (group.amountCents / 100).toFixed(2),
    currency: group?.currency ?? "usd",
    interval: group?.interval ?? "month",
    trialDays: String(group?.trialDays ?? 0),
    installmentCount:
      group?.installmentCount == null ? "" : String(group.installmentCount),
  };
}

export function groupPricingPayload(form: GroupPricingForm) {
  if (!form.pricingType) return {};
  const base = {
    pricingType: form.pricingType,
    amountCents:
      form.pricingType === "free" ? 0 : Math.round(Number(form.amount) * 100),
    currency: form.currency.toLowerCase(),
  };
  switch (form.pricingType) {
    case "subscription":
      return {
        ...base,
        // Kajabi bills subscriptions monthly or yearly.
        interval: form.interval === "year" ? "year" : "month",
        trialDays: Math.max(0, Math.floor(Number(form.trialDays) || 0)),
      };
    case "payment_plan":
      return {
        ...base,
        interval: form.interval,
        installmentCount: Math.floor(Number(form.installmentCount) || 0),
      };
    default:
      return { ...base, interval: null };
  }
}

function money(cents: number, currency?: string | null) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "usd",
  }).format(cents / 100);
}

/** One line for the group list: what a buyer pays, and whether the checkout
 * can actually take money yet. */
export function groupPricingSummary(group: AdminAccessGroup): string {
  let price: string;
  const amount = money(group.amountCents || 0, group.currency);
  switch (group.pricingType) {
    case "free":
      price = "Free access";
      break;
    case "one_time":
      price = `${amount} one-time payment`;
      break;
    case "subscription":
      price = `${amount} / ${group.interval ?? "month"}`;
      if (group.trialDays) price += ` · ${group.trialDays}-day free trial`;
      break;
    case "payment_plan": {
      const every = EVERY[group.interval ?? "month"];
      const count = group.installmentCount ?? 0;
      price = `${count} ${every} payments of ${amount} (${money((group.amountCents || 0) * count, group.currency)} total)`;
      break;
    }
    default:
      return "No pricing set";
  }
  for (const label of group.checkoutOptionLabels ?? []) price += ` · or ${label}`;
  if (group.checkoutStatus === "draft") {
    price += " · checkout is a draft (publish the offer to sell it)";
  } else if (group.checkoutStatus === "archived") {
    price += " · checkout is archived";
  }
  return price;
}

export function GroupPricingFields({
  value,
  onChange,
  allowLegacy = false,
}: {
  value: GroupPricingForm;
  onChange: (v: GroupPricingForm) => void;
  allowLegacy?: boolean;
}) {
  const access =
    value.pricingType === "" ? "" : value.pricingType === "free" ? "free" : "paid";
  const set = (patch: Partial<GroupPricingForm>) =>
    onChange({ ...value, ...patch });
  const installments = Math.floor(Number(value.installmentCount) || 0);
  const each = Math.round(Number(value.amount) * 100);
  return (
    <div className="grid w-full min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
      <Field label="Access">
        <select
          aria-label="Access"
          className={selectStyles}
          value={access}
          onChange={(e) => {
            const next = e.target.value;
            set({
              pricingType:
                next === "" ? "" : next === "free" ? "free" : "one_time",
            });
          }}
        >
          {allowLegacy && <option value="">No change to pricing</option>}
          <option value="free">Free</option>
          <option value="paid">Paid</option>
        </select>
      </Field>
      {access === "paid" && (
        <>
          <Field label="Price type">
            <select
              aria-label="Price type"
              className={selectStyles}
              value={value.pricingType}
              onChange={(e) => {
                const pricingType = e.target.value as GroupPricingType;
                set({
                  pricingType,
                  // Subscriptions bill monthly or yearly; a weekly plan
                  // frequency does not carry over.
                  interval:
                    pricingType === "subscription" && value.interval === "week"
                      ? "month"
                      : value.interval,
                });
              }}
            >
              {PAID_PRICE_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </Field>

          {value.pricingType === "payment_plan" && (
            <Field
              label="Number of payments"
              hint="including the first one, 2–60"
            >
              <Input
                aria-label="Number of payments"
                type="number"
                min={2}
                max={60}
                step={1}
                required
                value={value.installmentCount}
                onChange={(e) => set({ installmentCount: e.target.value })}
              />
            </Field>
          )}

          <Field
            label={
              value.pricingType === "payment_plan" ? "Amount per payment" : "Price"
            }
            hint={
              value.pricingType === "payment_plan"
                ? "each payment, not the total; minimum $0.50"
                : "USD; minimum $0.50"
            }
          >
            <Input
              aria-label="Access group price"
              type="number"
              min="0.50"
              step="0.01"
              required
              value={value.amount}
              onChange={(e) => set({ amount: e.target.value })}
            />
          </Field>

          {value.pricingType === "subscription" && (
            <>
              <Field label="Billing frequency">
                <select
                  aria-label="Billing frequency"
                  className={selectStyles}
                  value={value.interval === "year" ? "year" : "month"}
                  onChange={(e) =>
                    set({ interval: e.target.value as GroupInterval })
                  }
                >
                  <option value="month">Monthly</option>
                  <option value="year">Yearly</option>
                </select>
              </Field>
              <Field
                label="Free trial"
                hint="days before the first charge; 0 for no trial"
              >
                <Input
                  aria-label="Free trial days"
                  type="number"
                  min={0}
                  max={365}
                  step={1}
                  value={value.trialDays}
                  onChange={(e) => set({ trialDays: e.target.value })}
                />
              </Field>
            </>
          )}

          {value.pricingType === "payment_plan" && (
            <Field label="Payment frequency">
              <select
                aria-label="Payment frequency"
                className={selectStyles}
                value={value.interval}
                onChange={(e) =>
                  set({ interval: e.target.value as GroupInterval })
                }
              >
                <option value="month">Monthly</option>
                <option value="week">Weekly</option>
                <option value="year">Yearly</option>
              </select>
            </Field>
          )}

          <p className="text-xs text-ink-soft sm:col-span-2">
            {value.pricingType === "payment_plan" && installments >= 2 && each > 0
              ? `${installments} ${EVERY[value.interval]} payments of ${money(each)} (${money(each * installments)} total). `
              : ""}
            Saving sets this price on the group's checkout, creating one if
            the group has none. Payment grants access to its assigned channels.
          </p>
        </>
      )}
    </div>
  );
}
