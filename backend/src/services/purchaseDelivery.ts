import { env } from "../config/env";
import { pool } from "../db/pool";
import { publishDomainEvent } from "./domainEvents";
import { purchaseReceipt, purchaseWelcome, type ReceiptLine } from "../email/commerceTemplates";
import { sendMail, type MailAttachment } from "../email/mailer";
import { withStoredTemplate } from "../email/templateStore";
import { orderPaidNotification } from "../email/templates";
import { loadBusinessDetails } from "./businessIdentity";
import { invoiceFilename, renderInvoicePdf } from "./invoicePdf";
import { issueSetPasswordLink } from "./setPasswordLink";
import { exitContactOnPurchase } from "./sequences";
import { readSetting } from "./settings";

/**
 * Everything a customer is owed the moment a purchase completes.
 *
 * `services/fulfillment.ts` owns the money and the access: it marks the order
 * paid, writes the ledger and grants the products, all inside one transaction.
 * This owns the other half — the part the buyer actually experiences — and it
 * lives here rather than in the Stripe webhook because it has three callers, not
 * one:
 *
 *  - the webhook, for a card payment;
 *  - the offer checkout, for an order a coupon took to zero, which used to
 *    complete in total silence;
 *  - the admin's manual grant, which used to create an account and never tell
 *    anybody it had.
 *
 * A buyer's experience must not depend on which of those they came through. The
 * whole module is therefore fire-and-forget by contract: the money has already
 * moved and the access has already been granted by the time anything here runs,
 * so a mail server outage must never turn a completed purchase into a webhook
 * that Stripe retries and fulfils all over again. Nothing below is allowed to
 * throw.
 */

export interface DeliverPurchaseInput {
  orderId: number;
  memberId: number | null;
  /** True when this purchase is what created the account, so it has no password. */
  createdMember: boolean;
  /**
   * Whether the buyer gets a receipt. False for a manual grant, where no money
   * changed hands and a receipt for $0 raises a question rather than answering
   * one.
   */
  sendReceipt?: boolean;
}

export interface DeliverPurchaseOutcome {
  receiptSent: boolean;
  welcomeSent: boolean;
  setPasswordLinkIncluded: boolean;
  sequencesExited: number;
}

const NOTHING: DeliverPurchaseOutcome = {
  receiptSent: false,
  welcomeSent: false,
  setPasswordLinkIncluded: false,
  sequencesExited: 0,
};

interface DeliveryOrderRow {
  id: number;
  offer_id: number | null;
  contact_id: number | null;
  member_id: number | null;
  email: string;
  billing_name: string;
  billing_address: unknown;
  currency: string;
  subtotal_cents: number;
  discount_cents: number;
  coupon_code: string;
  tax_cents: number;
  total_cents: number;
  created_at: Date;
  offer_title: string | null;
  offer_slug: string | null;
  welcome_next_steps: string | null;
  send_welcome_email: boolean | null;
  course_title: string | null;
}

const DELIVERY_ORDER_SELECT = `
  SELECT o.id, o.offer_id, o.contact_id, o.member_id, o.email, o.billing_name, o.billing_address,
         o.currency, o.subtotal_cents, o.discount_cents, o.coupon_code, o.tax_cents,
         o.total_cents, o.created_at,
         f.title       AS offer_title,
         f.slug        AS offer_slug,
         f.welcome_next_steps,
         f.send_welcome_email,
         c.title       AS course_title
    FROM orders o
    LEFT JOIN offers  f ON f.id = o.offer_id
    LEFT JOIN courses c ON c.id = o.course_id
   WHERE o.id = $1`;

/** What the buyer thinks they bought, for a subject line that means something. */
function describe(order: DeliveryOrderRow): string {
  return order.offer_title || order.course_title || `Order #${order.id}`;
}

/**
 * The buyer's own address, as lines to print.
 *
 * `billing_address` is JSONB written by the checkout from whatever the offer
 * asked for, so any of its fields may be absent — a receipt is not the place to
 * discover that an offer did not collect a postcode.
 */
