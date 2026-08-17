import nodemailer, { Transporter } from "nodemailer";
import { env } from "../config/env";

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
}

/**
 * Sends mail and returns the transport's message id, propagating failures.
 *
 * The strict half of this module. A queued job needs to know that a send failed
 * so it can be retried and, if it never succeeds, land in the dead-letter list —
 * `sendMail` below swallows errors, which is right for a fire-and-forget site
 * notification and wrong for anything the queue owns.
 */
export async function sendMailStrict(input: SendMailInput): Promise<{ messageId: string }> {
  if (!input.to) throw new Error("No recipient address");

  const t = getTransporter();
  const info = await t.sendMail({
    from: input.from || env.smtp.from,
    to: input.to,
    replyTo: input.replyTo || undefined,
    subject: input.subject,
    text: input.text,
    html: input.html ?? `<p>${input.text}</p>`,
    attachments: input.attachments,
    headers: input.headers,
  });

  return { messageId: String(info.messageId ?? "") };
}

/** Sends mail; on any failure (or unconfigured SMTP) logs instead of throwing. */
export async function sendMail(input: SendMailInput): Promise<void> {
  if (!input.to) return;
  try {
    const { messageId } = await sendMailStrict(input);
    if (!env.smtp.host) {
      // jsonTransport puts the whole message in info.message (a Buffer)
      // eslint-disable-next-line no-console
      console.log(`[mailer:console] to=${input.to} subject="${input.subject}"`);
    } else {
      // eslint-disable-next-line no-console
      console.log(`[mailer] sent messageId=${messageId} to=${input.to}`);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[mailer] send failed (continuing):", err);
  }
}
