import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { pool } from "../../db/pool";
import { asyncHandler } from "../../utils/asyncHandler";
import { badRequest } from "../../utils/httpError";
import { recordActivity, upsertContact } from "../../services/contacts";
import { affiliateSettings, generateAffiliateCode } from "../../services/affiliates";

/**
 * The public side of the partner program: what it offers, and how to apply.
 *
 * Two rules govern the whole file:
 *
 *  - **Every application answers the same way.** A brand-new applicant, somebody
 *    who applied last week and an existing approved partner all get "thanks,
 *    we'll be in touch". Distinguishing them turns this endpoint into a way to
 *    ask "is this person one of your partners?" about any address in the world.
 *  - **The program's terms come from the program.** The rate shown on the page
 *    is read from the settings the owner edits, so the invitation cannot drift
 *    away from what a partner is actually paid.
 */
export const affiliateSignupRouter = Router();

/** Writes a row keyed on an unverified address, so the ceiling is low. */
const applyLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "That's a lot of applications. Please try again later." },
});

const programLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please try again later." },
});

/**
 * GET /api/affiliates/program
 *
 * What the application page renders. Deliberately says nothing about who the
 * existing partners are or how many there are.
 */
affiliateSignupRouter.get(
  "/affiliates/program",
  programLimiter,
  asyncHandler(async (_req, res) => {
    const settings = await affiliateSettings();
    res.json({
      pitchMd: settings.pitchMd,
      termsMd: settings.termsMd,
      // Presented as the money it is, never as basis points.
      commission:
        settings.defaultCommissionType === "fixed"
          ? { kind: "fixed", amountCents: settings.defaultFixedCents }
          : { kind: "percent", percent: settings.defaultRateBps / 100 },
      cookieWindowDays: settings.cookieWindowDays,
      recurring: settings.recurringCommission,
    });
  })
);

const applySchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(320),
  /** Where they will promote: a site, a podcast, an Instagram handle. */
  audience: z.string().trim().max(2000).optional(),
  website: z.string().trim().max(500).optional(),
  /** How they would like to be paid, in their own words. */
  payoutMethod: z.string().trim().max(120).optional(),
  payoutDetails: z.string().trim().max(500).optional(),
  acceptedTerms: z.boolean(),
});

/**
 * POST /api/affiliates/apply
 *
 * Creates a pending partner, or quietly leaves the existing one alone.
 *
 * `ON CONFLICT DO NOTHING` on the address is what makes a second application
 * harmless: it must not reset an approved partner back to pending, and it must
 * not overwrite the commission somebody negotiated by hand.
 */
affiliateSignupRouter.post(
  "/affiliates/apply",
  applyLimiter,
  asyncHandler(async (req, res) => {
    const parsed = applySchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Invalid application", parsed.error.flatten());
    const body = parsed.data;

    if (!body.acceptedTerms) throw badRequest("Please accept the partner terms to apply.");

    const settings = await affiliateSettings();
    const email = body.email.toLowerCase();

    const contactId = await upsertContact({
      email,
      name: body.name,
      source: "affiliate_application",
      consentSource: "affiliate application form",
      consentIp: req.ip ?? "",
    });

    const notes = [
      body.audience ? `Audience: ${body.audience}` : "",
      body.website ? `Website: ${body.website}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    const inserted = await pool.query<{ id: number }>(
      `INSERT INTO affiliates
         (contact_id, email, name, code, status, approved_at,
          commission_type, commission_rate, commission_fixed_cents,
          recurring_commission, cookie_window_days,
          payout_method, payout_details, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (email) DO NOTHING
       RETURNING id`,
      [
        contactId,
        email,
        body.name,
        generateAffiliateCode(),
        settings.autoApprove ? "approved" : "pending",
        settings.autoApprove ? new Date() : null,
        settings.defaultCommissionType,
        settings.defaultRateBps,
        settings.defaultFixedCents,
        settings.recurringCommission,
        settings.cookieWindowDays,
        (body.payoutMethod ?? "").slice(0, 120),
        (body.payoutDetails ?? "").slice(0, 500),
        notes,
      ]
    );

    if (inserted.rows[0]) {
      await recordActivity({
        contactId,
        kind: "affiliate_application",
        title: "Applied to the partner program",
        body: notes,
        subjectType: "affiliate",
        subjectId: inserted.rows[0].id,
      });
    }

    // The same answer either way. See the note at the top of the file.
    res.status(202).json({
      status: "received",
      message: settings.autoApprove
        ? "You're in — sign in to your account to find your link."
        : "Thanks — we'll review your application and email you.",
      autoApproved: settings.autoApprove,
    });
  })
);
