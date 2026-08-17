import { Request, Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool";
import { env } from "../../config/env";
import { asyncHandler } from "../../utils/asyncHandler";
import { badRequest, notFound, unauthorized } from "../../utils/httpError";
import { denyImpersonation } from "../../middleware/memberAuth";
import {
  affiliateForMember,
  affiliateSettings,
  type AffiliateIdentity,
} from "../../services/affiliates";
import { safeInternalPath } from "../public/affiliateTracking";

/**
 * The partner's own dashboard.
 *
 * Every handler below resolves the partner from the SESSION and never from the
 * request, and every query is filtered on that id. There is no route here that
 * takes an affiliate id, because a route that takes one is a route somebody will
 * eventually forget to check.
 *
 * Where a row is asked for by id — a link, a payout — a row belonging to
 * somebody else is a **404**, not a 403. A 403 is an answer: it confirms the row
 * exists, and walking the ids then tells you how many partners a business has
 * and how many payouts it has made. "Not found" tells you nothing you did not
 * already know.
 */
export const memberAffiliateRouter = Router();

/**
 * The partner record for this session, or a 404.
 *
 * A signed-in member who is not a partner is not an error condition anywhere
 * except here — the overview handles it explicitly and answers with a null
 * partner, so the portal can invite them to apply instead of showing them a
 * failure.
 */
async function requirePartner(req: Request): Promise<AffiliateIdentity> {
  if (!req.member) throw unauthorized("Please sign in to continue");
  const partner = await affiliateForMember(req.member.id, req.member.email);
  if (!partner) throw notFound("You're not part of the partner program yet.");
  return partner;
}

/** The link a partner shares. Built here so it is spelled one way everywhere. */
function shareLink(code: string, path?: string): string {
  const base = `${env.publicSiteUrl}/api/ref/${encodeURIComponent(code)}`;
  const destination = safeInternalPath(path, "");
  return destination && destination !== "/"
    ? `${base}?to=${encodeURIComponent(destination)}`
    : base;
}

/* ------------------------------------------------------------- overview */

interface StatsRow {
  clicks: number;
  referred: number;
  earned_cents: number;
  paid_cents: number;
  payable_cents: number;
  pending_cents: number;
}

/**
 * GET /api/member/affiliate
 *
 * Everything the top of the portal shows. `payable` and `pending` are separated
 * because they answer different questions: pending is money earned that is still
 * inside the refund window, payable is money that has cleared it and is waiting
 * on the next payout run. Collapsing them into one "balance" is how a partner
 * ends up asking why they were not paid what the page said they had.
 */
memberAffiliateRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    if (!req.member) throw unauthorized("Please sign in to continue");

    const partner = await affiliateForMember(req.member.id, req.member.email);
    const settings = await affiliateSettings();

    if (!partner) {
      res.json({
        partner: null,
        program: {
          commission:
            settings.defaultCommissionType === "fixed"
              ? { kind: "fixed", amountCents: settings.defaultFixedCents }
              : { kind: "percent", percent: settings.defaultRateBps / 100 },
          cookieWindowDays: settings.cookieWindowDays,
          termsMd: settings.termsMd,
        },
      });
      return;
    }

    const statsRes = await pool.query<StatsRow>(
      `SELECT
         (SELECT COUNT(*)::int FROM affiliate_clicks c WHERE c.affiliate_id = $1) AS clicks,
         (SELECT COUNT(DISTINCT o.id)::int FROM orders o
           WHERE o.affiliate_id = $1 AND o.status IN ('paid','refunded')) AS referred,
         COALESCE((SELECT SUM(k.amount_cents) FROM affiliate_commissions k
                    WHERE k.affiliate_id = $1 AND k.status <> 'void'), 0)::int AS earned_cents,
         COALESCE((SELECT SUM(k.amount_cents) FROM affiliate_commissions k
                    WHERE k.affiliate_id = $1 AND k.status = 'paid'), 0)::int AS paid_cents,
         -- Cleared the refund window and not yet paid.
         COALESCE((SELECT SUM(k.amount_cents) FROM affiliate_commissions k
                    WHERE k.affiliate_id = $1 AND k.status IN ('pending','approved')
                      AND (k.payable_at IS NULL OR k.payable_at <= now())), 0)::int AS payable_cents,
         -- Earned, but still inside it.
         COALESCE((SELECT SUM(k.amount_cents) FROM affiliate_commissions k
                    WHERE k.affiliate_id = $1 AND k.status IN ('pending','approved')
                      AND k.payable_at IS NOT NULL AND k.payable_at > now()), 0)::int AS pending_cents
       `,
      [partner.id]
    );
    const stats = statsRes.rows[0];

    const commissionRes = await pool.query<{
      commission_type: string;
      commission_rate: number;
      commission_fixed_cents: number;
      recurring_commission: boolean;
      cookie_window_days: number;
      payout_method: string;
      payout_details: string;
    }>(
      `SELECT commission_type, commission_rate, commission_fixed_cents,
              recurring_commission, cookie_window_days, payout_method, payout_details
         FROM affiliates WHERE id = $1`,
      [partner.id]
    );
    const own = commissionRes.rows[0];

    res.json({
      partner: {
        name: partner.name,
        email: partner.email,
        status: partner.status,
        code: partner.code,
        shareLink: shareLink(partner.code),
        payoutMethod: own.payout_method,
        payoutDetails: own.payout_details,
      },
      commission:
        own.commission_type === "fixed"
          ? { kind: "fixed", amountCents: own.commission_fixed_cents }
          : { kind: "percent", percent: own.commission_rate / 100 },
      recurring: own.recurring_commission,
      cookieWindowDays: own.cookie_window_days,
      holdDays: settings.holdDays,
      termsMd: settings.termsMd,
      stats: {
        clicks: stats.clicks,
        referred: stats.referred,
        earnedCents: stats.earned_cents,
        paidCents: stats.paid_cents,
        payableCents: stats.payable_cents,
        pendingCents: stats.pending_cents,
      },
    });
  })
);

