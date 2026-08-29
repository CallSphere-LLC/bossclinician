import { z } from "zod";
import type { PoolClient } from "pg";
import { pool } from "../db/pool";
import { generateToken } from "../auth/tokens";
import { commissionCents, type CommissionRule } from "./pricing";

/**
 * The partner program: attribution, commission rules and the commission ledger.
 *
 * Everything in this file exists to answer one question defensibly — *which
 * partner earned what, and when may it be paid* — so three properties are held
 * throughout and are worth stating before any of the code:
 *
 *  1. **Attribution is resolved once, at order creation, and frozen there.**
 *     A click is joined to a purchase through `affiliate_clicks.visitor_token`,
 *     which is a first-party cookie value — not an IP, not a fingerprint. It has
 *     to survive the visitor closing the tab, changing network and coming back
 *     three weeks later, and it must not depend on anything a privacy tool
 *     strips. Re-resolving at accrual time would let whatever cookie the buyer
 *     happens to be carrying that week steal a sale credited to somebody else.
 *
 *  2. **The ledger is append-only.** A refund writes a negative `clawback` row;
 *     it never edits the row it reverses. A balance is the SUM of the rows, so
 *     the history of how it got there survives, and two people reading the same
 *     ledger a year apart reach the same number.
 *
 *  3. **Accrual is idempotent.** Stripe retries webhooks — including after a
 *     delivery that actually succeeded — so `accrueForTransaction` leans on the
 *     unique index over `(transaction_id, kind)` rather than on having counted
 *     the deliveries correctly. Running it twice pays once.
 */

/* -------------------------------------------------------------- settings */

/**
 * Program-wide settings.
 *
 * Stored in the `settings` table under its own key rather than through
 * `services/settings.ts`: that module's registry drives the generated settings
 * *screen*, and this program is edited from the affiliates screen instead,
 * where the choices can be explained in the context they belong to. The row
 * shape is validated on every read for the same reason the registry validates
 * its own — a hand-edited row must not propagate into money arithmetic.
 */
export const SETTINGS_KEY = "affiliates";

const settingsSchema = z.object({
  /**
   * Which click wins when a buyer arrived through two different partners.
   *
   * Default is LAST-CLICK, and deliberately so: it credits the partner whose
   * promotion actually preceded the purchase, which is what every affiliate
   * network defaults to and therefore what a partner joining this program
   * already expects. It is also the model that keeps partners promoting — under
   * first-click, a partner who reaches somebody a second time is working for
   * free. First-click is offered for programs that would rather reward
   * discovery than closing, and is a setting rather than a constant because the
   * answer is a commercial decision, not a technical one.
   */
  attribution: z.enum(["last_click", "first_click"]).default("last_click"),
  /** How long a click stays live, for partners created from here on. */
  cookieWindowDays: z.number().int().min(1).max(365).default(30),
  /**
   * How long a commission is held before it may be paid.
   *
   * This is the refund window, and it is the entire reason `payable_at` exists:
   * paying a partner on day one of a 30-day guarantee means chasing the money
   * back by hand on day twenty.
   */
  holdDays: z.number().int().min(0).max(365).default(30),
  defaultCommissionType: z.enum(["percent", "fixed"]).default("percent"),
  defaultRateBps: z.number().int().min(0).max(10_000).default(3000),
  defaultFixedCents: z.number().int().min(0).max(10_000_000).default(0),
  /** Whether a subscription pays out on every renewal or only the first charge. */
  recurringCommission: z.boolean().default(false),
  /** Approve applications automatically, or read every one first. */
  autoApprove: z.boolean().default(false),
  /** Where a share link lands when neither the link nor the request says. */
  landingPath: z.string().max(400).default("/"),
  /** Shown on the application form and in the partner portal. */
  termsMd: z.string().max(20_000).default(""),
  /** The invitation shown on the public application page. */
  pitchMd: z.string().max(20_000).default(""),
});

export type AffiliateSettings = z.infer<typeof settingsSchema>;

export const SETTINGS_DEFAULTS: AffiliateSettings = settingsSchema.parse({});

const SETTINGS_CACHE_MS = 60_000;
let settingsCache: { at: number; value: AffiliateSettings } | null = null;

