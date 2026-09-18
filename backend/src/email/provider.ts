import crypto from "crypto";
import { z } from "zod";
import { env } from "../config/env";
import { pool } from "../db/pool";
import { sendMailStrict } from "./mailer";
import type { MergeLinks } from "./mergeValues";
import { assertRecipientAllowed } from "./recipientGuard";
import { escapeHtml } from "./templates";
import {
  SendingIdentityError,
  describeTransport,
  identityFailureReason,
  marketingIdentityProblems,
  sendingDomainsFrom,
  transportKeyForHost,
  type TransportReport,
} from "../services/sendingIdentity";

/**
 * The single door every outbound email goes through.
 *
 * Two things are true of this platform's mail that were not true before Phase 5,
 * and both of them are the reason this file exists rather than a call to
 * `sendMail` at each site.
 *
 * The first is reporting. Raw SMTP tells us nothing: the admin's open and click
 * figures are zero and always will be, because nothing reports back. A provider
 * that posts webhooks does report back, but only about messages it can name — so
 * every send writes an `email_messages` row BEFORE the transport is called and
 * stamps the provider's id on it afterwards. A message that is sent and not
 * recorded is a bounce with nowhere to land.
 *
 * The second is the suppression list. A hard bounce or a spam complaint means
 * that address must never be mailed marketing again, and "never again" is not a
 * property any individual caller can be trusted to remember. The check lives
 * here, ahead of the transport, so forgetting it is not something a caller is
 * able to do.
 */

/* ------------------------------------------------------------------ topics */

/**
 * The subscription topics a contact can turn off individually.
 *
 * Deliberately a short, human list rather than one topic per sequence: a
 * preferences page with forty checkboxes is a page nobody reads and everybody
 * unsubscribes from wholesale. `transactional` is absent on purpose — a receipt
 * is not something anyone may opt out of receiving.
 */
export const PREFERENCE_TOPICS = [
  { topic: "marketing", label: "News, offers and launches" },
  { topic: "product", label: "Course and product updates" },
  { topic: "community", label: "Community digests" },
  { topic: "events", label: "Event invitations and reminders" },
] as const;

export type PreferenceTopic = (typeof PREFERENCE_TOPICS)[number]["topic"];

export function isKnownTopic(topic: string): boolean {
  return PREFERENCE_TOPICS.some((t) => t.topic === topic);
}

/* ------------------------------------------------- preference link signing */

/**
 * HMAC over the contact id, following services/signedUrls.ts.
 *
 * Its own HKDF `info` string, so a preferences token and a download token are
 * not interchangeable even though both are HMACs over JWT_SECRET. And no
 * expiry: an unsubscribe link has to keep working in an email somebody finds in
 * their archive three years from now, which is exactly the case where they most
 * want it to.
 */
const PREFERENCES_INFO = "bossclinician/email-preferences/v1";
const PREFERENCES_VERSION = "p1";

let preferencesKey: Buffer | null = null;

function prefsKey(): Buffer {
  if (preferencesKey === null) {
    preferencesKey = Buffer.from(
      crypto.hkdfSync(
        "sha256",
        Buffer.from(env.jwtSecret, "utf8"),
        Buffer.alloc(0),
        Buffer.from(PREFERENCES_INFO, "utf8"),
        32
      )
    );
  }
  return preferencesKey;
}

function signPrefs(body: string): string {
  return crypto.createHmac("sha256", prefsKey()).update(body).digest("base64url");
}

export function signPreferencesToken(contactId: number): string {
  const body = Buffer.from(`${PREFERENCES_VERSION}.${contactId}`, "utf8").toString("base64url");
  return `${body}.${signPrefs(body)}`;
}