/* ---------------------------------------------------------------- links */

memberAffiliateRouter.get(
  "/links",
  asyncHandler(async (req, res) => {
    const partner = await requirePartner(req);

    const result = await pool.query<{
      id: number;
      label: string;
      destination_path: string;
      click_count: number;
      created_at: Date;
      offer_title: string | null;
    }>(
      `SELECT l.id, l.label, l.destination_path, l.click_count, l.created_at,
              o.title AS offer_title
         FROM affiliate_links l
         LEFT JOIN offers o ON o.id = l.offer_id
        WHERE l.affiliate_id = $1
        ORDER BY l.created_at DESC`,
      [partner.id]
    );

    res.json({
      links: result.rows.map((row) => ({
        id: row.id,
        label: row.label,
        destinationPath: row.destination_path,
        offerTitle: row.offer_title,
        clicks: row.click_count,
        createdAt: row.created_at,
        url: shareLink(partner.code, row.destination_path),
      })),
    });
  })
);

const MAX_LINKS = 100;

const linkSchema = z.object({
  label: z.string().trim().max(120).optional(),
  /** A path on this site. Anything else is refused rather than silently rewritten. */
  destinationPath: z.string().trim().max(400),
});

memberAffiliateRouter.post(
  "/links",
  denyImpersonation,
  asyncHandler(async (req, res) => {
    const partner = await requirePartner(req);

    const parsed = linkSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Invalid link", parsed.error.flatten());

    const destination = safeInternalPath(parsed.data.destinationPath, "");
    if (!destination) {
      throw badRequest("That has to be a page on this site, starting with a /");
    }

    // A partner with ten thousand links is somebody scripting the endpoint, not
    // somebody promoting anything.
    const count = await pool.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM affiliate_links WHERE affiliate_id = $1`,
      [partner.id]
    );
    if ((count.rows[0]?.count ?? 0) >= MAX_LINKS) {
      throw badRequest("You've reached the maximum number of links.");
    }

    // The offer is derived from the path rather than accepted from the body, so
    // a link can never claim to be for an offer it does not point at.
    const created = await pool.query<{ id: number; created_at: Date }>(
      `INSERT INTO affiliate_links (affiliate_id, offer_id, label, destination_path)
       VALUES ($1,
               (SELECT id FROM offers
                 WHERE status = 'published' AND $2 = '/checkout/' || slug),
               $3, $2)
       RETURNING id, created_at`,
      [partner.id, destination, (parsed.data.label ?? "").slice(0, 120)]
    );

    res.status(201).json({
      id: created.rows[0].id,
      label: parsed.data.label ?? "",
      destinationPath: destination,
      clicks: 0,
      createdAt: created.rows[0].created_at,
      url: shareLink(partner.code, destination),
    });
  })
);

const idParam = z.object({ id: z.string().regex(/^\d{1,9}$/) });

memberAffiliateRouter.delete(
  "/links/:id",
  denyImpersonation,
  asyncHandler(async (req, res) => {
    const partner = await requirePartner(req);
    const params = idParam.safeParse(req.params);
    if (!params.success) throw notFound("Link not found");

    // The affiliate id is in the WHERE clause, not checked afterwards: somebody
    // else's link simply does not match, and the answer is the same 404 a link
    // that never existed gets.
    const deleted = await pool.query(
      `DELETE FROM affiliate_links WHERE id = $1 AND affiliate_id = $2`,
      [Number(params.data.id), partner.id]
    );
    if ((deleted.rowCount ?? 0) === 0) throw notFound("Link not found");

    res.status(204).end();
  })
);

/* --------------------------------------------------------------- assets */

memberAffiliateRouter.get(
  "/assets",
  asyncHandler(async (req, res) => {
    await requirePartner(req);

    const result = await pool.query<{
      id: number;
      title: string;
      kind: string;
      url: string;
      body_md: string;
      offer_title: string | null;
    }>(
      `SELECT a.id, a.title, a.kind, a.url, a.body_md, o.title AS offer_title
         FROM affiliate_assets a
         LEFT JOIN offers o ON o.id = a.offer_id
        ORDER BY a.sort, a.id`
    );

    res.json({
      assets: result.rows.map((row) => ({
        id: row.id,
        title: row.title,
        kind: row.kind,
        url: row.url,
        bodyMd: row.body_md,
        offerTitle: row.offer_title,
      })),
    });
  })
);

/* -------------------------------------------------------- announcements */

memberAffiliateRouter.get(
  "/announcements",
  asyncHandler(async (req, res) => {
    await requirePartner(req);

    const result = await pool.query<{
      id: number;
      title: string;
      body_md: string;
      published_at: Date | null;
    }>(
      `SELECT id, title, body_md, published_at
         FROM affiliate_announcements
        WHERE published = true
        ORDER BY COALESCE(published_at, created_at) DESC
        LIMIT 50`
    );

    res.json({
      announcements: result.rows.map((row) => ({
        id: row.id,
        title: row.title,
        bodyMd: row.body_md,
        publishedAt: row.published_at,
      })),
    });
  })
);

/* --------------------------------------------------------- transactions */

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});

/**
 * GET /api/member/affiliate/transactions
 *
 * The partner's own ledger, clawbacks included. A reversal stays on the list
 * with its own row: a statement that quietly drops the refunded sale is one the
 * partner cannot reconcile against the total they were paid.
 */
memberAffiliateRouter.get(
  "/transactions",
  asyncHandler(async (req, res) => {
    const partner = await requirePartner(req);
    const parsed = listQuery.safeParse(req.query);
    if (!parsed.success) throw badRequest("Invalid query", parsed.error.flatten());
    const { limit, offset } = parsed.data;

    const [rows, total] = await Promise.all([
      pool.query<{
        id: string;
        kind: string;
        status: string;
        amount_cents: number;
        basis_cents: number;
        currency: string;
        payable_at: Date | null;
        created_at: Date;
        offer_title: string | null;
      }>(
        `SELECT k.id, k.kind, k.status, k.amount_cents, k.basis_cents, k.currency,
                k.payable_at, k.created_at, o.title AS offer_title
           FROM affiliate_commissions k
           LEFT JOIN offers o ON o.id = k.offer_id
          WHERE k.affiliate_id = $1
          ORDER BY k.created_at DESC, k.id DESC
          LIMIT $2 OFFSET $3`,
        [partner.id, limit, offset]
      ),
      pool.query<{ count: number }>(
        `SELECT COUNT(*)::int AS count FROM affiliate_commissions WHERE affiliate_id = $1`,
        [partner.id]
      ),
    ]);

    res.json({
      transactions: rows.rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        status: row.status,
        amountCents: row.amount_cents,
        // What the commission was worked out from — never the customer's name,
        // their address or what else was in the order.
        basisCents: row.basis_cents,
        currency: row.currency,
        payableAt: row.payable_at,
        createdAt: row.created_at,
        offerTitle: row.offer_title,
      })),
      total: total.rows[0]?.count ?? 0,
    });
  })
);

/* -------------------------------------------------------------- payouts */

memberAffiliateRouter.get(
  "/payouts",
  asyncHandler(async (req, res) => {
    const partner = await requirePartner(req);
    const parsed = listQuery.safeParse(req.query);
    if (!parsed.success) throw badRequest("Invalid query", parsed.error.flatten());

    const result = await pool.query<{
      id: number;
      amount_cents: number;
      currency: string;
      method: string;
      reference: string;
      status: string;
      period_start: Date | null;
      period_end: Date | null;
      paid_at: Date | null;
      created_at: Date;
    }>(
      `SELECT id, amount_cents, currency, method, reference, status,
              period_start, period_end, paid_at, created_at
         FROM affiliate_payouts
        WHERE affiliate_id = $1
        ORDER BY created_at DESC
        LIMIT $2 OFFSET $3`,
      [partner.id, parsed.data.limit, parsed.data.offset]
    );

    res.json({
      payouts: result.rows.map((row) => ({
        id: row.id,
        amountCents: row.amount_cents,
        currency: row.currency,
        method: row.method,
        reference: row.reference,
        status: row.status,
        periodStart: row.period_start,
        periodEnd: row.period_end,
        paidAt: row.paid_at,
        createdAt: row.created_at,
      })),
    });
  })
);

/* -------------------------------------------------------- payout details */

const payoutDetailsSchema = z.object({
  payoutMethod: z.string().trim().max(120),
  payoutDetails: z.string().trim().max(500),
});

/**
 * PUT /api/member/affiliate/payout-details
 *
 * Where the partner wants their money sent. Behind `denyImpersonation` like
 * every other write on this router: an admin viewing the site as a partner must
 * not be able to redirect that partner's payouts, with nothing in the log to
 * show which of the two people did it.
 */
memberAffiliateRouter.put(
  "/payout-details",
  denyImpersonation,
  asyncHandler(async (req, res) => {
    const partner = await requirePartner(req);
    const parsed = payoutDetailsSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Invalid payment details", parsed.error.flatten());

    await pool.query(
      `UPDATE affiliates SET payout_method = $2, payout_details = $3, updated_at = now()
        WHERE id = $1`,
      [partner.id, parsed.data.payoutMethod, parsed.data.payoutDetails]
    );

    res.json({ payoutMethod: parsed.data.payoutMethod, payoutDetails: parsed.data.payoutDetails });
  })
);
