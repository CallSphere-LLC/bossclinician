import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, CreditCard, ExternalLink, Receipt, Send } from "lucide-react";
import { toast } from "sonner";
import {
  settingsApi,
  type SettingCard as SettingCardShape,
  type SettingField,
  type SettingGroup,
} from "@/lib/settingsApi";
import {
  Button,
  Card,
  CardHeader,
  ErrorNotice,
  Field,
  Input,
  PageHeader,
  selectStyles,
  Skeleton,
  Textarea,
} from "@/pages/admin/ui/primitives";
import { friendlyError } from "@/pages/admin/ui/friendly";

/**
 * One group of settings, as plain boxes with plain labels.
 *
 * Everything on this page is generated from what the server sent: the label,
 * the help line, the kind of box and its current value. Nothing here knows what
 * a "key" is, and there is no JSON anywhere — adding a setting is a change on
 * the server, and this screen grows a correctly-labelled field for it.
 */

/** The zones a US-based practice with international customers actually uses. */
const TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Phoenix",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
  "America/Toronto",
  "America/Vancouver",
  "Europe/London",
  "Europe/Dublin",
  "Europe/Paris",
  "Europe/Berlin",
  "Australia/Sydney",
  "Australia/Perth",
  "Pacific/Auckland",
  "UTC",
];

/** "America/New_York" → "New York" — nobody reads a settings screen in IANA. */
function zoneLabel(zone: string): string {
  const city = zone.split("/").pop() ?? zone;
  return city.replace(/_/g, " ");
}

type Draft = Record<string, unknown>;

/** Stored value → what goes in the box (a tax rate is held in basis points). */
function toDisplay(field: SettingField, value: unknown): unknown {
  if (field.type === "number" && field.displayScale && typeof value === "number") {
    return value / field.displayScale;
  }
  return value;
}

