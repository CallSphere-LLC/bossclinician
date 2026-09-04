import { env } from "../config/env";
import { escapeHtml } from "./templates";
import type { EmailContent } from "./memberTemplates";
import { formatAmount } from "../utils/money";

/**
 * The money emails: the ones somebody receives because of something they bought.
 *
 * Split from templates.ts (site notifications) and memberTemplates.ts (account
 * and login) because these are the ones a customer keeps. Two rules hold across
 * all of them:
 *
 *  - Every figure is already-charged money, formatted through pricing.ts and
 *    never recomputed here. A receipt that disagrees with the card statement is
 *    a support ticket at best and a chargeback at worst.
 *  - The reader is told what to do next and given the link to do it with. A
 *    dunning email that says "your payment failed" without a way to fix the
 *    card is just a cancellation notice with extra steps.
 */

/** Titles the checkout's name field routinely collects, dropped before greeting. */
const HONORIFIC = /^(dr|mr|mrs|ms|mx|miss|prof|professor)\.?$/i;

function greeting(name: string): string {
  const parts = name.trim().split(/\s+/).filter((part) => !HONORIFIC.test(part));
  return parts[0] || "there";
}

export interface ReceiptLine {
  title: string;
  quantity: number;
  amountCents: number;
}

export interface PurchaseReceiptInput {
  buyerName: string;
  orderId: number;
  lines: ReceiptLine[];
  subtotalCents: number;
  discountCents: number;
  couponCode: string;
  taxCents: number;
  totalCents: number;
  currency: string;
}

export interface RefundReceiptInput {
  buyerName: string;
  orderId: number;
  amountCents: number;
  currency: string;
  fullyRefunded: boolean;
}

/** Confirmation for money returned, distinct from the original purchase receipt. */
export function refundReceipt(input: RefundReceiptInput): EmailContent {
  const name = greeting(input.buyerName);
  const amount = formatAmount(input.amountCents, input.currency);
  const status = input.fullyRefunded ? "Your order has been refunded in full." : "This was a partial refund.";
  return {
    subject: `Your ${amount} refund is confirmed`,
    text: [
      `Hi ${name},`,
      "",
      `We have returned ${amount} for order #${input.orderId}.`,
      status,
      "",
      "Your bank may take several business days to show it on your statement.",
      `You can see the order at ${env.publicSiteUrl}/account/billing.`,
    ].join("\n"),
    html: `<p>Hi ${escapeHtml(name)},</p><p>We have returned <strong>${escapeHtml(amount)}</strong> for order #${input.orderId}.</p><p>${escapeHtml(status)}</p><p>Your bank may take several business days to show it on your statement.</p><p><a href="${env.publicSiteUrl}/account/billing">View your billing history</a></p>`,
  };
}

/**
 * The receipt for a completed purchase.
 *
 * Line items are copied from `order_items`, which stores the titles as they were
 * at the time of sale — so a receipt re-sent next year still names what was
 * actually bought even if the offer has since been renamed or deleted.
 */
