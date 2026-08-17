import { Router } from "express";
import { z } from "zod";
import type { PoolClient } from "pg";
import { pool } from "../../db/pool";
import { env } from "../../config/env";
import { asyncHandler } from "../../utils/asyncHandler";
import { badRequest, notFound } from "../../utils/httpError";
import { recordAdminAction } from "../../services/adminAudit";
import {
  affiliateSettings,
  generateAffiliateCode,
  upsertCommissionRule,
  writeAffiliateSettings,
} from "../../services/affiliates";
import { safeInternalPath } from "../public/affiliateTracking";

/**
 * The owner's view of the partner program.
 *
 * Written for one reader who is not technical, which shapes the API and not
 * just the screen: nothing here answers in basis points, cents-as-integers are
 * accompanied by the figures a person actually types, and a commission is
 * described as "30% of each sale" rather than as a type/rate pair she would have
 * to assemble in her head. The frontend renders what this returns; it does not
 * translate machine vocabulary into English, because two places doing that is
 * how one of them drifts.
 */
export const adminAffiliatesRouter = Router();

/* ------------------------------------------------------------- helpers */

/**
 * A commission in the words it will be read in.
 *
 * `percent` is a real number of percent (30, not 3000 and not 0.3) — the API
 * boundary is where basis points stop, so no screen ever has to know they
 * existed.
 */
function describeCommission(
  type: string,
  rateBps: number,
  fixedCents: number
): { kind: "percent" | "fixed" | "none"; percent?: number; amountCents?: number; label: string } {
  if (type === "none") return { kind: "none", label: "Nothing" };
  if (type === "fixed") {
    return {
      kind: "fixed",
      amountCents: fixedCents,
      label: `$${(fixedCents / 100).toFixed(2)} per sale`,
    };
  }
  const percent = rateBps / 100;
  return { kind: "percent", percent, label: `${percent}% of each sale` };
}

/**
 * Escapes one CSV field, against two separate problems.
 *
 * The first is CSV syntax: quote every field and double any quote inside it, so
 * a comma or a newline in a partner's payment details cannot shift the
 * remaining columns.
 *
 * The second is that Excel and Sheets read a leading =, +, - or @ as the start
 * of a formula, and a partner's name and payment details are whatever a stranger
 * typed into a public application form. The apostrophe forces the cell to be
 * read as text and is not part of the value. Tab and carriage return lead the
 * same way in some locales, so they are covered too.
 */
function csvCell(value: unknown): string {
  const raw = value === null || value === undefined ? "" : String(value);
  const guarded = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return `"${guarded.replace(/"/g, '""')}"`;
}

const idParam = z.object({ id: z.string().regex(/^\d{1,9}$/) });

function parseId(params: unknown, label: string): number {
  const parsed = idParam.safeParse(params);
  if (!parsed.success) throw notFound(`${label} not found`);
  return Number(parsed.data.id);
}

/* ------------------------------------------------------------ settings */

/**
 * GET /api/admin/affiliates/settings
 *
 * The program's own rules. Every field comes back in the unit it is typed in.
 */
adminAffiliatesRouter.get(
  "/settings",
  asyncHandler(async (_req, res) => {
    const settings = await affiliateSettings();
    res.json({
      whoGetsCredit: settings.attribution,
      cookieWindowDays: settings.cookieWindowDays,
      holdDays: settings.holdDays,
      commissionKind: settings.defaultCommissionType,
      commissionPercent: settings.defaultRateBps / 100,
      commissionAmountCents: settings.defaultFixedCents,
      payOnEveryRenewal: settings.recurringCommission,
      autoApprove: settings.autoApprove,
      landingPath: settings.landingPath,
      termsMd: settings.termsMd,
      pitchMd: settings.pitchMd,
    });
  })
);

const settingsSchema = z
  .object({
    whoGetsCredit: z.enum(["last_click", "first_click"]),
    cookieWindowDays: z.number().int().min(1).max(365),
    holdDays: z.number().int().min(0).max(365),
    commissionKind: z.enum(["percent", "fixed"]),
    /** Typed as percent. Converted to basis points on the way in, and only here. */
    commissionPercent: z.number().min(0).max(100),
    commissionAmountCents: z.number().int().min(0).max(10_000_000),
    payOnEveryRenewal: z.boolean(),
    autoApprove: z.boolean(),
    landingPath: z.string().trim().max(400),
    termsMd: z.string().max(20_000),
    pitchMd: z.string().max(20_000),
  })
  .partial();