/** The contact id a token names, or null when the signature or shape does not hold. */
export function verifyPreferencesToken(token: string): number | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, provided] = parts;
  if (!body || !provided) return null;

  const expected = signPrefs(body);
  // Lengths must match before timingSafeEqual, which throws rather than
  // returning false when they differ.
  if (provided.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(provided, "utf8"), Buffer.from(expected, "utf8"))) {
    return null;
  }

  const fields = Buffer.from(body, "base64url").toString("utf8").split(".");
  if (fields.length !== 2 || fields[0] !== PREFERENCES_VERSION) return null;

  const contactId = Number(fields[1]);
  if (!Number.isSafeInteger(contactId) || contactId <= 0) return null;
  return contactId;
}

/** Where a token is redeemed. Minting and serving have to agree, so it is stated once. */
export const PREFERENCES_PATH = "/api/email/prefs";
export const UNSUBSCRIBE_PATH = "/api/email/unsubscribe";

export function preferencesUrl(contactId: number): string {
  return `${env.publicSiteUrl}${PREFERENCES_PATH}/${signPreferencesToken(contactId)}`;
}

export function unsubscribeUrl(contactId: number): string {
  return `${env.publicSiteUrl}${UNSUBSCRIBE_PATH}/${signPreferencesToken(contactId)}`;
}

/**
 * The link tokens a marketing email can use: `{{unsubscribeUrl}}`,
 * `{{loginUrl}}` and `{{startUrl}}`.
 *
 * Here rather than in `mergeValues` so that file stays free of the environment
 * and the signing secret. A send with no contact behind it gets a blank
 * unsubscribe link rather than one signed for nobody — except a test send,
 * where a blank would look like the token was broken; that gets a link of the
 * right shape which unsubscribes nobody.
 */
export function mergeLinks(
  contactId: number | null,
  options: { preview?: boolean } = {}
): MergeLinks {
  const placeholder = options.preview ? `${env.publicSiteUrl}${UNSUBSCRIBE_PATH}/preview` : "";
  return {
    unsubscribeUrl: contactId === null ? placeholder : unsubscribeUrl(contactId),
    loginUrl: `${env.publicSiteUrl}/login`,
    startUrl: `${env.publicSiteUrl}/library`,
  };
}

/* ---------------------------------------------------------------- settings */

const marketingSettingSchema = z.object({
  fromName: z.string().default(""),
  fromEmail: z.string().default(""),
  replyTo: z.string().default(""),
  address: z.string().default(""),
  footer: z.string().default(""),
  /** 3.9: a logo at the head of marketing email. Blank means text only. */
  logoUrl: z.string().default(""),
  defaultSendHour: z.coerce.number().int().min(0).max(23).default(9),
  defaultTimezone: z.string().default("America/New_York"),
});

export type MarketingSettings = z.infer<typeof marketingSettingSchema>;

// Deliberately a loose string rather than an enum: the settings screen offers
// more services than have transports here, and a name this file does not
// implement has to fall back to SMTP rather than fail a password reset.
const providerSettingSchema = z.object({
  provider: z.string().default("smtp"),
  apiKey: z.string().default(""),
  webhookSecret: z.string().default(""),
});

export type ProviderSettings = z.infer<typeof providerSettingSchema>;

async function readSetting(key: string): Promise<unknown> {
  const res = await pool.query<{ value: unknown }>(`SELECT value FROM settings WHERE key = $1`, [
    key,
  ]);
  return res.rows[0]?.value ?? {};
}

export async function marketingSettings(): Promise<MarketingSettings> {
  const parsed = marketingSettingSchema.safeParse(await readSetting("marketing_email"));
  return parsed.success
    ? parsed.data
    : {
        fromName: "",
        fromEmail: "",
        replyTo: "",
        address: "",
        footer: "",
        logoUrl: "",
        defaultSendHour: 9,
        defaultTimezone: "America/New_York",
      };
}

export async function providerSettings(): Promise<ProviderSettings> {
  const parsed = providerSettingSchema.safeParse(await readSetting("email_provider"));
  const settings = parsed.success ? parsed.data : { provider: "smtp", apiKey: "", webhookSecret: "" };
  // The environment wins over the database for the key itself: a secret in a
  // settings row is a secret in a database backup, and the deployment already
  // carries provider credentials this way.
  return { ...settings, apiKey: process.env.RESEND_API_KEY || settings.apiKey };
}