/** Drops the cached program settings. Called by the writer, and by tests. */
export function clearAffiliateSettingsCache(): void {
  settingsCache = null;
}

/** The program settings, defaults filled in. Never throws on a bad row. */
export async function affiliateSettings(): Promise<AffiliateSettings> {
  if (settingsCache && Date.now() - settingsCache.at < SETTINGS_CACHE_MS) {
    return settingsCache.value;
  }

  const res = await pool.query<{ value: unknown }>(
    `SELECT value FROM settings WHERE key = $1`,
    [SETTINGS_KEY]
  );
  const raw =
    typeof res.rows[0]?.value === "object" && res.rows[0].value !== null
      ? (res.rows[0].value as Record<string, unknown>)
      : {};

  const parsed = settingsSchema.safeParse(raw);
  const value = parsed.success ? parsed.data : SETTINGS_DEFAULTS;

  settingsCache = { at: Date.now(), value };
  return value;
}

/** Merges a patch into the program settings and returns the whole of it. */
export async function writeAffiliateSettings(
  patch: Partial<AffiliateSettings>
): Promise<AffiliateSettings> {
  const res = await pool.query<{ value: unknown }>(
    `INSERT INTO settings (key, value, group_key, label, description)
     VALUES ($1, $2::jsonb || $3::jsonb, 'payments', 'Partner program',
             'How your partners are paid and who gets credit for a sale.')
     ON CONFLICT (key) DO UPDATE
       SET value = settings.value || $3::jsonb, updated_at = now()
     RETURNING value`,
    [SETTINGS_KEY, JSON.stringify(SETTINGS_DEFAULTS), JSON.stringify(patch)]
  );

  const parsed = settingsSchema.safeParse(res.rows[0]?.value ?? {});
  const value = parsed.success ? parsed.data : SETTINGS_DEFAULTS;
  settingsCache = { at: Date.now(), value };
  return value;
}

/* --------------------------------------------------------------- codes */

/**
 * The public handle in a share link.
 *
 * Random rather than derived from the partner's name: codes sit in URLs that
 * get posted publicly, and a guessable scheme lets anyone enumerate `/api/ref/`
 * to discover who a business's partners are and how many it has. 6 bytes of
 * CSPRNG is 48 bits — short enough to read aloud, far too sparse to walk.
 */
export function generateAffiliateCode(): string {
  return generateToken(6);
}

/* --------------------------------------------------------- attribution */

export interface AttributedClick {
  clickId: string;
  affiliateId: number;
  linkId: number | null;
  offerId: number | null;
  createdAt: Date;
}

/**
 * The click a purchase by this visitor should be credited to, or null.
 *
 * Only live clicks (`expires_at > now()`) belonging to an approved partner are
 * candidates: a cookie window that has run out is not attribution, and paying a
 * partner who was suspended between the click and the sale is a decision for a
 * human, not a default.
 *
 * A click made through a link for one offer still counts towards a purchase of
 * another — partners promote a business, not a SKU, and dropping the credit
 * because the buyer bought the other thing is how a program loses its partners.
 * `offerId` therefore only breaks a tie between clicks recorded in the same
 * instant, in favour of the one that pointed at what was actually bought.
 */
export async function resolveAttribution(
  visitorToken: string,
  offerId: number | null,
  client?: PoolClient
): Promise<AttributedClick | null> {
  const token = visitorToken.trim();
  if (!token) return null;

  const db = client ?? pool;
  const { attribution } = await affiliateSettings();
  // Interpolated from a two-value union, never from anything a request carries.
  const recency = attribution === "first_click" ? "ASC" : "DESC";

  const res = await db.query<{
    id: string;
    affiliate_id: number;
    link_id: number | null;
    offer_id: number | null;
    created_at: Date;
  }>(
    `SELECT c.id, c.affiliate_id, c.link_id, c.offer_id, c.created_at
       FROM affiliate_clicks c
       JOIN affiliates a ON a.id = c.affiliate_id
      WHERE c.visitor_token = $1
        AND c.expires_at > now()
        AND a.status = 'approved'
      ORDER BY c.created_at ${recency},
               (c.offer_id IS NOT DISTINCT FROM $2::int) DESC,
               c.id ${recency}
      LIMIT 1`,
    [token, offerId]
  );

  const row = res.rows[0];
  if (!row) return null;

  return {
    clickId: row.id,
    affiliateId: row.affiliate_id,
    linkId: row.link_id,
    offerId: row.offer_id,
    createdAt: row.created_at,
  };
}

