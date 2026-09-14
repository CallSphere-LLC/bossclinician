import nodemailer, { Transporter } from "nodemailer";
import { env } from "../config/env";
import { pool } from "../db/pool";
import { transportKeyForHost } from "../services/sendingIdentity";
import { assertRecipientAllowed } from "./recipientGuard";

let transporter: Transporter;

function getTransporter(): Transporter {
  if (transporter) return transporter;

  if (env.smtp.host && env.smtp.user && env.smtp.pass) {
    transporter = nodemailer.createTransport({
      host: env.smtp.host,
      port: env.smtp.port,
      secure: env.smtp.port === 465,
      auth: { user: env.smtp.user, pass: env.smtp.pass },
    });
  } else {
    // Dev/fallback: never throw, never send anywhere real — just log.
    transporter = nodemailer.createTransport({ jsonTransport: true });
  }
  return transporter;
}

export interface MailAttachment {
  filename: string;
  content: string;
  contentType: string;
  /**
   * How `content` is encoded. Omitted means the string is the document itself,
   * which is right for a calendar invitation and wrong for anything binary — a
   * PDF handed over as an unencoded string is mangled into an unopenable file
   * by the time it reaches the reader, and it arrives looking like a real
   * attachment, so nobody finds out until a customer says so.
   */
  encoding?: "base64";
}

export interface SendMailInput {
  to: string;
  subject: string;
  text: string;
  html?: string;
  /** Calendar invitations, so a booking lands in the reader's diary in one click. */
  attachments?: MailAttachment[];
  /** Overrides SMTP_FROM — a marketing send uses the owner's configured identity. */
  from?: string;
  replyTo?: string;
  /** List-Unsubscribe and friends: CAN-SPAM and RFC 8058 live in headers, not in the body. */
  headers?: Record<string, string>;
  /**
   * What this message is, for the delivery log: "purchase_receipt",
   * "email_confirmation", "payment_failed". Free text, but keep it stable —
   * it is what "did the receipts go out?" is answered by.
   */
  topic?: string;
  /** The order, subscription or member the message is about. */
  sourceId?: number | null;
  contactId?: number | null;
  memberId?: number | null;
}

export interface SendMailOutcome {
  /** The `email_messages` row, or null when the log could not be written. */
  messageId: number | null;
  sent: boolean;
  /** The id SES assigned, which every later delivery event names. */
  providerMessageId: string;
  /** The transport's own words when `sent` is false. */
  error: string;
}

/**
 * Sends mail and returns the transport's message id, propagating failures.
 *
 * The strict half of this module. A queued job needs to know that a send failed
 * so it can be retried and, if it never succeeds, land in the dead-letter list —
 * `sendMail` below swallows errors, which is right for a fire-and-forget site
 * notification and wrong for anything the queue owns.
 */
/**
 * The id SES assigned, dug out of the SMTP acknowledgement.
 *
 * Every event SES will ever post about a message names it by this id, so a send
 * that does not capture it is a send whose bounce has nowhere to land. It is
 * deliberately not `info.messageId`: over SMTP that is the Message-ID header
 * nodemailer generated locally, which SES never mentions again. The id SES chose
 * comes back only in its 250 line — `250 Ok 0100019a1b2c3d4e-...`.
 *
 * Returns "" for any other transport, whose own id the caller should keep.
 */
function sesMessageId(response: unknown): string {
  const match = /^250 Ok ([0-9a-f-]{16,})$/i.exec(String(response ?? "").trim());
  return match?.[1] ?? "";
}

export async function sendMailStrict(input: SendMailInput): Promise<{ messageId: string }> {
  if (!input.to) throw new Error("No recipient address");
  // Outside production, only allow-listed recipients (see recipientGuard.ts).
  // Thrown before the transport, so every caller records it as not sent.
  assertRecipientAllowed(input.to);

  // SES emits nothing at all for a message sent without a configuration set, so
  // the default is applied here rather than at each call site: a sender that
  // forgets the header does not get an untracked send, it gets the transactional
  // set. A caller that names its own — the marketing path does — keeps it.
  const headers = { ...input.headers };
  if (env.ses.transactionalConfigSet && !headers["X-SES-CONFIGURATION-SET"]) {
    headers["X-SES-CONFIGURATION-SET"] = env.ses.transactionalConfigSet;
  }

  const t = getTransporter();
  const info = await t.sendMail({
    from: input.from || env.smtp.from,
    to: input.to,
    replyTo: input.replyTo || undefined,
    subject: input.subject,
    text: input.text,
    html: input.html ?? `<p>${input.text}</p>`,
    attachments: input.attachments,
    headers,
  });

  return { messageId: sesMessageId(info.response) || String(info.messageId ?? "") };
}