/* --------------------------------------------------------------- transport */

export interface ProviderMessage {
  to: string;
  from: string;
  replyTo: string;
  subject: string;
  text: string;
  html: string;
  headers: Record<string, string>;
}

export interface EmailProvider {
  readonly name: string;
  send(message: ProviderMessage): Promise<{ providerMessageId: string }>;
}

/** The nodemailer path this platform has always used. */
export const smtpProvider: EmailProvider = {
  name: "smtp",
  async send(message) {
    const { messageId } = await sendMailStrict({
      to: message.to,
      from: message.from,
      replyTo: message.replyTo,
      subject: message.subject,
      text: message.text,
      html: message.html,
      headers: message.headers,
    });
    return { providerMessageId: messageId };
  },
};

const RESEND_ENDPOINT = "https://api.resend.com/emails";

/**
 * Resend, over its REST API rather than its SDK.
 *
 * One fetch against a documented endpoint is less to keep current than a
 * dependency, and the platform is on Node 20 where fetch is built in. The id it
 * returns is the join key for every webhook it will later post about this
 * message, which is the whole reason for preferring it to SMTP.
 */
export function makeResendProvider(apiKey: string): EmailProvider {
  return {
    name: "resend",
    async send(message) {
      // The SMTP path is guarded inside sendMailStrict; this transport bypasses it.
      assertRecipientAllowed(message.to);
      const response = await fetch(RESEND_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: message.from,
          to: [message.to],
          reply_to: message.replyTo || undefined,
          subject: message.subject,
          text: message.text,
          html: message.html,
          headers: message.headers,
        }),
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(`Resend rejected the message (${response.status}): ${detail.slice(0, 300)}`);
      }

      const body = (await response.json()) as { id?: string };
      if (!body.id) throw new Error("Resend accepted the message but returned no id");
      return { providerMessageId: body.id };
    },
  };
}

/**
 * The transport the owner has configured.
 *
 * Falls back to SMTP when Resend is selected without a key rather than
 * throwing: a half-finished settings change must not stop a password reset.
 */
export async function resolveProvider(): Promise<EmailProvider> {
  const settings = await providerSettings();
  if (settings.provider === "resend" && settings.apiKey) {
    return makeResendProvider(settings.apiKey);
  }
  return smtpProvider;
}

/**
 * The domains a marketing from-address has to be on — see `sendingDomainsFrom`.
 *
 * SES_VERIFIED_DOMAINS is read here rather than declared in config/env.ts: it is
 * optional, and only this door and the settings screen consult it.
 */
export function verifiedSendingDomains(): string[] {
  return sendingDomainsFrom({
    smtpHost: env.smtp.host,
    smtpFrom: env.smtp.from,
    extra: process.env.SES_VERIFIED_DOMAINS ?? "",
  });
}

/** Whether mailer.ts has a real server to hand mail to, by its own test. */
function smtpConfigured(): boolean {
  return Boolean(env.smtp.host && env.smtp.user && env.smtp.pass);
}

/**
 * What `resolveProvider()` above will pick, described for the settings screen.
 *
 * Built from the same two facts `resolveProvider` reads, so the "Sending
 * service" field cannot show one transport while the mail goes out through
 * another — which is what it did when it showed the stored row instead.
 */
export async function activeTransport(): Promise<TransportReport> {
  const settings = await providerSettings();
  return describeTransport({
    storedProvider: settings.provider,
    smtpHost: env.smtp.host,
    smtpConfigured: smtpConfigured(),
    hasResendKey: settings.apiKey.trim() !== "",
  });
}

/** The word the delivery log records for a transport: "ses" rather than the protocol it was reached over. */
function deliveryLogName(provider: EmailProvider): string {
  if (provider.name !== smtpProvider.name) return provider.name;
  return smtpConfigured() ? transportKeyForHost(env.smtp.host) : "console";
}