export interface RecordClickInput {
  affiliateId: number;
  linkId: number | null;
  offerId: number | null;
  visitorToken: string;
  landingPath: string;
  referrer: string;
  userAgent: string;
  ip: string;
  cookieWindowDays: number;
}

/** Writes one click and returns its id. */
export async function recordClick(input: RecordClickInput): Promise<string> {
  const res = await pool.query<{ id: string }>(
    `INSERT INTO affiliate_clicks
       (affiliate_id, link_id, offer_id, visitor_token, landing_path,
        referrer, user_agent, ip, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now() + make_interval(days => $9))
     RETURNING id`,
    [
      input.affiliateId,
      input.linkId,
      input.offerId,
      input.visitorToken,
      input.landingPath.slice(0, 500),
      input.referrer.slice(0, 500),
      input.userAgent.slice(0, 500),
      input.ip.slice(0, 64),
      input.cookieWindowDays,
    ]
  );
  return res.rows[0].id;
}

/* ----------------------------------------------------------- commission */

/** One row of `affiliate_commission_rules`, or the affiliate's own defaults. */
export interface CommissionCandidate {
  affiliateId: number | null;
  offerId: number | null;
  type: "percent" | "fixed" | "none";
  rateBps: number;
  fixedCents: number;
  recurring: boolean;
}

export type CommissionSource =
  | "affiliate_offer"
  | "offer"
  | "affiliate_default"
  | "program_default";

export interface ResolvedCommission {
  rule: CommissionRule;
  recurring: boolean;
  source: CommissionSource;
  amountCents: number;
}

/**
 * Picks the rule that governs one affiliate selling one offer.
 *
 * Most specific wins, in this order:
 *
 *   1. a rule for THIS partner on THIS offer     — the hand-negotiated case
 *   2. a rule for THIS offer, any partner        — "everyone gets 40% on the retreat"
 *   3. a rule for THIS partner, any offer        — "she gets 50% on everything"
 *   4. the partner's own columns                 — seeded from the program default
 *
 * Pure, and separated from the query for exactly that reason: precedence is the
 * part that decides what a person is paid, and it must be testable without a
 * database in the loop.
 */
export function pickRule(
  candidates: CommissionCandidate[],
  affiliateDefault: CommissionCandidate,
  affiliateId: number,
  offerId: number | null
): { candidate: CommissionCandidate; source: CommissionSource } {
  const forBoth = candidates.find(
    (c) => c.affiliateId === affiliateId && offerId !== null && c.offerId === offerId
  );
  if (forBoth) return { candidate: forBoth, source: "affiliate_offer" };

  const forOffer = candidates.find(
    (c) => c.affiliateId === null && offerId !== null && c.offerId === offerId
  );
  if (forOffer) return { candidate: forOffer, source: "offer" };

  const forAffiliate = candidates.find(
    (c) => c.affiliateId === affiliateId && c.offerId === null
  );
  if (forAffiliate) return { candidate: forAffiliate, source: "affiliate_default" };

  return { candidate: affiliateDefault, source: "program_default" };
}

/**
 * What this partner earns on `basisCents` of this offer.
 *
 * Returns null when the partner does not exist. A rule of type `none` is a real
 * answer — "this offer pays no commission" — and comes back as a zero amount
 * rather than a null, so a caller can tell "no rule found" from "the rule says
 * nothing".
 */
