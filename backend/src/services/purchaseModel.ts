/**
 * What a "purchase" is, and every word the admin prints about one.
 *
 * Pure on purpose — no pool, no Express — so the rules the owner checks against
 * Kajabi line by line ("1/10 payments completed", "Monthly (10 payments of
 * $400.00 USD)", "Payments paused") are pinned by unit tests rather than by her
 * spotting a difference on a live screen. `services/purchases.ts` loads rows and
 * hands them here; nothing in this file knows where they came from.
 *
 * Three shapes of record become one list:
 *
 *  1. `purchases` rows (migration 076) — the Kajabi backfill writes these, one
 *     per purchase card Kajabi shows, with the payments linked by
 *     `orders.purchase_id`.
 *  2. Orders that belong to no purchase row. A one-time checkout here is one
 *     order and one purchase, so the order stands in for the purchase. A native
 *     payment plan is also one order — its later instalments are
 *     `payment_plan_installments`, not more orders — and is read through
 *     `payment_plans.order_id`. (`orders.parent_order_id` is the one-click
 *     upsell link, a separate offer and so a separate purchase; it is NOT how
 *     instalments are chained.)
 *  3. Offers handed out from "Grant offer" (`access_grants` with an offer and no
 *     order), which Kajabi lists as "Granted on …" cards. One offer can expand
 *     into several product grants; they are folded back into one card.
 */

export const SITE_TIME_ZONE = "America/Los_Angeles";

export type PurchaseKind = "one_time" | "payment_plan" | "subscription" | "grant" | "free";

export type PurchaseStatus =
  | "complete"
  | "active"
  | "paused"
  | "past_due"
  | "completed"
  | "canceled"
  | "granted"
  | "refunded";

/** The admin's Badge tones; the server picks one so every screen colours a status the same. */
export type Tone = "neutral" | "plum" | "gold" | "green" | "red" | "blue" | "slate";

/* ─────────────────────────────────────────────────────────── raw rows ── */

/** A `purchases` row, with its offer joined and the DATE columns read as text. */
export interface PurchaseRow {
  id: number;
  contact_id: number | null;
  member_id: number | null;
  offer_id: number | null;
  offer_title: string;
  /** The live offer's title and picture, when the purchase points at one. */
  linked_offer_title: string | null;
  offer_thumbnail_url: string | null;
  kind: PurchaseKind;
  source: string;
  external_id: string | null;
  order_no: string | null;
  status: PurchaseStatus;
  purchased_at: Date | string;
  ended_at: Date | string | null;
  quantity: number;
  price_text: string;
  total_cents: number;
  currency: string;
  setup_fee_cents: number;
  installment_cents: number | null;
  installments_total: number | null;
  installments_paid: number | null;
  billing_interval: string | null;
  interval_count: number;
  trial_days: number;
  next_payment_at: Date | string | null;
  next_payment_cents: number | null;
  paused_by: string;
  access_revoked: boolean;
  access_revoked_by: string;
  /** `YYYY-MM-DD` — selected `::text` so pg never shifts it through a local midnight. */
  access_starts_on: string | null;
  access_ends_on: string | null;
  gift: boolean;
  customer_details: Record<string, unknown> | null;
  meta: Record<string, unknown> | null;
}

/** An order, with the offer it sold joined in. */
export interface OrderRow {
  id: number;
  purchase_id: number | null;
  contact_id: number | null;
  member_id: number | null;
  status: string;
  currency: string;
  /** GREATEST(total_cents, amount_cents): older rows only filled amount_cents. */
  total_cents: number;
  refunded_cents: number;
  created_at: Date | string;
  updated_at: Date | string;
  offer_id: number | null;
  offer_title: string | null;
  offer_thumbnail_url: string | null;
  offer_pricing_type: string | null;
  course_title: string;
  source: string;
  notes: string;
  custom_field_data: Record<string, unknown> | null;
  billing_name: string;
  billing_phone: string;
  billing_address: Record<string, unknown> | null;
}

/** A native `payment_plans` row (checkout's own instalment plans). */
export interface NativePlanRow {
  id: number;
  order_id: number | null;
  installment_cents: number;
  installment_count: number;
  installments_paid: number;
  currency: string;
  interval: string;
  interval_count: number;
  status: string;
  next_charge_at: Date | string | null;
  completed_at: Date | string | null;
  canceled_at: Date | string | null;
}

export interface InstallmentRow {
  payment_plan_id: number;
  sequence: number;
  amount_cents: number;
  due_at: Date | string | null;
  paid_at: Date | string | null;
  status: string;
}

/** One product grant made from "Grant offer". */
export interface GrantRow {
  id: number;
  member_id: number;
  offer_id: number;
  offer_title: string;
  offer_thumbnail_url: string | null;
  granted_at: Date | string;
  status: string;
  revoked_at: Date | string | null;
  expires_at: Date | string | null;
}

export interface TransactionRow {
  order_id: number;
  kind: string;
  status: string;
  amount_cents: number;
  currency: string;
  occurred_at: Date | string;
  payment_method_brand: string;
  payment_method_last4: string;
}

