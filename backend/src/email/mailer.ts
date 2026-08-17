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

export interface SendMailInput {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/** Sends mail; on any failure (or unconfigured SMTP) logs instead of throwing. */
export async function sendMail(input: SendMailInput): Promise<void> {
  if (!input.to) return;
  try {
    const t = getTransporter();
    const info = await t.sendMail({
      from: env.smtp.from,
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html ?? `<p>${input.text}</p>`,
    });
    if (!env.smtp.host) {
      // jsonTransport puts the whole message in info.message (a Buffer)
      // eslint-disable-next-line no-console
      console.log(`[mailer:console] to=${input.to} subject="${input.subject}"`);
    } else {
      // eslint-disable-next-line no-console
      console.log(`[mailer] sent messageId=${info.messageId} to=${input.to}`);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[mailer] send failed (continuing):", err);
  }
}