/* ----------------------------------------------------------------- content */

/**
 * The small subset of Markdown the email editor actually produces.
 *
 * Not a Markdown library, and not trying to be one: headings, bold, italics,
 * links, lists and paragraphs cover every sequence email in the live account,
 * and a full parser is a dependency plus an HTML-injection surface in something
 * that goes out over the owner's sending domain. Everything is escaped first,
 * so an inline `<script>` in a body arrives as text.
 */
export function renderMarkdown(markdown: string): string {
  const inline = (text: string): string =>
    escapeHtml(text)
      .replace(
        /!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g,
        '<img src="$2" alt="$1" style="display:block;max-width:100%;height:auto;border:0">'
      )
      .replace(
        /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\s+&quot;button&quot;\)/g,
        '<a href="$2" style="display:inline-block;padding:12px 20px;border-radius:8px;background:#5b214e;color:#ffffff;text-decoration:none;font-weight:700">$1</a>'
      )
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>')
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");

  const blocks = markdown.replace(/\r\n/g, "\n").split(/\n{2,}/);
  const html: string[] = [];

  for (const block of blocks) {
    const trimmed = block.trim();
    if (trimmed === "") continue;

    const lines = trimmed.split("\n");
    if (/^-{3,}$/.test(trimmed)) {
      html.push('<hr style="border:0;border-top:1px solid #ded7db;margin:24px 0">');
      continue;
    }

    if (lines.every((line) => /^\s*[-*]\s+/.test(line))) {
      const items = lines.map((line) => `<li>${inline(line.replace(/^\s*[-*]\s+/, ""))}</li>`);
      html.push(`<ul>${items.join("")}</ul>`);
      continue;
    }

    if (lines.every((line) => /^\s*\d+\.\s+/.test(line))) {
      const items = lines.map((line) => `<li>${inline(line.replace(/^\s*\d+\.\s+/, ""))}</li>`);
      html.push(`<ol>${items.join("")}</ol>`);
      continue;
    }

    const heading = /^(#{1,3})\s+(.*)$/.exec(trimmed);
    if (heading) {
      const level = heading[1].length;
      html.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }

    html.push(`<p>${lines.map(inline).join("<br>")}</p>`);
  }

  return html.join("\n");
}

/** Replaces {{firstName}} style tokens. Unknown tokens become empty, never the raw token. */
export function renderTokens(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, key: string) => values[key] ?? "");
}

/* -------------------------------------------------------------------- send */

export type EmailSourceType =
  | "transactional"
  | "broadcast"
  | "sequence"
  | "automation"
  | "digest";

export interface SendEmailInput {
  to: string;
  subject: string;
  /** Plain text body. Required — a text/plain part is worth several points of deliverability. */
  text: string;
  /** Pre-rendered HTML. Omit and the text is wrapped in paragraphs. */
  html?: string;
  contactId?: number | null;
  memberId?: number | null;
  sourceType: EmailSourceType;
  sourceId?: number | null;
  /** Which preference switch governs this message. Ignored for transactional mail. */
  topic?: string;
  fromName?: string;
  fromEmail?: string;
  replyTo?: string;
}

export type SendOutcome = "sent" | "suppressed";

export interface SendEmailResult {
  /** The `email_messages` row, which exists even when nothing was sent. */
  messageId: number;
  outcome: SendOutcome;
  providerMessageId: string;
  /** Populated when `outcome` is "suppressed": why this address was skipped. */
  suppressedReason: string;
}

/**
 * Whether marketing may be sent to this address, and why not when it may not.
 *
 * Three independent gates, checked in the order that costs least. The
 * suppression list is keyed on the address rather than the contact on purpose:
 * an address stays suppressed through a contact being deleted and re-imported
 * from a CSV, which is the exact route by which a sending domain dies.
 */