function addressLines(value: unknown): string[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return [];
  const address = value as Record<string, unknown>;
  const text = (key: string): string => {
    const field = address[key];
    return typeof field === "string" ? field.trim() : "";
  };

  const cityLine = [text("city"), text("state"), text("postalCode") || text("postal_code")]
    .filter((part) => part !== "")
    .join(", ");

  return [text("line1"), text("line2"), cityLine, text("country")].filter(
    (line) => line !== ""
  );
}

/** "Visa ending 4242", or empty when the payment carried no card detail. */
function describePaymentMethod(brand: string, last4: string): string {
  const name = brand.trim();
  const digits = last4.trim();
  if (name === "" && digits === "") return "";
  const label = name === "" ? "Card" : name.charAt(0).toUpperCase() + name.slice(1);
  return digits === "" ? label : `${label} ending ${digits}`;
}

/**
 * Sends the receipt, with the PDF attached.
 *
 * The PDF is rendered inside its own try: a receipt that arrives without its
 * attachment is a small problem, and a receipt that never arrives because
 * rendering a PDF threw is a large one. So a failure here costs the attachment
 * and nothing else.
 */
async function sendReceiptEmail(
  order: DeliveryOrderRow,
  lines: ReceiptLine[],
  payment: { reference: string; method: string }
): Promise<boolean> {
  if (!order.email) return false;

  const content = purchaseReceipt({
    buyerName: order.billing_name,
    orderId: order.id,
    lines,
    subtotalCents: order.subtotal_cents,
    discountCents: order.discount_cents,
    couponCode: order.coupon_code,
    taxCents: order.tax_cents,
    totalCents: order.total_cents,
    currency: order.currency,
  });

  let attachments: MailAttachment[] | undefined;
  try {
    const business = await loadBusinessDetails();
    const issuedAt = order.created_at ?? new Date();
    const pdf = await renderInvoicePdf({
      business,
      orderId: order.id,
      transactionReference: payment.reference,
      issuedAt,
      buyerName: order.billing_name,
      buyerEmail: order.email,
      buyerAddressLines: addressLines(order.billing_address),
      paymentMethod: payment.method,
      lines,
      subtotalCents: order.subtotal_cents,
      discountCents: order.discount_cents,
      couponCode: order.coupon_code,
      taxCents: order.tax_cents,
      totalCents: order.total_cents,
      currency: order.currency,
    });
    attachments = [
      {
        filename: invoiceFilename(order.id, issuedAt),
        content: pdf.toString("base64"),
        contentType: "application/pdf",
        encoding: "base64",
      },
    ];
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      `[purchaseDelivery] receipt PDF for order ${order.id} failed:`,
      (err as Error).message
    );
  }

  const stored = await withStoredTemplate(
    "purchase_receipt",
    {
      firstName: (order.billing_name || "").split(/\s+/)[0] ?? "",
      name: order.billing_name,
      email: order.email,
      offer: describe(order),
      orderId: String(order.id),
      total: content.subject,
    },
    content
  );

  await sendMail({
    topic: "purchase_receipt",
    sourceId: order.id,
    memberId: order.member_id ?? null,
    contactId: order.contact_id ?? null,
    to: order.email,
    ...stored,
    attachments,
  });
  return true;
}

/**
 * Records a purchase and sends everything that goes with it.
 *
 * Never throws, and never reports a failure to its caller as an exception:
 * every caller has already taken money or granted access and has nothing
 * useful to do with one.
 */