adminAffiliatesRouter.put(
  "/settings",
  asyncHandler(async (req, res) => {
    const parsed = settingsSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Invalid settings", parsed.error.flatten());
    const body = parsed.data;

    if (body.landingPath !== undefined && !safeInternalPath(body.landingPath, "")) {
      throw badRequest("The landing page has to be a page on this site, starting with a /");
    }

    const patch = {
      ...(body.whoGetsCredit !== undefined ? { attribution: body.whoGetsCredit } : {}),
      ...(body.cookieWindowDays !== undefined ? { cookieWindowDays: body.cookieWindowDays } : {}),
      ...(body.holdDays !== undefined ? { holdDays: body.holdDays } : {}),
      ...(body.commissionKind !== undefined
        ? { defaultCommissionType: body.commissionKind }
        : {}),
      ...(body.commissionPercent !== undefined
        ? { defaultRateBps: Math.round(body.commissionPercent * 100) }
        : {}),
      ...(body.commissionAmountCents !== undefined
        ? { defaultFixedCents: body.commissionAmountCents }
        : {}),
      ...(body.payOnEveryRenewal !== undefined
        ? { recurringCommission: body.payOnEveryRenewal }
        : {}),
      ...(body.autoApprove !== undefined ? { autoApprove: body.autoApprove } : {}),
      ...(body.landingPath !== undefined ? { landingPath: body.landingPath } : {}),
      ...(body.termsMd !== undefined ? { termsMd: body.termsMd } : {}),
      ...(body.pitchMd !== undefined ? { pitchMd: body.pitchMd } : {}),
    };

    const saved = await writeAffiliateSettings(patch);
    await recordAdminAction({
      req,
      action: "affiliate.settings_update",
      entityType: "affiliate_settings",
      entityId: "program",
      after: patch,
    });

    res.json({
      whoGetsCredit: saved.attribution,
      cookieWindowDays: saved.cookieWindowDays,
      holdDays: saved.holdDays,
      commissionKind: saved.defaultCommissionType,
      commissionPercent: saved.defaultRateBps / 100,
      commissionAmountCents: saved.defaultFixedCents,
      payOnEveryRenewal: saved.recurringCommission,
      autoApprove: saved.autoApprove,
      landingPath: saved.landingPath,
      termsMd: saved.termsMd,
      pitchMd: saved.pitchMd,
    });
  })
);

/* --------------------------------------------------------- leaderboard */

/**
 * GET /api/admin/affiliates/leaderboard
 *
 * Who is actually selling. Ordered by money earned rather than by clicks: a
 * partner with fifty thousand clicks and no sales is not the top of any list
 * worth looking at.
 */
adminAffiliatesRouter.get(
  "/leaderboard",
  asyncHandler(async (_req, res) => {
    const result = await pool.query<{
      id: number;
      name: string;
      email: string;
      clicks: number;
      referred: number;
      earned_cents: number;
      revenue_cents: number;
    }>(
      `SELECT a.id, a.name, a.email::text AS email,
              a.click_count AS clicks, a.referred_count AS referred, a.earned_cents,
              COALESCE((SELECT SUM(GREATEST(o.total_cents, o.amount_cents) - o.refunded_cents)
                          FROM orders o
                         WHERE o.affiliate_id = a.id
                           AND o.status IN ('paid','refunded')), 0)::int AS revenue_cents
         FROM affiliates a
        WHERE a.status = 'approved'
        ORDER BY a.earned_cents DESC, a.referred_count DESC
        LIMIT 50`
    );

    res.json({
      partners: result.rows.map((row) => ({
        id: row.id,
        name: row.name || row.email,
        email: row.email,
        clicks: row.clicks,
        sales: row.referred,
        earnedCents: row.earned_cents,
        revenueCents: row.revenue_cents,
      })),
    });
  })
);

/* -------------------------------------------------------- transactions */