/** …and back again on save. */
function toStored(field: SettingField, value: unknown): unknown {
  if (field.type === "number" && field.displayScale && typeof value === "number") {
    return Math.round(value * field.displayScale);
  }
  return value;
}

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: SettingField;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const id = `setting-${field.name}`;

  switch (field.type) {
    case "boolean":
      return (
        <label className="flex cursor-pointer items-start gap-3 text-sm font-medium text-ink">
          <input
            id={id}
            type="checkbox"
            checked={value === true}
            onChange={(e) => onChange(e.target.checked)}
            className="mt-0.5 size-4 shrink-0 rounded border-hairline text-plum focus-visible:ring-plum/30"
          />
          <span>
            {field.label}
            {field.help && (
              <span className="mt-0.5 block text-xs font-normal text-ink-soft">{field.help}</span>
            )}
          </span>
        </label>
      );

    case "longtext":
      return (
        <Field label={field.label} hint={field.help} htmlFor={id}>
          <Textarea
            id={id}
            rows={3}
            value={typeof value === "string" ? value : ""}
            placeholder={field.placeholder}
            onChange={(e) => onChange(e.target.value)}
          />
        </Field>
      );

    case "choice":
      return (
        <Field label={field.label} hint={field.help} htmlFor={id}>
          <select
            id={id}
            className={selectStyles}
            value={typeof value === "string" ? value : ""}
            onChange={(e) => onChange(e.target.value)}
          >
            {(field.choices ?? []).map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.label}
              </option>
            ))}
          </select>
        </Field>
      );

    case "timezone": {
      const current = typeof value === "string" ? value : "";
      // A zone already saved that isn't on the short list still has to be
      // selectable, or opening this page would silently change it.
      const options = TIMEZONES.includes(current) ? TIMEZONES : [current, ...TIMEZONES];
      return (
        <Field label={field.label} hint={field.help} htmlFor={id}>
          <select
            id={id}
            className={selectStyles}
            value={current}
            onChange={(e) => onChange(e.target.value)}
          >
            {options.filter(Boolean).map((zone) => (
              <option key={zone} value={zone}>
                {zoneLabel(zone)}
              </option>
            ))}
          </select>
        </Field>
      );
    }

    case "color":
      return (
        <Field label={field.label} hint={field.help} htmlFor={id}>
          <div className="flex items-center gap-3">
            <input
              id={id}
              type="color"
              value={typeof value === "string" && value ? value : "#D4AF6E"}
              onChange={(e) => onChange(e.target.value)}
              className="size-11 shrink-0 cursor-pointer rounded-xl border border-hairline bg-transparent p-1"
            />
            {typeof value === "string" && value && (
              <Button type="button" variant="ghost" size="sm" onClick={() => onChange("")}>
                Use the default
              </Button>
            )}
          </div>
        </Field>
      );

    case "number":
      return (
        <Field label={field.label} hint={field.help} htmlFor={id}>
          <div className="flex items-center gap-2.5">
            <Input
              id={id}
              type="number"
              inputMode="decimal"
              className="max-w-[10rem]"
              min={field.displayScale ? undefined : field.min}
              max={field.displayScale ? undefined : field.max}
              value={typeof value === "number" ? String(value) : ""}
              onChange={(e) => onChange(e.target.value === "" ? 0 : Number(e.target.value))}
            />
            {field.unit && <span className="text-sm text-ink-soft">{field.unit}</span>}
          </div>
        </Field>
      );

    case "time":
      return (
        <Field label={field.label} hint={field.help} htmlFor={id}>
          <Input
            id={id}
            type="time"
            className="max-w-[10rem]"
            value={typeof value === "string" ? value : ""}
            onChange={(e) => onChange(e.target.value)}
          />
        </Field>
      );

    // The stored value never comes back from the server, so the box is always
    // empty and the line underneath says whether one is saved.
    case "secret":
      return (
        <Field label={field.label} hint={field.help} htmlFor={id}>
          <Input
            id={id}
            type="password"
            autoComplete="off"
            value={typeof value === "string" ? value : ""}
            placeholder={field.hasValue ? "Leave blank to keep the one you saved" : "Paste it here"}
            onChange={(e) => onChange(e.target.value)}
          />
          <p className="mt-1.5 text-xs text-ink-soft">
            {field.hasValue
              ? `Saved — ends in ${field.hint}. Type a new one to replace it.`
              : "Nothing saved yet."}
          </p>
        </Field>
      );

    default:
      return (
        <Field label={field.label} hint={field.help} htmlFor={id}>
          <Input
            id={id}
            type={field.type === "email" ? "email" : field.type === "url" ? "url" : "text"}
            value={typeof value === "string" ? value : ""}
            placeholder={field.placeholder}
            onChange={(e) => onChange(e.target.value)}
          />
        </Field>
      );
  }
}

