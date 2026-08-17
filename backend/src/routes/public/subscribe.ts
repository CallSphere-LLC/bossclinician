import { Router } from "express";
import { pool } from "../../db/pool";
import { asyncHandler } from "../../utils/asyncHandler";
import { subscribeSchema } from "../../validation/schemas";
import { badRequest } from "../../utils/httpError";
import { sendMail } from "../../email/mailer";
import { subscriberWelcome } from "../../email/templates";
import { subscribeLimiter } from "../../middleware/rateLimit";
import { fireTriggerAsync } from "../../automations/engine";

export const subscribeRouter = Router();

subscribeRouter.post(
  "/subscribe",
  subscribeLimiter,
  asyncHandler(async (req, res) => {
    const parsed = subscribeSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Invalid subscribe payload", parsed.error.flatten());
    const { email, source } = parsed.data;

    await pool.query(
      `INSERT INTO subscribers (email, source) VALUES ($1, $2)
       ON CONFLICT (email) DO UPDATE SET source = EXCLUDED.source`,
      [email, source]
    );

    const { subject, text, html } = subscriberWelcome(email);
    void sendMail({ to: email, subject, text, html });

    fireTriggerAsync("subscriber_created", { email, source });

    res.status(201).json({ ok: true });
  })
);