export function purchaseReceipt(input: PurchaseReceiptInput): EmailContent {
  const name = greeting(input.buyerName);
  const money = (cents: number) => formatAmount(cents, input.currency);
  const total = money(input.totalCents);
  const libraryUrl = `${env.publicSiteUrl}/library`;

  const lineText = input.lines.map(
    (line) =>
      `  ${line.quantity > 1 ? `${line.quantity} x ` : ""}${line.title} — ${money(line.amountCents)}`
  );
  const lineHtml = input.lines.map(
    (line) =>
      `<tr><td style="padding:4px 12px 4px 0">${
        line.quantity > 1 ? `${line.quantity} &times; ` : ""
      }${escapeHtml(line.title)}</td><td style="padding:4px 0;text-align:right">${escapeHtml(
        money(line.amountCents)
      )}</td></tr>`
  );

  // Subtotal and tax lines are shown only when they say something the total
  // does not. On the common order — one item, no coupon, no tax — repeating the
  // same number three times makes the receipt harder to read, not clearer.
  const summaryText: string[] = [];
  const summaryHtml: string[] = [];
  const addSummary = (label: string, value: string): void => {
    summaryText.push(`  ${label}: ${value}`);
    summaryHtml.push(
      `<tr><td style="padding:4px 12px 4px 0">${escapeHtml(
        label
      )}</td><td style="padding:4px 0;text-align:right">${escapeHtml(value)}</td></tr>`
    );
  };
  if (input.discountCents > 0 || input.taxCents > 0) {
    addSummary("Subtotal", money(input.subtotalCents));
  }
  if (input.discountCents > 0) {
    const label = input.couponCode ? `Discount (${input.couponCode})` : "Discount";
    addSummary(label, `-${money(input.discountCents)}`);
  }
  if (input.taxCents > 0) {
    addSummary("Tax", money(input.taxCents));
  }
  addSummary("Total paid", total);

  const text = [
    `Hi ${name},`,
    ``,
    `Thank you — your payment went through. Here's your receipt.`,
    ``,
    `Order #${input.orderId}`,
    ...lineText,
    ``,
    ...summaryText,
    ``,
    `Everything you've bought lives here: ${libraryUrl}`,
    ``,
    `Keep this email for your records. If anything looks wrong, just reply — it comes to me.`,
    ``,
    `— Yvette`,
  ].join("\n");

  const html = [
    `<p>Hi ${escapeHtml(name)},</p>`,
    `<p>Thank you — your payment went through. Here's your receipt.</p>`,
    `<p><strong>Order #${input.orderId}</strong></p>`,
    `<table role="presentation" style="border-collapse:collapse">`,
    ...lineHtml,
    `<tr><td colspan="2" style="padding:8px 0"><hr style="border:0;border-top:1px solid #ddd"></td></tr>`,
    ...summaryHtml,
    `</table>`,
    `<p><a href="${escapeHtml(libraryUrl)}">Open my library</a></p>`,
    `<p>Keep this email for your records. If anything looks wrong, just reply — it comes to me.</p>`,
    `<p>— Yvette</p>`,
  ].join("\n");

  return { subject: `Your receipt (order #${input.orderId}) — ${total}`, text, html };
}

export interface DunningInput {
  buyerName: string;
  description: string;
  amountCents: number;
  currency: string;
  /** How many consecutive failures, including this one. */
  attempt: number;
  /** Stripe's hosted invoice page — the one place the card can actually be fixed. */
  payInvoiceUrl: string;
  /** Null when Stripe has given up and will not try again. */
  nextAttemptAt: Date | null;
}

/**
 * Sent when a renewal or an installment is declined.
 *
 * The tone escalates with `attempt` because the stakes do: the first failure is
 * usually an expired card and nothing has been lost yet, while the last one is
 * the message that decides whether somebody keeps what they were part-way
 * through paying for.
 */
export function paymentFailedDunning(input: DunningInput): EmailContent {
  const name = greeting(input.buyerName);
  const amount = formatAmount(input.amountCents, input.currency);
  const url = input.payInvoiceUrl || `${env.publicSiteUrl}/account/billing`;
  const nextAttempt = input.nextAttemptAt;
  const last = nextAttempt === null;

  const when =
    nextAttempt === null
      ? `This was the last automatic attempt, so nothing more will be tried — the payment needs to be made from the link below.`
      : `We'll try again on ${nextAttempt.toLocaleDateString("en-US", {
          month: "long",
          day: "numeric",
        })}, but you can clear it straight away from the link below.`;

  const text = [
    `Hi ${name},`,
    ``,
    `The ${amount} payment for ${input.description} was declined${
      input.attempt > 1 ? ` (attempt ${input.attempt})` : ""
    }.`,
    ``,
    `Nine times out of ten it's a card that's expired or been replaced rather than anything to do with the balance.`,
    ``,
    when,
    ``,
    url,
    ``,
    `If you'd rather sort it out with me directly, just reply to this email.`,
    ``,
    `— Yvette`,
  ].join("\n");

  const html = [
    `<p>Hi ${escapeHtml(name)},</p>`,
    `<p>The <strong>${escapeHtml(amount)}</strong> payment for ${escapeHtml(
      input.description
    )} was declined${input.attempt > 1 ? ` (attempt ${input.attempt})` : ""}.</p>`,
    `<p>Nine times out of ten it's a card that's expired or been replaced rather than anything to do with the balance.</p>`,
    `<p>${escapeHtml(when)}</p>`,
    `<p><a href="${escapeHtml(url)}">Update my card and pay</a></p>`,
    `<p>If you'd rather sort it out with me directly, just reply to this email.</p>`,
    `<p>— Yvette</p>`,
  ].join("\n");

  return {
    subject: last
      ? `Action needed: ${amount} payment for ${input.description}`
      : `Your ${amount} payment didn't go through`,
    text,
    html,
  };
}

