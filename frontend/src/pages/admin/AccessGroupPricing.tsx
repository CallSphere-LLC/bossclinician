import { Field, Input, selectStyles } from "@/pages/admin/ui/primitives";
import type { AdminAccessGroup } from "@/types/admin";
export interface GroupPricingForm {
  pricingType: "free" | "one_time" | "subscription" | "";
  amount: string;
  currency: string;
  interval: "month" | "year";
}
export function groupPricingForm(group?: AdminAccessGroup): GroupPricingForm {
  return {
    pricingType: (group?.pricingType ??
      (group ? "" : "free")) as GroupPricingForm["pricingType"],
    amount:
      group?.amountCents == null ? "" : (group.amountCents / 100).toFixed(2),
    currency: group?.currency ?? "usd",
    interval: group?.interval === "year" ? "year" : "month",
  };
}
export function groupPricingPayload(form: GroupPricingForm) {
  return form.pricingType
    ? {
        pricingType: form.pricingType,
        amountCents:
          form.pricingType === "free"
            ? 0
            : Math.round(Number(form.amount) * 100),
        currency: form.currency.toLowerCase(),
        interval: form.pricingType === "subscription" ? form.interval : null,
      }
    : {};
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
  const paid =
    value.pricingType === "one_time" || value.pricingType === "subscription";
  return (
    <div className="grid w-full min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
      <Field label="Access pricing">
        <select
          aria-label="Access pricing"
          className={selectStyles}
          value={value.pricingType}
          onChange={(e) =>
            onChange({
              ...value,
              pricingType: e.target.value as GroupPricingForm["pricingType"],
            })
          }
        >
          {allowLegacy && <option value="">Keep existing offer access</option>}
          <option value="free">Free access</option>
          <option value="one_time">Paid — one-time payment</option>
          <option value="subscription">Paid — subscription</option>
        </select>
      </Field>
      {paid && (
        <>
          <Field label="Price" hint="USD; minimum $0.50">
            <Input
              aria-label="Access group price"
              type="number"
              min="0.50"
              step="0.01"
              required
              value={value.amount}
              onChange={(e) => onChange({ ...value, amount: e.target.value })}
            />
          </Field>
          {value.pricingType === "subscription" && (
            <Field label="Billing frequency">
              <select
                aria-label="Billing frequency"
                className={selectStyles}
                value={value.interval}
                onChange={(e) =>
                  onChange({
                    ...value,
                    interval: e.target.value as "month" | "year",
                  })
                }
              >
                <option value="month">Monthly</option>
                <option value="year">Yearly</option>
              </select>
            </Field>
          )}
          <p className="text-xs text-ink-soft sm:col-span-2">
            Saving creates a checkout for this access group. Payment grants
            access to its assigned channels.
          </p>
        </>
      )}
    </div>
  );
}
