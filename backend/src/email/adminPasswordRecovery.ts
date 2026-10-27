import { env } from "../config/env";
import { withRecoveryNext } from "../auth/passwordRecoveryLinks";
import { escapeHtml } from "./templates";

export function adminPasswordResetEmail(token: string, next?: string) {
  // Configured canonical origin only; never trust a Host/Origin/next header.
  let origin = "https://admin.bossclinician.com";
  try {
    const configured = new URL(env.adminOrigin);
    if (["http:", "https:"].includes(configured.protocol) && !configured.username && !configured.password &&
        !["admin.bossclinician.callsphere.site", "admin.bossclinician.com"].includes(configured.hostname)) origin = configured.origin;
  } catch { /* Default to the canonical admin site. */ }
  const url = origin + withRecoveryNext(`/admin/reset-password/${encodeURIComponent(token)}`, "admin", next);
  return {
    subject: "Reset your Boss Clinician admin password",
    text: `Set a new admin password: ${url}\n\nThis link works once and expires in one hour. If you did not request it, ignore this email. Your password has not changed.`,
    html: `<p>Use this link to set a new Boss Clinician admin password.</p><p><a href="${escapeHtml(url)}">Reset admin password</a></p><p>This link works once and expires in one hour. If you did not request it, ignore this email. Your password has not changed.</p>`,
  };
}