export async function marketingBlockReason(
  email: string,
  contactId: number | null | undefined,
  topic: string
): Promise<string | null> {
  const suppressed = await pool.query<{ reason: string }>(
    `SELECT reason FROM email_suppressions WHERE email = $1`,
    [email]
  );
  if (suppressed.rows[0]) return `suppressed (${suppressed.rows[0].reason})`;

  if (contactId === null || contactId === undefined) return null;

  const contact = await pool.query<{ email_marketing_status: string }>(
    `SELECT email_marketing_status FROM contacts WHERE id = $1`,
    [contactId]
  );
  const status = contact.rows[0]?.email_marketing_status ?? "subscribed";
  if (status !== "subscribed" && status !== "unconfirmed") {
    return `contact is ${status}`;
  }

  if (topic) {
    const preference = await pool.query<{ subscribed: boolean }>(
      `SELECT subscribed FROM contact_email_preferences WHERE contact_id = $1 AND topic = $2`,
      [contactId, topic]
    );
    if (preference.rows[0] && !preference.rows[0].subscribed) {
      return `unsubscribed from ${topic}`;
    }

    /*
     * The member portal's own switches, which this path used to ignore.
     *
     * There are two preference stores and they were checked in different
     * places: the email-link preference centre writes
     * `contact_email_preferences` keyed by contact and by the topic names this
     * file uses, while /account writes `member_email_preferences` keyed by
     * member and by its own names. Only the community digest job ever read the
     * second one — so a member who turned "course and product updates" off in
     * their account went on receiving every campaign, because nothing on the
     * sending path had looked.
     *
     * Honouring both, and the OFF switch always wins. A member who has said no
     * in either place has said no.
     */
    const memberTopic = MEMBER_TOPIC_FOR[topic];
    if (memberTopic) {
      const declined = await pool.query(
        `SELECT 1
           FROM members m
           JOIN member_email_preferences p ON p.member_id = m.id
          WHERE m.contact_id = $1 AND p.topic = $2 AND NOT p.subscribed`,
        [contactId, memberTopic]
      );
      if ((declined.rowCount ?? 0) > 0) {
        return `unsubscribed from ${topic} in their account`;
      }
    }
  }

  return null;
}

/**
 * The member portal's topic names, mapped onto the ones the sending path uses.
 *
 * Two vocabularies for one idea, which is how they drifted apart in the first
 * place. Mapping rather than renaming either: the stored rows on both sides are
 * a record of what somebody chose, and rewriting their keys would silently
 * reinterpret decisions people have already made.
 *
 * `events` has no member-portal switch, so it is deliberately absent rather
 * than pointed at an approximation — mapping it to "product news" would let a
 * member who muted course updates stop getting reminders for a webinar they
 * registered for.
 */
const MEMBER_TOPIC_FOR: Record<string, string | undefined> = {
  marketing: "product_news",
  product: "course_updates",
  community: "community_digest",
};

function fromHeader(name: string, address: string): string {
  if (!address) return env.smtp.from;
  return name ? `${name} <${address}>` : address;
}

/**
 * The CAN-SPAM block every marketing email carries.
 *
 * Not a nicety and not a setting anyone may switch off: a commercial email
 * without a physical postal address and a working opt-out is illegal in the
 * United States, where this list lives.
 */
function complianceBlock(
  settings: MarketingSettings,
  contactId: number
): { text: string; html: string; unsubscribe: string } {
  const unsubscribe = unsubscribeUrl(contactId);
  const preferences = preferencesUrl(contactId);

  const textParts = ["", "—", settings.footer, settings.address].filter(Boolean);
  textParts.push(`Unsubscribe: ${unsubscribe}`);
  textParts.push(`Change what you hear about: ${preferences}`);

  const htmlParts = [
    `<hr style="border:none;border-top:1px solid #e5e5e5;margin:32px 0 16px">`,
    `<div style="color:#767676;font-size:12px;line-height:1.6">`,
  ];
  if (settings.footer) htmlParts.push(`<p>${escapeHtml(settings.footer)}</p>`);
  if (settings.address) htmlParts.push(`<p>${escapeHtml(settings.address)}</p>`);
  htmlParts.push(
    `<p><a href="${escapeHtml(unsubscribe)}">Unsubscribe</a> &middot; ` +
      `<a href="${escapeHtml(preferences)}">Change what you hear about</a></p>`,
    `</div>`
  );

  return { text: textParts.join("\n"), html: htmlParts.join("\n"), unsubscribe };
}

