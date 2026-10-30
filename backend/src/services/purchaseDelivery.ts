import { env, stripeTestMode } from "../config/env";
import { pool } from "../db/pool";
import { automationIdentity, publishDomainEvent } from "./domainEvents";
import { purchaseReceipt, purchaseWelcome, type ReceiptLine } from "../email/commerceTemplates";
import { sendMail, type MailAttachment } from "../email/mailer";
import { withStoredTemplate } from "../email/templateStore";
import { ensureOrderReceipt, loadReceiptDocument, renderReceiptPdf } from "./receiptDocument";
import { issueSetPasswordLink } from "./setPasswordLink";
import { upsertContactWithStatus } from "./contacts";
import { exitContactOnPurchase } from "./sequences";
import { readSetting } from "./settings";
import { sendOwnerSaleNotification } from "./ownerSaleNotification";
import { sendDirectoryAuditIntake } from "./directoryAuditIntake";

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
  gift_recipient_email: string;
  gift_message: string;
  gift_member_id: number | null;
  gift_created_member: boolean;
}

const DELIVERY_ORDER_SELECT = `
  SELECT o.id, o.offer_id, o.contact_id, o.member_id, o.email, o.billing_name, o.billing_address,
         o.currency, o.subtotal_cents, o.discount_cents, o.coupon_code, o.tax_cents,
         o.total_cents, o.created_at, o.gift_recipient_email, o.gift_message, o.gift_member_id, o.gift_created_member,
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
 * Sends the receipt, with the PDF attached.
 *
 * The PDF is rendered inside its own try: a receipt that arrives without its
 * attachment is a small problem, and a receipt that never arrives because
 * rendering a PDF threw is a large one. So a failure here costs the attachment
 * and nothing else.
 */
async function sendReceiptEmail(
  order: DeliveryOrderRow,
  lines: ReceiptLine[]
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
    // The same document the member can reopen from their purchases page and the
    // same one the office can print, loaded from the receipt record rather than
    // rebuilt from the row this function happens to be holding. Two builders is
    // how an emailed PDF and an on-screen receipt start disagreeing about one
    // payment.
    const document = await loadReceiptDocument({ orderId: order.id }, { admin: true });
    if (document?.pdf) {
      const pdf = await renderReceiptPdf(document);
      attachments = [
        {
          filename: document.filename,
          content: pdf.toString("base64"),
          contentType: "application/pdf",
          encoding: "base64",
        },
      ];
    }
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

  // The transport's own answer, not an assumption. `sendMail` never throws, so
  // returning `true` here reported every receipt as sent — including the ones
  // the transport had refused.
  const result = await sendMail({
    topic: "purchase_receipt",
    sourceId: order.id,
    memberId: order.member_id ?? null,
    contactId: order.contact_id ?? null,
    to: order.email,
    ...stored,
    attachments,
  });
  return result.sent;
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

    const outcome: DeliverPurchaseOutcome = { ...NOTHING };

    /* ------------------------------------------------------------ receipt */

    // The receipt record, before any decision about *emailing* one. Whether she
    // has receipt emails switched on is a question about mail; whether the
    // purchase can be receipted at all is not, and the member's purchases page,
    // her invoice list and the emailed PDF all read this one row.
    //
    // A caller passing `sendReceipt: false` is saying this was not a purchase —
    // an access grant, with no money — and there is nothing to receipt.
    if (input.sendReceipt !== false) await ensureOrderReceipt(order.id);

    // Sandbox billing holds back the envelope and nothing else.
    //
    // Returning here instead was the same bug in four places: the set-password
    // link was never minted, so a guest checkout produced an account nobody
    // could sign in to; the gift was never marked delivered; the buyer stayed in
    // the sequence selling them what they had just bought; and the sale left no
    // `domain_events` row, so no automation fired and the business had no record
    // of it. None of that is a message. Only the sends below are, and each one
    // is gated on its own — the addresses on a test order belong to real people.
    const sandbox = stripeTestMode();

    const paymentSettings = await readSetting("customer_payments");
    const receiptRule = String(paymentSettings.receiptRule ?? "every");
    const receiptAllowed =
      !sandbox &&
      input.sendReceipt !== false &&
      paymentSettings.sendReceipts !== false &&
      (receiptRule !== "nonzero" || order.total_cents > 0);
    if (receiptAllowed) {
      outcome.receiptSent = await sendReceiptEmail(order, lines);
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

    // `deliverGift` is the gift email and the `gift_delivered_at` stamp in one
    // transaction, and it rolls the stamp back when the transport refuses — so
    // it cannot be half-run here. In sandbox the message is the part that must
    // not go, which leaves the stamp unset until purchaseGift.ts can separate
    // the two. The recipient's access grant does not come from here.
    if (order.gift_recipient_email && order.gift_member_id && !sandbox) {
      const { deliverGift } = await import("./purchaseGift");
      await deliverGift(order);
    }
    const wantsWelcome = !order.gift_recipient_email && order.send_welcome_email !== false;
    if (wantsWelcome && order.email && !sandbox) {
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
      const welcome = await sendMail({
        topic: "purchase_access",
        sourceId: order.id,
        memberId: order.member_id ?? null,
        contactId: order.contact_id ?? null,
        to: order.email,
        ...stored,
      });
      // What the transport said, so "welcome sent" means a welcome was sent.
      outcome.welcomeSent = welcome.sent;
      outcome.setPasswordLinkIncluded = welcome.sent && setPasswordUrl !== null;
    } else if (setPasswordUrl !== null && !sandbox) {
      // The offer sends no welcome, but the buyer still has no way in. The
      // link cannot simply be dropped, so it goes as its own email — this is the
      // one branch where a third message is the right answer.
      const { sendSetPasswordLink } = await import("./setPasswordLink");
      void sendSetPasswordLink(input.memberId as number);
    }

    // A service purchase needs its intake instructions after access is granted.
    // The helper checks the real published form and claims each order once.
    if (!sandbox) await sendDirectoryAuditIntake(order);

    /* --------------------------------------------------- list housekeeping */

    // Continuing to sell somebody what they bought an hour ago is the fastest
    // way to earn an unsubscribe. `exit_on_purchase` has defaulted to true on
    // every sequence since Phase 5 and nothing ever honoured it.
    if (order.contact_id !== null) {
      outcome.sequencesExited = await exitContactOnPurchase(
        order.contact_id,
        `bought ${describe(order)}`,
        // The offer, so a sequence that named THIS offer exits too — not only
        // the ones with the blunt global switch on.
        order.offer_id
      );
    }

    /* ---------------------------------------------------------- automation */

    // The trigger Yvette can already build against in the automation builder.
    // It has been listed there, narrowable to a specific offer, since Phase 5 —
    // and nothing has ever fired it, so every automation built on it has sat
    // idle since the day it was saved.
    //
    // QA row 211: this is what starts the emails that come with a course, and it
    // is reached from a real purchase only: card and PayPal payments, free offers
    // and 100% coupons. A renewal or a later installment never calls
    // deliverPurchase (they extend access directly), and imports, migrations and
    // backfills write access_grants without coming near this file. A redelivered
    // webhook collapses on the event key, and `enrollContact` refuses to start
    // anybody on a sequence they are already in or have been through.
    //
    // The emails belong to whoever received the course, which on a gift is not
    // the person who paid.
    const recipient =
      order.gift_recipient_email && order.gift_member_id !== null
        ? await automationIdentity(order.gift_member_id, order.gift_recipient_email)
        : { contactId: order.contact_id, email: order.email, name: order.billing_name };

    const publishPurchased = (
      offerId: number,
      offerSlug: string,
      offerTitle: string,
      eventKey: string,
      additionalOffer: boolean,
    ) =>
      publishDomainEvent("offer_purchased", {
        eventKey,
        contactId: recipient.contactId,
        email: recipient.email,
        name: recipient.name,
        subjectId: offerId,
        source: "purchase",
        facts: {
          source: "purchase",
          offerId,
          offerSlug,
          offerTitle,
          orderId: order.id,
          amountCents: order.total_cents,
          currency: order.currency,
          couponCode: order.coupon_code,
          additionalOffer,
        },
      });

    if (order.offer_id !== null) {
      await publishPurchased(
        order.offer_id,
        order.offer_slug ?? "",
        order.offer_title ?? "",
        `offer-purchased:order:${order.id}`,
        false,
      );
    }

    // An upsell or a cart line is an offer bought too, and fulfilment already
    // grants it (the same two kinds), so it owes the same emails. The order's own
    // offer keeps its original key, so nothing published before this can repeat.
    const otherOffers = await pool.query<{ offer_id: number; title: string; slug: string }>(
      `SELECT DISTINCT i.offer_id, f.title, f.slug
         FROM order_items i
         JOIN offers f ON f.id = i.offer_id
        WHERE i.order_id = $1 AND i.kind IN ('offer', 'upsell')
          AND i.offer_id IS DISTINCT FROM $2::int`,
      [order.id, order.offer_id],
    );
    for (const other of otherOffers.rows) {
      await publishPurchased(
        other.offer_id,
        other.slug,
        other.title,
        `offer-purchased:order:${order.id}:offer:${other.offer_id}`,
        true,
      );
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

/**
 * Tells the owner she made a sale. Separate because a $0 grant is not one.
 *
 * Fire-and-forget for both callers. Who is told — the site-wide address and
 * "someone buys something" switch, narrowed or redirected by the offer's own
 * "Email me when someone buys this offer" setting — and the once-per-order
 * guard that makes a redelivered webhook harmless both live in
 * services/ownerSaleNotification.ts. Sandbox still sends nothing.
 */
export function notifyOwnerOfSale(input: { orderId: number }): void {
  if (stripeTestMode()) {
    // eslint-disable-next-line no-console
    console.log(`[notify] Stripe test mode: owner sale email for order ${input.orderId} not sent`);
    return;
  }
  void sendOwnerSaleNotification(input.orderId);
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
  /** The admin's "send the course emails" box. Only ever true on a single grant. */
  sendCourseEmails?: boolean;
  /** Everything the offer covers, and the part of it this grant newly opened. */
  productIds?: number[];
  activatedProductIds?: number[];
}): Promise<{ welcomeSent: boolean; setPasswordLinkIncluded: boolean }> {
  const delivered = await sendManualGrantWelcome(input);
  if (input.sendCourseEmails === true) {
    await startCourseEmailsForGrant({
      memberId: input.memberId,
      offerId: input.offerId,
      productIds: input.productIds ?? [],
      activatedProductIds: input.activatedProductIds ?? [],
    });
  }
  return delivered;
}

/**
 * QA row 211: one explicit admin grant starts the emails that come with the offer.
 *
 * The same `offer_purchased` trigger a sale raises, because that is where the
 * offer's sequences are attached. `source: "manual_grant"` is in the facts, so an
 * automation that must only run on a sale can say so with an "only if".
 *
 * This is deliberately NOT in `grantAccess` or `grantOfferAccess`. Those are also
 * how renewals, plan grants, the automation engine and the bulk "Grant an offer"
 * bar give access, and migrations and the Kajabi import write the table directly.
 * None of them may email anybody from here, so the only caller is the single
 * grant route, and only with the box ticked.
 *
 * Somebody who already holds this through an import is left alone: "source=import"
 * people bought long ago elsewhere and must never be emailed by this. Otherwise a
 * repeat grant is allowed through, because the key below and `enrollContact` make
 * it harmless: one event per person and offer, ever. Never throws.
 */
async function startCourseEmailsForGrant(input: {
  memberId: number;
  offerId: number;
  productIds: number[];
  activatedProductIds: number[];
}): Promise<void> {
  try {
    if (input.activatedProductIds.length === 0) {
      const imported = await pool.query(
        `SELECT 1 FROM access_grants
          WHERE member_id = $1 AND product_id = ANY($2::int[])
            AND source = 'import' AND status = 'active'
          LIMIT 1`,
        [input.memberId, input.productIds],
      );
      if ((imported.rowCount ?? 0) > 0) return;
    }

    const identity = await automationIdentity(input.memberId);
    if (!identity.email) return;

    // An account made by a grant has no contact yet, and a sequence needs one.
    let contactId = identity.contactId;
    if (contactId === null) {
      const contact = await upsertContactWithStatus({
        email: identity.email,
        name: identity.name,
        source: "customer",
      });
      contactId = contact.id;
      await pool.query(`UPDATE members SET contact_id = $2 WHERE id = $1 AND contact_id IS NULL`, [
        input.memberId,
        contactId,
      ]);
      if (contact.created) {
        await publishDomainEvent("contact_created", {
          eventKey: `contact-created:${contactId}`,
          contactId,
          email: identity.email,
          name: identity.name,
          source: "customer",
        });
      }
    }

    const offerRes = await pool.query<{ title: string; slug: string }>(
      `SELECT title, slug FROM offers WHERE id = $1`,
      [input.offerId],
    );

    await publishDomainEvent("offer_purchased", {
      eventKey: `offer-granted:member:${input.memberId}:offer:${input.offerId}`,
      contactId,
      email: identity.email,
      name: identity.name,
      subjectId: input.offerId,
      source: "manual_grant",
      facts: {
        source: "manual_grant",
        offerId: input.offerId,
        offerSlug: offerRes.rows[0]?.slug ?? "",
        offerTitle: offerRes.rows[0]?.title ?? "",
      },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      `[purchaseDelivery] course emails for member ${input.memberId}, offer ${input.offerId} failed:`,
      (err as Error).message,
    );
  }
}

async function sendManualGrantWelcome(input: {
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

    const welcome = await sendMail({ to: member.email, ...content });
    return {
      welcomeSent: welcome.sent,
      setPasswordLinkIncluded: welcome.sent && setPasswordUrl !== null,
    };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      `[purchaseDelivery] manual grant delivery for member ${input.memberId} failed:`,
      (err as Error).message
    );
    return { welcomeSent: false, setPasswordLinkIncluded: false };
  }
}