export async function deliverPurchase(
  input: DeliverPurchaseInput
): Promise<DeliverPurchaseOutcome> {
  try {
    const orderRes = await pool.query<DeliveryOrderRow>(DELIVERY_ORDER_SELECT, [input.orderId]);
    const order = orderRes.rows[0];
    if (!order) return NOTHING;

    const itemsRes = await pool.query<{
      title: string;
      quantity: number;
      amount_cents: number;
    }>(
      `SELECT title, quantity, amount_cents FROM order_items
        WHERE order_id = $1 ORDER BY id`,
      [order.id]
    );

    const lines: ReceiptLine[] =
      itemsRes.rows.length > 0
        ? itemsRes.rows.map((row) => ({
            title: row.title,
            quantity: row.quantity,
            amountCents: row.amount_cents,
          }))
        : // The legacy course path writes no order_items, so the order itself is
          // the only line there is.
          [{ title: describe(order), quantity: 1, amountCents: order.total_cents }];

    // Card detail lives on the transaction, not the order — an order can have
    // several (a payment plan has one per installment), so the opening one is
    // what a receipt for this purchase describes.
    const paymentRes = await pool.query<{
      payment_method_brand: string;
      payment_method_last4: string;
      stripe_payment_intent_id: string | null;
    }>(
      `SELECT payment_method_brand, payment_method_last4, stripe_payment_intent_id
         FROM transactions
        WHERE order_id = $1 AND kind = 'payment'
        ORDER BY id LIMIT 1`,
      [order.id]
    );
    const payment = paymentRes.rows[0];

    const outcome: DeliverPurchaseOutcome = { ...NOTHING };

    /* ------------------------------------------------------------ receipt */

    const paymentSettings = await readSetting("customer_payments");
    const receiptRule = String(paymentSettings.receiptRule ?? "every");
    const receiptAllowed =
      input.sendReceipt !== false &&
      paymentSettings.sendReceipts !== false &&
      (receiptRule !== "nonzero" || order.total_cents > 0);
    if (receiptAllowed) {
      outcome.receiptSent = await sendReceiptEmail(order, lines, {
        reference: payment?.stripe_payment_intent_id ?? "",
        method: describePaymentMethod(
          payment?.payment_method_brand ?? "",
          payment?.payment_method_last4 ?? ""
        ),
      });
    }

    /* ------------------------------------------------------------ welcome */

    // A guest checkout leaves an account with no password, and this link is the
    // only way into it. It is minted once and carried inside the welcome email
    // rather than sent as its own message: two emails is what the buyer expects,
    // and minting twice would invalidate the first link with the second.
    let setPasswordUrl: string | null = null;
    if (input.createdMember && input.memberId !== null) {
      setPasswordUrl = (await issueSetPasswordLink(input.memberId))?.url ?? null;
    }

    const wantsWelcome = order.send_welcome_email !== false;
    if (wantsWelcome && order.email) {
      const startUrl = `${env.publicSiteUrl}/library`;
      const fallback = purchaseWelcome({
        buyerName: order.billing_name,
        offerTitle: describe(order),
        setPasswordUrl,
        startUrl,
        nextSteps: order.welcome_next_steps ?? "",
      });

      const stored = await withStoredTemplate(
        "purchase_welcome",
        {
          firstName: (order.billing_name || "").split(/\s+/)[0] ?? "",
          name: order.billing_name,
          email: order.email,
          offer: describe(order),
          startUrl,
          // An owner-written template that uses this token on a purchase by an
          // existing customer gets the library link, never an empty href.
          setPasswordUrl: setPasswordUrl ?? startUrl,
          nextSteps: order.welcome_next_steps ?? "",
        },
        fallback
      );

      // Deliberately its own topic: access details and a receipt are different
      // messages with different switches, and "did they get in?" must be
      // answerable without reading the receipt log.
      await sendMail({
        topic: "purchase_access",
        sourceId: order.id,
        memberId: order.member_id ?? null,
        contactId: order.contact_id ?? null,
        to: order.email,
        ...stored,
      });
      outcome.welcomeSent = true;
      outcome.setPasswordLinkIncluded = setPasswordUrl !== null;
    } else if (setPasswordUrl !== null) {
      // The offer sends no welcome, but the buyer still has no way in. The
      // link cannot simply be dropped, so it goes as its own email — this is the
      // one branch where a third message is the right answer.
      const { sendSetPasswordLink } = await import("./setPasswordLink");
      void sendSetPasswordLink(input.memberId as number);
    }

    /* --------------------------------------------------- list housekeeping */

    // Continuing to sell somebody what they bought an hour ago is the fastest
    // way to earn an unsubscribe. `exit_on_purchase` has defaulted to true on
    // every sequence since Phase 5 and nothing ever honoured it.
    if (order.contact_id !== null) {
      outcome.sequencesExited = await exitContactOnPurchase(
        order.contact_id,
        `bought ${describe(order)}`
      );
    }

    /* ---------------------------------------------------------- automation */

    // The trigger Yvette can already build against in the automation builder.
    // It has been listed there, narrowable to a specific offer, since Phase 5 —
    // and nothing has ever fired it, so every automation built on it has sat
    // idle since the day it was saved.
    if (order.offer_id !== null) {
      await publishDomainEvent("offer_purchased", {
        eventKey: `offer-purchased:order:${order.id}`,
        contactId: order.contact_id,
        email: order.email,
        name: order.billing_name,
        subjectId: order.offer_id,
        source: "purchase",
        facts: {
          offerId: order.offer_id,
          offerSlug: order.offer_slug ?? "",
          offerTitle: order.offer_title ?? "",
          orderId: order.id,
          amountCents: order.total_cents,
          currency: order.currency,
          couponCode: order.coupon_code,
        },
      });
    }

    return outcome;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      `[purchaseDelivery] order ${input.orderId} delivery failed:`,
      (err as Error).message
    );
    return NOTHING;
  }
}

