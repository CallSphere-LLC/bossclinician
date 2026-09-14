import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { pool } from "../../db/pool";
import { asyncHandler } from "../../utils/asyncHandler";
import { notFound } from "../../utils/httpError";
import { optionalMember } from "../../middleware/memberAuth";
import { verifyReceiptLink } from "../../services/receiptLinks";
import { loadReceiptDocument, renderReceiptPdf } from "../../services/receiptDocument";

/**
 * GET /api/receipts/:token — a member's receipt PDF, as a download.
 *
 * Public because the thing fetching it is a browser navigation, which carries no
 * Bearer header; the signed token minted by
 * POST /api/member/billing/{orders,invoices}/:id/receipt-link is the credential
 * (see services/receiptLinks.ts).
 *
 * Every refusal is the same 404 with the same words — a bad signature, an
 * expired link, somebody else's session, a suspended account, a receipt the
 * member no longer owns — so a probe learns nothing about which it hit.
 */
export const receiptLinkRouter = Router();

const RECEIPT_LINK_DEAD =
  "We couldn't find that receipt. Download it again from your purchases.";

/** Keyed on IP: the request is a signed-out navigation. The token is unguessable. */
const receiptLinkLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please try again later." },
});

receiptLinkRouter.get(
  "/receipts/:token",
  receiptLinkLimiter,
  optionalMember,
  asyncHandler(async (req, res) => {
    const payload = verifyReceiptLink(String(req.params.token ?? ""));
    if (payload === null) throw notFound(RECEIPT_LINK_DEAD);

    // Where a session does come along (an API client), a different member is
    // refused — the one case a forwarded link can actually be caught in.
    if (req.member && req.member.id !== payload.memberId) throw notFound(RECEIPT_LINK_DEAD);

    // Stands in for requireMember, so it asks the same question of the account.
    const account = await pool.query<{ email: string; status: string }>(
      `SELECT email, status FROM members WHERE id = $1`,
      [payload.memberId]
    );
    const row = account.rows[0];
    if (!row || row.status === "suspended" || row.status === "deleted") {
      throw notFound(RECEIPT_LINK_DEAD);
    }

    // Ownership re-proven in SQL with the member's own scope, not trusted from
    // the moment the link was minted.
    const document = await loadReceiptDocument(payload.target, {
      memberId: payload.memberId,
      billedToEmail: row.email,
    });
    if (!document?.pdf) throw notFound(RECEIPT_LINK_DEAD);

    const pdf = await renderReceiptPdf(document);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${document.filename}"`);
    res.setHeader("Content-Length", String(pdf.byteLength));
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.send(pdf);
  })
);