export interface PaymentPlanCompletedInput {
  buyerName: string;
  description: string;
  installmentCount: number;
  totalPaidCents: number;
  currency: string;
}

/**
 * Sent when the final installment of a payment plan clears.
 *
 * Worth its own email: it is the moment the customer stops being billed, and
 * saying so plainly is what stops the "am I still paying for this?" support
 * thread three months later.
 */
export function paymentPlanCompleted(input: PaymentPlanCompletedInput): EmailContent {
  const name = greeting(input.buyerName);
  const total = formatAmount(input.totalPaidCents, input.currency);
  const libraryUrl = `${env.publicSiteUrl}/library`;

  const text = [
    `Hi ${name},`,
    ``,
    `That's the last one — ${input.description} is paid in full.`,
    ``,
    `All ${input.installmentCount} payments have gone through, ${total} in total, and there is nothing further to pay. No more charges will be made.`,
    ``,
    `What you bought is yours to keep: ${libraryUrl}`,
    ``,
    `— Yvette`,
  ].join("\n");

  const html = [
    `<p>Hi ${escapeHtml(name)},</p>`,
    `<p>That's the last one — <strong>${escapeHtml(input.description)}</strong> is paid in full.</p>`,
    `<p>All ${input.installmentCount} payments have gone through, ${escapeHtml(
      total
    )} in total, and there is nothing further to pay. No more charges will be made.</p>`,
    `<p>What you bought is yours to keep: <a href="${escapeHtml(
      libraryUrl
    )}">open my library</a>.</p>`,
    `<p>— Yvette</p>`,
  ].join("\n");

  return { subject: `Paid in full — ${input.description}`, text, html };
}

export interface PaymentPlanDefaultedInput {
  buyerName: string;
  description: string;
  installmentsPaid: number;
  installmentCount: number;
  outstandingCents: number;
  currency: string;
}

/**
 * Sent when a payment plan ends with installments still owed.
 *
 * The counterpart to `paymentPlanCompleted`, and the harder of the two to
 * write: the customer has paid real money and is losing access anyway. It says
 * exactly how far they got and what is left, because the commonest cause is a
 * card that expired months ago and the commonest outcome, once somebody
 * notices, is that they want to finish paying.
 */