/** Tells the owner she made a sale. Separate because a $0 grant is not one. */
export function notifyOwnerOfSale(input: {
  description: string;
  email: string;
  amountCents: number;
  currency: string;
}): void {
  if (!env.notifyEmail) return;
  void sendMail({
    to: env.notifyEmail,
    ...orderPaidNotification({
      courseTitle: input.description,
      email: input.email,
      amountCents: input.amountCents,
      currency: input.currency,
    }),
  });
}

/**
 * The welcome half of a delivery, for access that was given rather than bought.
 *
 * An admin grant has no order, so there is nothing to receipt and no money to
 * report — but the person on the other end has just been handed a course, and
 * until this existed they were handed it in silence. Worse, a grant to an
 * address with no account created one with no password and no link to claim it,
 * so the most common manual grant produced a customer who could not sign in.
 */
export async function deliverManualGrant(input: {
  memberId: number;
  offerId: number;
  createdMember: boolean;
}): Promise<{ welcomeSent: boolean; setPasswordLinkIncluded: boolean }> {
  try {
    const offerRes = await pool.query<{
      title: string;
      welcome_next_steps: string;
      send_welcome_email: boolean;
    }>(
      `SELECT title, welcome_next_steps, send_welcome_email FROM offers WHERE id = $1`,
      [input.offerId]
    );
    const offer = offerRes.rows[0];

    const memberRes = await pool.query<{ email: string; name: string; first_name: string }>(
      `SELECT email, name, first_name FROM members WHERE id = $1`,
      [input.memberId]
    );
    const member = memberRes.rows[0];
    if (!member?.email) return { welcomeSent: false, setPasswordLinkIncluded: false };

    let setPasswordUrl: string | null = null;
    if (input.createdMember) {
      setPasswordUrl = (await issueSetPasswordLink(input.memberId))?.url ?? null;
    }

    if (offer?.send_welcome_email === false) {
      // No welcome for this offer, but a brand-new account still needs its way
      // in — that link is not optional and cannot be dropped with the email.
      if (setPasswordUrl !== null) {
        const { sendSetPasswordLink } = await import("./setPasswordLink");
        void sendSetPasswordLink(input.memberId);
      }
      return { welcomeSent: false, setPasswordLinkIncluded: false };
    }

    const startUrl = `${env.publicSiteUrl}/library`;
    const content = purchaseWelcome({
      buyerName: member.name || member.first_name,
      offerTitle: offer?.title ?? "your new program",
      setPasswordUrl,
      startUrl,
      nextSteps: offer?.welcome_next_steps ?? "",
    });

    await sendMail({ to: member.email, ...content });
    return { welcomeSent: true, setPasswordLinkIncluded: setPasswordUrl !== null };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      `[purchaseDelivery] manual grant delivery for member ${input.memberId} failed:`,
      (err as Error).message
    );
    return { welcomeSent: false, setPasswordLinkIncluded: false };
  }
}