export async function commissionFor(
  affiliateId: number,
  offerId: number | null,
  basisCents: number,
  client?: PoolClient
): Promise<ResolvedCommission | null> {
  const db = client ?? pool;

  const affiliateRes = await db.query<{
    commission_type: string;
    commission_rate: number;
    commission_fixed_cents: number;
    recurring_commission: boolean;
  }>(
    `SELECT commission_type, commission_rate, commission_fixed_cents, recurring_commission
       FROM affiliates WHERE id = $1`,
    [affiliateId]
  );
  const affiliate = affiliateRes.rows[0];
  if (!affiliate) return null;

  const affiliateDefault: CommissionCandidate = {
    affiliateId,
    offerId: null,
    type: affiliate.commission_type === "fixed" ? "fixed" : "percent",
    rateBps: affiliate.commission_rate,
    fixedCents: affiliate.commission_fixed_cents,
    recurring: affiliate.recurring_commission,
  };

  const rulesRes = await db.query<{
    affiliate_id: number | null;
    offer_id: number | null;
    commission_type: string;
    commission_rate: number;
    commission_fixed_cents: number;
    recurring_commission: boolean;
  }>(
    `SELECT affiliate_id, offer_id, commission_type, commission_rate,
            commission_fixed_cents, recurring_commission
       FROM affiliate_commission_rules
      WHERE (affiliate_id = $1 AND offer_id IS NOT DISTINCT FROM $2::int)
         OR (affiliate_id IS NULL AND offer_id = $2::int)
         OR (affiliate_id = $1 AND offer_id IS NULL)`,
    [affiliateId, offerId]
  );

  const candidates: CommissionCandidate[] = rulesRes.rows.map((r) => ({
    affiliateId: r.affiliate_id,
    offerId: r.offer_id,
    type: r.commission_type === "fixed" ? "fixed" : r.commission_type === "none" ? "none" : "percent",
    rateBps: r.commission_rate,
    fixedCents: r.commission_fixed_cents,
    recurring: r.recurring_commission,
  }));

  const { candidate, source } = pickRule(candidates, affiliateDefault, affiliateId, offerId);
  const rule: CommissionRule = {
    type: candidate.type,
    rateBps: candidate.rateBps,
    fixedCents: candidate.fixedCents,
  };

  return {
    rule,
    recurring: candidate.recurring,
    source,
    amountCents: commissionCents(Math.max(0, basisCents), rule),
  };
}

export interface CommissionRuleInput {
  /** Null means "every partner" — the program-wide rule for that offer. */
  affiliateId: number | null;
  /** Null means "every offer" — that partner's own default. */
  offerId: number | null;
  type: "percent" | "fixed" | "none";
  rateBps: number;
  fixedCents: number;
  recurring: boolean;
}

/**
 * Creates or replaces one commission rule.
 *
 * Deliberately NOT `ON CONFLICT (affiliate_id, offer_id)`, which is the obvious
 * spelling and is wrong here. Postgres treats NULLs as distinct in a UNIQUE
 * constraint unless it is declared `NULLS NOT DISTINCT`, and the one in the
 * migration is not — so two program-wide rules for the same offer, or two
 * "everything" rules for the same partner, do not conflict at all and the upsert
 * silently becomes an insert. `pickRule` would then choose between duplicates
 * arbitrarily, and what a partner is paid would depend on row order.
 *
 * `IS NOT DISTINCT FROM` is the comparison that treats two NULLs as equal, so
 * the UPDATE finds the existing rule whichever of the two columns is blank and
 * the INSERT only runs when it found nothing.
 */
export async function upsertCommissionRule(input: CommissionRuleInput): Promise<number> {
  if (input.affiliateId === null && input.offerId === null) {
    throw new RangeError("A commission rule must name a partner, an offer, or both");
  }

  const res = await pool.query<{ id: number }>(
    `WITH updated AS (
       UPDATE affiliate_commission_rules
          SET commission_type        = $3,
              commission_rate        = $4,
              commission_fixed_cents = $5,
              recurring_commission   = $6
        WHERE affiliate_id IS NOT DISTINCT FROM $1::int
          AND offer_id     IS NOT DISTINCT FROM $2::int
        RETURNING id
     ), inserted AS (
       INSERT INTO affiliate_commission_rules
         (affiliate_id, offer_id, commission_type, commission_rate,
          commission_fixed_cents, recurring_commission)
       SELECT $1::int, $2::int, $3, $4, $5, $6
        WHERE NOT EXISTS (SELECT 1 FROM updated)
       RETURNING id
     )
     SELECT id FROM updated
      UNION ALL
     SELECT id FROM inserted`,
    [input.affiliateId, input.offerId, input.type, input.rateBps, input.fixedCents, input.recurring]
  );

  return res.rows[0].id;
}