export interface RawRows {
  purchases: PurchaseRow[];
  orders: OrderRow[];
  plans: NativePlanRow[];
  installments: InstallmentRow[];
  grants: GrantRow[];
  transactions: TransactionRow[];
}

/* ──────────────────────────────────────────────────── the one record ── */

/** One money movement on a purchase, oldest first. */
export interface PaymentLine {
  key: string;
  orderId: number | null;
  kind: "payment" | "refund";
  status: "paid" | "refunded" | "failed" | "pending";
  amountCents: number;
  currency: string;
  at: string;
}

/** A purchase, whichever of the three shapes it came from. */
export interface PurchaseRecord {
  /** Numeric for a `purchases` row; `order-<id>` or `grant-<id>` otherwise. */
  key: string;
  purchaseId: number | null;
  orderIds: number[];
  contactId: number | null;
  kind: PurchaseKind;
  status: PurchaseStatus;
  source: string;
  offerId: number | null;
  offerTitle: string;
  offerThumbnailUrl: string | null;
  purchasedAt: string;
  endedAt: string | null;
  quantity: number;
  /** Stored verbatim (Kajabi's words) or empty — see `priceText()`. */
  storedPriceText: string;
  totalCents: number;
  currency: string;
  setupFeeCents: number;
  installmentCents: number | null;
  installmentsTotal: number | null;
  /** Null means "count the payments" — see `paymentsCompleted()`. */
  installmentsPaid: number | null;
  billingInterval: string | null;
  intervalCount: number;
  trialDays: number;
  nextPaymentAt: string | null;
  nextPaymentCents: number | null;
  pausedBy: string;
  accessRevoked: boolean;
  accessRevokedBy: string;
  accessStartsOn: string | null;
  accessEndsOn: string | null;
  gift: boolean;
  orderNo: string | null;
  customerDetails: Record<string, unknown>;
  meta: Record<string, unknown>;
  /** A note typed on a manual purchase ("Paid by bank transfer"). */
  note: string;
  payments: PaymentLine[];
}

/* ─────────────────────────────────────────────────────────── helpers ── */

