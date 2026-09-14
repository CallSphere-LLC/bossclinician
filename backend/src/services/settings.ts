import { z } from "zod";
import { recoveryDefinition } from "./checkoutRecoverySettings";
import { pool } from "../db/pool";
import { isValidTimeZone } from "./availability";
import { clearDripSettingsCache } from "./curriculum";
import { cancelReasonsProblem } from "./cancellationReasons";
import { retryScheduleProblem, statementDescriptorProblem } from "./paymentRules";

/**
 * Typed access to the `settings` table, and the description of every setting
 * the admin can edit.
 *
 * The table stores free-form JSONB per key. That is fine for code that reads it
 * and knows what it wants, and hopeless for a settings *screen*: a screen built
 * straight from the data ends up as a JSON textarea, which is exactly what the
 * owner of this admin must never be shown. So the shape of each key lives here
 * as a list of fields with plain-English labels, and the screen is generated
 * from that — one place to add a setting, no hand-written form per group.
 *
 * The registry is also what makes reads safe. Every value that comes back has
 * been checked field by field against the same declaration the form was built
 * from, and anything unparseable falls back to its default rather than
 * propagating into whatever was about to use it.
 */

/* ------------------------------------------------------------------ shapes */

export type FieldType =
  | "text"
  | "longtext"
  | "email"
  | "url"
  | "number"
  | "boolean"
  | "time"
  | "timezone"
  | "choice"
  | "color"
  | "secret"
  /** A file uploaded to the public media library, stored as `/uploads/<file>`. */
  | "image"
  /** Cancellation reasons, `key | label` per line — see services/cancellationReasons. */
  | "reasonlist"
  /** A card statement descriptor, checked against Stripe's rules. */
  | "descriptor"
  /** Days between payment retries, comma-separated — see services/paymentRules. */
  | "retryschedule";

export interface SettingChoice {
  value: string;
  label: string;
}

export interface SettingField {
  name: string;
  /** What the box is called on screen. Written for the owner, never a key name. */
  label: string;
  /** The grey line under the box: what changes if she changes this. */
  help?: string;
  type: FieldType;
  choices?: SettingChoice[];
  placeholder?: string;
  min?: number;
  max?: number;
  /** Shown after the box — "%", "hours", "days". */
  unit?: string;
  /**
   * Stored value = what she typed x this. Sales tax is held in basis points
   * because that is what the checkout maths wants; nobody should ever be asked
   * to type 825 when they mean 8.25%.
   */
  displayScale?: number;
}

export interface SettingDefinition {
  key: string;
  group: string;
  label: string;
  description: string;
  fields: SettingField[];
  /** Applied when the row is missing a field, and when a stored field is unusable. */
  defaults: Record<string, unknown>;
  /**
   * Keys this setting also has to be written to.
   *
   * Two readers in the platform predate the settings migration and read older
   * keys with different field names — the Stripe webhook reads `billing`, the
   * coaching calendar reads `coaching`. A screen that wrote only the new key
   * would look like it worked and change nothing at all, which is a worse
   * outcome than not shipping the screen. The mirror is merged into the old row
   * rather than replacing it, so fields those readers use and this screen does
   * not expose survive the write.
   */
  mirror?: (value: Record<string, unknown>) => { key: string; value: Record<string, unknown> }[];
}

export interface SettingGroupDefinition {
  key: string;
  label: string;
  description: string;
}

/* ------------------------------------------------------------------ groups */

export const SETTING_GROUPS: SettingGroupDefinition[] = [
  { key: "general", label: "General", description: "The basics, and what you get told about." },
  {
    key: "payments",
    label: "Payments & checkout",
    description: "How the checkout looks, what it collects, and what happens after.",
  },
  { key: "email", label: "Email", description: "Who your emails come from and who sends them." },
  { key: "members", label: "Customers", description: "How the people who buy from you sign in." },
  {
    key: "delivery",
    label: "Course delivery",
    description: "When newly unlocked lessons appear.",
  },
  { key: "coaching", label: "Coaching", description: "Your booking and cancellation rules." },
  { key: "marketing", label: "Forms", description: "Keeping junk out of your forms." },
  { key: "website", label: "Your website", description: "Branding, and what Google sees." },
  {
    key: "integrations",
    label: "Connected services",
    description: "Tracking and the other tools you plug in.",
  },
];

