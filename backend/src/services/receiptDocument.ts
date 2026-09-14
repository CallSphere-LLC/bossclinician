import { pool } from "../db/pool";
import { escapeHtml } from "../email/templates";
import { formatAmount } from "../utils/money";
import { loadBusinessDetails, type BusinessDetails } from "./businessIdentity";
import { invoiceFilename, renderInvoicePdf, type InvoiceInput } from "./invoicePdf";
import { loadReceiptLogo } from "./receiptLogo";
import { readSetting } from "./settings";

/**
 * The one receipt document, for every payment and every surface that shows one.
 *
 * There used to be two halves of this and a hole between them. `invoices` was
 * written by the Stripe subscription webhook alone, so only a renewal had a
 * document; a one-off order had an emailed PDF built in `purchaseDelivery` and
 * nothing else — nothing the member could open again, and nothing the admin
 * could see. Both member screens said so out loud ("Ask us if you need a
 * receipt for this one") directly under a heading promising a receipt for every
 * purchase.
 *
 * So the loading lives here, once, and every caller renders the same facts:
 * the member's HTML receipt, the member's PDF, the admin's copy of either, and
 * the PDF attached to the confirmation email. Two rules hold it together:
 *
 *  - **Ownership is decided before anything is loaded.** `loadReceiptDocument`
 *    takes a scope, and a member scope puts `member_id` inside the WHERE clause
 *    of the resolve query rather than reading a row and comparing afterwards.
 *  - **Figures come from the order that was charged, never recomputed.** Where
 *    an order exists it owns the breakdown — it is the only place the discount
 *    and the per-line amounts live. A renewal invoice has no order, so its own
 *    amounts are used instead.
 */

/* ----------------------------------------------------------------- ownership */

/**
 * Ownership for an invoice, which can arrive attached to any of three parents.
 *
 * `invoices.member_id` was added in Phase 2, so a row written by the
 * subscription webhook carries only `subscription_id`. Walking to the parent
 * keeps the check on ids the member provably owns instead of falling back to
 * matching on the email column, which anyone can put anything in.
 *
 * `$1` is the member.
 */
export const INVOICE_OWNED_BY_MEMBER = `(
     i.member_id = $1
  OR EXISTS (SELECT 1 FROM orders o2        WHERE o2.id = i.order_id        AND o2.member_id = $1)
  OR EXISTS (SELECT 1 FROM subscriptions s2 WHERE s2.id = i.subscription_id AND s2.member_id = $1)
  OR EXISTS (SELECT 1 FROM payment_plans p2 WHERE p2.id = i.payment_plan_id AND p2.member_id = $1)
)`;

/**
 * The statuses that mean money actually moved.
 *
 * A `pending` order is a checkout somebody opened and walked away from, and a
 * `failed` one is a decline; neither is a purchase, and neither gets a receipt.
 */
export const PURCHASED_ORDER_STATUSES = `('paid','refunded')`;

/**
 * What the order was charged for.
 *
 * The legacy single-course checkout recorded its money in `amount_cents` alone
 * and left `total_cents` at zero, so neither column can be read on its own. The
 * order of preference matters for the case on file: a coupon that discounts a
 * purchase to nothing leaves a legitimate `total_cents` of 0, and reading
 * `amount_cents` first would print whatever the legacy column happened to hold.
 */
const ORDER_TOTAL_SQL = `CASE WHEN o.total_cents > 0 THEN o.total_cents ELSE o.amount_cents END`;

/* ------------------------------------------------------------------- the view */

export interface ReceiptLine {
  title: string;
  quantity: number;
  amountCents: number;
}

export interface ReceiptView {
  business: BusinessDetails;
  /** Heads the document. "Receipt" unless she has renamed it. */
  title: string;
  /** Her refund policy, printed at the foot so the terms travel with the money. */
  refundPolicy: string;
  billedToName: string;
  billedToEmail: string;
  reference: string;
  /**
   * The order number, printed beside the receipt number so the HTML and the PDF
   * ("Order no.") quote the same two references. Absent for a renewal invoice.
   */
  orderNumber?: string;
  description: string;
  paid: boolean;
  paidAt: string | null;
  issuedAt: string;
  currency: string;
  lines: ReceiptLine[];
  subtotalCents: number;
  discountCents: number;
  couponCode: string;
  taxCents: number;
  totalCents: number;
  /**
   * Her receipt logo as a `data:` URI, built by `receiptLogo` from a file it has
   * identified as PNG or JPEG. Absent means the business name heads the page.
   */
  logoDataUri?: string;
}

