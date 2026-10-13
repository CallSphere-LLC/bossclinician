import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { BellRing, MailWarning, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/cn";
import { sessionFetch } from "@/lib/adminTransport";
import { CommerceError, commerceMessage, fieldErrorsOf } from "@/lib/adminCommerceApi";
import {
  Button,
  Card,
  CardHeader,
  ErrorNotice,
  Field,
  Input,
  Skeleton,
  Textarea,
} from "@/pages/admin/ui/primitives";

/**
 * The offer's Notifications tab: "Email me when someone buys this offer" and
 * the abandoned-checkout reminders for this offer (Kajabi sets both per offer).
 *
 * Saved by its own button, like bumps and upsells: it is its own endpoint
 * (/admin/offers/:id/notifications), and the site-wide defaults it falls back
 * to come back with it so the boxes can show them.
 */

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "/api";
const STEPS = [0, 1, 2, 3] as const;

type Overrides = Record<string, string | number | boolean>;

interface NotificationSettings {
  notifyOwnerOnSale: boolean;
  notifyOwnerRecipients: string;
  recoveryEnabled: boolean;
  recoveryMode: "default" | "custom";
  recoveryOverrides: Overrides;
  defaults: {
    notifyEmail: string;
    saleEmailsOn: boolean;
    recovery: Record<string, unknown>;
  };
}

async function request(offerId: number, init?: RequestInit): Promise<NotificationSettings> {
  const res = await sessionFetch(`${API_BASE}/admin/offers/${offerId}/notifications`, {
    ...init,
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) {
    let body: { error?: string; message?: string; details?: { fieldErrors?: Record<string, string[]> } } = {};
    try {
      body = await res.json();
    } catch {
      // The status alone is enough for commerceMessage.
    }
    const fieldErrors: Record<string, string> = {};
    for (const [field, messages] of Object.entries(body.details?.fieldErrors ?? {})) {
      if (messages[0]) fieldErrors[field] = messages[0];
    }
    throw new CommerceError(body.error ?? body.message ?? "", res.status, fieldErrors);
  }
  return (await res.json()) as NotificationSettings;
}

function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  hint?: ReactNode;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-hairline bg-white/[0.02] px-4 py-3 transition-colors hover:border-white/20">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 size-4 rounded border-hairline text-plum focus-visible:ring-plum/30"
      />
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-ink">{label}</span>
        {hint && <span className="mt-0.5 block text-xs text-ink-soft">{hint}</span>}
      </span>
    </label>
  );
}

function Choice({
  checked,
  onSelect,
  label,
  hint,
}: {
  checked: boolean;
  onSelect: () => void;
  label: string;
  hint?: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={checked}
      className={cn(
        "flex w-full items-start gap-3 rounded-xl border px-4 py-3 text-left transition-all",
        checked ? "border-gold/60 bg-gold/[0.10]" : "border-hairline bg-white/[0.02] hover:border-white/25",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border",
          checked ? "border-gold bg-gold" : "border-hairline",
        )}
      >
        {checked && <span className="size-1.5 rounded-full bg-night-deep" />}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-ink">{label}</span>
        {hint && <span className="mt-0.5 block text-xs text-ink-soft">{hint}</span>}
      </span>
    </button>
  );
}

function Note({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-gold/40 bg-gold/[0.09] px-4 py-3 text-sm text-ink">
      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-gold" aria-hidden="true" />
      <span>{children}</span>
    </div>
  );
}

const linkClass = "font-semibold text-plum underline-offset-2 hover:underline";