/* ------------------------------------------------------------- definitions */

const TIMEZONE_HELP = "Used for every time shown on this screen and in your emails.";

export const SETTING_DEFINITIONS: SettingDefinition[] = [
  {
    key: "notifications",
    group: "general",
    label: "What you get told about",
    description: "We'll email you when these happen.",
    defaults: { notifyEmail: "", onSale: true, onLead: true, onDispute: true, onJobFailure: true },
    fields: [
      {
        name: "notifyEmail",
        label: "Send these to",
        help: "Leave blank to use the address you sign in with.",
        type: "email",
        placeholder: "you@yourpractice.com",
      },
      { name: "onSale", label: "Someone buys something", type: "boolean" },
      { name: "onLead", label: "Someone fills in a form", type: "boolean" },
      { name: "onDispute", label: "A customer disputes a payment", type: "boolean" },
      {
        name: "onJobFailure",
        label: "Something we send on your behalf doesn't go out",
        type: "boolean",
      },
    ],
  },
  {
    key: "business",
    group: "general",
    label: "What goes on your receipts",
    description:
      "The business details printed on every receipt and invoice your customers keep.",
    defaults: { name: "", email: "", address: "", taxId: "", footerNote: "", logoUrl: "" },
    fields: [
      {
        name: "logoUrl",
        label: "Logo",
        help: "A PNG or JPEG, printed at the top of every receipt on screen and in the PDF. Leave it empty for your business name alone.",
        type: "image",
      },
      {
        name: "name",
        label: "Business name",
        help: "The name that heads the receipt. Leave blank and we'll use Boss Clinician.",
        type: "text",
        placeholder: "Boss Clinician LLC",
      },
      {
        name: "email",
        label: "Support address",
        help: "Where a customer writes when something on a receipt looks wrong.",
        type: "email",
        placeholder: "support@bossclinician.com",
      },
      {
        name: "address",
        label: "Business address",
        help: "One line per line, exactly as it should print.",
        type: "longtext",
        placeholder: "848 N Rainbow Blvd\n451\nLas Vegas, NV 89107",
      },
      {
        name: "taxId",
        label: "Tax ID",
        help: "Your EIN or VAT number. Printed on receipts; leave blank to leave it off.",
        type: "text",
        placeholder: "88-1691637",
      },
      {
        name: "footerNote",
        label: "A note at the bottom",
        help: "Printed at the foot of every receipt, on screen and in the PDF — a thank-you, or a registration number your accountant asks for. Leave blank to leave it off.",
        type: "longtext",
        placeholder: "Thank you for investing in your practice.",
      },
    ],
  },
  {
    key: "checkout",
    group: "payments",
    label: "Your checkout page",
    description: "What a customer sees while they're paying.",
    defaults: { brandColor: "", buttonLabelColor: "#211829", buttonOutlineColor: "", buttonBorderRadius: 12, supportEmail: "", termsUrl: "", showCoupons: true },
    fields: [
      {
        name: "brandColor",
        label: "Button colour",
        help: "Leave blank to use your usual brand colour.",
        type: "color",
      },
      { name: "buttonLabelColor", label: "Button label colour", type: "color" },
      { name: "buttonOutlineColor", label: "Button outline colour", type: "color", help: "Leave blank for no outline." },
      { name: "buttonBorderRadius", label: "Button corner radius (pixels)", type: "number", min: 0, max: 40 },
      {
        name: "supportEmail",
        label: "Where customers write if something goes wrong",
        type: "email",
        placeholder: "help@yourpractice.com",
      },
      {
        name: "termsUrl",
        label: "Link to your terms",
        help: "Shown under the pay button.",
        type: "url",
        placeholder: "https://yourpractice.com/terms",
      },
      {
        name: "showCoupons",
        label: "Let customers enter a discount code",
        type: "boolean",
      },
    ],
  },
  {
    key: "customer_payments",
    group: "payments",
    label: "Receipts & cancellations",
    description: "What a customer gets, and what they keep if they stop paying.",
    defaults: {
      sendReceipts: true,
      receiptRule: "every",
      accessOnCancel: "period_end",
      graceDays: 3,
      revokeAccessOnRefund: true,
      sendRefundReceipts: true,
      statementDescriptor: "BOSSCLINICIAN",
      receiptTitle: "Receipt",
      refundPolicy: "",
      sendTrialReminders: true,
      trialReminderDays: 3,
      sendUpcomingPaymentReminders: true,
      upcomingPaymentReminderDays: 3,
      revokeOnFirstFailedPayment: false,
      cancellationReasons: [
        "too_expensive | It's too expensive",
        "not_using_it | I'm not using it",
        "missing_feature | It's missing something I need",
        "found_alternative | I found another option",
        "temporary_pause | I just need a break for now",
        "other | Something else",
      ].join("\n"),
    },
    fields: [
      { name: "sendReceipts", label: "Email customers a receipt", type: "boolean" },
      {
        name: "receiptRule",
        label: "Which payments get a receipt",
        type: "choice",
        choices: [
          { value: "every", label: "Every payment, including renewals" },
          { value: "first", label: "The first payment only" },
          { value: "nonzero", label: "Only payments with a value above zero" },
        ],
      },
      {
        name: "sendRefundReceipts",
        label: "Email a confirmation when money is refunded",
        type: "boolean",
      },
      {
        name: "statementDescriptor",
        label: "Name shown on card statements",
        help: "5–22 letters, numbers, spaces, dots or hyphens, with at least one letter. Sent to Stripe on every checkout, one-click upsell and membership. Stripe may put your account's short prefix in front. Leave blank to use the name on your Stripe account.",
        type: "descriptor",
        placeholder: "BOSSCLINICIAN",
      },
      {
        name: "receiptTitle",
        label: "What the receipt is called",
        help: "Heads the document a customer prints. Leave blank for \"Receipt\".",
        type: "text",
        placeholder: "Receipt",
      },
      {
        name: "refundPolicy",
        label: "Refund policy printed on receipts",
        help: "Printed at the foot of every receipt, so the terms travel with the money.",
        type: "longtext",
        placeholder: "Refunds are available within 14 days of purchase.",
      },
      {
        name: "sendTrialReminders",
        label: "Email a reminder before a free trial ends",
        help: "Tells the customer when the trial ends and what the first payment will be.",
        type: "boolean",
      },
      {
        name: "trialReminderDays",
        label: "How long before the trial ends",
        type: "number",
        min: 0,
        max: 30,
        unit: "days before",
      },
      {
        name: "sendUpcomingPaymentReminders",
        label: "Email a reminder before a membership or instalment payment",
        help: "Sent once for each upcoming payment, with a link to update the card.",
        type: "boolean",
      },
      {
        name: "upcomingPaymentReminderDays",
        label: "How long before the payment",
        type: "number",
        min: 0,
        max: 30,
        unit: "days before",
      },
      {
        name: "revokeOnFirstFailedPayment",
        label: "Stop access as soon as the first recurring payment fails",
        help: "Only the access that membership pays for is paused. The moment a retry or a new card pays the invoice, the same access comes back on its own.",
        type: "boolean",
      },
      {
        name: "accessOnCancel",
        label: "When someone cancels a subscription",
        type: "choice",
        choices: [
          { value: "period_end", label: "They keep access until the month they've paid for ends" },
          { value: "immediately", label: "Access stops straight away" },
        ],
      },
      {
        name: "graceDays",
        label: "Extra days of access after that",
        help: "A short cushion so nobody is locked out by a card that failed on a Friday.",
        type: "number",
        min: 0,
        max: 365,
        unit: "days",
      },
      {
        name: "revokeAccessOnRefund",
        label: "Take access back when you refund someone in full",
        type: "boolean",
      },
      {
        name: "cancellationReasons",
        label: "Reasons a customer can choose when they cancel",
        help: "Customers pick one of these, in this order, when they cancel from their billing page. Their answers feed the “People who left” and “What people said when they left” reports.",
        type: "reasonlist",
        placeholder: "too_expensive | It's too expensive",
      },
    ],
    mirror: (value) => [
      {
        key: "billing",
        value: {
          // "Immediately" means no cushion at all, whatever number is in the box.
          cancelGraceDays:
            value.accessOnCancel === "immediately" ? 0 : Number(value.graceDays ?? 0),
          revokeAccessOnFullRefund: value.revokeAccessOnRefund !== false,
        },
      },
    ],
  },
  {
    key: "failed_payments",
    group: "payments",
    label: "When a payment fails",
    description:
      "How often a declined membership or instalment payment is tried again, and what happens when the tries run out.",
    defaults: { retryMode: "stripe", retryDays: "3, 5, 7", finalAction: "cancel" },
    fields: [
      {
        name: "retryMode",
        label: "Who tries the card again",
        help: "If you choose this site, switch off automatic retries in your Stripe account (Settings → Billing → Revenue recovery → Retries) so a card isn't tried twice as often.",
        type: "choice",
        choices: [
          { value: "stripe", label: "Stripe, using the retry settings in your Stripe account" },
          { value: "schedule", label: "This site, on the schedule below" },
        ],
      },
      {
        name: "retryDays",
        label: "Wait this many days before each new try",
        help: "Whole days, separated by commas. \"3, 5, 7\" tries three more times: 3 days after the first failure, then 5 days later, then 7 days after that. Up to 6 tries, 1–30 days apart.",
        type: "retryschedule",
        placeholder: "3, 5, 7",
      },
      {
        name: "finalAction",
        label: "When the last try fails",
        help: "Only used when this site is doing the retries. The customer gets the payment-failed email after every try either way.",
        type: "choice",
        choices: [
          { value: "cancel", label: "Cancel the membership, and end the access it pays for" },
          { value: "leave", label: "Stop trying, but leave the membership overdue for me to sort out" },
        ],
      },
    ],
  },
  recoveryDefinition,
  {
    key: "tax",
    group: "payments",
    label: "Sales tax",
    description: "Whether tax is added at the checkout.",
    defaults: { enabled: false, defaultRateBps: 0, rates: [] },
    fields: [
      { name: "enabled", label: "Add sales tax to orders", type: "boolean" },
      {
        name: "defaultRateBps",
        label: "Rate",
        help: "Used when you have no specific rate for a customer's country.",
        type: "number",
        min: 0,
        max: 10000,
        unit: "%",
        displayScale: 100,
      },
    ],
  },
  {
    key: "marketing_email",
    group: "email",
    label: "Who your emails come from",
    description: "This appears on every email you send, and the law requires the address.",
    defaults: {
      fromName: "",
      fromEmail: "",
      replyTo: "",
      address: "",
      footer: "",
      // 3.9: a logo at the head of marketing email.
      logoUrl: "",
      // 3.10: what a NEW sequence starts with, rather than every sequence
      // being configured from scratch and drifting apart.
      defaultSendHour: 9,
      defaultTimezone: "America/New_York",
    },
    fields: [
      {
        name: "fromName",
        label: "Name in the inbox",
        type: "text",
        placeholder: "Yvette at Boss Clinician",
      },
      {
        name: "fromEmail",
        label: "Sent from",
        help: "Has to be an address on a domain this site is verified to send from — anything else is refused when you save.",
        type: "email",
        placeholder: "yvette@bossclinician.callsphere.site",
      },
      {
        name: "replyTo",
        label: "Replies go to",
        help: "Leave blank to use the sending address.",
        type: "email",
      },
      {
        name: "logoUrl",
        label: "Logo at the top of marketing emails",
        help: "A URL to an image. Leave blank for text only — a broken logo looks worse than none.",
        type: "text",
        placeholder: "https://bossclinician.com/logo.png",
      },
      {
        name: "defaultSendHour",
        label: "New sequences send at",
        help: "The hour a newly created sequence uses until you change it. 0–23.",
        type: "number",
        min: 0,
        max: 23,
        unit: "o'clock",
      },
      {
        name: "defaultTimezone",
        label: "New sequences use this timezone",
        help: "Yours, unless a sequence is set to use each reader's own.",
        type: "text",
        placeholder: "America/New_York",
      },
      {
        name: "address",
        label: "Your postal address",
        help: "Required by law at the bottom of every marketing email.",
        type: "longtext",
      },
      {
        name: "footer",
        label: "Anything else at the bottom of your emails",
        type: "longtext",
      },
    ],
  },
  {
    key: "email_provider",
    group: "email",
    label: "Who delivers your email",
    description: "The service that actually sends, and tells us when someone opens.",
    defaults: { provider: "smtp", webhookSecret: "" },
    fields: [
      {
        name: "provider",
        label: "Sending service",
        help: "What actually carries your email. When it is set on the server, this shows the one in use and can't be changed here.",
        type: "choice",
        // Only transports email/provider.ts can actually run. Postmark and
        // SendGrid used to be offered and did nothing at all when chosen — the
        // mail kept going out through SES — which is exactly the lie E5 is
        // about. The screen narrows this further to what is available on the
        // running server (routes/admin/settingsV2.ts, `/groups`).
        choices: [
          { value: "ses", label: "Amazon SES" },
          { value: "smtp", label: "Your own mail server" },
          { value: "resend", label: "Resend" },
        ],
      },
      {
        name: "webhookSecret",
        label: "Signing secret from that service",
        help: "Lets us trust the opens and bounces it reports back.",
        type: "secret",
      },
    ],
  },
  {
    key: "member_signin",
    group: "members",
    label: "How customers sign in",
    description: "",
    defaults: { magicLinkEnabled: false, requireVerifiedEmail: false },
    fields: [
      {
        name: "magicLinkEnabled",
        label: "Let customers sign in with an emailed link instead of a password",
        type: "boolean",
      },
      {
        name: "requireVerifiedEmail",
        label: "Make customers confirm their email before they can sign in",
        type: "boolean",
      },
    ],
  },
  {
    key: "drip",
    group: "delivery",
    label: "When new lessons unlock",
    description: "Lessons on a schedule become available at this time.",
    defaults: { releaseTime: "06:00", timezone: "America/New_York" },
    fields: [
      { name: "releaseTime", label: "Time of day", type: "time" },
      { name: "timezone", label: "Time zone", help: TIMEZONE_HELP, type: "timezone" },
    ],
  },
  {
    key: "scheduling",
    group: "coaching",
    label: "Booking rules",
    description: "How far ahead people have to book, and when they can still move a session.",
    defaults: {
      minNoticeHours: 24,
      cancelWindowHours: 24,
      timezone: "America/New_York",
      slotIntervalMinutes: 30,
      bookingHorizonDays: 60,
    },
    fields: [
      {
        name: "minNoticeHours",
        label: "Earliest someone can book",
        help: "Nothing can be booked closer to now than this.",
        type: "number",
        min: 0,
        max: 2160,
        unit: "hours ahead",
      },
      {
        name: "cancelWindowHours",
        label: "Free cancellation up to",
        type: "number",
        min: 0,
        max: 2160,
        unit: "hours before",
      },
      {
        name: "slotIntervalMinutes",
        label: "Start times are offered every",
        type: "number",
        min: 5,
        max: 240,
        unit: "minutes",
      },
      {
        name: "bookingHorizonDays",
        label: "Calendar is open for the next",
        type: "number",
        min: 1,
        max: 365,
        unit: "days",
      },
      { name: "timezone", label: "Your time zone", help: TIMEZONE_HELP, type: "timezone" },
    ],
    mirror: (value) => [
      {
        key: "coaching",
        value: {
          minimumNoticeHours: Number(value.minNoticeHours ?? 24),
          cancellationWindowHours: Number(value.cancelWindowHours ?? 24),
          slotIntervalMinutes: Number(value.slotIntervalMinutes ?? 30),
          bookingHorizonDays: Number(value.bookingHorizonDays ?? 60),
          timezone: String(value.timezone ?? "America/New_York"),
        },
      },
    ],
  },
  {
    key: "form_settings",
    group: "marketing",
    label: "Keeping junk out of your forms",
    description: "",
    defaults: { spamProtection: "honeypot", turnstileSiteKey: "", turnstileSecret: "" },
    fields: [
      {
        name: "spamProtection",
        label: "How forms are protected",
        type: "choice",
        choices: [
          { value: "honeypot", label: "Invisible trap — nothing for real people to do" },
          { value: "turnstile", label: "Cloudflare's checkbox — stronger, needs an account" },
        ],
      },
      {
        name: "turnstileSiteKey",
        label: "Cloudflare site key",
        help: "Only needed if you picked Cloudflare above.",
        type: "text",
      },
      { name: "turnstileSecret", label: "Cloudflare secret key", type: "secret" },
    ],
  },
  {
    key: "seo",
    group: "website",
    label: "What Google sees",
    description: "",
    defaults: { allowIndexing: false, defaultTitle: "", defaultDescription: "", ogImage: "" },
    fields: [
      {
        name: "allowIndexing",
        label: "Let search engines list your site",
        help: "Turn this on once your site is on its real address.",
        type: "boolean",
      },
      {
        name: "defaultTitle",
        label: "Title shown in search results",
        type: "text",
        placeholder: "Boss Clinician",
      },
      {
        name: "defaultDescription",
        label: "Description under the title",
        type: "longtext",
      },
      {
        name: "ogImage",
        label: "Picture used when your site is shared",
        type: "url",
      },
    ],
  },
  {
    key: "branding",
    group: "website",
    label: "Your look",
    description: "",
    defaults: { logoUrl: "", faviconUrl: "", primaryColor: "", fontHeading: "", fontBody: "" },
    fields: [
      { name: "logoUrl", label: "Logo", type: "url" },
      { name: "faviconUrl", label: "Little icon in the browser tab", type: "url" },
      { name: "primaryColor", label: "Main colour", type: "color" },
      { name: "fontHeading", label: "Font for headings", type: "text" },
      { name: "fontBody", label: "Font for everything else", type: "text" },
    ],
  },
  {
    key: "analytics",
    group: "integrations",
    label: "Tracking",
    description: "Lets Google and Facebook tell you where your buyers came from.",
    defaults: { ga4MeasurementId: "", metaPixelId: "", metaAccessToken: "" },
    fields: [
      {
        name: "ga4MeasurementId",
        label: "Google Analytics ID",
        type: "text",
        placeholder: "G-XXXXXXXXXX",
      },
      { name: "metaPixelId", label: "Facebook pixel ID", type: "text" },
      { name: "metaAccessToken", label: "Facebook access token", type: "secret" },
    ],
  },
];