/**
 * Writes the delivery-log row for a transactional send, before the transport runs.
 *
 * Returns null rather than throwing: this is bookkeeping, and a receipt that
 * never goes out because the log insert failed would be a far worse bug than an
 * unlogged receipt.
 */
async function openMailRecord(input: SendMailInput): Promise<number | null> {
  try {
    const res = await pool.query<{ id: string }>(
      `INSERT INTO email_messages
         (contact_id, member_id, to_email, source_type, source_id, topic, subject, provider, status)
       VALUES ($1, $2, $3, 'transactional', $4, $5, $6, $7, 'queued')
       RETURNING id`,
      [
        input.contactId ?? null,
        input.memberId ?? null,
        input.to.trim().toLowerCase(),
        input.sourceId ?? null,
        (input.topic ?? "").slice(0, 100),
        input.subject.slice(0, 500),
        // "ses" when SMTP_HOST is Amazon's SMTP interface, so the delivery log
        // names the service that carried the message rather than the protocol.
        transportKeyForHost(env.smtp.host),
      ]
    );
    return Number(res.rows[0].id);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[mailer] could not open a delivery record:", (err as Error).message);
    return null;
  }
}

async function closeMailRecord(
  messageId: number | null,
  patch: { sent: boolean; providerMessageId: string; error: string }
): Promise<void> {
  if (messageId === null) return;
  try {
    if (patch.sent) {
      await pool.query(
        `UPDATE email_messages
            SET status = 'sent', provider_message_id = NULLIF($2, ''),
                sent_at = now(), error = ''
          WHERE id = $1`,
        [messageId, patch.providerMessageId]
      );
    } else {
      await pool.query(`UPDATE email_messages SET status = 'failed', error = $2 WHERE id = $1`, [
        messageId,
        patch.error.slice(0, 1000),
      ]);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[mailer] could not close a delivery record:", (err as Error).message);
  }
}

/**
 * Sends mail; on any failure (or unconfigured SMTP) logs instead of throwing.
 *
 * Every send is now recorded in `email_messages` with the id SES assigned, which
 * is what makes a transactional message traceable. Before this, receipts,
 * access emails, dunning and confirmations went out with nothing but a console
 * line behind them: SES's delivery and bounce notifications arrive keyed on
 * `provider_message_id`, so with no row to match they landed in `email_events`
 * with a null `message_id` and could never be attributed to anything. The
 * practical cost was that "the customer says the receipt never arrived" had no
 * answer — not for Yvette, and not for anyone reading the database.
 *
 * Still swallows transport failures, because every caller has already taken
 * money or granted access and has nothing useful to do with an exception. The
 * difference is that the failure is now written down instead of only logged,
 * and the returned outcome lets a caller that wants to be honest say so.
 */
export async function sendMail(input: SendMailInput): Promise<SendMailOutcome> {
  if (!input.to) return { messageId: null, sent: false, providerMessageId: "", error: "No recipient address" };

  const messageId = await openMailRecord(input);
  try {
    const { messageId: providerMessageId } = await sendMailStrict(input);
    // Subjects and addresses can carry what a visitor typed into a form, so they
    // are JSON-quoted arguments: a newline in one cannot forge a second log line.
    if (!env.smtp.host) {
      // jsonTransport puts the whole message in info.message (a Buffer)
      // eslint-disable-next-line no-console
      console.log("[mailer:console] to=%s subject=%s", JSON.stringify(input.to), JSON.stringify(input.subject));
    } else {
      // eslint-disable-next-line no-console
      console.log("[mailer] sent messageId=%s to=%s", JSON.stringify(providerMessageId), JSON.stringify(input.to));
    }
    await closeMailRecord(messageId, { sent: true, providerMessageId, error: "" });
    return { messageId, sent: true, providerMessageId, error: "" };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.error("[mailer] send failed (continuing):", err);
    await closeMailRecord(messageId, { sent: false, providerMessageId: "", error });
    return { messageId, sent: false, providerMessageId: "", error };
  }
}