export default function OfferNotificationsTab({ offerId }: { offerId: number }) {
  const [data, setData] = useState<NotificationSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let current = true;
    setData(null);
    setLoadError(null);
    request(offerId)
      .then((body) => current && setData(body))
      .catch(() => current && setLoadError("We couldn't load this offer's notification settings."));
    return () => {
      current = false;
    };
  }, [offerId]);

  if (loadError) return <ErrorNotice message={loadError} />;
  if (!data) return <Skeleton className="h-64" />;

  const defaults = data.defaults.recovery;
  const allowList = String(defaults.recipients ?? "").trim();

  function update(patch: Partial<NotificationSettings>) {
    setData((current) => (current ? { ...current, ...patch } : current));
    setDirty(true);
    setErrors((current) => {
      const next = { ...current };
      for (const key of Object.keys(patch)) delete next[key];
      return next;
    });
  }

  function setOverride(key: string, value: string | number | boolean) {
    if (!data) return;
    update({ recoveryOverrides: { ...data.recoveryOverrides, [key]: value } });
    setErrors((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  /** A custom value, else the site-wide one. */
  function stepValue(key: string): unknown {
    const own = data?.recoveryOverrides[key];
    return own === undefined || own === "" ? defaults[key] : own;
  }

  function chooseMode(mode: "default" | "custom") {
    if (!data || mode === data.recoveryMode) return;
    // Starting a custom sequence from the site-wide one, so she edits what is
    // already going out instead of a blank form.
    if (mode === "custom" && Object.keys(data.recoveryOverrides).length === 0) {
      const seeded: Overrides = {};
      for (const step of STEPS) {
        for (const field of ["enabled", "hours", "subject", "body"]) {
          const value = defaults[`${field}${step}`];
          if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
            seeded[`${field}${step}`] = value;
          }
        }
      }
      update({ recoveryMode: mode, recoveryOverrides: seeded });
      return;
    }
    update({ recoveryMode: mode });
  }

  async function save() {
    if (!data) return;
    setSaving(true);
    try {
      const overrides: Overrides = {};
      for (const [key, value] of Object.entries(data.recoveryOverrides)) {
        overrides[key] = key.startsWith("hours") && typeof value === "string" ? Number(value) : value;
      }
      const saved = await request(offerId, {
        method: "PUT",
        body: JSON.stringify({
          notifyOwnerOnSale: data.notifyOwnerOnSale,
          notifyOwnerRecipients: data.notifyOwnerRecipients,
          recoveryEnabled: data.recoveryEnabled,
          recoveryMode: data.recoveryMode,
          recoveryOverrides: overrides,
        }),
      });
      setData(saved);
      setDirty(false);
      setErrors({});
      toast.success("Notifications saved");
    } catch (err) {
      setErrors(fieldErrorsOf(err));
      toast.error(commerceMessage(err, "notification settings"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          icon={<BellRing className="size-4" />}
          title="Tell me when someone buys"
          subtitle="An email to you for every purchase of this offer"
        />
        <div className="space-y-4 p-5">
          <Toggle
            checked={data.notifyOwnerOnSale}
            onChange={(notifyOwnerOnSale) => update({ notifyOwnerOnSale })}
            label="Email me when someone buys this offer"
            hint="With the offer, the buyer's name and email, what they paid and on which plan, any coupon, and a link to the purchase."
          />
          {data.notifyOwnerOnSale && (
            <Field
              label="Send it to"
              hint={`optional — leave blank to use ${data.defaults.notifyEmail || "your notification address"}`}
              error={errors.notifyOwnerRecipients}
            >
              <Input
                value={data.notifyOwnerRecipients}
                onChange={(e) => update({ notifyOwnerRecipients: e.target.value })}
                placeholder={data.defaults.notifyEmail || "you@yourpractice.com"}
              />
            </Field>
          )}
          {data.notifyOwnerOnSale && (
            <p className="text-xs text-ink-soft">Separate several addresses with commas.</p>
          )}
          {!data.defaults.saleEmailsOn && (
            <Note>
              Sale emails are switched off for the whole site, so none will be sent for this offer either.{" "}
              <Link to="/admin/settings/general" className={linkClass}>
                Turn them back on
              </Link>
            </Note>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader
          icon={<MailWarning className="size-4" />}
          title="Abandoned checkout email"
          subtitle="Reminds people who started checking out but didn't finish"
        />
        <div className="space-y-4 p-5">
          <Toggle
            checked={data.recoveryEnabled}
            onChange={(recoveryEnabled) => update({ recoveryEnabled })}
            label="Send abandoned checkout reminders for this offer"
            hint="Someone who types their email on this checkout and leaves without buying gets these reminders. Buying stops the rest straight away."
          />

          {data.recoveryEnabled && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Choice
                checked={data.recoveryMode === "default"}
                onSelect={() => chooseMode("default")}
                label="Use the default reminders"
                hint="The same reminders every offer uses."
              />
              <Choice
                checked={data.recoveryMode === "custom"}
                onSelect={() => chooseMode("custom")}
                label="Custom for this offer"
                hint="Your own timing and wording, just for this offer."
              />
            </div>
          )}

          {data.recoveryEnabled && data.recoveryMode === "default" && (
            <p className="text-sm text-ink-soft">
              {STEPS.filter((step) => defaults[`enabled${step}`] === true)
                .map((step) => `${defaults[`hours${step}`]}h`)
                .join(", ") || "No reminders are switched on"}{" "}
              after their last checkout activity.{" "}
              <Link to="/admin/settings/payments" className={linkClass}>
                Edit default reminders
              </Link>
            </p>
          )}

          {data.recoveryEnabled && data.recoveryMode === "custom" && (
            <div className="space-y-4">
              {STEPS.map((step) => {
                const on = stepValue(`enabled${step}`) === true;
                return (
                  <div key={step} className="space-y-3 rounded-xl border border-hairline p-4">
                    <Toggle
                      checked={on}
                      onChange={(next) => setOverride(`enabled${step}`, next)}
                      label={`Send reminder ${step + 1}`}
                    />
                    {on && (
                      <>
                        <Field
                          label="Send it this many hours after they leave"
                          hint="Each reminder has to be later than the one before"
                          error={errors[`hours${step}`]}
                        >
                          <Input
                            inputMode="decimal"
                            value={String(data.recoveryOverrides[`hours${step}`] ?? "")}
                            placeholder={String(defaults[`hours${step}`] ?? "")}
                            onChange={(e) => setOverride(`hours${step}`, e.target.value)}
                          />
                        </Field>
                        <Field label="Subject" hint="blank uses the default" error={errors[`subject${step}`]}>
                          <Input
                            value={String(data.recoveryOverrides[`subject${step}`] ?? "")}
                            placeholder={String(defaults[`subject${step}`] ?? "")}
                            onChange={(e) => setOverride(`subject${step}`, e.target.value)}
                          />
                        </Field>
                        <Field label="Email" hint="blank uses the default" error={errors[`body${step}`]}>
                          <Textarea
                            rows={6}
                            value={String(data.recoveryOverrides[`body${step}`] ?? "")}
                            placeholder={String(defaults[`body${step}`] ?? "")}
                            onChange={(e) => setOverride(`body${step}`, e.target.value)}
                          />
                        </Field>
                      </>
                    )}
                  </div>
                );
              })}
              <p className="text-xs text-ink-soft">
                Use {"{name}"}, {"{offer}"} and {"{checkout_url}"}. Links are written [link text]({"{checkout_url}"}); a
                "Continue checkout" link is added if you leave it out.{" "}
                <Link to="/admin/settings/payments" className={linkClass}>
                  Edit default reminders
                </Link>
              </p>
            </div>
          )}

          {data.recoveryEnabled && defaults.enabled === false && (
            <Note>
              Abandoned checkout reminders are switched off for the whole site, so none will go out for this offer.{" "}
              <Link to="/admin/settings/payments" className={linkClass}>
                Turn them on
              </Link>
            </Note>
          )}
          {data.recoveryEnabled && defaults.enabled !== false && allowList && (
            <Note>
              Reminders are currently limited to these addresses: {allowList}.{" "}
              <Link to="/admin/settings/payments" className={linkClass}>
                Change this
              </Link>
            </Note>
          )}
          <p className="text-xs text-ink-soft">
            Reminders are checked every 30 minutes, so one can arrive up to half an hour after its time. Unsubscribes
            always apply.
          </p>
        </div>
      </Card>

      <div className="flex justify-end">
        <Button onClick={() => void save()} disabled={saving || !dirty}>
          {saving ? "Saving…" : dirty ? "Save notifications" : "Saved"}
        </Button>
      </div>
    </div>
  );
}