const BY_KEY = new Map(SETTING_DEFINITIONS.map((d) => [d.key, d]));

export function settingDefinition(key: string): SettingDefinition | undefined {
  return BY_KEY.get(key);
}

/**
 * The fields of a setting that hold a credential.
 *
 * The settings screen never sends one back — it shows a masked hint instead —
 * so anything that reads or writes the raw `settings` table needs to know which
 * fields those are. Empty for a key the registry does not describe, which is
 * the safe answer only because the caller then has nothing to strip.
 */
export function secretFieldNames(key: string): string[] {
  return (BY_KEY.get(key)?.fields ?? [])
    .filter((field) => field.type === "secret")
    .map((field) => field.name);
}

/* -------------------------------------------------------------- validation */

function fieldSchema(field: SettingField): z.ZodTypeAny {
  switch (field.type) {
    case "text":
      return z.string().max(500);
    case "longtext":
      return z.string().max(5000);
    // The three payment fields Stripe or the reports have rules about. The
    // message is the reason, so the owner reads why a save was refused.
    case "reasonlist":
      return z.string().max(8000).superRefine((value, ctx) => {
        const problem = cancelReasonsProblem(value);
        if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem });
      });
    case "descriptor":
      return z.string().max(60).superRefine((value, ctx) => {
        const problem = statementDescriptorProblem(value);
        if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem });
      });
    case "retryschedule":
      return z.string().max(100).superRefine((value, ctx) => {
        const problem = retryScheduleProblem(value);
        if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem });
      });
    case "secret":
      return z.string().max(2000);
    case "email":
      // Blank is a real answer — "we don't have one" — and must not be a
      // validation failure she has to work out how to satisfy.
      return z.union([z.literal(""), z.string().email().max(320)]);
    case "url":
      return z.union([z.literal(""), z.string().url().max(2000)]);
    case "color":
      return z.union([z.literal(""), z.string().regex(/^#[0-9a-fA-F]{6}$/)]);
    case "image":
      // Only a file this server stores publicly, as the media upload names it,
      // and only the two formats a PDF can draw. The bytes are checked again
      // when a receipt reads them (services/receiptLogo.ts).
      return z.union([
        z.literal(""),
        z
          .string()
          .max(260)
          .regex(/^\/uploads\/[A-Za-z0-9][A-Za-z0-9._-]{0,199}\.(png|jpe?g)$/i),
      ]);
    case "boolean":
      return z.boolean();
    case "number": {
      let schema = z.number().finite();
      if (field.min !== undefined) schema = schema.min(field.min);
      if (field.max !== undefined) schema = schema.max(field.max);
      return schema;
    }
    case "time":
      return z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
    case "timezone":
      return z.string().refine(isValidTimeZone);
    case "choice": {
      const allowed = (field.choices ?? []).map((c) => c.value);
      return z.string().refine((v) => allowed.includes(v));
    }
  }
}

/**
 * The schema a PUT body is checked against.
 *
 * Partial, because a screen may save one field; strict, because a key the
 * registry does not describe has no business being written through a form —
 * the alternative is a settings endpoint that will store anything at all.
 */
function patchSchema(definition: SettingDefinition): z.ZodTypeAny {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const field of definition.fields) shape[field.name] = fieldSchema(field);
  return z.object(shape).partial().strict();
}