const transactionsQuery = z.object({
  affiliateId: z.coerce.number().int().positive().optional(),
  status: z.enum(["pending", "approved", "paid", "reversed", "void"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});

adminAffiliatesRouter.get(
  "/transactions",
  asyncHandler(async (req, res) => {
    const parsed = transactionsQuery.safeParse(req.query);
    if (!parsed.success) throw badRequest("Invalid query", parsed.error.flatten());
    const { affiliateId, status, limit, offset } = parsed.data;

    const filters: string[] = [];
    const params: unknown[] = [];
    if (affiliateId !== undefined) {
      params.push(affiliateId);
      filters.push(`k.affiliate_id = $${params.length}`);
    }
    if (status !== undefined) {
      params.push(status);
      filters.push(`k.status = $${params.length}`);
    }
    const where = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";

    const [rows, total] = await Promise.all([
      pool.query<{
        id: string;
        affiliate_id: number;
        partner_name: string;
        partner_email: string;
        kind: string;
        status: string;
        amount_cents: number;
        basis_cents: number;
        currency: string;
        payable_at: Date | null;
        created_at: Date;
        offer_title: string | null;
        order_id: number | null;
        customer_email: string | null;
      }>(
        `SELECT k.id, k.affiliate_id, a.name AS partner_name, a.email::text AS partner_email,
                k.kind, k.status, k.amount_cents, k.basis_cents, k.currency,
                k.payable_at, k.created_at, o.title AS offer_title,
                k.order_id, ord.email AS customer_email
           FROM affiliate_commissions k
           JOIN affiliates a ON a.id = k.affiliate_id
           LEFT JOIN offers o  ON o.id = k.offer_id
           LEFT JOIN orders ord ON ord.id = k.order_id
           ${where}
          ORDER BY k.created_at DESC, k.id DESC
          LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset]
      ),
      pool.query<{ count: number }>(
        `SELECT COUNT(*)::int AS count FROM affiliate_commissions k ${where}`,
        params
      ),
    ]);

    res.json({
      transactions: rows.rows.map((row) => ({
        id: row.id,
        affiliateId: row.affiliate_id,
        partnerName: row.partner_name || row.partner_email,
        kind: row.kind,
        status: row.status,
        amountCents: row.amount_cents,
        basisCents: row.basis_cents,
        currency: row.currency,
        payableAt: row.payable_at,
        createdAt: row.created_at,
        offerTitle: row.offer_title,
        orderId: row.order_id,
        customerEmail: row.customer_email,
      })),
      total: total.rows[0]?.count ?? 0,
    });
  })
);

/* -------------------------------------------------------------- payouts */

interface PayableRow {
  affiliate_id: number;
  name: string;
  email: string;
  payout_method: string;
  payout_details: string;
  currency: string;
  amount_cents: number;
  rows: number;
}

/**
 * What each partner is owed right now.
 *
 * Only commissions past `payable_at` — the refund window — and clawbacks, which
 * are payable the moment they exist. The sum is over the WHOLE ledger for the
 * partner, so a refunded sale reduces what the next payout hands over rather
 * than needing to be chased afterwards.
 *
 * Partners whose balance nets to zero or less are excluded: nobody wants a
 * payment run with a $0.00 line on it.
 *
 * `payout_id IS NULL` is load-bearing and not an optimisation. A commission
 * attached to a payout that has been prepared but not yet marked as sent is
 * still `approved`, so without this it would be counted again on the next run
 * and handed to a second payout — the partner paid twice for one sale, with two
 * payouts each claiming the same rows.
 *
 * Currencies are summed together, which is right for this business (every offer
 * is priced in one currency) and would need splitting the day that stops being
 * true.
 */
async function payableBalances(client?: PoolClient): Promise<PayableRow[]> {
  const db = client ?? pool;
  const result = await db.query<PayableRow>(
    `SELECT k.affiliate_id, a.name, a.email::text AS email,
            a.payout_method, a.payout_details,
            MIN(k.currency) AS currency,
            SUM(k.amount_cents)::int AS amount_cents,
            COUNT(*)::int AS rows
       FROM affiliate_commissions k
       JOIN affiliates a ON a.id = k.affiliate_id
      WHERE k.status IN ('pending','approved')
        AND k.payout_id IS NULL
        AND (k.payable_at IS NULL OR k.payable_at <= now())
      GROUP BY k.affiliate_id, a.name, a.email, a.payout_method, a.payout_details
     HAVING SUM(k.amount_cents) > 0
      ORDER BY SUM(k.amount_cents) DESC`
  );
  return result.rows;
}

/**
 * GET /api/admin/affiliates/payouts/due
 *
 * The "who do I owe" screen, before anything is committed.
 */
adminAffiliatesRouter.get(
  "/payouts/due",
  asyncHandler(async (_req, res) => {
    const rows = await payableBalances();
    res.json({
      due: rows.map((row) => ({
        affiliateId: row.affiliate_id,
        name: row.name || row.email,
        email: row.email,
        payoutMethod: row.payout_method,
        payoutDetails: row.payout_details,
        amountCents: row.amount_cents,
        currency: row.currency,
        commissionCount: row.rows,
      })),
      totalCents: rows.reduce((sum, row) => sum + row.amount_cents, 0),
    });
  })
);

const CSV_HEADERS = [
  "Partner",
  "Email",
  "How they want to be paid",
  "Payment details",
  "Amount",
  "Currency",
  "Commissions included",
];

/**
 * GET /api/admin/affiliates/payouts/export.csv
 *
 * The file handed to whoever actually sends the money. Registered ahead of
 * `/payouts/:id` and distinct from it by shape, so it is never read as an id.
 */
adminAffiliatesRouter.get(
  "/payouts/export.csv",
  asyncHandler(async (req, res) => {
    const rows = await payableBalances();

    const lines = [CSV_HEADERS.map(csvCell).join(",")];
    for (const row of rows) {
      lines.push(
        [
          row.name || row.email,
          row.email,
          row.payout_method,
          row.payout_details,
          // Dollars, not the integer of cents the database keeps — this file is
          // opened by somebody who thinks in money.
          (row.amount_cents / 100).toFixed(2),
          row.currency.toUpperCase(),
          row.rows,
        ]
          .map(csvCell)
          .join(",")
      );
    }

    await recordAdminAction({
      req,
      action: "affiliate.payout_export_csv",
      entityType: "affiliate_payout",
      entityId: "",
      after: { rows: rows.length },
    });

    const filename = `partner-payments-${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    // The BOM is for Excel, which otherwise reads the file in the local ANSI
    // codepage and turns every accented name into mojibake.
    res.send(`\uFEFF${lines.join("\r\n")}\r\n`);
  })
);

adminAffiliatesRouter.get(
  "/payouts",
  asyncHandler(async (_req, res) => {
    const result = await pool.query<{
      id: number;
      affiliate_id: number;
      name: string;
      email: string;
      amount_cents: number;
      currency: string;
      method: string;
      reference: string;
      status: string;
      paid_at: Date | null;
      created_at: Date;
    }>(
      `SELECT p.id, p.affiliate_id, a.name, a.email::text AS email, p.amount_cents,
              p.currency, p.method, p.reference, p.status, p.paid_at, p.created_at
         FROM affiliate_payouts p
         JOIN affiliates a ON a.id = p.affiliate_id
        ORDER BY p.created_at DESC
        LIMIT 200`
    );

    res.json({
      payouts: result.rows.map((row) => ({
        id: row.id,
        affiliateId: row.affiliate_id,
        name: row.name || row.email,
        email: row.email,
        amountCents: row.amount_cents,
        currency: row.currency,
        method: row.method,
        reference: row.reference,
        status: row.status,
        paidAt: row.paid_at,
        createdAt: row.created_at,
      })),
    });
  })
);

const createPayoutSchema = z.object({
  affiliateId: z.number().int().positive(),
  method: z.string().trim().max(120).optional(),
  reference: z.string().trim().max(200).optional(),
  note: z.string().trim().max(1000).optional(),
});

/**
 * POST /api/admin/affiliates/payouts
 *
 * Draws a line under everything a partner is currently owed and opens a payout
 * for it.
 *
 * The commission rows are attached to the payout inside the same transaction
 * that creates it, and only the rows that were payable when the total was
 * computed. Without that, a commission accruing between the sum and the update
 * would be marked as paid by a payout whose amount never included it — money
 * the partner would never see again, because the row would look settled.
 */
adminAffiliatesRouter.post(
  "/payouts",
  asyncHandler(async (req, res) => {
    const parsed = createPayoutSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Invalid payout", parsed.error.flatten());
    const body = parsed.data;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const affiliate = await client.query<{ id: number; payout_method: string }>(
        `SELECT id, payout_method FROM affiliates WHERE id = $1 FOR UPDATE`,
        [body.affiliateId]
      );
      if (!affiliate.rows[0]) {
        await client.query("ROLLBACK");
        throw notFound("Partner not found");
      }

      const due = await client.query<{ id: string; amount_cents: number; currency: string }>(
        `SELECT id, amount_cents, currency
           FROM affiliate_commissions
          WHERE affiliate_id = $1
            AND status IN ('pending','approved')
            -- Never a row some other payout has already claimed.
            AND payout_id IS NULL
            AND (payable_at IS NULL OR payable_at <= now())
          ORDER BY id
          FOR UPDATE`,
        [body.affiliateId]
      );

      const amountCents = due.rows.reduce((sum, row) => sum + row.amount_cents, 0);
      if (due.rows.length === 0 || amountCents <= 0) {
        await client.query("ROLLBACK");
        throw badRequest("There's nothing to pay this partner right now.");
      }

      const payout = await client.query<{ id: number }>(
        `INSERT INTO affiliate_payouts
           (affiliate_id, amount_cents, currency, method, reference, status, period_start, period_end, note)
         VALUES ($1,$2,$3,$4,$5,'pending',
                 (SELECT MIN(created_at) FROM affiliate_commissions WHERE id = ANY($6::bigint[])),
                 now(), $7)
         RETURNING id`,
        [
          body.affiliateId,
          amountCents,
          due.rows[0].currency || "usd",
          body.method ?? affiliate.rows[0].payout_method,
          body.reference ?? "",
          due.rows.map((row) => row.id),
          body.note ?? "",
        ]
      );

      await client.query(
        `UPDATE affiliate_commissions
            SET payout_id = $1, status = 'approved', updated_at = now()
          WHERE id = ANY($2::bigint[])`,
        [payout.rows[0].id, due.rows.map((row) => row.id)]
      );

      await client.query("COMMIT");

      await recordAdminAction({
        req,
        action: "affiliate.payout_create",
        entityType: "affiliate_payout",
        entityId: payout.rows[0].id,
        after: { affiliateId: body.affiliateId, amountCents, commissions: due.rows.length },
      });

      res.status(201).json({ id: payout.rows[0].id, amountCents, commissionCount: due.rows.length });
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  })
);

const markPaidSchema = z.object({
  reference: z.string().trim().max(200).optional(),
  method: z.string().trim().max(120).optional(),
});

/**
 * POST /api/admin/affiliates/payouts/:id/paid
 *
 * Records that the money actually left. Guarded on the payout still being
 * pending, so a double click does not restate `paid_at` and does not mark a
 * second batch of commissions as settled.
 */
adminAffiliatesRouter.post(
  "/payouts/:id/paid",
  asyncHandler(async (req, res) => {
    const payoutId = parseId(req.params, "Payout");
    const parsed = markPaidSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw badRequest("Invalid payout", parsed.error.flatten());

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const updated = await client.query<{ id: number; amount_cents: number }>(
        `UPDATE affiliate_payouts
            SET status = 'paid', paid_at = now(),
                reference = CASE WHEN $2 <> '' THEN $2 ELSE reference END,
                method    = CASE WHEN $3 <> '' THEN $3 ELSE method END
          WHERE id = $1 AND status = 'pending'
          RETURNING id, amount_cents`,
        [payoutId, parsed.data.reference ?? "", parsed.data.method ?? ""]
      );
      if (!updated.rows[0]) {
        await client.query("ROLLBACK");
        throw notFound("Payout not found");
      }

      await client.query(
        `UPDATE affiliate_commissions SET status = 'paid', updated_at = now()
          WHERE payout_id = $1 AND status <> 'void'`,
        [payoutId]
      );

      await client.query("COMMIT");

      await recordAdminAction({
        req,
        action: "affiliate.payout_paid",
        entityType: "affiliate_payout",
        entityId: payoutId,
        after: { amountCents: updated.rows[0].amount_cents },
      });

      res.json({ id: payoutId, status: "paid" });
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  })
);

/* -------------------------------------------------------- announcements */

adminAffiliatesRouter.get(
  "/announcements",
  asyncHandler(async (_req, res) => {
    const result = await pool.query<{
      id: number;
      title: string;
      body_md: string;
      published: boolean;
      published_at: Date | null;
      created_at: Date;
    }>(
      `SELECT id, title, body_md, published, published_at, created_at
         FROM affiliate_announcements ORDER BY created_at DESC`
    );
    res.json({
      announcements: result.rows.map((row) => ({
        id: row.id,
        title: row.title,
        bodyMd: row.body_md,
        published: row.published,
        publishedAt: row.published_at,
        createdAt: row.created_at,
      })),
    });
  })
);

const announcementSchema = z.object({
  title: z.string().trim().min(1).max(200),
  bodyMd: z.string().max(20_000).default(""),
  published: z.boolean().default(false),
});

adminAffiliatesRouter.post(
  "/announcements",
  asyncHandler(async (req, res) => {
    const parsed = announcementSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Invalid announcement", parsed.error.flatten());

    const created = await pool.query<{ id: number }>(
      `INSERT INTO affiliate_announcements (title, body_md, published, published_at)
       VALUES ($1,$2,$3, CASE WHEN $3 THEN now() ELSE NULL END)
       RETURNING id`,
      [parsed.data.title, parsed.data.bodyMd, parsed.data.published]
    );

    await recordAdminAction({
      req,
      action: "affiliate.announcement_create",
      entityType: "affiliate_announcement",
      entityId: created.rows[0].id,
      after: parsed.data,
    });

    res.status(201).json({ id: created.rows[0].id, ...parsed.data });
  })
);

adminAffiliatesRouter.patch(
  "/announcements/:id",
  asyncHandler(async (req, res) => {
    const announcementId = parseId(req.params, "Announcement");
    const parsed = announcementSchema.partial().safeParse(req.body);
    if (!parsed.success) throw badRequest("Invalid announcement", parsed.error.flatten());
    const body = parsed.data;

    const updated = await pool.query<{ id: number }>(
      `UPDATE affiliate_announcements
          SET title     = COALESCE($2, title),
              body_md   = COALESCE($3, body_md),
              published = COALESCE($4, published),
              -- Stamped the first time it goes live and never restated, so the
              -- partner list does not reshuffle every time a typo is fixed.
              published_at = CASE
                               WHEN COALESCE($4, published) AND published_at IS NULL THEN now()
                               WHEN COALESCE($4, published) = false THEN NULL
                               ELSE published_at
                             END,
              updated_at = now()
        WHERE id = $1
        RETURNING id`,
      [announcementId, body.title ?? null, body.bodyMd ?? null, body.published ?? null]
    );
    if (!updated.rows[0]) throw notFound("Announcement not found");

    await recordAdminAction({
      req,
      action: "affiliate.announcement_update",
      entityType: "affiliate_announcement",
      entityId: announcementId,
      after: body,
    });

    res.json({ id: announcementId });
  })
);

adminAffiliatesRouter.delete(
  "/announcements/:id",
  asyncHandler(async (req, res) => {
    const announcementId = parseId(req.params, "Announcement");
    const deleted = await pool.query(`DELETE FROM affiliate_announcements WHERE id = $1`, [
      announcementId,
    ]);
    if ((deleted.rowCount ?? 0) === 0) throw notFound("Announcement not found");

    await recordAdminAction({
      req,
      action: "affiliate.announcement_delete",
      entityType: "affiliate_announcement",
      entityId: announcementId,
    });

    res.status(204).end();
  })
);

/* --------------------------------------------------------------- assets */

adminAffiliatesRouter.get(
  "/assets",
  asyncHandler(async (_req, res) => {
    const result = await pool.query<{
      id: number;
      title: string;
      kind: string;
      url: string;
      body_md: string;
      offer_id: number | null;
      offer_title: string | null;
      sort: number;
    }>(
      `SELECT a.id, a.title, a.kind, a.url, a.body_md, a.offer_id, a.sort, o.title AS offer_title
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
        offerId: row.offer_id,
        offerTitle: row.offer_title,
        sort: row.sort,
      })),
    });
  })
);

const assetSchema = z.object({
  title: z.string().trim().min(1).max(200),
  kind: z.enum(["image", "swipe", "video", "document"]).default("image"),
  url: z.string().trim().max(2000).default(""),
  bodyMd: z.string().max(20_000).default(""),
  offerId: z.number().int().positive().nullable().default(null),
  sort: z.number().int().min(0).max(9999).default(0),
});

adminAffiliatesRouter.post(
  "/assets",
  asyncHandler(async (req, res) => {
    const parsed = assetSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Invalid item", parsed.error.flatten());
    const body = parsed.data;

    const created = await pool.query<{ id: number }>(
      `INSERT INTO affiliate_assets (title, kind, url, body_md, offer_id, sort)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [body.title, body.kind, body.url, body.bodyMd, body.offerId, body.sort]
    );

    await recordAdminAction({
      req,
      action: "affiliate.asset_create",
      entityType: "affiliate_asset",
      entityId: created.rows[0].id,
      after: body,
    });

    res.status(201).json({ id: created.rows[0].id, ...body });
  })
);

adminAffiliatesRouter.patch(
  "/assets/:id",
  asyncHandler(async (req, res) => {
    const assetId = parseId(req.params, "Item");
    const parsed = assetSchema.partial().safeParse(req.body);
    if (!parsed.success) throw badRequest("Invalid item", parsed.error.flatten());
    const body = parsed.data;

    const updated = await pool.query<{ id: number }>(
      `UPDATE affiliate_assets
          SET title    = COALESCE($2, title),
              kind     = COALESCE($3, kind),
              url      = COALESCE($4, url),
              body_md  = COALESCE($5, body_md),
              offer_id = CASE WHEN $6::boolean THEN $7 ELSE offer_id END,
              sort     = COALESCE($8, sort)
        WHERE id = $1
        RETURNING id`,
      [
        assetId,
        body.title ?? null,
        body.kind ?? null,
        body.url ?? null,
        body.bodyMd ?? null,
        // A null offerId is a real edit ("this applies to everything"), which
        // COALESCE cannot express — hence the explicit "was it sent" flag.
        Object.prototype.hasOwnProperty.call(body, "offerId"),
        body.offerId ?? null,
        body.sort ?? null,
      ]
    );
    if (!updated.rows[0]) throw notFound("Item not found");

    await recordAdminAction({
      req,
      action: "affiliate.asset_update",
      entityType: "affiliate_asset",
      entityId: assetId,
      after: body,
    });

    res.json({ id: assetId });
  })
);

adminAffiliatesRouter.delete(
  "/assets/:id",
  asyncHandler(async (req, res) => {
    const assetId = parseId(req.params, "Item");
    const deleted = await pool.query(`DELETE FROM affiliate_assets WHERE id = $1`, [assetId]);
    if ((deleted.rowCount ?? 0) === 0) throw notFound("Item not found");

    await recordAdminAction({
      req,
      action: "affiliate.asset_delete",
      entityType: "affiliate_asset",
      entityId: assetId,
    });

    res.status(204).end();
  })
);

/* ---------------------------------------------------------------- rules */

const ruleSchema = z.object({
  /** Null means "every partner" — the program-wide rule for that offer. */
  affiliateId: z.number().int().positive().nullable().default(null),
  /** Null means "every offer" — that partner's own default. */
  offerId: z.number().int().positive().nullable().default(null),
  kind: z.enum(["percent", "fixed", "none"]),
  percent: z.number().min(0).max(100).default(0),
  amountCents: z.number().int().min(0).max(10_000_000).default(0),
  payOnEveryRenewal: z.boolean().default(false),
});

/**
 * PUT /api/admin/affiliates/rules
 *
 * Creates or replaces one rule. "40% on the retreat" is one fact, and saving it
 * twice must not become two rows that later disagree — see
 * `upsertCommissionRule` for why the obvious `ON CONFLICT` spelling would not
 * have achieved that.
 */
adminAffiliatesRouter.put(
  "/rules",
  asyncHandler(async (req, res) => {
    const parsed = ruleSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Invalid rule", parsed.error.flatten());
    const body = parsed.data;

    if (body.affiliateId === null && body.offerId === null) {
      throw badRequest("A rule has to be for a partner, an offer, or both.");
    }

    const ruleId = await upsertCommissionRule({
      affiliateId: body.affiliateId,
      offerId: body.offerId,
      type: body.kind,
      rateBps: Math.round(body.percent * 100),
      fixedCents: body.amountCents,
      recurring: body.payOnEveryRenewal,
    });

    await recordAdminAction({
      req,
      action: "affiliate.rule_save",
      entityType: "affiliate_commission_rule",
      entityId: ruleId,
      after: body,
    });

    res.json({ id: ruleId });
  })
);

adminAffiliatesRouter.delete(
  "/rules/:id",
  asyncHandler(async (req, res) => {
    const ruleId = parseId(req.params, "Rule");
    const deleted = await pool.query(`DELETE FROM affiliate_commission_rules WHERE id = $1`, [
      ruleId,
    ]);
    if ((deleted.rowCount ?? 0) === 0) throw notFound("Rule not found");

    await recordAdminAction({
      req,
      action: "affiliate.rule_delete",
      entityType: "affiliate_commission_rule",
      entityId: ruleId,
    });

    res.status(204).end();
  })
);

/* ------------------------------------------------------------- partners */

const listQuery = z.object({
  status: z.enum(["pending", "approved", "suspended", "rejected"]).optional(),
  q: z.string().trim().max(200).optional(),
});

/**
 * GET /api/admin/affiliates
 *
 * Every partner, newest application first within a status so the ones waiting
 * on a decision are the first thing she sees.
 */
adminAffiliatesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = listQuery.safeParse(req.query);
    if (!parsed.success) throw badRequest("Invalid query", parsed.error.flatten());

    const filters: string[] = [];
    const params: unknown[] = [];
    if (parsed.data.status) {
      params.push(parsed.data.status);
      filters.push(`a.status = $${params.length}`);
    }
    if (parsed.data.q) {
      params.push(`%${parsed.data.q}%`);
      filters.push(`(a.name ILIKE $${params.length} OR a.email::text ILIKE $${params.length})`);
    }
    const where = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";

    const result = await pool.query<{
      id: number;
      name: string;
      email: string;
      code: string;
      status: string;
      commission_type: string;
      commission_rate: number;
      commission_fixed_cents: number;
      click_count: number;
      referred_count: number;
      earned_cents: number;
      paid_cents: number;
      created_at: Date;
    }>(
      `SELECT a.id, a.name, a.email::text AS email, a.code::text AS code, a.status,
              a.commission_type, a.commission_rate, a.commission_fixed_cents,
              a.click_count, a.referred_count, a.earned_cents, a.paid_cents, a.created_at
         FROM affiliates a
         ${where}
        ORDER BY (a.status = 'pending') DESC, a.created_at DESC`,
      params
    );

    res.json({
      partners: result.rows.map((row) => ({
        id: row.id,
        name: row.name || row.email,
        email: row.email,
        code: row.code,
        status: row.status,
        commission: describeCommission(
          row.commission_type,
          row.commission_rate,
          row.commission_fixed_cents
        ),
        clicks: row.click_count,
        sales: row.referred_count,
        earnedCents: row.earned_cents,
        paidCents: row.paid_cents,
        owedCents: row.earned_cents - row.paid_cents,
        shareLink: `${env.publicSiteUrl}/api/ref/${encodeURIComponent(row.code)}`,
        appliedAt: row.created_at,
      })),
    });
  })
);

/**
 * GET /api/admin/affiliates/:id
 *
 * One partner, everything about them: how they are paid, what they have sold,
 * every rule that applies to them and the last of their referred orders.
 */
adminAffiliatesRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const affiliateId = parseId(req.params, "Partner");

    const affiliateRes = await pool.query<{
      id: number;
      name: string;
      email: string;
      code: string;
      status: string;
      rejected_reason: string;
      commission_type: string;
      commission_rate: number;
      commission_fixed_cents: number;
      recurring_commission: boolean;
      cookie_window_days: number;
      payout_method: string;
      payout_details: string;
      notes: string;
      click_count: number;
      referred_count: number;
      earned_cents: number;
      paid_cents: number;
      created_at: Date;
      approved_at: Date | null;
    }>(
      `SELECT id, name, email::text AS email, code::text AS code, status, rejected_reason,
              commission_type, commission_rate, commission_fixed_cents, recurring_commission,
              cookie_window_days, payout_method, payout_details, notes,
              click_count, referred_count, earned_cents, paid_cents, created_at, approved_at
         FROM affiliates WHERE id = $1`,
      [affiliateId]
    );
    const partner = affiliateRes.rows[0];
    if (!partner) throw notFound("Partner not found");

    const [rules, orders] = await Promise.all([
      pool.query<{
        id: number;
        offer_id: number | null;
        offer_title: string | null;
        commission_type: string;
        commission_rate: number;
        commission_fixed_cents: number;
        recurring_commission: boolean;
      }>(
        `SELECT r.id, r.offer_id, o.title AS offer_title, r.commission_type,
                r.commission_rate, r.commission_fixed_cents, r.recurring_commission
           FROM affiliate_commission_rules r
           LEFT JOIN offers o ON o.id = r.offer_id
          WHERE r.affiliate_id = $1
          ORDER BY r.offer_id NULLS FIRST`,
        [affiliateId]
      ),
      pool.query<{
        id: number;
        email: string;
        status: string;
        total_cents: number;
        created_at: Date;
        offer_title: string | null;
      }>(
        `SELECT o.id, o.email, o.status, GREATEST(o.total_cents, o.amount_cents) AS total_cents,
                o.created_at, f.title AS offer_title
           FROM orders o
           LEFT JOIN offers f ON f.id = o.offer_id
          WHERE o.affiliate_id = $1
          ORDER BY o.created_at DESC
          LIMIT 50`,
        [affiliateId]
      ),
    ]);

    res.json({
      partner: {
        id: partner.id,
        name: partner.name || partner.email,
        email: partner.email,
        code: partner.code,
        status: partner.status,
        rejectedReason: partner.rejected_reason,
        commission: describeCommission(
          partner.commission_type,
          partner.commission_rate,
          partner.commission_fixed_cents
        ),
        commissionKind: partner.commission_type,
        commissionPercent: partner.commission_rate / 100,
        commissionAmountCents: partner.commission_fixed_cents,
        payOnEveryRenewal: partner.recurring_commission,
        cookieWindowDays: partner.cookie_window_days,
        payoutMethod: partner.payout_method,
        payoutDetails: partner.payout_details,
        notes: partner.notes,
        clicks: partner.click_count,
        sales: partner.referred_count,
        earnedCents: partner.earned_cents,
        paidCents: partner.paid_cents,
        owedCents: partner.earned_cents - partner.paid_cents,
        appliedAt: partner.created_at,
        approvedAt: partner.approved_at,
        shareLink: `${env.publicSiteUrl}/api/ref/${encodeURIComponent(partner.code)}`,
      },
      rules: rules.rows.map((row) => ({
        id: row.id,
        offerId: row.offer_id,
        offerTitle: row.offer_title,
        appliesTo: row.offer_title ?? "Everything",
        commission: describeCommission(
          row.commission_type,
          row.commission_rate,
          row.commission_fixed_cents
        ),
        commissionKind: row.commission_type,
        commissionPercent: row.commission_rate / 100,
        commissionAmountCents: row.commission_fixed_cents,
        payOnEveryRenewal: row.recurring_commission,
      })),
      orders: orders.rows.map((row) => ({
        id: row.id,
        customerEmail: row.email,
        status: row.status,
        totalCents: row.total_cents,
        offerTitle: row.offer_title,
        createdAt: row.created_at,
      })),
    });
  })
);

