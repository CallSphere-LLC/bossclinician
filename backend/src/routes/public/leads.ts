import { Router } from "express";
import { pool } from "../../db/pool";
import { asyncHandler } from "../../utils/asyncHandler";
import { leadSchema } from "../../validation/schemas";
import { badRequest } from "../../utils/httpError";
import { sendMail } from "../../email/mailer";
import { incomeProjection, newLeadNotification } from "../../email/templates";
import { env } from "../../config/env";
import { leadsLimiter } from "../../middleware/rateLimit";
import { fireTriggerAsync } from "../../automations/engine";

export const leadsRouter = Router();

/** Faster than this and nobody read the form, let alone filled it in. */
const MIN_FILL_MS = 2000;

/** The figures the income calculator writes into a lead's meta. */
const PROJECTION_KEYS = [
  "sessionRate",
  "clientsPerWeek",
  "weeksPerYear",
  "annualIncome",
  "monthlyIncome",
] as const;

type Projection = Record<(typeof PROJECTION_KEYS)[number], number>;

/**
 * Reads the calculator's figures back out of the free-form lead meta.
 *
 * Null unless every one of them is a real number: a half-filled projection is
 * worse to send than none, and `meta` is a jsonb column anyone can post to.
 */
function readProjection(meta: Record<string, unknown> | undefined): Projection | null {
  const projection = {} as Projection;
  for (const key of PROJECTION_KEYS) {
    const value = meta?.[key];
    if (typeof value !== "number" || !Number.isFinite(value)) return null;
    projection[key] = value;
  }
  return projection;
}

leadsRouter.post(
  "/leads",
  leadsLimiter,
  asyncHandler(async (req, res) => {
    const parsed = leadSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Invalid lead payload", parsed.error.flatten());
    const { name, email, phone, message, source, meta, company, elapsedMs } = parsed.data;

    // A filled honeypot, or a form sent faster than a person can read it, is a
    // script. It gets the same 201 a real submission gets — an error response
    // is just feedback a bot can tune against — but nothing is written, mailed
    // or triggered.
    if (company?.trim() || (elapsedMs !== undefined && elapsedMs < MIN_FILL_MS)) {
      res.status(201).json({ ok: true });
      return;
    }

    const result = await pool.query(
      `INSERT INTO leads (name, email, phone, message, source, meta)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [name, email, phone ?? null, message ?? null, source, JSON.stringify(meta ?? {})]
    );

    const id = result.rows[0].id as number;

    if (env.notifyEmail) {
      const { subject, text, html } = newLeadNotification({ name, email, phone, message, source });
      void sendMail({ to: env.notifyEmail, subject, text, html });
    }

    // The calculator's capture band promises the reader their own numbers
    // back, so that one source answers the submitter as well as the notify
    // address — no admin-configured automation required for the promise on a
    // public page to be true. Guarded on the figures actually being there.
    if (source === "income-calculator") {
      const projection = readProjection(meta);
      if (projection) {
        const { subject, text, html } = incomeProjection({ name, ...projection });
        void sendMail({ to: email, subject, text, html });
      }
    }

    // Detached on purpose: automation latency must not delay the response,
    // and a failing automation must not fail lead capture.
    fireTriggerAsync("lead_created", { email, name, source });

    res.status(201).json({ ok: true, id });
  })
);