function SettingCard({ card, onSaved }: { card: SettingCardShape; onSaved: () => void }) {
  const initial = useMemo(() => {
    const draft: Draft = {};
    for (const field of card.fields) {
      // A secret starts blank — an empty box means "leave it alone", and only a
      // value typed in gets sent.
      draft[field.name] = field.type === "secret" ? "" : toDisplay(field, field.value);
    }
    return draft;
  }, [card]);

  const [draft, setDraft] = useState<Draft>(initial);
  const [saving, setSaving] = useState(false);

  useEffect(() => setDraft(initial), [initial]);

  const dirty = card.fields.some((field) => {
    if (field.type === "secret") return String(draft[field.name] ?? "") !== "";
    return JSON.stringify(draft[field.name]) !== JSON.stringify(initial[field.name]);
  });

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);

    const values: Record<string, unknown> = {};
    for (const field of card.fields) {
      const value = draft[field.name];
      if (field.type === "secret") {
        if (typeof value === "string" && value.trim()) values[field.name] = value.trim();
        continue;
      }
      values[field.name] = toStored(field, value);
    }

    try {
      await settingsApi.save(card.key, values);
      toast.success("Saved");
      onSaved();
    } catch (err) {
      toast.error(friendlyError(err, "setting"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader title={card.label} subtitle={card.description || undefined} />
      <form onSubmit={save} className="space-y-5 px-5 py-5">
        {card.fields.map((field) => (
          <FieldInput
            key={field.name}
            field={field}
            value={draft[field.name]}
            onChange={(value) => setDraft((d) => ({ ...d, [field.name]: value }))}
          />
        ))}
        <div className="flex items-center gap-3 border-t border-hairline/60 pt-4">
          <Button type="submit" size="sm" disabled={!dirty || saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
          {dirty && !saving && (
            <span className="text-xs text-ink-soft">You have changes that aren't saved yet.</span>
          )}
        </div>
      </form>
    </Card>
  );
}

/** Sits on the email group, because that is where she goes when mail looks wrong. */
function TestEmailCard() {
  const [sending, setSending] = useState(false);

  async function send() {
    setSending(true);
    try {
      const result = await settingsApi.sendTestEmail();
      if (result.sent) {
        toast.success(`Sent — check ${result.to}`);
      } else if (!result.configured) {
        toast.error(
          "Nothing was sent: no mail server is set up yet. Ask whoever set this site up to connect one.",
        );
      } else {
        // The third case, and the one this button exists for: a mail server is
        // configured and it refused us. Its own words are shown, because
        // "535 Authentication Credentials Invalid" is the whole answer and
        // paraphrasing it into "something went wrong" throws it away.
        toast.error(`Your mail server refused it: ${result.failure}`, { duration: 12000 });
      }
    } catch (err) {
      toast.error(friendlyError(err, "email"));
    } finally {
      setSending(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Check your email is working"
        subtitle="Sends one message to the address you sign in with."
      />
      <div className="px-5 py-5">
        <Button size="sm" variant="secondary" onClick={send} disabled={sending}>
          <Send />
          {sending ? "Sending…" : "Send me a test email"}
        </Button>
      </div>
    </Card>
  );
}

/** Makes the already-live member billing surface visible from payment settings. */
function BillingPortalCard() {
  return (
    <Card>
      <CardHeader
        title="Customer billing portal"
        subtitle="Customers can replace a card, see invoices and PDF receipts, pause or resume a subscription, and cancel with a reason."
      />
      <div className="grid gap-3 px-5 py-5 sm:grid-cols-2">
        <Button asChild variant="secondary" className="min-h-11 justify-start">
          <a href="/account/billing" target="_blank" rel="noreferrer">
            <CreditCard />
            Open the customer portal
            <ExternalLink className="ml-auto" />
          </a>
        </Button>
        <Button asChild variant="secondary" className="min-h-11 justify-start">
          <Link to="/admin/marketing/emails">
            <Receipt />
            Customise receipt emails
          </Link>
        </Button>
        <p className="text-sm leading-relaxed text-ink-soft sm:col-span-2">
          Failed recurring payments follow Stripe&rsquo;s retry dates. Each new failed attempt sends
          a payment-failed email with the hosted invoice link; a successful retry restores the
          subscription automatically.
        </p>
      </div>
    </Card>
  );
}

export default function SettingsGroupPage() {
  const { group: groupKey } = useParams<{ group: string }>();
  const [group, setGroup] = useState<SettingGroup | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    settingsApi
      .groups()
      .then((res) => {
        setGroup(res.groups.find((g) => g.key === groupKey) ?? null);
        setError(null);
      })
      .catch(() => setError("We couldn't load these settings. Try refreshing the page."));
  }, [groupKey]);

  useEffect(load, [load]);

  return (
    <div className="space-y-6">
      <div>
        <Link
          to="/admin/settings"
          className="mb-3 inline-flex items-center gap-1.5 text-sm text-ink-soft transition-colors hover:text-ink"
        >
          <ArrowLeft className="size-4" />
          All settings
        </Link>
        <PageHeader
          eyebrow="Settings"
          title={group?.label ?? "Settings"}
          description={group?.description}
        />
      </div>

      {error && <ErrorNotice message={error} />}

      {group === undefined ? (
        <div className="space-y-5">
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-44 w-full" />
        </div>
      ) : group === null ? (
        <ErrorNotice message="We couldn't find that group of settings." />
      ) : (
        <div className="space-y-5">
          {group.key === "payments" && <BillingPortalCard />}
          {group.settings.map((card) => (
            <SettingCard key={card.key} card={card} onSaved={load} />
          ))}
          {group.key === "email" && <TestEmailCard />}
        </div>
      )}
    </div>
  );
}