const updatePartnerSchema = z
  .object({
    name: z.string().trim().max(200),
    commissionKind: z.enum(["percent", "fixed"]),
    commissionPercent: z.number().min(0).max(100),
    commissionAmountCents: z.number().int().min(0).max(10_000_000),
    payOnEveryRenewal: z.boolean(),
    cookieWindowDays: z.number().int().min(1).max(365),
    payoutMethod: z.string().trim().max(120),
    payoutDetails: z.string().trim().max(500),
    notes: z.string().trim().max(5000),
  })
  .partial();

adminAffiliatesRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const affiliateId = parseId(req.params, "Partner");
    const parsed = updatePartnerSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Invalid partner", parsed.error.flatten());
    const body = parsed.data;

    const updated = await pool.query<{ id: number }>(
      `UPDATE affiliates
          SET name                   = COALESCE($2, name),
              commission_type        = COALESCE($3, commission_type),
              commission_rate        = COALESCE($4, commission_rate),
              commission_fixed_cents = COALESCE($5, commission_fixed_cents),
              recurring_commission   = COALESCE($6, recurring_commission),
              cookie_window_days     = COALESCE($7, cookie_window_days),
              payout_method          = COALESCE($8, payout_method),
              payout_details         = COALESCE($9, payout_details),
              notes                  = COALESCE($10, notes),
              updated_at = now()
        WHERE id = $1
        RETURNING id`,
      [
        affiliateId,
        body.name ?? null,
        body.commissionKind ?? null,
        body.commissionPercent === undefined ? null : Math.round(body.commissionPercent * 100),
        body.commissionAmountCents ?? null,
        body.payOnEveryRenewal ?? null,
        body.cookieWindowDays ?? null,
        body.payoutMethod ?? null,
        body.payoutDetails ?? null,
        body.notes ?? null,
      ]
    );
    if (!updated.rows[0]) throw notFound("Partner not found");

    await recordAdminAction({
      req,
      action: "affiliate.update",
      entityType: "affiliate",
      entityId: affiliateId,
      after: body,
    });

    res.json({ id: affiliateId });
  })
);