/**
 * A stored row, field by field, with anything unusable replaced by its default.
 *
 * Never throws. A settings row is edited by hand often enough — and by older
 * versions of this app — that one bad field must not take down every page that
 * reads the key.
 */
function coerce(definition: SettingDefinition, stored: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...definition.defaults, ...stored };

  for (const field of definition.fields) {
    const parsed = fieldSchema(field).safeParse(stored[field.name]);
    out[field.name] = parsed.success ? parsed.data : definition.defaults[field.name];
  }

  return out;
}

/* ------------------------------------------------------------------- cache */

interface CacheEntry {
  at: number;
  value: Record<string, unknown>;
}

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, CacheEntry>();

/**
 * Drops every cached setting.
 *
 * Called by the writer, and by tests. A minute of staleness is invisible to a
 * reader and unacceptable to the person who just pressed Save, which is why
 * this exists rather than only the TTL.
 */
export function clearSettingsCache(): void {
  cache.clear();
}

function rawValue(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** One setting, defaults filled in and every field validated. Cached for a minute. */
export async function readSetting(key: string): Promise<Record<string, unknown>> {
  const definition = BY_KEY.get(key);
  if (!definition) return {};

  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;

  const res = await pool.query<{ value: unknown }>(`SELECT value FROM settings WHERE key = $1`, [
    key,
  ]);
  const value = coerce(definition, rawValue(res.rows[0]?.value));

  cache.set(key, { at: Date.now(), value });
  return value;
}

/** The same read, checked against a caller's own schema. Falls back on a mismatch. */
export async function readSettingAs<T>(key: string, schema: z.ZodType<T>, fallback: T): Promise<T> {
  const parsed = schema.safeParse(await readSetting(key));
  return parsed.success ? parsed.data : fallback;
}

/* ------------------------------------------------------------------ writes */

export class SettingValidationError extends Error {
  readonly details: unknown;

  constructor(details: unknown) {
    super("Invalid setting value");
    this.name = "SettingValidationError";
    this.details = details;
  }
}

/**
 * Merges a patch into a setting.
 *
 * A merge rather than a replace, at the database rather than in application
 * code: two people saving two different groups of the same key would otherwise
 * race, and the loser's change would vanish with no error anywhere. `||` on
 * jsonb is a top-level key merge, which is exactly the granularity a form
 * saves at.
 */
export async function writeSetting(
  key: string,
  patch: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const definition = BY_KEY.get(key);
  if (!definition) throw new SettingValidationError({ key: ["Unknown setting"] });

  const parsed = patchSchema(definition).safeParse(patch);
  if (!parsed.success) throw new SettingValidationError(parsed.error.flatten());
  const clean = parsed.data as Record<string, unknown>;

  if (key === "cart_recovery") {
    const candidate = {...await readSetting(key), ...clean};
    const emails = String(candidate.recipients ?? "").split(/[,\s]+/).filter(Boolean);
    if (emails.some((email) => !z.string().email().safeParse(email).success)) {
      throw new SettingValidationError({recipients: ["Enter valid email addresses, separated by commas or newlines."]});
    }
    let previous = 0;
    for (const i of [0, 1, 2, 3]) {
      if (!candidate[`enabled${i}`]) continue;
      const hours = Number(candidate[`hours${i}`]);
      if (hours <= previous) throw new SettingValidationError({[`hours${i}`]: ["Each enabled reminder must have a later delay than the previous one."]});
      if (!String(candidate[`subject${i}`] ?? "").trim() || !String(candidate[`body${i}`] ?? "").trim()) {
        throw new SettingValidationError({[`body${i}`]: ["Enabled reminders need a subject and email body."]});
      }
      previous = hours;
    }
  }

  const res = await pool.query<{ value: unknown }>(
    `INSERT INTO settings (key, value, group_key, label, description)
     VALUES ($1, $2::jsonb || $3::jsonb, $4, $5, $6)
     ON CONFLICT (key) DO UPDATE
       SET value = settings.value || $3::jsonb, updated_at = now()
     RETURNING value`,
    [
      key,
      JSON.stringify(definition.defaults),
      JSON.stringify(clean),
      definition.group,
      definition.label,
      definition.description,
    ]
  );

  const merged = coerce(definition, rawValue(res.rows[0]?.value));

  for (const target of definition.mirror?.(merged) ?? []) {
    await pool.query(
      `INSERT INTO settings (key, value, group_key, label, description)
       VALUES ($1, $2::jsonb, 'internal', '', '')
       ON CONFLICT (key) DO UPDATE
         SET value = settings.value || EXCLUDED.value, updated_at = now()`,
      [target.key, JSON.stringify(target.value)]
    );
  }

  cache.delete(key);
  // The course player caches the drip schedule of its own accord, on its own
  // hot path. Saving a release time that takes a minute to appear is a support
  // question; saving one that never appears is a bug report.
  if (key === "drip") clearDripSettingsCache();

  return merged;
}

/* ------------------------------------------------------------- for the UI */

export interface SettingFieldView extends SettingField {
  /** Always absent for a secret — see `hasValue`. */
  value?: unknown;
  /** Secrets only: whether one is stored, and the tail end of it. */
  hasValue?: boolean;
  hint?: string;
}

export interface SettingView {
  key: string;
  label: string;
  description: string;
  fields: SettingFieldView[];
}

export interface SettingGroupView {
  key: string;
  label: string;
  description: string;
  settings: SettingView[];
}

/**
 * Enough of a secret to recognise it, and not enough to use it.
 *
 * "sk_…9f2c" tells her the right key is in there; the full value never leaves
 * the server once it has been saved.
 */
export function maskSecret(value: string): string {
  if (!value) return "";
  if (value.length <= 8) return "••••";
  return `${value.slice(0, 3)}…${value.slice(-4)}`;
}

/**
 * Every setting, grouped for the screen, with secrets reduced to a hint.
 *
 * Reads the whole table in one query rather than one per key: this is the first
 * paint of the settings screen, and thirteen round trips to render one page is
 * the sort of thing that makes an admin feel slow for no reason at all.
 */
export async function settingGroups(): Promise<SettingGroupView[]> {
  const res = await pool.query<{
    key: string;
    value: unknown;
    label: string;
    description: string;
    is_secret: boolean;
  }>(`SELECT key, value, label, description, is_secret FROM settings`);

  const rows = new Map(res.rows.map((r) => [r.key, r]));

  return SETTING_GROUPS.map((group) => ({
    key: group.key,
    label: group.label,
    description: group.description,
    settings: SETTING_DEFINITIONS.filter((d) => d.group === group.key).map((definition) => {
      const row = rows.get(definition.key);
      const value = coerce(definition, rawValue(row?.value));
      // A row flagged secret hides all of its fields, whatever their declared
      // type — that flag is the escape hatch for a key added after this file.
      const wholeRowSecret = row?.is_secret === true;

      return {
        key: definition.key,
        // The row's own wording wins when it has some: the migration seeds it,
        // and a future one can rename a setting without a deploy of this file.
        label: row?.label || definition.label,
        description: row?.description || definition.description,
        fields: definition.fields.map((field): SettingFieldView => {
          if (field.type === "secret" || wholeRowSecret) {
            const stored = typeof value[field.name] === "string" ? String(value[field.name]) : "";
            return { ...field, hasValue: stored.length > 0, hint: maskSecret(stored) };
          }
          return { ...field, value: value[field.name] };
        }),
      };
    }),
  })).filter((group) => group.settings.length > 0);
}
