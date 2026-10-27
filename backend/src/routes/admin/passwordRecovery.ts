import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { badRequest } from "../../utils/httpError";
import { forgotPasswordSchema, resetPasswordSchema } from "../../validation/memberSchemas";
import { checkPasswordStrength, hashPassword } from "../../auth/password";
import { clearAdminCookies } from "../../auth/adminSession";
import { adminRecoveryRequestLimiter, adminRecoveryTokenLimiter } from "../../middleware/rateLimit";
import { issuePasswordReset, consumePasswordReset, INVALID_RESET_LINK } from "../../services/passwordRecovery";
import { adminPasswordResetEmail } from "../../email/adminPasswordRecovery";
import { sendMail } from "../../email/mailer";

export const adminPasswordRecoveryRouter = Router();
adminPasswordRecoveryRouter.post("/forgot-password", adminRecoveryRequestLimiter, asyncHandler(async (req, res) => {
  const parsed = forgotPasswordSchema.safeParse(req.body);
  if (!parsed.success) throw badRequest("Please enter a valid email address.");
  const reset = await issuePasswordReset("admin", parsed.data.email, req.ip);
  res.json({ ok: true });
  // Delivery never affects status, body or response latency for an existing account.
  if (reset) void sendMail({ to: reset.email, topic: "admin_password_reset", ...adminPasswordResetEmail(reset.token, parsed.data.next) }).catch(() => { console.error("[password-recovery] Unexpected admin mail failure"); });
}));

adminPasswordRecoveryRouter.post("/reset-password", adminRecoveryTokenLimiter, asyncHandler(async (req, res) => {
  const parsed = resetPasswordSchema.safeParse(req.body);
  if (!parsed.success) throw badRequest(INVALID_RESET_LINK);
  const strength = checkPasswordStrength(parsed.data.password);
  if (!strength.ok) throw badRequest(strength.reason!);
  await consumePasswordReset("admin", parsed.data.token, await hashPassword(parsed.data.password), req.ip);
  clearAdminCookies(res);
  res.json({ ok: true });
}));