/**
 * Records, guards, sends, stamps.
 *
 * Throws when the transport fails, after marking the message `failed` — the
 * caller is a queued job, and a job that cannot tell a failure from a success
 * turns "the emails stopped" into something nobody finds out about.
 */
export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const to = input.to.trim().toLowerCase();
  if (!to) throw new Error("No recipient address");

  const isMarketing = input.sourceType !== "transactional";
  const topic = input.topic ?? (isMarketing ? "marketing" : "");
  const provider = await resolveProvider();

  const inserted = await pool.query<{ id: string }>(
    `INSERT INTO email_messages
       (contact_id, member_id, to_email, source_type, source_id, topic, subject, provider, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'queued')
     RETURNING id`,
    [
      input.contactId ?? null,
      input.memberId ?? null,
      to,
      input.sourceType,
      input.sourceId ?? null,
      topic,
      input.subject.slice(0, 500),
      deliveryLogName(provider),
    ]
  );
  const messageId = Number(inserted.rows[0].id);

  if (isMarketing) {
    const blocked = await marketingBlockReason(to, input.contactId, topic);
    if (blocked) {
      await pool.query(
        `UPDATE email_messages SET status = 'suppressed', error = $2 WHERE id = $1`,
        [messageId, blocked]
      );
      return { messageId, outcome: "suppressed", providerMessageId: "", suppressedReason: blocked };
    }
  }

  const settings = await marketingSettings();

  /*
   * The identity gate.
   *
   * Everything below this point builds a marketing email: a From line, and a
   * CAN-SPAM footer made out of `settings.address`. Both used to be built
   * happily out of nothing — a blank `fromEmail` fell through `fromHeader()` to
   * SMTP_FROM, and a blank `address` produced a footer with no postal address in
   * it, which is not a cosmetic problem but an illegal commercial email. The
   * send then reported success and the delivery log recorded it as handed over.
   *
   * So the effective identity is checked here rather than at each caller: a
   * campaign carries its own from-name and from-address, a sequence email may
   * too, and the postal address only ever comes from settings. Refused sends are
   * written down as `failed` with the missing field named — the same shape the
   * "no contact to unsubscribe" refusal below already uses — so the delivery log
   * says which field, and then the error is thrown so a job cannot mistake it
   * for a delivery.
   *
   * Transactional mail is deliberately not gated. A confirmation link is what
   * unlocks posting, commenting and every point a member can earn, and refusing
   * it because the marketing footer is blank would lock every member out to
   * enforce a rule that does not apply to receipts.
   */
  if (isMarketing) {
    const identityProblems = marketingIdentityProblems(
      {
        fromName: input.fromName || settings.fromName,
        fromEmail: input.fromEmail || settings.fromEmail,
        address: settings.address,
      },
      // A campaign or a sequence email can carry its own from-address, so the
      // domain is judged here on the EFFECTIVE address — the save-time check on
      // the settings screen cannot see those.
      { verifiedDomains: verifiedSendingDomains() }
    );
    if (identityProblems.length > 0) {
      const reason = identityFailureReason(identityProblems);
      await pool.query(`UPDATE email_messages SET status = 'failed', error = $2 WHERE id = $1`, [
        messageId,
        reason,
      ]);
      throw new SendingIdentityError(identityProblems);
    }
  }

  const headers: Record<string, string> = {};
  let text = input.text;
  let html = input.html ?? renderMarkdown(input.text);

  // Open and click figures exist because a configuration set subscribes to
  // those events; measuring a click also means SES rewriting every link in the
  // body. Both are wanted for a broadcast and neither is wanted on a receipt,
  // so the marketing set is named here and mailer.ts applies the plain
  // transactional one to everything that does not.
  if (isMarketing && env.ses.marketingConfigSet) {
    headers["X-SES-CONFIGURATION-SET"] = env.ses.marketingConfigSet;
  }

  // The compliance block needs a contact to address the opt-out to. A marketing
  // send with no contact row cannot honour an unsubscribe and so must not go —
  // every caller in this phase resolves a contact first.
  /*
   * 3.9: the logo, above the body and on marketing only.
   *
   * Only when it is an https URL. A logo is the first thing in the email and
   * an <img> pointing at http on an https-delivered message is a mixed-content
   * block in some clients and a broken picture in the rest — worse than the
   * text-only header it replaced.
   */
  if (isMarketing && /^https:\/\//i.test(settings.logoUrl)) {
    html =
      `<div style="margin:0 0 24px"><img src="${escapeHtml(settings.logoUrl)}" ` +
      `alt="${escapeHtml(settings.fromName || "")}" ` +
      `style="max-width:220px;height:auto;display:block;border:0"></div>` +
      html;
  }

  if (isMarketing) {
    if (input.contactId === null || input.contactId === undefined) {
      await pool.query(
        `UPDATE email_messages SET status = 'failed', error = $2 WHERE id = $1`,
        [messageId, "marketing email with no contact to unsubscribe"]
      );
      throw new Error("A marketing email needs a contact so the reader can unsubscribe");
    }

    const block = complianceBlock(settings, input.contactId);
    text = `${text}\n${block.text}`;
    html = `${html}\n${block.html}`;
    // RFC 8058: the POST form is what lets Gmail and Outlook show their own
    // one-click unsubscribe button, which is the button people press instead of
    // "report spam".
    headers["List-Unsubscribe"] = `<${block.unsubscribe}>`;
    headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
  }

  const message: ProviderMessage = {
    to,
    from: fromHeader(
      input.fromName || settings.fromName,
      input.fromEmail || settings.fromEmail
    ),
    replyTo: input.replyTo || settings.replyTo,
    subject: input.subject,
    text,
    html,
    headers,
  };

  try {
    const { providerMessageId } = await provider.send(message);
    await pool.query(
      `UPDATE email_messages
          SET status = 'sent', provider_message_id = NULLIF($2, ''), sent_at = now(), error = ''
        WHERE id = $1`,
      [messageId, providerMessageId]
    );
    return { messageId, outcome: "sent", providerMessageId, suppressedReason: "" };
  } catch (err) {
    const detail = (err instanceof Error ? err.message : String(err)).slice(0, 1000);
    await pool.query(`UPDATE email_messages SET status = 'failed', error = $2 WHERE id = $1`, [
      messageId,
      detail,
    ]);
    throw err;
  }
}

/**
 * Adds an address to the suppression list and stops its contact being marketed to.
 *
 * Both halves, always: the list is what survives a re-import, the contact status
 * is what every audience query filters on, and a bounce that updated only one of
 * them would keep the address in exactly half the places that matter.
 */
export async function suppress(input: {
  email: string;
  reason: "bounce" | "complaint" | "manual" | "unsubscribe" | "invalid";
  detail?: string;
  /** The contact status to set. A complaint is not the same event as an opt-out. */
  contactStatus?: "opted_out" | "bounced" | "complained";
}): Promise<void> {
  const email = input.email.trim().toLowerCase();
  if (!email) return;

  await pool.query(
    `INSERT INTO email_suppressions (email, reason, detail)
     VALUES ($1, $2, $3)
     ON CONFLICT (email) DO UPDATE SET reason = EXCLUDED.reason, detail = EXCLUDED.detail`,
    [email, input.reason, (input.detail ?? "").slice(0, 500)]
  );

  const status = input.contactStatus ?? "opted_out";
  await pool.query(
    `UPDATE contacts
        SET email_marketing_status = $2,
            opted_out_at = COALESCE(opted_out_at, now()),
            updated_at = now()
      WHERE email = $1`,
    [email, status]
  );
}