function iso(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function isoOrNow(value: Date | string | null | undefined): string {
  return iso(value) ?? new Date(0).toISOString();
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * "$1,250.00 USD" — Kajabi's money: always two decimals, always the code.
 * The code is what tells "$400.00 USD" from a Canadian "$400.00 CAD".
 */
export function money(cents: number, currency = "usd"): string {
  const code = (currency || "usd").toUpperCase();
  let amount: string;
  try {
    amount = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: code,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(cents / 100);
  } catch {
    amount = (cents / 100).toFixed(2);
  }
  return `${amount} ${code}`;
}

/** The calendar day an instant falls on at the school, as `YYYY-MM-DD` (Kajabi's "on 2026-10-20"). */
export function siteDay(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: SITE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

const ADVERB: Record<string, string> = { day: "daily", week: "weekly", month: "monthly", year: "yearly" };
const CADENCE: Record<string, string> = { day: "Daily", week: "Weekly", month: "Monthly", year: "Yearly" };

type Terms = Pick<
  PurchaseRecord,
  | "kind"
  | "status"
  | "currency"
  | "totalCents"
  | "setupFeeCents"
  | "installmentCents"
  | "installmentsTotal"
  | "installmentsPaid"
  | "billingInterval"
  | "intervalCount"
  | "trialDays"
  | "nextPaymentAt"
  | "nextPaymentCents"
  | "quantity"
  | "storedPriceText"
>;

/** " + $500.00 USD setup fee with 30 day trial", or nothing. */
function extras(terms: Terms): string {
  let tail = "";
  if (terms.setupFeeCents > 0) tail += ` + ${money(terms.setupFeeCents, terms.currency)} setup fee`;
  if (terms.trialDays > 0) tail += ` with ${terms.trialDays} day trial`;
  return tail;
}

/**
 * "10 monthly payments of $400.00 USD + $500.00 USD setup fee with 30 day trial"
 * — composed exactly as Kajabi words a plan, for plans that did not come with
 * Kajabi's own sentence (the rebuild's own checkout).
 */
export function planPriceText(terms: Terms): string {
  const count = terms.installmentsTotal ?? 0;
  const each = money(terms.installmentCents ?? 0, terms.currency);
  const interval = terms.billingInterval ?? "month";
  const base =
    terms.intervalCount > 1
      ? `${count} payments of ${each} every ${terms.intervalCount} ${interval}s`
      : `${count} ${ADVERB[interval] ?? interval} payments of ${each}`;
  return base + extras(terms);
}

/** "$19.00 USD/month", "$99.00 USD every 3 months". */
export function subscriptionPriceText(terms: Terms): string {
  const each = money(terms.installmentCents ?? terms.totalCents, terms.currency);
  const interval = terms.billingInterval ?? "month";
  const base = terms.intervalCount > 1 ? `${each} every ${terms.intervalCount} ${interval}s` : `${each}/${interval}`;
  return base + extras(terms);
}

/** "Monthly (10 payments of $400.00 USD)" — the Billing interval line of a plan's detail page. */
export function billingIntervalText(terms: Terms): string | null {
  if (terms.kind !== "payment_plan" && terms.kind !== "subscription") return null;
  const interval = terms.billingInterval ?? "month";
  const cadence =
    terms.intervalCount > 1 ? `Every ${terms.intervalCount} ${interval}s` : (CADENCE[interval] ?? interval);
  if (terms.kind === "subscription") return cadence;
  const each = money(terms.installmentCents ?? 0, terms.currency);
  return `${cadence} (${terms.installmentsTotal ?? 0} payments of ${each})`;
}

/**
 * Instalments paid, the way Kajabi counts them: the setup fee is not one.
 *
 * Sharon Smith paid a $500 setup fee and one $400 instalment: two payments,
 * "1/10 payments completed". When the purchase row carries the number (the
 * Kajabi backfill writes Kajabi's own count) it wins; otherwise the linked
 * payments are counted and the setup fee, which is always the first, is taken
 * off.
 */
export function paymentsCompleted(terms: Terms, payments: PaymentLine[]): number {
  const total = terms.installmentsTotal ?? 0;
  if (terms.installmentsPaid !== null) return Math.max(0, Math.min(total || Infinity, terms.installmentsPaid));
  const paid = payments.filter((p) => p.kind === "payment" && p.status !== "failed" && p.status !== "pending").length;
  const instalments = Math.max(0, paid - (terms.setupFeeCents > 0 && paid > 0 ? 1 : 0));
  return total > 0 ? Math.min(total, instalments) : instalments;
}

export function remainingPayments(terms: Terms, payments: PaymentLine[]): number {
  return Math.max(0, (terms.installmentsTotal ?? 0) - paymentsCompleted(terms, payments));
}

/** "1/10 payments completed", for a plan; nothing for anything else. */
export function progressText(terms: Terms, payments: PaymentLine[]): string | null {
  if (terms.kind !== "payment_plan" || !terms.installmentsTotal) return null;
  return `${paymentsCompleted(terms, payments)}/${terms.installmentsTotal} payments completed`;
}

const STATUS: Record<PurchaseStatus, { label: string; tone: Tone }> = {
  complete: { label: "Paid", tone: "green" },
  active: { label: "Active", tone: "green" },
  paused: { label: "Paused", tone: "gold" },
  past_due: { label: "Past due", tone: "red" },
  completed: { label: "Completed", tone: "blue" },
  canceled: { label: "Canceled", tone: "red" },
  granted: { label: "Granted", tone: "slate" },
  refunded: { label: "Refunded", tone: "slate" },
};

export function statusLabel(status: PurchaseStatus): string {
  return STATUS[status]?.label ?? "Unknown";
}

export function statusTone(status: PurchaseStatus): Tone {
  return STATUS[status]?.tone ?? "neutral";
}

/** Kajabi's card heading: "Granted on" for a grant, "Paid on" for everything bought. */
export function dateLabel(kind: PurchaseKind): string {
  return kind === "grant" ? "Granted on" : "Paid on";
}

/** The sentence Kajabi prints as a purchase's price. */
export function priceText(record: Terms): string {
  if (record.storedPriceText) return record.storedPriceText;
  switch (record.kind) {
    case "grant":
      // Kajabi prints a grant's price as a "Granted" pill and a bare "$0.00".
      return "$0.00";
    case "free":
      return money(0, record.currency);
    case "payment_plan":
      return record.installmentsTotal ? planPriceText(record) : money(record.totalCents, record.currency);
    case "subscription":
      return record.installmentCents !== null ? subscriptionPriceText(record) : money(record.totalCents, record.currency);
    default:
      return money(Math.round(record.totalCents / Math.max(1, record.quantity)), record.currency);
  }
}

/**
 * What Kajabi prints after "Total" on a card: "Granted" for a grant ("Granted
 * by automation" when Kajabi said so), the whole plan sentence for a plan, the
 * amount for anything paid once. Kajabi's own words, when the backfill kept
 * them, are used verbatim.
 */
export function totalText(record: Terms & { meta?: Record<string, unknown> }): string {
  const kajabi = text(record.meta?.kajabiTotalText);
  if (record.kind === "grant") return kajabi || "Granted";
  if (kajabi) return kajabi;
  if (record.kind === "free") return "Free";
  if (record.kind === "payment_plan" || record.kind === "subscription") return priceText(record);
  return money(record.totalCents, record.currency);
}

/**
 * The "Upcoming payment" line of a plan: "$250.00 USD on 2026-10-20", or
 * "Payments paused" — Kajabi's exact words for Melinda's paused plan.
 */
export function upcomingText(terms: Terms): string | null {
  if (terms.kind !== "payment_plan" && terms.kind !== "subscription") return null;
  if (terms.status === "paused") return "Payments paused";
  if ((terms.status === "active" || terms.status === "past_due") && terms.nextPaymentAt) {
    return `${money(terms.nextPaymentCents ?? terms.installmentCents ?? 0, terms.currency)} on ${siteDay(terms.nextPaymentAt)}`;
  }
  return "No upcoming payments";
}

/* ─────────────────────────────────────────────────────────── assembly ── */

function kajabiType(order: OrderRow): string {
  return text(order.custom_field_data?.kajabiType);
}

/** The payments an order stands for: the charge, then any refund taken off it. */
function orderPayments(order: OrderRow, transactions: TransactionRow[]): PaymentLine[] {
  const lines: PaymentLine[] = [];
  const at = isoOrNow(order.created_at);
  const failed = order.status === "failed";
  lines.push({
    key: `order-${order.id}`,
    orderId: order.id,
    kind: "payment",
    // A charge that was later refunded was still paid; the refund is its own
    // line, as Kajabi's Transactions list shows it.
    status: failed ? "failed" : order.status === "pending" ? "pending" : "paid",
    amountCents: order.total_cents,
    currency: order.currency,
    at,
  });
  if (order.refunded_cents > 0) {
    const refunds = transactions.filter(
      (t) => t.order_id === order.id && t.kind === "refund" && t.status === "succeeded",
    );
    if (refunds.length > 0) {
      for (const [index, refund] of refunds.entries()) {
        lines.push({
          key: `refund-${order.id}-${index}`,
          orderId: order.id,
          kind: "refund",
          status: "refunded",
          amountCents: refund.amount_cents,
          currency: refund.currency || order.currency,
          at: isoOrNow(refund.occurred_at),
        });
      }
    } else {
      lines.push({
        key: `refund-${order.id}`,
        orderId: order.id,
        kind: "refund",
        status: "refunded",
        amountCents: order.refunded_cents,
        currency: order.currency,
        at: isoOrNow(order.updated_at),
      });
    }
  }
  return lines;
}

function byTime(a: PaymentLine, b: PaymentLine): number {
  return a.at < b.at ? -1 : a.at > b.at ? 1 : a.key < b.key ? -1 : 1;
}

function offerTitleOf(order: OrderRow): string {
  return order.offer_title || order.course_title || "";
}

/** Refunded in full reads as refunded; a partial refund is still a purchase she has. */
function orderStatus(order: OrderRow): PurchaseStatus {
  if (order.status === "refunded") return "refunded";
  if (order.refunded_cents > 0 && order.refunded_cents >= order.total_cents) return "refunded";
  return "complete";
}

function baseFromOrder(order: OrderRow, key: string): PurchaseRecord {
  const type = kajabiType(order);
  const kind: PurchaseKind =
    type === "Subscription" || (!type && order.offer_pricing_type === "subscription")
      ? "subscription"
      : order.total_cents === 0 && order.offer_pricing_type === "free"
        ? "free"
        : "one_time";
  return {
    key,
    purchaseId: null,
    orderIds: [order.id],
    contactId: order.contact_id,
    kind,
    status: kind === "subscription" && orderStatus(order) !== "refunded" ? "active" : orderStatus(order),
    source: order.source === "kajabi" ? "kajabi" : order.source === "manual" ? "manual" : "checkout",
    offerId: order.offer_id,
    offerTitle: offerTitleOf(order),
    offerThumbnailUrl: order.offer_thumbnail_url,
    purchasedAt: isoOrNow(order.created_at),
    endedAt: null,
    quantity: 1,
    storedPriceText: "",
    totalCents: order.total_cents,
    currency: order.currency,
    setupFeeCents: 0,
    // An order alone does not say how often a subscription bills, so nothing
    // here guesses "/month"; the price reads as the amount that was charged.
    installmentCents: null,
    installmentsTotal: null,
    installmentsPaid: null,
    billingInterval: null,
    intervalCount: 1,
    trialDays: 0,
    nextPaymentAt: null,
    nextPaymentCents: null,
    pausedBy: "",
    accessRevoked: false,
    accessRevokedBy: "",
    accessStartsOn: null,
    accessEndsOn: null,
    gift: false,
    orderNo: null,
    customerDetails: {},
    meta: {},
    note: order.source === "kajabi" ? "" : order.notes || "",
    payments: [],
  };
}

const NATIVE_PLAN_STATUS: Record<string, PurchaseStatus> = {
  active: "active",
  completed: "completed",
  past_due: "past_due",
  canceled: "canceled",
};

/**
 * Every purchase a set of rows describes, newest first.
 *
 * The rows are whatever the loader found for one contact (or one purchase);
 * this function never reaches for more, so a test can hand it a fixture and
 * see exactly what the owner would see.
 */
export function assemblePurchases(rows: RawRows): PurchaseRecord[] {
  const records: PurchaseRecord[] = [];
  const ordersByPurchase = new Map<number, OrderRow[]>();
  const orphans: OrderRow[] = [];

  for (const order of rows.orders) {
    if (order.purchase_id !== null) {
      const list = ordersByPurchase.get(order.purchase_id) ?? [];
      list.push(order);
      ordersByPurchase.set(order.purchase_id, list);
    } else if (order.status === "paid" || order.status === "refunded") {
      // A checkout that never finished is not a purchase; Kajabi does not list
      // abandoned carts on a contact either.
      orphans.push(order);
    }
  }

  // 1. The purchases table.
  const knownPurchaseIds = new Set(rows.purchases.map((p) => p.id));
  for (const row of rows.purchases) {
    const linked = ordersByPurchase.get(row.id) ?? [];
    records.push({
      key: String(row.id),
      purchaseId: row.id,
      orderIds: linked.map((o) => o.id).sort((a, b) => a - b),
      contactId: row.contact_id,
      kind: row.kind,
      status: row.status,
      source: row.source,
      offerId: row.offer_id,
      offerTitle: row.offer_title || row.linked_offer_title || "",
      offerThumbnailUrl: row.offer_thumbnail_url,
      purchasedAt: isoOrNow(row.purchased_at),
      endedAt: iso(row.ended_at),
      quantity: row.quantity || 1,
      storedPriceText: row.price_text || "",
      totalCents: row.total_cents,
      currency: row.currency || "usd",
      setupFeeCents: row.setup_fee_cents || 0,
      installmentCents: row.installment_cents,
      installmentsTotal: row.installments_total,
      installmentsPaid: row.installments_paid,
      billingInterval: row.billing_interval,
      intervalCount: row.interval_count || 1,
      trialDays: row.trial_days || 0,
      nextPaymentAt: iso(row.next_payment_at),
      nextPaymentCents: row.next_payment_cents,
      pausedBy: row.paused_by || "",
      accessRevoked: row.access_revoked,
      accessRevokedBy: row.access_revoked_by || "",
      accessStartsOn: row.access_starts_on,
      accessEndsOn: row.access_ends_on,
      gift: row.gift,
      orderNo: row.order_no,
      customerDetails: row.customer_details ?? {},
      meta: row.meta ?? {},
      note: "",
      payments: linked.flatMap((o) => orderPayments(o, rows.transactions)).sort(byTime),
    });
  }
  // An order pointing at a purchase the loader did not return (another
  // contact's, say) is shown on its own rather than dropped.
  for (const [purchaseId, linked] of ordersByPurchase) {
    if (!knownPurchaseIds.has(purchaseId)) {
      orphans.push(...linked.filter((o) => o.status === "paid" || o.status === "refunded"));
    }
  }

  // 2. Orders with no purchase row.
  const planByOrder = new Map<number, NativePlanRow>();
  for (const plan of rows.plans) if (plan.order_id !== null) planByOrder.set(plan.order_id, plan);

  // Kajabi instalments the backfill has not linked yet (or ever, if it is not
  // run) still belong together: one card per offer, not one per payment.
  const kajabiPlanGroups = new Map<string, OrderRow[]>();

  for (const order of orphans) {
    const plan = planByOrder.get(order.id);
    if (plan) {
      const record = baseFromOrder(order, `order-${order.id}`);
      const installments = rows.installments
        .filter((i) => i.payment_plan_id === plan.id)
        .sort((a, b) => a.sequence - b.sequence);
      record.kind = "payment_plan";
      record.status = NATIVE_PLAN_STATUS[plan.status] ?? "active";
      record.installmentCents = plan.installment_cents;
      record.installmentsTotal = plan.installment_count;
      record.installmentsPaid = plan.installments_paid;
      record.billingInterval = plan.interval;
      record.intervalCount = plan.interval_count || 1;
      record.currency = plan.currency || record.currency;
      record.totalCents = installments.length
        ? installments.reduce((sum, i) => sum + i.amount_cents, 0)
        : plan.installment_cents * plan.installment_count;
      record.nextPaymentAt = iso(plan.next_charge_at);
      record.endedAt = iso(plan.completed_at) ?? iso(plan.canceled_at);
      const paid = installments.filter((i) => i.status === "paid");
      record.payments = paid.length
        ? paid.map((i) => ({
            key: `installment-${plan.id}-${i.sequence}`,
            orderId: i.sequence === 1 ? order.id : null,
            kind: "payment" as const,
            status: "paid" as const,
            amountCents: i.amount_cents,
            currency: record.currency,
            at: isoOrNow(i.paid_at ?? i.due_at),
          }))
        : orderPayments(order, rows.transactions);
      // Refunds live on the order whichever way its payments were read.
      if (paid.length) record.payments.push(...orderPayments(order, rows.transactions).filter((p) => p.kind === "refund"));
      const next = installments.find((i) => i.status === "scheduled");
      record.nextPaymentCents = next ? next.amount_cents : null;
      record.payments.sort(byTime);
      records.push(record);
      continue;
    }
    if (order.source === "kajabi" && kajabiType(order) === "Payment Plan") {
      const group = `${order.contact_id ?? "none"}:${offerTitleOf(order).toLowerCase()}`;
      const list = kajabiPlanGroups.get(group) ?? [];
      list.push(order);
      kajabiPlanGroups.set(group, list);
      continue;
    }
    const record = baseFromOrder(order, `order-${order.id}`);
    record.payments = orderPayments(order, rows.transactions).sort(byTime);
    records.push(record);
  }

  for (const group of kajabiPlanGroups.values()) {
    group.sort((a, b) => (isoOrNow(a.created_at) < isoOrNow(b.created_at) ? -1 : 1));
    const first = group[0];
    const record = baseFromOrder(first, `order-${first.id}`);
    record.kind = "payment_plan";
    // Without the backfill nothing says how many payments the plan has or
    // whether it is paused, so it is described only by what was paid.
    record.status = "active";
    record.orderIds = group.map((o) => o.id).sort((a, b) => a - b);
    record.payments = group.flatMap((o) => orderPayments(o, rows.transactions)).sort(byTime);
    record.totalCents = group.reduce((sum, o) => sum + o.total_cents, 0);
    record.storedPriceText = "Payment plan";
    record.meta = { kajabiTotalText: `${money(record.totalCents, record.currency)} paid so far`, unlinked: true };
    records.push(record);
  }

  // 3. Offers granted by hand here. One grant per product the offer carries,
  // folded back into the one offer she granted.
  const grantedOffers = new Set(
    records.filter((r) => r.kind === "grant" && r.offerId !== null).map((r) => r.offerId as number),
  );
  const grantGroups = new Map<string, GrantRow[]>();
  for (const grant of rows.grants) {
    if (grantedOffers.has(grant.offer_id)) continue;
    const group = `${grant.member_id}:${grant.offer_id}`;
    const list = grantGroups.get(group) ?? [];
    list.push(grant);
    grantGroups.set(group, list);
  }
  for (const group of grantGroups.values()) {
    group.sort((a, b) => a.id - b.id);
    const first = group[0];
    const revoked = group.every((g) => g.status === "revoked");
    const grantedAt = group.map((g) => isoOrNow(g.granted_at)).sort()[0];
    const revokedAt = revoked
      ? group.map((g) => iso(g.revoked_at)).filter((d): d is string => d !== null).sort().reverse()[0] ?? null
      : null;
    const expiresAt = iso(first.expires_at);
    records.push({
      key: `grant-${first.id}`,
      purchaseId: null,
      orderIds: [],
      contactId: null,
      kind: "grant",
      status: "granted",
      source: "manual",
      offerId: first.offer_id,
      offerTitle: first.offer_title,
      offerThumbnailUrl: first.offer_thumbnail_url,
      purchasedAt: grantedAt,
      endedAt: null,
      quantity: 1,
      storedPriceText: "",
      totalCents: 0,
      currency: "usd",
      setupFeeCents: 0,
      installmentCents: null,
      installmentsTotal: null,
      installmentsPaid: null,
      billingInterval: null,
      intervalCount: 1,
      trialDays: 0,
      nextPaymentAt: null,
      nextPaymentCents: null,
      pausedBy: "",
      accessRevoked: revoked,
      accessRevokedBy: "",
      accessStartsOn: siteDay(grantedAt),
      accessEndsOn: revokedAt ? siteDay(revokedAt) : expiresAt ? siteDay(expiresAt) : null,
      gift: false,
      orderNo: null,
      customerDetails: {},
      // Every product grant folded into this card, so a link to any of them opens it.
      meta: { grantIds: group.map((g) => g.id) },
      note: "",
      payments: [],
    });
  }

  // Newest first, as Kajabi lists them: Sharon's Aug 17 grant above her Aug 13 plan.
  return records.sort((a, b) =>
    a.purchasedAt === b.purchasedAt ? (a.key < b.key ? 1 : -1) : a.purchasedAt < b.purchasedAt ? 1 : -1,
  );
}

/**
 * Finds a record by its key — or by any order folded into it (a grouped Kajabi
 * plan), or any product grant folded into it (one offer granted).
 */
export function findPurchase(records: PurchaseRecord[], key: string): PurchaseRecord | null {
  const direct = records.find((r) => r.key === key);
  if (direct) return direct;
  const order = /^order-(\d+)$/.exec(key);
  if (order) {
    const id = Number(order[1]);
    return records.find((r) => r.orderIds.includes(id)) ?? null;
  }
  const grant = /^grant-(\d+)$/.exec(key);
  if (grant) {
    const id = Number(grant[1]);
    return (
      records.find((r) => Array.isArray(r.meta.grantIds) && (r.meta.grantIds as unknown[]).includes(id)) ?? null
    );
  }
  return null;
}

/* ─────────────────────────────────────────────────────────────── views ── */

export interface BillingView {
  status: PurchaseStatus;
  label: string;
  tone: Tone;
  /** "1/10 payments completed". */
  progressText: string | null;
  /** "Yvette Howard (…)" — who paused it, when somebody did. */
  pausedBy: string | null;
  endedAt: string | null;
}

export interface AccessView {
  revoked: boolean;
  revokedBy: string | null;
  /** `YYYY-MM-DD`; the page prints "Aug 10, 2026 - Aug 24, 2026". */
  startsOn: string;
  endsOn: string | null;
}

export interface PlanView {
  startedAt: string;
  setupFeeCents: number;
  setupFeeText: string | null;
  billingIntervalText: string | null;
  installmentsTotal: number | null;
  /** Null when the plan's length is not known (instalments grouped without the backfill). */
  paymentsCompleted: number | null;
  remainingPayments: number | null;
  upcomingText: string | null;
}

/** One purchase as the Purchases tab draws it. */
export interface PurchaseView {
  key: string;
  kind: PurchaseKind;
  status: PurchaseStatus;
  source: string;
  offerId: number | null;
  offerTitle: string;
  offerThumbnailUrl: string | null;
  purchasedAt: string;
  dateLabel: string;
  totalText: string;
  priceText: string;
  /** "Granted" — the pill Kajabi puts in front of a grant's $0.00. */
  pricePill: string | null;
  quantity: number;
  currency: string;
  totalCents: number;
  paidCents: number;
  refundedCents: number;
  /** Billing status row: plans and subscriptions only, as on Kajabi. */
  billing: BillingView | null;
  /** Access row: shown when access was taken away, as on Kajabi. */
  access: AccessView;
  plan: PlanView | null;
  orderNo: string | null;
  gift: boolean;
  note: string;
}

export function toView(record: PurchaseRecord): PurchaseView {
  const paidCents = record.payments
    .filter((p) => p.kind === "payment" && p.status === "paid")
    .reduce((sum, p) => sum + p.amountCents, 0);
  const refundedCents = record.payments.filter((p) => p.kind === "refund").reduce((sum, p) => sum + p.amountCents, 0);
  const recurring = record.kind === "payment_plan" || record.kind === "subscription";
  // Instalments grouped without the backfill: how many payments the plan has,
  // and whether it is paused, are not known — so nothing is claimed about them.
  const termsKnown = record.meta.unlinked !== true;
  // A purchase copied from Kajabi's Purchases tab has a Billing status row
  // exactly when Kajabi drew one: its plans do, a refunded one-off and the old
  // Lounge VIP subscription do not. Everything else follows the kind.
  const fromKajabiTab = record.source === "kajabi" && "kajabiType" in record.meta;
  const showBilling = fromKajabiTab
    ? text(record.meta.kajabiBillingStatus) !== ""
    : (recurring && termsKnown) || record.status === "refunded";
  let billing: BillingView | null = null;
  if (showBilling && recurring && termsKnown) {
    billing = {
      status: record.status,
      label: statusLabel(record.status),
      tone: statusTone(record.status),
      progressText: progressText(record, record.payments),
      pausedBy: record.status === "paused" && record.pausedBy ? record.pausedBy : null,
      endedAt: record.endedAt,
    };
  } else if (showBilling && record.status === "refunded") {
    billing = {
      status: record.status,
      label: statusLabel(record.status),
      tone: statusTone(record.status),
      progressText: null,
      pausedBy: null,
      endedAt: record.endedAt,
    };
  }
  return {
    key: record.key,
    kind: record.kind,
    status: record.status,
    source: record.source,
    offerId: record.offerId,
    offerTitle: record.offerTitle,
    offerThumbnailUrl: record.offerThumbnailUrl,
    purchasedAt: record.purchasedAt,
    dateLabel: dateLabel(record.kind),
    totalText: totalText(record),
    priceText: priceText(record),
    pricePill: record.kind === "grant" ? "Granted" : null,
    quantity: record.quantity,
    currency: record.currency,
    totalCents: record.totalCents,
    paidCents,
    refundedCents,
    billing,
    access: {
      revoked: record.accessRevoked,
      revokedBy: record.accessRevoked && record.accessRevokedBy ? record.accessRevokedBy : null,
      startsOn: record.accessStartsOn ?? siteDay(record.purchasedAt),
      endsOn: record.accessEndsOn,
    },
    plan:
      record.kind === "payment_plan"
        ? {
            startedAt: record.purchasedAt,
            setupFeeCents: record.setupFeeCents,
            setupFeeText: record.setupFeeCents > 0 ? money(record.setupFeeCents, record.currency) : null,
            billingIntervalText: record.installmentsTotal ? billingIntervalText(record) : null,
            installmentsTotal: record.installmentsTotal,
            paymentsCompleted: record.installmentsTotal ? paymentsCompleted(record, record.payments) : null,
            remainingPayments: record.installmentsTotal ? remainingPayments(record, record.payments) : null,
            upcomingText: termsKnown ? upcomingText(record) : null,
          }
        : null,
    orderNo: record.orderNo,
    gift: record.gift,
    note: record.note,
  };
}

/** One row of the detail page's Transactions list. */
export interface TransactionLine {
  key: string;
  amountCents: number;
  amountText: string;
  status: "paid" | "refunded" | "failed" | "pending" | "upcoming";
  statusText: string;
  at: string;
}

const LINE_STATUS: Record<TransactionLine["status"], string> = {
  paid: "Paid",
  refunded: "Refunded",
  failed: "Failed",
  pending: "Pending",
  upcoming: "Upcoming",
};

/**
 * The Transactions list: every payment and refund oldest first, then the one
 * scheduled payment still to come — Norma's $500, $250, $250 paid and $250
 * "Upcoming, Scheduled for Oct 20, 2026", in that order.
 */
export function transactionLines(record: PurchaseRecord): TransactionLine[] {
  const lines: TransactionLine[] = record.payments.map((p) => ({
    key: p.key,
    amountCents: p.amountCents,
    amountText: money(p.amountCents, p.currency),
    status: p.kind === "refund" ? "refunded" : p.status,
    statusText: LINE_STATUS[p.kind === "refund" ? "refunded" : p.status],
    at: p.at,
  }));
  const scheduled =
    (record.kind === "payment_plan" || record.kind === "subscription") &&
    (record.status === "active" || record.status === "past_due") &&
    record.nextPaymentAt;
  if (scheduled && record.nextPaymentAt) {
    const cents = record.nextPaymentCents ?? record.installmentCents ?? 0;
    lines.push({
      key: "upcoming",
      amountCents: cents,
      amountText: money(cents, record.currency),
      status: "upcoming",
      statusText: LINE_STATUS.upcoming,
      at: record.nextPaymentAt,
    });
  }
  return lines;
}

/** The detail page's heading: "Payment Plan" for a plan, as Kajabi titles it. */
export function detailHeading(kind: PurchaseKind): string {
  switch (kind) {
    case "payment_plan":
      return "Payment Plan";
    case "subscription":
      return "Subscription";
    case "grant":
      return "Granted offer";
    case "free":
      return "Free offer";
    default:
      return "Purchase";
  }
}

/* ──────────────────────────────────────────────── customer details ── */

export interface ContactFacts {
  id: number;
  name: string;
  email: string;
  phone: string;
  customFields: Record<string, unknown>;
}

export interface CustomerView {
  name: string;
  email: string;
  address: string[];
  phone: string | null;
  paymentMethod: string | null;
}

const BRAND: Record<string, string> = {
  visa: "Visa",
  mastercard: "Mastercard",
  amex: "American Express",
  discover: "Discover",
  jcb: "JCB",
  diners: "Diners Club",
  unionpay: "UnionPay",
};

function lines(parts: (string | null | undefined)[]): string[] {
  return parts.map((p) => (p ?? "").trim()).filter(Boolean);
}

function addressFrom(value: unknown): string[] {
  if (typeof value === "string") return lines(value.split("\n"));
  if (Array.isArray(value)) return lines(value.map((v) => (typeof v === "string" ? v : "")));
  if (value && typeof value === "object") {
    const a = value as Record<string, unknown>;
    const cityLine = [text(a.city), [text(a.state), text(a.postalCode ?? a.postal_code ?? a.zip)].filter(Boolean).join(" ")]
      .filter(Boolean)
      .join(", ");
    return lines([text(a.line1), text(a.line2), cityLine, text(a.country)]);
  }
  return [];
}

/**
 * Kajabi's "Customer details" card: who, where, how they paid.
 *
 * The purchase's own record wins (what the processor saw at checkout), then the
 * order's billing fields, then the contact card — an imported Kajabi purchase
 * carries none of the first two, and the contact card has the address Kajabi
 * exported.
 */
export function customerView(
  contact: ContactFacts | null,
  record: PurchaseRecord,
  orders: OrderRow[],
  transactions: TransactionRow[],
): CustomerView {
  const details = record.customerDetails ?? {};
  const own = orders.filter((o) => record.orderIds.includes(o.id));
  const latest = [...own].sort((a, b) => (isoOrNow(a.created_at) < isoOrNow(b.created_at) ? 1 : -1));

  let address = addressFrom(details.address);
  if (address.length === 0) {
    for (const order of latest) {
      address = addressFrom(order.billing_address);
      if (address.length) break;
    }
  }
  if (address.length === 0 && contact) {
    const f = contact.customFields ?? {};
    const cityLine = [text(f.City), [text(f.State), text(f["Zip Code"])].filter(Boolean).join(" ")]
      .filter(Boolean)
      .join(", ");
    address = lines([text(f.Address), text(f["Address Line 2"]), cityLine, text(f.Country)]);
  }

  const phone =
    text(details.phone) || latest.map((o) => o.billing_phone).find(Boolean) || contact?.phone || null;

  let paymentMethod: string | null = null;
  const method = details.paymentMethod as Record<string, unknown> | undefined;
  const brand = text(method?.brand);
  const last4 = text(method?.last4);
  if (brand || last4) {
    paymentMethod = lines([BRAND[brand.toLowerCase()] ?? brand, last4 ? `•••• ${last4}` : ""]).join(" ");
  } else {
    const card = transactions
      .filter((t) => record.orderIds.includes(t.order_id) && (t.payment_method_brand || t.payment_method_last4))
      .sort((a, b) => (isoOrNow(a.occurred_at) < isoOrNow(b.occurred_at) ? 1 : -1))[0];
    if (card) {
      paymentMethod = lines([
        BRAND[card.payment_method_brand.toLowerCase()] ?? card.payment_method_brand,
        card.payment_method_last4 ? `•••• ${card.payment_method_last4}` : "",
      ]).join(" ");
    }
  }

  return {
    name: contact?.name || latest[0]?.billing_name || "",
    email: contact?.email ?? "",
    address,
    phone: phone || null,
    paymentMethod,
  };
}