function formatDate(value: string | null): string {
  if (value === null) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(parsed);
}

/**
 * The receipt as a standalone HTML document.
 *
 * Every interpolated value goes through escapeHtml, including the ones that
 * came from our own tables: an offer title and a billing name are both typed by
 * a person, and this page is served from the site's own origin, so an unescaped
 * one would be script running with the member's session.
 */
export function renderReceipt(view: ReceiptView): string {
  const money = (cents: number): string => escapeHtml(formatAmount(cents, view.currency));

  const lines = view.lines
    .map(
      (line) => `      <tr>
        <td>${escapeHtml(line.title)}${
          line.quantity > 1 ? ` <span class="qty">&times;${escapeHtml(String(line.quantity))}</span>` : ""
        }</td>
        <td class="num">${money(line.amountCents)}</td>
      </tr>`
    )
    .join("\n");

  const totals = [
    `      <tr><td>Subtotal</td><td class="num">${money(view.subtotalCents)}</td></tr>`,
    view.discountCents > 0
      ? `      <tr><td>Discount${
          view.couponCode ? ` (${escapeHtml(view.couponCode)})` : ""
        }</td><td class="num">&minus;${money(view.discountCents)}</td></tr>`
      : "",
    // Always printed, $0.00 included: an accountant reading a receipt needs to
    // see that no tax was charged, not infer it from a missing row.
    `      <tr><td>Tax</td><td class="num">${money(view.taxCents)}</td></tr>`,
    `      <tr class="total"><td>${view.paid ? "Total paid" : "Total due"}</td><td class="num">${money(view.totalCents)}</td></tr>`,
  ]
    .filter((row) => row !== "")
    .join("\n");

  const addressBlock = view.business.addressLines
    .map((line) => `      <div>${escapeHtml(line)}</div>`)
    .join("\n");

  const paidLine = view.paid
    ? `Paid ${escapeHtml(formatDate(view.paidAt) || formatDate(view.issuedAt))}`
    : "Not yet paid";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(view.title)} ${escapeHtml(view.reference)} &middot; ${escapeHtml(view.business.name)}</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; padding: 40px 24px; background: #f6f5f2; color: #1c1917;
         font: 16px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
  .sheet { max-width: 640px; margin: 0 auto; background: #fff; border-radius: 14px;
           padding: 40px; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
  header { display: flex; justify-content: space-between; gap: 24px; flex-wrap: wrap;
           border-bottom: 1px solid #e7e5e4; padding-bottom: 24px; }
  h1 { font-size: 22px; margin: 0 0 4px; letter-spacing: -.01em; }
  .muted { color: #78716c; font-size: 14px; }
  .biz { text-align: right; font-size: 14px; color: #57534e; }
  .biz strong { display: block; color: #1c1917; font-size: 15px; }
  .meta { display: flex; gap: 40px; flex-wrap: wrap; margin: 24px 0 8px; font-size: 14px; }
  .meta h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .08em;
             color: #a8a29e; margin: 0 0 4px; }
  table { width: 100%; border-collapse: collapse; margin-top: 24px; font-size: 15px; }
  td { padding: 10px 0; border-bottom: 1px solid #f0efed; vertical-align: top; }
  .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .qty { color: #a8a29e; font-size: 13px; }
  .totals td { border: none; padding: 6px 0; color: #57534e; }
  .totals .total td { border-top: 1px solid #e7e5e4; padding-top: 14px;
                      font-weight: 600; font-size: 17px; color: #1c1917; }
  .pill { display: inline-block; padding: 3px 10px; border-radius: 999px; font-size: 13px;
          background: #ecfdf5; color: #065f46; }
  .pill.unpaid { background: #fef3c7; color: #92400e; }
  footer { margin-top: 32px; padding-top: 20px; border-top: 1px solid #e7e5e4;
           font-size: 13px; color: #78716c; }
  .policy { margin-top: 10px; white-space: pre-line; }
  .note { margin-top: 10px; white-space: pre-line; color: #44403c; }
  .logo { display: block; max-width: 200px; max-height: 64px; margin: 0 0 16px; }
  @media print { body { background: #fff; padding: 0; } .sheet { box-shadow: none; padding: 0; } }
</style>
</head>
<body>
  <div class="sheet">
    <header>
      <div>
${
  // Only ever a data: URI of sniffed PNG/JPEG bytes — the page's policy allows
  // nothing else — and escaped all the same.
  view.logoDataUri && view.logoDataUri.startsWith("data:image/")
    ? `        <img class="logo" src="${escapeHtml(view.logoDataUri)}" alt="${escapeHtml(view.business.name)}">`
    : ""
}
        <h1>${escapeHtml(view.title)}</h1>
        <div class="muted">${escapeHtml(view.reference)}${
          view.orderNumber && view.reference !== `#${view.orderNumber}`
            ? ` &middot; Order no. ${escapeHtml(view.orderNumber)}`
            : ""
        }</div>
        <div style="margin-top:10px"><span class="pill${view.paid ? "" : " unpaid"}">${paidLine}</span></div>
      </div>
      <div class="biz">
        <strong>${escapeHtml(view.business.name)}</strong>
${addressBlock}
${view.business.email ? `      <div>${escapeHtml(view.business.email)}</div>` : ""}
${view.business.taxId ? `      <div>Tax ID ${escapeHtml(view.business.taxId)}</div>` : ""}
      </div>
    </header>

    <div class="meta">
      <div>
        <h2>Billed to</h2>
        ${view.billedToName ? `<div>${escapeHtml(view.billedToName)}</div>` : ""}
        <div>${escapeHtml(view.billedToEmail)}</div>
      </div>
      <div>
        <h2>Date</h2>
        <div>${escapeHtml(formatDate(view.paidAt) || formatDate(view.issuedAt))}</div>
      </div>
      <div>
        <h2>For</h2>
        <div>${escapeHtml(view.description)}</div>
      </div>
    </div>

    <table>
${lines}
    </table>

    <table class="totals">
${totals}
    </table>

    <footer>
      Thank you. Keep this receipt for your records &mdash; ${escapeHtml(view.business.name)}.
${view.business.footerNote ? `      <div class="note">${escapeHtml(view.business.footerNote)}</div>` : ""}
${view.refundPolicy ? `      <div class="policy">${escapeHtml(view.refundPolicy)}</div>` : ""}
    </footer>
  </div>
</body>
</html>`;
}


/* -------------------------------------------------------- issuing the record */

/**
 * The receipt record for a completed order, created once and then found.
 *
 * Called on every purchase path (card, coupon-to-zero, manual) through
 * `purchaseDelivery`, and safe to call again: the insert is guarded by both a
 * `NOT EXISTS` and the unique index behind `ON CONFLICT`, so a retried webhook
 * cannot issue a second receipt for one payment.
 *
 * Answers null for an order nobody has paid for, and for one Stripe has already
 * invoiced — a payment plan's installments each carry their own Stripe invoice,
 * and a local receipt for the whole order beside them would double the money on
 * the member's own list.
 */
export async function ensureOrderReceipt(orderId: number): Promise<number | null> {
  const inserted = await pool.query<{ id: number }>(
    `INSERT INTO invoices (
       stripe_invoice_id, origin, member_id, order_id, email, number,
       amount_due_cents, amount_paid_cents, tax_cents, currency, status,
       paid_at, created_at
     )
     SELECT 'order:' || o.id,
            'order',
            o.member_id,
            o.id,
            o.email,
            'R-' || to_char(o.created_at AT TIME ZONE 'UTC', 'YYYY')
                 || '-' || lpad(o.id::text, 5, '0'),
            ${ORDER_TOTAL_SQL},
            ${ORDER_TOTAL_SQL},
            o.tax_cents,
            o.currency,
            'paid',
            o.updated_at,
            o.created_at
       FROM orders o
      WHERE o.id = $1
        AND o.status IN ${PURCHASED_ORDER_STATUSES}
        AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.order_id = o.id)
        AND NOT EXISTS (SELECT 1 FROM payment_plans pp WHERE pp.order_id = o.id)
     ON CONFLICT (stripe_invoice_id) DO NOTHING
     RETURNING id`,
    [orderId]
  );
  if (inserted.rows[0]) return inserted.rows[0].id;

  // Either it was already issued, or Stripe owns the receipt for this order.
  const existing = await pool.query<{ id: number }>(
    `SELECT id FROM invoices WHERE order_id = $1
      ORDER BY (origin = 'order') DESC, id LIMIT 1`,
    [orderId]
  );
  return existing.rows[0]?.id ?? null;
}

/* ------------------------------------------------------------- loading a copy */

export interface ReceiptDocument {
  invoiceId: number | null;
  orderId: number | null;
  /** What the member quotes at us: the invoice number, or the order. */
  reference: string;
  issuedAt: Date;
  /** The name the PDF is saved under. */
  filename: string;
  view: ReceiptView;
  /**
   * The PDF's input, or null when the payment has no order behind it. A renewal
   * invoice carries Stripe's own hosted PDF, and printing "Order no. —" on a
   * document of ours instead is not an improvement.
   */
  pdf: InvoiceInput | null;
}

/** Who is asking. A member scope is enforced in SQL, not after the read. */
export type ReceiptScope =
  | { memberId: number; billedToEmail?: string }
  | { admin: true };

export type ReceiptTarget = { invoiceId: number } | { orderId: number };

interface FactRow {
  invoice_id: number | null;
  number: string | null;
  invoice_status: string | null;
  invoice_currency: string | null;
  amount_paid_cents: number | null;
  invoice_tax_cents: number | null;
  paid_at: Date | null;
  invoice_created_at: Date | null;
  invoice_email: string | null;
  order_id: number | null;
  order_status: string | null;
  order_currency: string | null;
  subtotal_cents: number | null;
  discount_cents: number | null;
  order_tax_cents: number | null;
  total_cents: number | null;
  amount_cents: number | null;
  coupon_code: string | null;
  billing_name: string | null;
  billing_address: unknown;
  order_email: string | null;
  order_created_at: Date | null;
  order_updated_at: Date | null;
  stripe_payment_intent_id: string | null;
  description: string;
  member_email: string | null;
}

/**
 * A currency code Intl will accept.
 *
 * `offers.currency` is free text an admin can mistype, and `Intl.NumberFormat`
 * throws a RangeError on anything that is not three letters — which would turn
 * one bad row into a 500 on every receipt opened.
 */
export function safeCurrency(value: string | null | undefined): string {
  return typeof value === "string" && /^[A-Za-z]{3}$/.test(value) ? value.toLowerCase() : "usd";
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 200) : "";
}

/**
 * The buyer's own address, as lines to print.
 *
 * `billing_address` is JSONB written by the checkout from whatever the offer
 * asked for, so any of its fields may be absent — a receipt is not the place to
 * discover that an offer did not collect a postcode.
 */
function buyerAddressLines(value: unknown): string[] {
  const address = asRecord(value);
  const text = (key: string): string => asText(address[key]);
  const cityLine = [text("city"), text("state"), text("postalCode") || text("postal_code")]
    .filter((part) => part !== "")
    .join(", ");
  return [text("line1"), text("line2"), cityLine, text("country")].filter((line) => line !== "");
}

/** "Visa ending 4242", or empty when the payment carried no card detail. */
function describePaymentMethod(brand: string, last4: string): string {
  const name = brand.trim();
  const digits = last4.trim();
  if (name === "" && digits === "") return "";
  const label = name === "" ? "Card" : name.charAt(0).toUpperCase() + name.slice(1);
  return digits === "" ? label : `${label} ending ${digits}`;
}

/** Resolves the target to a pair of ids, with ownership decided in the WHERE. */
async function resolveKeys(
  target: ReceiptTarget,
  scope: ReceiptScope
): Promise<{ invoiceId: number | null; orderId: number | null } | null> {
  // The member's id is bound only where it is used. An admin query that carried
  // an unreferenced parameter would leave Postgres unable to type it at all.
  const admin = "admin" in scope;

  if ("invoiceId" in target) {
    const found = await pool.query<{ id: number; order_id: number | null }>(
      admin
        ? `SELECT i.id, i.order_id FROM invoices i WHERE i.id = $1`
        : `SELECT i.id, i.order_id FROM invoices i
            WHERE i.id = $2 AND ${INVOICE_OWNED_BY_MEMBER}`,
      admin ? [target.invoiceId] : [scope.memberId, target.invoiceId]
    );
    const row = found.rows[0];
    return row ? { invoiceId: row.id, orderId: row.order_id } : null;
  }

  const RECEIPT_FOR_ORDER = `(SELECT i.id FROM invoices i WHERE i.order_id = o.id
              ORDER BY (i.origin = 'order') DESC, i.id LIMIT 1)`;
  const found = await pool.query<{ id: number; invoice_id: number | null }>(
    admin
      ? `SELECT o.id, ${RECEIPT_FOR_ORDER} AS invoice_id
           FROM orders o
          WHERE o.id = $1 AND o.status IN ${PURCHASED_ORDER_STATUSES}`
      : `SELECT o.id, ${RECEIPT_FOR_ORDER} AS invoice_id
           FROM orders o
          WHERE o.id = $2 AND o.status IN ${PURCHASED_ORDER_STATUSES}
            AND o.member_id = $1`,
    admin ? [target.orderId] : [scope.memberId, target.orderId]
  );
  const row = found.rows[0];
  return row ? { invoiceId: row.invoice_id, orderId: row.id } : null;
}

/**
 * A receipt, ready to render as HTML or as a PDF.
 *
 * Answers null for anything the scope does not own and for anything that does
 * not exist — the same answer for both, because order ids are sequential and a
 * 403 on somebody else's would confirm both that it exists and roughly how many
 * sales have been made.
 */
export async function loadReceiptDocument(
  target: ReceiptTarget,
  scope: ReceiptScope
): Promise<ReceiptDocument | null> {
  const keys = await resolveKeys(target, scope);
  if (!keys) return null;

  const facts = await pool.query<FactRow>(
    `SELECT i.id AS invoice_id, i.number, i.status AS invoice_status,
            i.currency AS invoice_currency, i.amount_paid_cents,
            i.tax_cents AS invoice_tax_cents, i.paid_at,
            i.created_at AS invoice_created_at, i.email AS invoice_email,
            o.id AS order_id, o.status AS order_status, o.currency AS order_currency,
            o.subtotal_cents, o.discount_cents, o.tax_cents AS order_tax_cents,
            o.total_cents, o.amount_cents, o.coupon_code, o.billing_name,
            o.billing_address, o.email AS order_email,
            o.created_at AS order_created_at, o.updated_at AS order_updated_at,
            o.stripe_payment_intent_id,
            COALESCE(NULLIF(fo.title, ''), NULLIF(fs.title, ''), NULLIF(pl.name, ''),
                     NULLIF(o.course_title, ''), 'Purchase') AS description,
            m.email AS member_email
       FROM (SELECT $1::int AS invoice_id, $2::int AS order_id) k
       LEFT JOIN invoices i      ON i.id  = k.invoice_id
       LEFT JOIN orders o        ON o.id  = COALESCE(k.order_id, i.order_id)
       LEFT JOIN offers fo       ON fo.id = o.offer_id
       LEFT JOIN subscriptions s ON s.id  = i.subscription_id
       LEFT JOIN offers fs       ON fs.id = s.offer_id
       LEFT JOIN plans pl        ON pl.id = s.plan_id
       LEFT JOIN members m       ON m.id  = COALESCE(o.member_id, i.member_id)`,
    [keys.invoiceId, keys.orderId]
  );
  const row = facts.rows[0];
  if (!row) return null;

  const orderId = row.order_id;
  const [items, payment, settings] = await Promise.all([
    orderId === null
      ? Promise.resolve({ rows: [] as { title: string; quantity: number; amount_cents: number }[] })
      : pool.query<{ title: string; quantity: number; amount_cents: number }>(
          `SELECT title, quantity, amount_cents FROM order_items
            WHERE order_id = $1 ORDER BY id`,
          [orderId]
        ),
    orderId === null
      ? Promise.resolve({
          rows: [] as {
            stripe_payment_intent_id: string | null;
            payment_method_brand: string;
            payment_method_last4: string;
          }[],
        })
      : pool.query<{
          stripe_payment_intent_id: string | null;
          payment_method_brand: string;
          payment_method_last4: string;
        }>(
          `SELECT stripe_payment_intent_id, payment_method_brand, payment_method_last4
             FROM transactions
            WHERE order_id = $1 AND kind = 'payment'
            ORDER BY id LIMIT 1`,
          [orderId]
        ),
    readSetting("customer_payments"),
  ]);

  const business = await loadBusinessDetails();
  const logo = await loadReceiptLogo(business.logoUrl);
  const currency = safeCurrency(row.order_currency ?? row.invoice_currency);

  /*
   * An invoice raised against an order has that order's own breakdown, which is
   * the only place the discount and the per-line figures exist. A renewal
   * invoice has no order, so the figures come from the invoice itself.
   */
  const hasOrder = orderId !== null && row.total_cents !== null;
  // An order written by the legacy single-course checkout recorded its money in
  // amount_cents alone and left total_cents at zero.
  const orderTotal = row.total_cents || row.amount_cents || 0;
  const totalCents = hasOrder ? orderTotal : (row.amount_paid_cents ?? 0);
  const taxCents = hasOrder ? (row.order_tax_cents ?? 0) : (row.invoice_tax_cents ?? 0);
  const discountCents = hasOrder ? (row.discount_cents ?? 0) : 0;

  // A receipt has to add up. The stored subtotal is used where there is one and
  // derived from the total otherwise — a renewal invoice never had one, and a
  // legacy course order left it at zero.
  const storedSubtotal = hasOrder ? (row.subtotal_cents ?? 0) : 0;
  const subtotalCents =
    storedSubtotal > 0 ? storedSubtotal : Math.max(0, totalCents - taxCents + discountCents);

  const lines: ReceiptLine[] =
    items.rows.length > 0
      ? items.rows.map((item) => ({
          title: item.title,
          quantity: item.quantity,
          amountCents: item.amount_cents,
        }))
      : [{ title: row.description, quantity: 1, amountCents: subtotalCents }];

  const paid =
    row.invoice_status === "paid" ||
    row.order_status === "paid" ||
    row.order_status === "refunded";

  const issuedAt =
    row.order_created_at ?? row.invoice_created_at ?? row.paid_at ?? new Date();
  const paidAt = row.paid_at ?? (paid ? (row.order_updated_at ?? issuedAt) : null);

  // Trimmed and length-capped rather than trusted: both are free text from
  // settings, and the first is a page heading.
  const receiptTitle = asText(settings.receiptTitle).slice(0, 60) || "Receipt";
  const refundPolicy = asText(settings.refundPolicy).slice(0, 600);

  const reference = row.number ?? (orderId === null ? `#${row.invoice_id}` : `#${orderId}`);
  const buyerName = row.billing_name ?? "";
  const buyerEmail =
    ("memberId" in scope ? scope.billedToEmail : undefined) ??
    row.order_email ??
    row.invoice_email ??
    row.member_email ??
    "";

  const view: ReceiptView = {
    business,
    title: receiptTitle,
    refundPolicy,
    billedToName: buyerName,
    billedToEmail: buyerEmail,
    reference,
    orderNumber: orderId === null ? undefined : String(orderId),
    description: row.description,
    paid,
    paidAt: paidAt === null ? null : paidAt.toISOString(),
    issuedAt: issuedAt.toISOString(),
    currency,
    lines,
    subtotalCents,
    discountCents,
    couponCode: row.coupon_code ?? "",
    taxCents,
    totalCents,
    logoDataUri: logo?.dataUri,
  };

  const card = payment.rows[0];
  const method = describePaymentMethod(
    card?.payment_method_brand ?? "",
    card?.payment_method_last4 ?? ""
  );

  return {
    invoiceId: row.invoice_id,
    orderId,
    reference,
    issuedAt,
    // Named after the receipt number the document prints ("receipt-R-2026-00009.pdf"),
    // so the file a bookkeeper saves matches the reference on it. Characters
    // outside the number's own alphabet are dropped: this lands in a
    // Content-Disposition header. No number yet falls back to date and order.
    filename:
      row.number && /[A-Za-z0-9]/.test(row.number)
        ? `receipt-${row.number.replace(/[^A-Za-z0-9-]/g, "").slice(0, 60)}.pdf`
        : invoiceFilename(orderId ?? row.invoice_id ?? 0, issuedAt),
    view,
    pdf:
      orderId === null
        ? null
        : {
            business,
            orderId,
            receiptNumber: row.number ?? "",
            transactionReference:
              card?.stripe_payment_intent_id ?? row.stripe_payment_intent_id ?? "",
            issuedAt,
            buyerName,
            buyerEmail,
            buyerAddressLines: buyerAddressLines(row.billing_address),
            // A coupon that took the order to zero leaves no card and no
            // transaction. "—" against "Payment method" reads like something
            // went missing; nothing was taken, and the receipt should say so.
            paymentMethod: method || (totalCents === 0 ? "No payment due" : ""),
            lines,
            subtotalCents,
            discountCents,
            couponCode: row.coupon_code ?? "",
            taxCents,
            totalCents,
            currency,
            logo: logo?.bytes ?? null,
          },
  };
}

/**
 * A receipt for nobody, dressed exactly as a real one would be today.
 *
 * What the receipt customiser previews: her saved business name, address, tax
 * ID, footer note, logo, title and refund policy around a made-up $19.00
 * purchase. Built through the same renderers as a real receipt, so the preview
 * cannot drift from what a customer is sent — and it touches no order, so there
 * is nothing to leak and nothing to need a sale for.
 */
export async function sampleReceiptDocument(): Promise<ReceiptDocument> {
  const [business, settings] = await Promise.all([
    loadBusinessDetails(),
    readSetting("customer_payments"),
  ]);
  const logo = await loadReceiptLogo(business.logoUrl);
  const issuedAt = new Date();
  const lines: ReceiptLine[] = [{ title: "Sample purchase", quantity: 1, amountCents: 1900 }];

  return {
    invoiceId: null,
    orderId: null,
    reference: "R-SAMPLE",
    issuedAt,
    filename: "receipt-sample.pdf",
    view: {
      business,
      title: asText(settings.receiptTitle).slice(0, 60) || "Receipt",
      refundPolicy: asText(settings.refundPolicy).slice(0, 600),
      billedToName: "A sample customer",
      billedToEmail: "customer@example.com",
      reference: "R-SAMPLE",
      description: "Sample purchase",
      paid: true,
      paidAt: issuedAt.toISOString(),
      issuedAt: issuedAt.toISOString(),
      currency: "usd",
      lines,
      subtotalCents: 1900,
      discountCents: 0,
      couponCode: "",
      taxCents: 0,
      totalCents: 1900,
      logoDataUri: logo?.dataUri,
    },
    pdf: {
      business,
      orderId: 0,
      receiptNumber: "R-SAMPLE",
      transactionReference: "SAMPLE",
      issuedAt,
      buyerName: "A sample customer",
      buyerEmail: "customer@example.com",
      buyerAddressLines: [],
      paymentMethod: "Visa ending 4242",
      lines,
      subtotalCents: 1900,
      discountCents: 0,
      couponCode: "",
      taxCents: 0,
      totalCents: 1900,
      currency: "usd",
      logo: logo?.bytes ?? null,
    },
  };
}

/** The same document as a PDF. Only ever called where `pdf` is present. */
export async function renderReceiptPdf(document: ReceiptDocument): Promise<Buffer> {
  if (document.pdf === null) {
    throw new Error(`receipt ${document.reference} has no order to build a PDF from`);
  }
  return renderInvoicePdf(document.pdf);
}
