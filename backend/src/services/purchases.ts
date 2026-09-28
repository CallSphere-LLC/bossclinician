import { pool } from "../db/pool";
import { notFound } from "../utils/httpError";
import {
  assemblePurchases,
  customerView,
  detailHeading,
  findPurchase,
  toView,
  transactionLines,
  type ContactFacts,
  type CustomerView,
  type GrantRow,
  type InstallmentRow,
  type NativePlanRow,
  type OrderRow,
  type PurchaseRecord,
  type PurchaseRow,
  type PurchaseView,
  type RawRows,
  type TransactionLine,
  type TransactionRow,
} from "./purchaseModel";

/**
 * Reading purchases for the admin: one person's list, and one purchase's page.
 *
 * All the deciding — what is one purchase, what it is called, what the numbers
 * say — happens in `purchaseModel.ts`. This file only fetches the rows that
 * model needs, for exactly one contact at a time, so nothing here can make a
 * card say something different from what the unit tests pin.
 *
 * Loading a whole contact even for one purchase's page is deliberate: the page
 * lists the other items of the same Kajabi order, and a grouped Kajabi plan
 * (before the backfill links it) is only knowable from all of that person's
 * orders. A contact has tens of orders at most.
 */

const PURCHASE_COLUMNS = `
  p.id, p.contact_id, p.member_id, p.offer_id, p.offer_title,
  off.title AS linked_offer_title, off.thumbnail_url AS offer_thumbnail_url,
  p.kind, p.source, p.external_id, p.order_no, p.status, p.purchased_at, p.ended_at,
  p.quantity, p.price_text, p.total_cents, p.currency, p.setup_fee_cents,
  p.installment_cents, p.installments_total, p.installments_paid,
  p.billing_interval, p.interval_count, p.trial_days,
  p.next_payment_at, p.next_payment_cents, p.paused_by,
  p.access_revoked, p.access_revoked_by,
  p.access_starts_on::text AS access_starts_on, p.access_ends_on::text AS access_ends_on,
  p.gift, p.customer_details, p.meta`;

const ORDER_COLUMNS = `
  o.id, o.purchase_id, o.contact_id, o.member_id, o.status, o.currency,
  GREATEST(o.total_cents, o.amount_cents) AS total_cents, o.refunded_cents,
  o.created_at, o.updated_at, o.offer_id,
  off.title AS offer_title, off.thumbnail_url AS offer_thumbnail_url,
  COALESCE(po.pricing_type, off.pricing_type) AS offer_pricing_type,
  o.course_title, o.source, o.notes, o.custom_field_data,
  o.billing_name, o.billing_phone, o.billing_address`;

const ORDER_FROM = `
  FROM orders o
  LEFT JOIN offers off ON off.id = o.offer_id
  LEFT JOIN offer_pricing_options po ON po.id = o.pricing_option_id`;

async function loadContactFacts(contactId: number): Promise<ContactFacts | null> {
  const res = await pool.query<{
    id: number;
    name: string;
    email: string;
    phone: string;
    custom_fields: Record<string, unknown> | null;
  }>(`SELECT id, name, email::text AS email, phone, custom_fields FROM contacts WHERE id = $1`, [contactId]);
  const row = res.rows[0];
  if (!row) return null;
  return { id: row.id, name: row.name, email: row.email, phone: row.phone, customFields: row.custom_fields ?? {} };
}

/** Plans, instalments and transactions for a set of orders — the parts every loader shares. */
async function loadOrderExtras(orders: OrderRow[]): Promise<Pick<RawRows, "plans" | "installments" | "transactions">> {
  const orderIds = orders.map((o) => o.id);
  if (orderIds.length === 0) return { plans: [], installments: [], transactions: [] };
  const [plans, transactions] = await Promise.all([
    pool.query<NativePlanRow>(
      `SELECT id, order_id, installment_cents, installment_count, installments_paid, currency,
              interval, interval_count, status, next_charge_at, completed_at, canceled_at
         FROM payment_plans
        WHERE order_id = ANY($1::int[])`,
      [orderIds],
    ),
    pool.query<TransactionRow>(
      `SELECT order_id, kind, status, amount_cents, currency, occurred_at,
              payment_method_brand, payment_method_last4
         FROM transactions
        WHERE order_id = ANY($1::int[])
        ORDER BY occurred_at, id`,
      [orderIds],
    ),
  ]);
  const planIds = plans.rows.map((p) => p.id);
  const installments =
    planIds.length === 0
      ? []
      : (
          await pool.query<InstallmentRow>(
            `SELECT payment_plan_id, sequence, amount_cents, due_at, paid_at, status
               FROM payment_plan_installments
              WHERE payment_plan_id = ANY($1::int[])
              ORDER BY payment_plan_id, sequence`,
            [planIds],
          )
        ).rows;
  return { plans: plans.rows, installments, transactions: transactions.rows };
}