/* -------------------------------------------------------------- accrual */

export interface AccrualResult {
  accrued: boolean;
  commissionId: string | null;
  /** Why nothing was written, for the job log. Never surfaced to a partner. */
  reason?: string;
}

const NOT_ACCRUED = (reason: string): AccrualResult => ({
  accrued: false,
  commissionId: null,
  reason,
});

/**
 * Accrues the commission for one succeeded payment.
 *
 * Hangs off `transactions`, not `orders`, because that is the grain money
 * actually moves at: a three-installment plan is one order and three payments,
 * and a monthly membership is one order and thirty. Keying on the order would
 * pay a partner once for a subscription that renews for two years, or three
 * times for a single sale, depending on which way you got it wrong.
 *
 * Safe to call any number of times for the same transaction. The unique index on
 * `(transaction_id, kind)` is the guard rather than a "have I already done
 * this?" read, because between the read and the write is exactly where the
 * second delivery of a retried webhook lands.
 */
export async function accrueForTransaction(transactionId: number): Promise<AccrualResult> {
  const settings = await affiliateSettings();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const txRes = await client.query<{
      id: number;
      order_id: number | null;
      kind: string;
      status: string;
      amount_cents: number;
      currency: string;
      occurred_at: Date;
      affiliate_id: number | null;
      offer_id: number | null;
      tax_cents: number;
      affiliate_status: string | null;
      self_referral: boolean;
    }>(
      `SELECT t.id, t.order_id, t.kind, t.status, t.amount_cents, t.currency, t.occurred_at,
              o.affiliate_id, o.offer_id, o.tax_cents, a.status AS affiliate_status,
              COALESCE(
                (a.member_id IS NOT NULL AND a.member_id = o.member_id)
                  OR a.email = o.email::citext,
                false
              ) AS self_referral
         FROM transactions t
         JOIN orders o     ON o.id = t.order_id
         LEFT JOIN affiliates a ON a.id = o.affiliate_id
        WHERE t.id = $1
        FOR UPDATE OF t`,
      [transactionId]
    );

    const tx = txRes.rows[0];
    if (!tx) {
      await client.query("ROLLBACK");
      return NOT_ACCRUED("no such transaction, or it belongs to no order");
    }
    if (tx.kind !== "payment" || tx.status !== "succeeded") {
      await client.query("ROLLBACK");
      return NOT_ACCRUED("not a succeeded payment");
    }
    if (tx.affiliate_id === null) {
      await client.query("ROLLBACK");
      return NOT_ACCRUED("order is not attributed to a partner");
    }
    // Approval is checked at accrual as well as at attribution: a partner
    // suspended for fraud between the click and the charge must not be paid,
    // and the click row is already written by then.
    if (tx.affiliate_status !== "approved") {
      await client.query("ROLLBACK");
      return NOT_ACCRUED("partner is not approved");
    }
    // A partner buying through their own link is not a referral, it is a
    // discount they wrote themselves. Nothing upstream stops it: the click is
    // recorded like any other, `resolveAttribution` freezes it onto the order,
    // and a partner on the default 30% then takes $599 back on their own $1,997
    // purchase — repeatable for every offer, and on every renewal where the rule
    // pays recurring. Refused here rather than at attribution so the click and
    // the order keep their honest history; only the money stops.
    if (tx.self_referral) {
      await client.query("ROLLBACK");
      return NOT_ACCRUED("the buyer is the partner");
    }

    // The first cleared payment on an order is the sale; everything after it is
    // a renewal or an installment. Measured against the ledger of payments
    // rather than a counter, so it is the same answer however many times this
    // runs and whatever order the webhooks arrived in.
    const firstRes = await client.query<{ first_id: number | null }>(
      `SELECT MIN(id) AS first_id
         FROM transactions
        WHERE order_id = $1 AND kind = 'payment'
          AND status IN ('succeeded', 'refunded', 'disputed')`,
      [tx.order_id]
    );
    const isFirst = firstRes.rows[0]?.first_id === tx.id;
    const kind: "sale" | "renewal" = isFirst ? "sale" : "renewal";

    // Tax is money collected on a government's behalf, never revenue, so it is
    // not shared. Only the opening charge carries the order's tax figure; a
    // renewal is invoiced by Stripe and its amount stands as it is.
    const basisCents = Math.max(0, tx.amount_cents - (isFirst ? tx.tax_cents : 0));

    const resolved = await commissionFor(tx.affiliate_id, tx.offer_id, basisCents, client);
    if (!resolved) {
      await client.query("ROLLBACK");
      return NOT_ACCRUED("partner has no commission rule");
    }
    if (kind === "renewal" && !resolved.recurring) {
      await client.query("ROLLBACK");
      return NOT_ACCRUED("this rule pays on the first charge only");
    }
    if (resolved.amountCents <= 0) {
      await client.query("ROLLBACK");
      return NOT_ACCRUED("this offer pays no commission");
    }

    const payableAt = new Date(
      tx.occurred_at.getTime() + settings.holdDays * 24 * 60 * 60 * 1000
    );

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO affiliate_commissions
         (affiliate_id, order_id, transaction_id, offer_id, kind, status,
          basis_cents, rate_bps, amount_cents, currency, payable_at)
       VALUES ($1,$2,$3,$4,$5,'pending',$6,$7,$8,$9,$10)
       ON CONFLICT (transaction_id, kind) WHERE transaction_id IS NOT NULL
         DO NOTHING
       RETURNING id`,
      [
        tx.affiliate_id,
        tx.order_id,
        tx.id,
        tx.offer_id,
        kind,
        basisCents,
        resolved.rule.type === "percent" ? Math.min(resolved.rule.rateBps, 10_000) : 0,
        resolved.amountCents,
        tx.currency || "usd",
        payableAt,
      ]
    );

    await client.query("COMMIT");

    const commissionId = inserted.rows[0]?.id ?? null;
    return commissionId
      ? { accrued: true, commissionId }
      : NOT_ACCRUED("already accrued");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/* ------------------------------------------------------------ clawback */

export interface ClawbackResult {
  clawedBack: boolean;
  commissionId: string | null;
  amountCents: number;
  reason?: string;
}

/**
 * Reverses commission in proportion to a refund.
 *
 * A negative row, never an edit. An editable ledger is one nobody can
 * reconcile: the partner's statement, the payout export and the accounts all
 * read the same rows, and "it says 40 now, it said 120 last month" is not an
 * answer any of them can give.
 *
 * Keyed on the REFUND rather than on the transaction it reverses. The unique
 * index over `(transaction_id, kind)` guards accrual, where one payment is one
 * commission; a single payment can be refunded twice, so using it here would
 * silently swallow the second partial refund and leave a partner paid for money
 * that went back to the customer. `transaction_id` is therefore left null on a
 * clawback — a refund is not a payment — and the refund's own id in `note` is
 * what makes a replayed `charge.refunded` a no-op.
 */
export async function clawback(refundId: number): Promise<ClawbackResult> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const refundRes = await client.query<{
      id: number;
      order_id: number | null;
      amount_cents: number;
      currency: string;
      affiliate_id: number | null;
      offer_id: number | null;
    }>(
      `SELECT r.id, r.order_id, r.amount_cents, r.currency, o.affiliate_id, o.offer_id
         FROM refunds r
         JOIN orders o ON o.id = r.order_id
        WHERE r.id = $1`,
      [refundId]
    );
    const refund = refundRes.rows[0];
    if (!refund || refund.order_id === null) {
      await client.query("ROLLBACK");
      return { clawedBack: false, commissionId: null, amountCents: 0, reason: "no such refund" };
    }
    if (refund.affiliate_id === null) {
      await client.query("ROLLBACK");
      return {
        clawedBack: false,
        commissionId: null,
        amountCents: 0,
        reason: "order is not attributed to a partner",
      };
    }

    // Serialises two refunds landing on the same order together, which would
    // otherwise both read the same "already clawed back" total and each write a
    // full reversal.
    await client.query(`SELECT id FROM orders WHERE id = $1 FOR UPDATE`, [refund.order_id]);

    const note = `refund:${refund.id}`;
    const already = await client.query<{ id: string }>(
      `SELECT id FROM affiliate_commissions
        WHERE order_id = $1 AND kind = 'clawback' AND note = $2
        LIMIT 1`,
      [refund.order_id, note]
    );
    if (already.rows[0]) {
      await client.query("ROLLBACK");
      return {
        clawedBack: false,
        commissionId: already.rows[0].id,
        amountCents: 0,
        reason: "already clawed back",
      };
    }

    const ledgerRes = await client.query<{
      earned_cents: number;
      reversed_cents: number;
      collected_cents: number;
    }>(
      `SELECT
         COALESCE((SELECT SUM(amount_cents) FROM affiliate_commissions
                    WHERE order_id = $1 AND status <> 'void'
                      AND kind IN ('sale','renewal','adjustment')), 0)::int AS earned_cents,
         COALESCE((SELECT -SUM(amount_cents) FROM affiliate_commissions
                    WHERE order_id = $1 AND status <> 'void'
                      AND kind = 'clawback'), 0)::int AS reversed_cents,
         -- Every payment that cleared, whatever became of it afterwards. A
         -- charge later marked 'refunded' still contributed the money it took,
         -- and dropping it would shrink the denominator until a partial refund
         -- read as a full one.
         COALESCE((SELECT SUM(amount_cents) FROM transactions
                    WHERE order_id = $1 AND kind = 'payment'
                      AND status IN ('succeeded','refunded','disputed')), 0)::int AS collected_cents`,
      [refund.order_id]
    );
    const ledger = ledgerRes.rows[0];
    const outstanding = Math.max(0, ledger.earned_cents - ledger.reversed_cents);

    if (outstanding === 0 || ledger.collected_cents <= 0) {
      await client.query("ROLLBACK");
      return {
        clawedBack: false,
        commissionId: null,
        amountCents: 0,
        reason: "nothing left to reverse",
      };
    }

    // Proportional to what the refund gave back out of what the order took, so
    // a half refund reverses half the commission and a full one reverses all of
    // it however many charges it was collected over.
    const share = Math.min(1, refund.amount_cents / ledger.collected_cents);
    const amountCents = Math.min(outstanding, Math.round(ledger.earned_cents * share));
    if (amountCents <= 0) {
      await client.query("ROLLBACK");
      return { clawedBack: false, commissionId: null, amountCents: 0, reason: "rounds to nothing" };
    }

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO affiliate_commissions
         (affiliate_id, order_id, transaction_id, offer_id, kind, status,
          basis_cents, rate_bps, amount_cents, currency, payable_at, note)
       VALUES ($1,$2,NULL,$3,'clawback','approved',$4,0,$5,$6, now(), $7)
       RETURNING id`,
      [
        refund.affiliate_id,
        refund.order_id,
        refund.offer_id,
        refund.amount_cents,
        -amountCents,
        refund.currency || "usd",
        note,
      ]
    );

    await client.query("COMMIT");
    return { clawedBack: true, commissionId: inserted.rows[0].id, amountCents: -amountCents };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/* ---------------------------------------------------------- portal glue */

export interface AffiliateIdentity {
  id: number;
  code: string;
  status: string;
  name: string;
  email: string;
}

/**
 * The partner record belonging to a signed-in member, or null.
 *
 * Matched on `member_id` first and on the address second, because somebody can
 * apply as a partner before they ever buy anything and get a member account
 * later. The address match writes the link back, so it happens once.
 */
export async function affiliateForMember(
  memberId: number,
  email: string
): Promise<AffiliateIdentity | null> {
  const res = await pool.query<{
    id: number;
    code: string;
    status: string;
    name: string;
    email: string;
  }>(
    `SELECT id, code::text AS code, status, name, email::text AS email
       FROM affiliates
      WHERE member_id = $1 OR (member_id IS NULL AND email = $2::citext)
      ORDER BY (member_id = $1) DESC, id
      LIMIT 1`,
    [memberId, email]
  );

  const row = res.rows[0];
  if (!row) return null;

  await pool.query(`UPDATE affiliates SET member_id = $2 WHERE id = $1 AND member_id IS NULL`, [
    row.id,
    memberId,
  ]);

  return row;
}
