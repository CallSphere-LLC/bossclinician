import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router";
import { AlertTriangle, ArrowLeft, CheckCircle2, CreditCard, ExternalLink, Receipt, Send } from "lucide-react";
import { toast } from "sonner";
import { adminApi } from "@/lib/api";
import { downloadAdminDocument, fetchAdminDocument } from "@/lib/adminReceipt";
import { ReceiptFrame } from "@/components/receipt/ReceiptFrame";
import type { SendingDomainReport } from "@/types/admin";
import {
  settingsApi,
  type EmailLogRow,
  type SendingIdentityReport,
  type SettingCard as SettingCardShape,
  type SettingField,
  type SettingGroup,
} from "@/lib/settingsApi";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Chip,
  chipRowStyles,
  ErrorNotice,
  Field,
  Input,
  PageHeader,
  selectStyles,
  Skeleton,
  Textarea,
} from "@/pages/admin/ui/primitives";
import { friendlyError } from "@/pages/admin/ui/friendly";
import { formatDateTime } from "@/lib/format";
import { CancelReasonsEditor } from "@/components/admin/CancelReasonsEditor";
import { paymentFieldProblem } from "@/lib/paymentSettingsRules";
import { CheckoutPreview } from "@/components/admin/CheckoutPreview";
import { logoFileProblem } from "@/lib/receiptLogo";

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

    case "reasonlist":
      return (
        <CancelReasonsEditor
          id={id}
          label={field.label}
          help={field.help}
          value={typeof value === "string" ? value : ""}
          onChange={onChange}
        />
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
      if (field.locked) {
        // The server decides this one. A live dropdown here read "Your own mail
        // server" while every message went out through Amazon SES, so the box
        // shows what is really in use, can't be changed, and says why.
        const current = typeof value === "string" ? value : "";
        const shown = (field.choices ?? []).find((choice) => choice.value === current);
        return (
          <Field label={field.label} htmlFor={id}>
            <select
              id={id}
              className={selectStyles}
              value={current}
              disabled
              aria-describedby={`${id}-locked`}
            >
              <option value={current}>{shown?.label ?? current}</option>
            </select>
            <p id={`${id}-locked`} className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-ink-soft">
              {field.source === "server" && <Badge tone="neutral">Set on the server</Badge>}
              <span>{field.help}</span>
            </p>
          </Field>
        );
      }
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

    case "image":
      return <ImageFieldInput id={id} field={field} value={value} onChange={onChange} />;

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

/**
 * A logo box: upload a PNG or JPEG into the public media library, see it, or
 * take it away. The value is the upload's own `/uploads/<file>` reference, and
 * it only reaches receipts when the card is saved — the card already says when
 * there are unsaved changes.
 *
 * A file that can't be used is refused here, next to the box, with the reason:
 * a logo that silently failed to appear on a receipt is the kind of thing nobody
 * notices until a customer's accountant does.
 */
export function ImageFieldInput({
  id,
  field,
  value,
  onChange,
}: {
  id: string;
  field: SettingField;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [problem, setProblem] = useState("");
  const current = typeof value === "string" ? value : "";

  async function pick(file: File | undefined) {
    if (!file) return;
    const refused = logoFileProblem(file);
    setProblem(refused);
    if (refused) return;
    setUploading(true);
    try {
      const asset = await adminApi.uploadMedia(file, "public");
      onChange(asset.url);
    } catch (err) {
      setProblem(friendlyError(err, "logo"));
    } finally {
      setUploading(false);
    }
  }

  return (
    <Field label={field.label} hint={field.help} htmlFor={id}>
      <div className="flex flex-wrap items-center gap-3">
        {current ? (
          <img
            src={current}
            alt="Your receipt logo"
            className="h-14 max-w-[12rem] rounded-lg border border-hairline bg-white object-contain p-1.5"
          />
        ) : (
          <span className="text-sm text-ink-soft">No logo — your business name heads the receipt.</span>
        )}
        <input
          id={id}
          type="file"
          accept="image/png,image/jpeg"
          disabled={uploading}
          onChange={(e) => {
            void pick(e.target.files?.[0]);
            e.target.value = "";
          }}
          className="block max-w-full text-sm text-ink-soft file:mr-3 file:cursor-pointer file:rounded-full file:border-0 file:bg-plum file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white"
        />
        {current && !uploading && (
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange("")}>
            Remove the logo
          </Button>
        )}
      </div>
      {uploading && <p className="mt-1.5 text-xs text-ink-soft">Uploading…</p>}
      {problem && (
        <p role="alert" className="mt-1.5 text-xs font-medium text-red-400">
          {problem}
        </p>
      )}
    </Field>
  );
}

/**
 * The receipt customiser's proof, under the receipt details on the General page.
 *
 * Shows a made-up receipt dressed in whatever is saved — the same renderers a
 * customer's receipt and PDF use — so she can see the logo, address, tax ID and
 * footer note in place without waiting for a sale. Both documents are
 * Bearer-authenticated, so the receipt is fetched and shown right here in the
 * card, and the PDF is saved through the browser's download; no window opens.
 */
export function ReceiptPreviewCard() {
  const [opening, setOpening] = useState<"" | "html" | "pdf">("");
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);

  async function open(kind: "html" | "pdf") {
    setOpening(kind);
    try {
      if (kind === "html") {
        setPreviewHtml(await fetchAdminDocument("/admin/sales/receipt-preview"));
      } else {
        await downloadAdminDocument("/admin/sales/receipt-preview.pdf", "receipt-sample.pdf");
      }
    } catch {
      toast.error("We couldn't open the sample receipt just now. Try again in a moment.");
    } finally {
      setOpening("");
    }
  }

  return (
    <Card>
      <CardHeader
        title="See a sample receipt"
        subtitle="A made-up $19.00 purchase in the details you've saved above — exactly how a customer's receipt and its PDF look."
      />
      <div className="flex flex-wrap items-center gap-3 px-5 py-5">
        <Button type="button" size="sm" disabled={opening !== ""} onClick={() => void open("html")}>
          <Receipt />
          {opening === "html" ? "Opening…" : "Open a sample receipt"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={opening !== ""}
          onClick={() => void open("pdf")}
        >
          <ExternalLink />
          {opening === "pdf" ? "Opening…" : "Sample PDF"}
        </Button>
        <span className="text-xs text-ink-soft">Save your changes first — the sample shows what's saved.</span>
      </div>
      {previewHtml !== null && (
        <div className="border-t border-hairline px-5 py-5">
          <ReceiptFrame html={previewHtml} title="Sample receipt" />
        </div>
      )}
    </Card>
  );
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

    // The payment fields with rules are checked here first, so a refused save
    // says which rule rather than "Something in that form needs fixing".
    for (const field of card.fields) {
      const problem = paymentFieldProblem(field.type, draft[field.name]);
      if (problem) {
        toast.error(problem, { duration: 10000 });
        return;
      }
    }

    setSaving(true);

    const values: Record<string, unknown> = {};
    for (const field of card.fields) {
      // A locked field is the server's to decide: sending it back would either be
      // refused or store a stale copy of something this screen cannot change.
      if (field.locked) continue;
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
        {card.key === "checkout" && <CheckoutPreview settings={draft} />}
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

/**
 * Whether this site can send at all — first thing on the email screen.
 *
 * It exists because the broken state was invisible. On the live site "Name in
 * the inbox", "Sent from" and "Your postal address" were all blank, and an empty
 * box looks exactly like a box somebody meant to leave empty: nothing said that
 * every campaign would be refused, or that a marketing email without a postal
 * address is illegal, or that mail was going out under an address from the
 * server's own configuration that appears nowhere on this screen.
 *
 * The verdict is the same one email/provider.ts enforces on the send itself, read
 * from the same endpoint, so this card cannot say "ready" about a send that would
 * be refused.
 */
function SendingIdentityCard({ refreshToken }: { refreshToken: number }) {
  const [report, setReport] = useState<SendingIdentityReport | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    settingsApi
      .sendingIdentity()
      .then((next) => {
        if (!live) return;
        setReport(next);
        setError("");
      })
      .catch((err) => {
        if (!live) return;
        setReport(null);
        setError(friendlyError(err, "email settings"));
      });
    return () => {
      live = false;
    };
  }, [refreshToken]);

  return (
    <Card>
      <CardHeader
        title="Can you send email?"
        subtitle="What your emails say they come from, and whether that is enough to send one."
        action={
          report && <Badge tone={report.ready ? "green" : "red"}>{report.summary}</Badge>
        }
      />
      <div className="space-y-4 px-5 py-5">
        {error && <ErrorNotice message={error} />}
        {report === null && !error && <Skeleton className="h-24 w-full" />}

        {report && report.problems.length > 0 && (
          <div
            role="alert"
            className="space-y-3 rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-3.5 text-sm text-red-100"
          >
            <p className="flex items-start gap-2.5 font-semibold">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              Marketing email is being refused until these are filled in. Nothing is sent, and
              nothing pretends to have been.
            </p>
            <ul className="space-y-2.5">
              {report.problems.map((problem) => (
                <li key={problem.field} className="leading-relaxed">
                  <span className="font-semibold text-white">{problem.label}</span> is empty.{" "}
                  <span className="text-red-100/85">{problem.message}</span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-red-100/80">
              The boxes are below on this page. Fill them in, press Save, and this turns green.
            </p>
          </div>
        )}

        {report && report.problems.length === 0 && (
          <p className="flex items-start gap-2.5 text-sm text-ink">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-green-bright" />
            <span>
              Your emails go out as{" "}
              <span className="font-semibold">{report.marketingFrom}</span>, with your postal
              address at the bottom.
            </span>
          </p>
        )}

        {report && report.warnings.length > 0 && (
          <ul className="space-y-2.5">
            {report.warnings.map((warning) => (
              <li
                key={`${warning.field}-${warning.label}`}
                className="rounded-xl border border-gold/30 bg-gold/[0.10] px-4 py-3 text-sm leading-relaxed text-ink"
              >
                <span className="font-semibold">{warning.label}:</span>{" "}
                <span className="text-ink-soft">{warning.message}</span>
              </li>
            ))}
          </ul>
        )}

        {report?.transport && (
          <p className="text-sm text-ink">
            Sending through <span className="font-semibold">{report.transport.label}</span>
            {report.transport.source === "server" ? " — set on the server." : " — chosen here."}
          </p>
        )}

        {report && (
          <p className="text-xs text-ink-soft">
            Receipts, password links and email confirmations are separate — they go out as{" "}
            <span className="font-mono">{report.transactionalFrom || "nothing configured"}</span>{" "}
            and are never held back for the fields above, because a confirmation link is what lets
            a customer post in your community at all.
          </p>
        )}
      </div>
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
      if (result.sent && !result.identity.ready) {
        // The test message is transactional, so it goes out under the server's
        // own identity even when the marketing one is blank. Saying only "Sent"
        // here is what let somebody believe email was working while every
        // campaign was being refused.
        toast.warning(
          `Sent to ${result.to} — but that only proves receipts work. ${result.identity.summary}`,
          { duration: 12000 },
        );
      } else if (result.sent) {
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

/**
 * The sending domain check (3.9).
 *
 * This exists because of something read off real delivered mail: the site sends
 * as `…@bossclinician.callsphere.site`, a staging subdomain, while the product
 * it replaces sends from the customer's own domain. Moving that is a DNS job,
 * not a provider one — SES is already wired and authenticating — so what was
 * missing was a way to SEE whether the DNS is right without asking somebody to
 * run `dig`.
 *
 * The domain box lets her check a domain BEFORE switching the from-address to
 * it, which is the order anybody sane does this in.
 */
function SendingDomainCard() {
  const [domain, setDomain] = useState("");
  const [report, setReport] = useState<SendingDomainReport | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");

  const check = useCallback(async (which?: string) => {
    setChecking(true);
    setError("");
    try {
      setReport(await adminApi.sendingDomain(which));
    } catch (err) {
      setReport(null);
      setError(friendlyError(err, "sending domain"));
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  const TONE: Record<string, "green" | "gold" | "red"> = {
    pass: "green",
    warn: "gold",
    fail: "red",
  };

  return (
    <Card>
      <CardHeader
        title="Where your email comes from"
        subtitle="Whether the internet believes this domain is really you."
        action={
          report && (
            <Badge tone={report.ready ? "green" : "red"}>{report.summary}</Badge>
          )
        }
      />
      <div className="space-y-4 px-5 py-5">
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void check(domain.trim() || undefined);
          }}
        >
          <Field
            label="Check a domain"
            hint="Leave blank to check the one you send from now"
            className="min-w-[14rem] flex-1"
          >
            <Input
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="bossclinician.com"
              autoCapitalize="none"
              spellCheck={false}
            />
          </Field>
          <Button type="submit" size="sm" variant="secondary" disabled={checking}>
            {checking ? "Checking…" : "Check the DNS"}
          </Button>
        </form>

        {error && <ErrorNotice message={error} />}

        {report && (
          <>
            <p className="text-sm text-ink-soft">
              Checking <span className="font-semibold text-ink">{report.domain}</span>
              {report.isCurrent
                ? " — the domain you send from now."
                : report.configuredDomain
                  ? ` — you currently send from ${report.configuredDomain}.`
                  : " — no sending address is set yet."}
            </p>

            <ul className="space-y-3">
              {report.checks.map((item) => (
                <li key={item.name} className="rounded-xl border border-hairline px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <Badge tone={TONE[item.status] ?? "neutral"}>{item.name}</Badge>
                    <p className="text-sm font-semibold text-ink">{item.detail}</p>
                  </div>
                  <p className="mt-1 text-xs text-ink-soft">{item.purpose}</p>
                  {item.found.length > 0 && (
                    <p className="mt-2 break-all font-mono text-[0.65rem] text-ink-soft/80">
                      found: {item.found.join(" | ")}
                    </p>
                  )}
                  {item.status !== "pass" && (
                    <p className="mt-1 break-all font-mono text-[0.65rem] text-plum">
                      should be: {item.expected}
                    </p>
                  )}
                </li>
              ))}
            </ul>

            <p className="text-xs text-ink-soft">
              Checked live every time this loads — a remembered answer would say
              “verified” for a record somebody deleted an hour ago.
            </p>
          </>
        )}
      </div>
    </Card>
  );
}

/** How a status reads to somebody who does not think in mail-server terms. */
const DELIVERY_LABEL: Record<string, { text: string; tone: "green" | "red" | "gold" | "neutral" }> = {
  delivered: { text: "Arrived", tone: "green" },
  sent: { text: "Handed over", tone: "neutral" },
  queued: { text: "Still going", tone: "gold" },
  bounced: { text: "Bounced back", tone: "red" },
  complained: { text: "Marked as spam", tone: "red" },
  failed: { text: "Didn't send", tone: "red" },
  suppressed: { text: "Held back", tone: "gold" },
};

const DELIVERY_FILTERS = [
  { value: "all", label: "Everything" },
  { value: "delivered", label: "Arrived" },
  { value: "sent", label: "Handed over" },
  { value: "bounced", label: "Bounced" },
  { value: "failed", label: "Didn't send" },
] as const;

function deliveryStatus(row: EmailLogRow): { text: string; tone: "green" | "red" | "gold" | "neutral" } {
  // The provider's later word beats our own: we record "sent" the moment the
  // handover succeeds, and a bounce arrives seconds afterwards. Showing "handed
  // over" for a message the far end rejected is the exact lie this screen was
  // built to stop telling.
  const authoritative = row.lastEvent && row.lastEvent !== "opened" && row.lastEvent !== "clicked"
    ? row.lastEvent
    : row.status;
  return DELIVERY_LABEL[authoritative] ?? { text: authoritative, tone: "neutral" };
}

/**
 * The delivery log.
 *
 * Sits under the test-email button because both answer the same question, and
 * this one answers it about real customers rather than about Yvette. Before it
 * existed the only signal for a receipt was the checkout saying it had sent one.
 */
export function EmailDeliveryCard() {
  const [rows, setRows] = useState<EmailLogRow[] | null>(null);
  const [tally, setTally] = useState<Record<string, number>>({});
  const [filter, setFilter] = useState<string>("all");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((status: string) => {
    setRows(null);
    settingsApi
      .emailLog({ limit: 50, status })
      .then((res) => {
        setRows(res.messages);
        setTally(res.lastSevenDays);
        setError(null);
      })
      .catch(() => setError("We couldn't load the delivery log. Try refreshing the page."));
  }, []);

  useEffect(() => {
    load(filter);
  }, [filter, load]);

  const trouble = (tally.bounced ?? 0) + (tally.failed ?? 0) + (tally.complained ?? 0);
  const arrived = tally.delivered ?? 0;

  return (
    <Card>
      <CardHeader
        title="What happened to your emails"
        subtitle="Every message this site sent, and whether it actually arrived."
        action={
          rows !== null && (
            <Badge tone={trouble > 0 ? "red" : "green"}>
              {trouble > 0
                ? `${trouble} had trouble in the last 7 days`
                : `${arrived} arrived in the last 7 days`}
            </Badge>
          )
        }
      />
      <div className="space-y-4 px-5 py-5">
        <div className={chipRowStyles}>
          {DELIVERY_FILTERS.map((option) => (
            <Chip
              key={option.value}
              selected={filter === option.value}
              onClick={() => setFilter(option.value)}
            >
              {option.label}
            </Chip>
          ))}
        </div>

        {error && <ErrorNotice message={error} />}

        {rows === null ? (
          <Skeleton className="h-40 w-full" />
        ) : rows.length === 0 ? (
          <p className="rounded-xl bg-cream px-3.5 py-3 text-sm text-ink-soft">
            {filter === "all"
              ? "Nothing has been sent yet. Receipts, access details and password links will all show up here."
              : "Nothing matches that filter — which is usually the good news."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wide text-ink-soft">
                  <th className="py-2 pr-3 font-semibold">Who and what</th>
                  <th className="py-2 pr-3 font-semibold">How it went</th>
                  <th className="py-2 font-semibold">When</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const state = deliveryStatus(row);
                  return (
                    <tr key={row.id} className="border-t border-hairline/70 align-top">
                      <td className="min-w-0 py-2.5 pr-3">
                        <p className="truncate font-semibold text-ink">{row.toEmail}</p>
                        <p className="truncate text-xs text-ink-soft">
                          {row.subject || row.topic || "No subject"}
                        </p>
                        {row.error && (
                          <p className="mt-1 text-xs text-red-400">{row.error}</p>
                        )}
                        {row.providerMessageId && (
                          <p className="mt-1 truncate font-mono text-[0.65rem] text-ink-soft/70">
                            {row.providerMessageId}
                          </p>
                        )}
                      </td>
                      <td className="py-2.5 pr-3">
                        <Badge tone={state.tone}>{state.text}</Badge>
                      </td>
                      <td className="whitespace-nowrap py-2.5 text-xs text-ink-soft">
                        {formatDateTime(row.sentAt ?? row.createdAt)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
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
  /** Bumped on every save, so the sending-identity verdict re-reads with it. */
  const [savedCount, setSavedCount] = useState(0);

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
          {/* First, because it is the answer to "why did nothing arrive?" */}
          {group.key === "email" && <SendingIdentityCard refreshToken={savedCount} />}
          {group.settings.map((card) => (
            <SettingCard
              key={card.key}
              card={card}
              onSaved={() => {
                load();
                setSavedCount((count) => count + 1);
              }}
            />
          ))}
          {group.key === "email" && <TestEmailCard />}
          {group.key === "email" && <EmailDeliveryCard />}
          {group.key === "email" && <SendingDomainCard />}
          {group.key === "general" && <ReceiptPreviewCard />}
        </div>
      )}
    </div>
  );
}