export function paymentPlanDefaulted(input: PaymentPlanDefaultedInput): EmailContent {
  const name = greeting(input.buyerName);
  const outstanding = formatAmount(input.outstandingCents, input.currency);
  const billingUrl = `${env.publicSiteUrl}/account/billing`;
  const progress = `${input.installmentsPaid} of ${input.installmentCount} payments`;

  const text = [
    `Hi ${name},`,
    ``,
    `The payment plan for ${input.description} has stopped after ${progress}, with ${outstanding} still outstanding, and your access has been paused.`,
    ``,
    `Almost every time this happens it is a card that expired or was replaced rather than any decision on your part. If that's the case here, nothing is lost — reply to this email and I'll get the plan restarted and your access back on.`,
    ``,
    `Your billing details: ${billingUrl}`,
    ``,
    `— Yvette`,
  ].join("\n");

  const html = [
    `<p>Hi ${escapeHtml(name)},</p>`,
    `<p>The payment plan for <strong>${escapeHtml(
      input.description
    )}</strong> has stopped after ${progress}, with <strong>${escapeHtml(
      outstanding
    )}</strong> still outstanding, and your access has been paused.</p>`,
    `<p>Almost every time this happens it is a card that expired or was replaced rather than any decision on your part. If that's the case here, nothing is lost — reply to this email and I'll get the plan restarted and your access back on.</p>`,
    `<p><a href="${escapeHtml(billingUrl)}">Your billing details</a></p>`,
    `<p>— Yvette</p>`,
  ].join("\n");

  return { subject: `Your payment plan for ${input.description} has stopped`, text, html };
}

export interface PaymentPlanDefaultedAlertInput {
  buyerEmail: string;
  description: string;
  installmentsPaid: number;
  installmentCount: number;
  outstandingCents: number;
  currency: string;
  revokedCount: number;
  stripeSubscriptionId: string;
}

/**
 * Admin alert for a payment plan that ended unpaid.
 *
 * A defaulted plan is the one billing failure nobody finds out about on their
 * own: Stripe's dunning has already run its course, the customer has stopped
 * hearing from it, and the only visible trace is a member who quietly stops
 * being charged. Access has been taken back automatically, so this exists to
 * put the money on somebody's desk while it is still collectable.
 */
export function paymentPlanDefaultedAlert(input: PaymentPlanDefaultedAlertInput): EmailContent {
  const outstanding = formatAmount(input.outstandingCents, input.currency);

  const text = [
    `A payment plan has ended with money still owed.`,
    ``,
    `Buyer: ${input.buyerEmail || "(unknown)"}`,
    `Bought: ${input.description}`,
    `Paid: ${input.installmentsPaid} of ${input.installmentCount} installments`,
    `Outstanding: ${outstanding}`,
    `Stripe subscription: ${input.stripeSubscriptionId}`,
    ``,
    `The plan is marked cancelled and ${input.revokedCount} access grant(s) have been revoked, so the customer no longer has what they were part-way through paying for.`,
    ``,
    `They have been emailed. If it turns out to be an expired card, taking the remaining ${outstanding} and restoring access is usually the outcome everybody wants.`,
  ].join("\n");

  const html = [
    `<p>A payment plan has ended with money still owed.</p>`,
    `<p>`,
    `Buyer: ${escapeHtml(input.buyerEmail || "(unknown)")}<br>`,
    `Bought: ${escapeHtml(input.description)}<br>`,
    `Paid: ${input.installmentsPaid} of ${input.installmentCount} installments<br>`,
    `Outstanding: <strong>${escapeHtml(outstanding)}</strong><br>`,
    `Stripe subscription: ${escapeHtml(input.stripeSubscriptionId)}`,
    `</p>`,
    `<p>The plan is marked cancelled and ${input.revokedCount} access grant(s) have been revoked, so the customer no longer has what they were part-way through paying for.</p>`,
    `<p>They have been emailed. If it turns out to be an expired card, taking the remaining ${escapeHtml(
      outstanding
    )} and restoring access is usually the outcome everybody wants.</p>`,
  ].join("\n");

  return { subject: `Payment plan defaulted: ${outstanding} outstanding`, text, html };
}

export interface DisputeAlertInput {
  buyerEmail: string;
  amountCents: number;
  currency: string;
  reason: string;
  chargeId: string;
  orderId: number | null;
}

/**
 * Admin alert for a chargeback.
 *
 * Disputes run on Stripe's clock, not ours — evidence is due within days and the
 * money is already gone — so this exists to get a human looking at the Stripe
 * dashboard, and says which charge to look at rather than trying to summarise it.
 */