/**
 * POST /api/admin/affiliates/:id/approve
 *
 * Turns an application into a partner who can be paid.
 *
 * A code is minted here if the row somehow has none, because an approved
 * partner without a share link is a partner who cannot do anything. Approving
 * an already-approved partner is a no-op rather than an error — the button is
 * on a list that somebody may have open in two tabs.
 */
adminAffiliatesRouter.post(
  "/:id/approve",
  asyncHandler(async (req, res) => {
    const affiliateId = parseId(req.params, "Partner");

    const updated = await pool.query<{ id: number; code: string }>(
      `UPDATE affiliates
          SET status = 'approved',
              approved_at = COALESCE(approved_at, now()),
              rejected_reason = '',
              code = CASE WHEN code = '' THEN $2::citext ELSE code END,
              updated_at = now()
        WHERE id = $1
        RETURNING id, code::text AS code`,
      [affiliateId, generateAffiliateCode()]
    );
    if (!updated.rows[0]) throw notFound("Partner not found");

    await recordAdminAction({
      req,
      action: "affiliate.approve",
      entityType: "affiliate",
      entityId: affiliateId,
      after: { status: "approved" },
    });

    res.json({
      id: affiliateId,
      status: "approved",
      shareLink: `${env.publicSiteUrl}/api/ref/${encodeURIComponent(updated.rows[0].code)}`,
    });
  })
);

const rejectSchema = z.object({
  reason: z.string().trim().max(1000).default(""),
  /** Suspending keeps the history; rejecting closes an application. */
  suspend: z.boolean().default(false),
});

adminAffiliatesRouter.post(
  "/:id/reject",
  asyncHandler(async (req, res) => {
    const affiliateId = parseId(req.params, "Partner");
    const parsed = rejectSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw badRequest("Invalid request", parsed.error.flatten());

    const status = parsed.data.suspend ? "suspended" : "rejected";
    const updated = await pool.query<{ id: number }>(
      `UPDATE affiliates
          SET status = $2, rejected_reason = $3, updated_at = now()
        WHERE id = $1
        RETURNING id`,
      [affiliateId, status, parsed.data.reason]
    );
    if (!updated.rows[0]) throw notFound("Partner not found");

    // Commission already earned is deliberately left alone. Turning a partner
    // off stops them earning more; it is not a decision to keep money they
    // already earned, and a ledger that can be emptied by a status change is one
    // nobody can reconcile.
    await recordAdminAction({
      req,
      action: "affiliate.reject",
      entityType: "affiliate",
      entityId: affiliateId,
      after: { status, reason: parsed.data.reason },
    });

    res.json({ id: affiliateId, status });
  })
);