/** Everything one person bought or was given. */
async function rowsForContact(contact: ContactFacts): Promise<RawRows> {
  const [purchases, members] = await Promise.all([
    pool.query<PurchaseRow>(
      `SELECT ${PURCHASE_COLUMNS}
         FROM purchases p
         LEFT JOIN offers off ON off.id = p.offer_id
        WHERE p.contact_id = $1`,
      [contact.id],
    ),
    // Linked by contact_id, or — for an account made before the link existed —
    // by the address, the same rule the Products tab uses (contactAccess.ts).
    pool.query<{ id: number }>(
      `SELECT id FROM members
        WHERE (contact_id = $1 OR ($2::text <> '' AND email = $2::citext)) AND status <> 'deleted'`,
      [contact.id, contact.email ?? ""],
    ),
  ]);
  const purchaseIds = purchases.rows.map((p) => p.id);
  const memberIds = members.rows.map((m) => m.id);

  const [orders, grants] = await Promise.all([
    pool.query<OrderRow>(
      `SELECT ${ORDER_COLUMNS} ${ORDER_FROM}
        WHERE o.contact_id = $1 OR o.purchase_id = ANY($2::int[])
        ORDER BY o.created_at, o.id`,
      [contact.id, purchaseIds],
    ),
    memberIds.length === 0
      ? Promise.resolve({ rows: [] as GrantRow[] })
      : pool.query<GrantRow>(
          // Offers handed out from "Grant offer" — with an offer and without a
          // payment. A grant a purchase made is that purchase's access, not a
          // purchase of its own.
          `SELECT g.id, g.member_id, g.offer_id, off.title AS offer_title,
                  off.thumbnail_url AS offer_thumbnail_url,
                  g.granted_at, g.status, g.revoked_at, g.expires_at
             FROM access_grants g
             JOIN offers off ON off.id = g.offer_id
            WHERE g.member_id = ANY($1::int[])
              AND g.order_id IS NULL
              AND g.source = 'manual'`,
          [memberIds],
        ),
  ]);

  const extras = await loadOrderExtras(orders.rows);
  return { purchases: purchases.rows, orders: orders.rows, grants: grants.rows, ...extras };
}

export interface ContactPurchases {
  /**
   * How many purchases the person has, counted as Kajabi counts them ("Total
   * offers" on its contact drawer): a payment plan is one however many
   * instalments it has taken, and a grant counts.
   */
  purchaseCount: number;
  /** Newest first. */
  purchases: PurchaseView[];
}

export async function listContactPurchases(contactId: number): Promise<ContactPurchases> {
  const contact = await loadContactFacts(contactId);
  if (!contact) throw notFound("Contact not found");
  const records = assemblePurchases(await rowsForContact(contact));
  return { purchaseCount: records.length, purchases: records.map(toView) };
}

export interface PurchaseDetail {
  /** "Payment Plan", "Purchase", "Granted offer"… */
  heading: string;
  purchase: PurchaseView;
  contact: { id: number; name: string; email: string } | null;
  customer: CustomerView;
  /** The Kajabi order's other items too, so "2 items" reads as it does there. */
  items: PurchaseView[];
  transactions: TransactionLine[];
}

/** Parses a detail key: `12` (a purchases row), `order-45`, `grant-7`. */
export function parsePurchaseKey(raw: string): { type: "purchase" | "order" | "grant"; id: number } | null {
  const match = /^(?:(order|grant)-)?(\d{1,9})$/.exec(raw);
  if (!match) return null;
  const id = Number(match[2]);
  if (!Number.isInteger(id) || id <= 0) return null;
  return { type: (match[1] as "order" | "grant" | undefined) ?? "purchase", id };
}