export function disputeAlert(input: DisputeAlertInput): EmailContent {
  const amount = formatAmount(input.amountCents, input.currency);
  const orderLine = input.orderId === null ? "(no matching order found)" : `#${input.orderId}`;

  const text = [
    `A payment has been disputed.`,
    ``,
    `Amount: ${amount}`,
    `Buyer: ${input.buyerEmail || "(unknown)"}`,
    `Reason given: ${input.reason}`,
    `Order: ${orderLine}`,
    `Stripe charge: ${input.chargeId}`,
    ``,
    `The transaction has been flagged as disputed. Evidence is submitted in the Stripe dashboard and there is a deadline on it — open the charge above.`,
    ``,
    `Access has NOT been revoked automatically. Decide that separately from the dispute itself.`,
  ].join("\n");

  const html = [
    `<p>A payment has been disputed.</p>`,
    `<p>`,
    `Amount: <strong>${escapeHtml(amount)}</strong><br>`,
    `Buyer: ${escapeHtml(input.buyerEmail || "(unknown)")}<br>`,
    `Reason given: ${escapeHtml(input.reason)}<br>`,
    `Order: ${escapeHtml(orderLine)}<br>`,
    `Stripe charge: ${escapeHtml(input.chargeId)}`,
    `</p>`,
    `<p>The transaction has been flagged as disputed. Evidence is submitted in the Stripe dashboard and there is a deadline on it — open the charge above.</p>`,
    `<p>Access has <strong>not</strong> been revoked automatically. Decide that separately from the dispute itself.</p>`,
  ].join("\n");

  return { subject: `Disputed payment: ${amount}`, text, html };
}

export interface PaymentPlanOverchargeInput {
  buyerEmail: string;
  amountCents: number;
  currency: string;
  installmentCount: number;
  installmentsPaid: number;
  stripeSubscriptionId: string;
}

/**
 * Admin alert for a payment-plan charge that should not have happened.
 *
 * A plan stops itself: the subscription is created with `cancel_at` set to the
 * final installment date. If an invoice arrives after the last installment has
 * been recorded, that safeguard has failed and a customer is being billed for
 * something they have already paid off. Nothing here can un-charge them, so the
 * only useful action is to make the noise loud and immediate.
 */
export function paymentPlanOverchargeAlert(input: PaymentPlanOverchargeInput): EmailContent {
  const amount = formatAmount(input.amountCents, input.currency);

  const text = [
    `URGENT: a payment plan has been charged past its final installment.`,
    ``,
    `Buyer: ${input.buyerEmail || "(unknown)"}`,
    `Charged: ${amount}`,
    `Plan: ${input.installmentsPaid} of ${input.installmentCount} installments already recorded as paid`,
    `Stripe subscription: ${input.stripeSubscriptionId}`,
    ``,
    `This customer has finished paying and has been billed anyway. Cancel the subscription above in Stripe and refund this charge.`,
    ``,
    `The installment schedule has NOT been advanced, so the plan's own records are still correct.`,
  ].join("\n");

  const html = [
    `<p><strong>URGENT: a payment plan has been charged past its final installment.</strong></p>`,
    `<p>`,
    `Buyer: ${escapeHtml(input.buyerEmail || "(unknown)")}<br>`,
    `Charged: <strong>${escapeHtml(amount)}</strong><br>`,
    `Plan: ${input.installmentsPaid} of ${input.installmentCount} installments already recorded as paid<br>`,
    `Stripe subscription: ${escapeHtml(input.stripeSubscriptionId)}`,
    `</p>`,
    `<p>This customer has finished paying and has been billed anyway. Cancel the subscription above in Stripe and refund this charge.</p>`,
    `<p>The installment schedule has <strong>not</strong> been advanced, so the plan's own records are still correct.</p>`,
  ].join("\n");

  return { subject: `URGENT: payment plan overcharged (${amount})`, text, html };
}

