import { env } from "../config/env";
import { notificationRecipients } from "./notificationRecipients";

/**
 * Who hears about a reply to a form (migration 112).
 *
 * Each form has its own "email me when someone sends this" switch and an
 * optional list of addresses. Blank means the notification address saved in
 * Settings, under the same "someone sends an enquiry" switch the owner email
 * has always gone out under — so a form left on its defaults behaves exactly as
 * before, and a form given its own addresses is an explicit choice that the
 * global switch does not second-guess.
 */

/** More than this is a mailing list, and that is what sequences are for. */
export const MAX_NOTIFY_EMAILS = 5;

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The addresses in what the admin typed: split on commas, semicolons or
 * whitespace, lowercased, de-duplicated. Anything that is not an address comes
 * back in `invalid` so the builder can say which one.
 */
export function parseNotifyEmails(raw: unknown): { emails: string[]; invalid: string[] } {
  const emails: string[] = [];
  const invalid: string[] = [];
  if (typeof raw !== "string") return { emails, invalid };
  for (const part of raw.split(/[\s,;]+/)) {
    const address = part.trim().toLowerCase();
    if (!address) continue;
    if (address.length > 320 || !EMAIL_SHAPE.test(address)) {
      invalid.push(part.trim());
      continue;
    }
    if (!emails.includes(address)) emails.push(address);
  }
  return { emails, invalid };
}

/** The stored form of the list: tidy, one comma between addresses. */
export function normalizeNotifyEmails(raw: unknown): string {
  return parseNotifyEmails(raw).emails.join(", ");
}

/** A sentence for the builder when the list can't be stored, or null when it can. */
export function notifyEmailsProblem(raw: unknown): string | null {
  const { emails, invalid } = parseNotifyEmails(raw);
  if (invalid.length > 0) return `“${invalid[0]}” isn't an email address.`;
  if (emails.length > MAX_NOTIFY_EMAILS) {
    return `A form can email up to ${MAX_NOTIFY_EMAILS} addresses.`;
  }
  return null;
}

/** Whether this form's replies are emailed at all. Older rows lack the column: they followed create_lead. */
export function wantsReplyEmail(form: { notify_on_submit?: unknown; create_lead?: unknown }): boolean {
  if (typeof form.notify_on_submit === "boolean") return form.notify_on_submit;
  return form.create_lead === true;
}

/**
 * The `to` for one reply's email, or "" for nobody. Never throws (the settings
 * read inside `notificationRecipients` already doesn't).
 */
export async function replyRecipients(form: { notify_emails?: unknown }): Promise<string> {
  const own = parseNotifyEmails(form.notify_emails).emails.slice(0, MAX_NOTIFY_EMAILS);
  if (own.length > 0) return own.join(", ");
  return notificationRecipients("lead");
}

/** The reply list for one form in the admin, scrolled to the replies. */
export function adminRepliesUrl(formId: number): string {
  const origin = env.adminOrigin.replace(/\/+$/, "");
  return `${origin}/admin/marketing/forms-v2?form=${formId}&view=replies`;
}