/** Which person a key belongs to, and the rows to fall back on when it belongs to nobody. */
async function locate(
  key: { type: "purchase" | "order" | "grant"; id: number },
): Promise<{ contactId: number | null; lookupKey: string; standalone: () => Promise<RawRows> } | null> {
  const empty: RawRows = { purchases: [], orders: [], plans: [], installments: [], grants: [], transactions: [] };

  if (key.type === "purchase") {
    const res = await pool.query<{ contact_id: number | null }>(`SELECT contact_id FROM purchases WHERE id = $1`, [
      key.id,
    ]);
    if (!res.rows[0]) return null;
    return {
      contactId: res.rows[0].contact_id,
      lookupKey: String(key.id),
      standalone: async () => {
        const purchases = await pool.query<PurchaseRow>(
          `SELECT ${PURCHASE_COLUMNS} FROM purchases p LEFT JOIN offers off ON off.id = p.offer_id WHERE p.id = $1`,
          [key.id],
        );
        const orders = await pool.query<OrderRow>(
          `SELECT ${ORDER_COLUMNS} ${ORDER_FROM} WHERE o.purchase_id = $1 ORDER BY o.created_at, o.id`,
          [key.id],
        );
        return { ...empty, purchases: purchases.rows, orders: orders.rows, ...(await loadOrderExtras(orders.rows)) };
      },
    };
  }

  if (key.type === "order") {
    const res = await pool.query<{ contact_id: number | null; purchase_id: number | null }>(
      `SELECT contact_id, purchase_id FROM orders WHERE id = $1`,
      [key.id],
    );
    const row = res.rows[0];
    if (!row) return null;
    // A payment that has since been linked to its purchase opens that purchase.
    if (row.purchase_id !== null) return locate({ type: "purchase", id: row.purchase_id });
    return {
      contactId: row.contact_id,
      lookupKey: `order-${key.id}`,
      standalone: async () => {
        const orders = await pool.query<OrderRow>(`SELECT ${ORDER_COLUMNS} ${ORDER_FROM} WHERE o.id = $1`, [key.id]);
        return { ...empty, orders: orders.rows, ...(await loadOrderExtras(orders.rows)) };
      },
    };
  }

  const res = await pool.query<{ contact_id: number | null; member_id: number }>(
    `SELECT m.contact_id, g.member_id
       FROM access_grants g
       JOIN members m ON m.id = g.member_id
      WHERE g.id = $1 AND g.offer_id IS NOT NULL AND g.order_id IS NULL`,
    [key.id],
  );
  const row = res.rows[0];
  if (!row) return null;
  return {
    contactId: row.contact_id,
    lookupKey: `grant-${key.id}`,
    standalone: async () => {
      const grants = await pool.query<GrantRow>(
        `SELECT g.id, g.member_id, g.offer_id, off.title AS offer_title,
                off.thumbnail_url AS offer_thumbnail_url,
                g.granted_at, g.status, g.revoked_at, g.expires_at
           FROM access_grants g
           JOIN offers off ON off.id = g.offer_id
          WHERE g.member_id = $1 AND g.order_id IS NULL AND g.source = 'manual'`,
        [row.member_id],
      );
      return { ...empty, grants: grants.rows };
    },
  };
}

export async function getPurchaseDetail(rawKey: string): Promise<PurchaseDetail> {
  const key = parsePurchaseKey(rawKey);
  if (!key) throw notFound("Purchase not found");
  const found = await locate(key);
  if (!found) throw notFound("Purchase not found");

  const contact = found.contactId !== null ? await loadContactFacts(found.contactId) : null;
  const rows = contact ? await rowsForContact(contact) : await found.standalone();
  const records = assemblePurchases(rows);
  const record: PurchaseRecord | null = findPurchase(records, found.lookupKey);
  if (!record) throw notFound("Purchase not found");

  const siblings =
    record.orderNo !== null
      ? records.filter((r) => r.orderNo === record.orderNo && r.source === record.source)
      : [record];

  return {
    heading: detailHeading(record.kind),
    purchase: toView(record),
    contact: contact ? { id: contact.id, name: contact.name, email: contact.email } : null,
    customer: customerView(contact, record, rows.orders, rows.transactions),
    items: siblings.map(toView),
    transactions: transactionLines(record),
  };
}