export interface PurchaseWelcomeInput {
  buyerName: string;
  /** What they bought, named as it was at the time of sale. */
  offerTitle: string;
  /**
   * The set-password link, for a buyer whose account was created by this
   * purchase and has no password yet. Null for someone who was already signed
   * in — telling an existing customer to "set your password first" is how a
   * welcome email becomes a support ticket.
   */
  setPasswordUrl: string | null;
  /** Where the thing they bought actually opens. */
  startUrl: string;
  /**
   * Anything Yvette wrote on the offer for this moment: which module to start
   * with, a planner to download, where the community lives. Rendered as its own
   * step when present and skipped entirely when not.
   */
  nextSteps: string;
}

/**
 * The email that turns a payment into somebody who has actually started.
 *
 * The receipt is a financial document and this is the opposite of one: it exists
 * to get the buyer into the product on the day they were most motivated to be
 * there — the day they paid. Numbered steps because that is what someone skims
 * on a phone, and the first step is always the one that gets them in, because a
 * welcome that opens with encouragement and buries the login link is a welcome
 * nobody acts on.
 *
 * Deliberately separate from `purchaseReceipt`. Two emails rather than one long
 * one: a receipt gets filed and forwarded to a bookkeeper, and this gets read
 * once and acted on. Merging them means the person filing it forwards the login
 * link to their accountant.
 */
export function purchaseWelcome(input: PurchaseWelcomeInput): EmailContent {
  const name = greeting(input.buyerName);
  const offer = input.offerTitle || "your new program";

  // Steps are assembled rather than written out, so the numbering stays correct
  // when the set-password step or Yvette's own step is absent.
  const steps: { text: string[]; html: string[] }[] = [];

  if (input.setPasswordUrl) {
    steps.push({
      text: [
        `Set your password.`,
        `Your account is already made and ${offer} is already in it — this is the one link that lets you in:`,
        input.setPasswordUrl,
      ],
      html: [
        `<strong>Set your password.</strong>`,
        `Your account is already made and ${escapeHtml(offer)} is already in it — this is the one link that lets you in:`,
        `<a href="${escapeHtml(input.setPasswordUrl)}">Set my password</a>`,
      ],
    });
  }

  steps.push({
    text: [
      `Open ${offer}.`,
      `It's waiting in your library:`,
      input.startUrl,
    ],
    html: [
      `<strong>Open ${escapeHtml(offer)}.</strong>`,
      `It's waiting in your library:`,
      `<a href="${escapeHtml(input.startUrl)}">Open ${escapeHtml(offer)}</a>`,
    ],
  });

  if (input.nextSteps.trim() !== "") {
    steps.push({
      text: [`Then start here.`, input.nextSteps.trim()],
      html: [`<strong>Then start here.</strong>`, escapeHtml(input.nextSteps.trim())],
    });
  }

  const text = [
    `Hi ${name},`,
    ``,
    `Welcome to ${offer} — I'm so glad you're in.`,
    ``,
    `Here's what to do next:`,
    ``,
    ...steps.flatMap((step, index) => [`${index + 1}. ${step.text[0]}`, ...step.text.slice(1), ``]),
    `Do the first step today if you can. The people who get the most out of this are the ones who open it the day they join, not the week they finally find time.`,
    ``,
    `If you get stuck anywhere at all, just reply to this email. It comes to me.`,
    ``,
    `— Yvette`,
  ].join("\n");

  const html = [
    `<p>Hi ${escapeHtml(name)},</p>`,
    `<p>Welcome to <strong>${escapeHtml(offer)}</strong> — I'm so glad you're in.</p>`,
    `<p>Here's what to do next:</p>`,
    `<ol>`,
    ...steps.map((step) => `<li><p>${step.html.join("</p><p>")}</p></li>`),
    `</ol>`,
    `<p>Do the first step today if you can. The people who get the most out of this are the ones who open it the day they join, not the week they finally find time.</p>`,
    `<p>If you get stuck anywhere at all, just reply to this email. It comes to me.</p>`,
    `<p>— Yvette</p>`,
  ].join("\n");

  return { subject: `Welcome to ${offer}`, text, html };
}
