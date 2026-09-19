import { stripeTestMode } from "../config/env";
import { sendMail } from "../email/mailer";

/**
 * Sandbox billing updates balances and access, but sends no real messages.
 *
 * The guard is on the message and nothing else. A sandbox purchase is still a
 * purchase as far as this system is concerned — the entitlement, the ledger, the
 * schedule and the `domain_events` row that records the sale all have to happen,
 * or the site's own books disagree with Stripe's. Only the envelope is held
 * back, because the addresses on a test order belong to real people.
 */
export async function sendStripeMail(...args: Parameters<typeof sendMail>): ReturnType<typeof sendMail> {
  if (stripeTestMode()) return { messageId: null, sent: false, providerMessageId: "", error: "Stripe test mode: email disabled" };
  return sendMail(...args);
}
