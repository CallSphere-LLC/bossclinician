import { Router } from "express";
import { pool } from "../../db/pool";
import { asyncHandler } from "../../utils/asyncHandler";

export const settingsRouter = Router();

/**
 * What an anonymous visitor may read from the settings table.
 *
 * An allow-list, and a field-level one, because several keys hold public and
 * private values in the same object: `form_settings` carries both a Turnstile
 * *site* key (meant to be in the page) and its *secret*; `analytics` carries a
 * Meta pixel id and a Meta access token. Publishing by key would leak the second
 * half of each pair, and this endpoint answers unauthenticated GETs.
 *
 * Deny by default is the only safe posture here. A new setting is invisible to
 * the public site until somebody adds it below and has to think about what they
 * are exposing — the alternative fails open, and the failure is silent.
 */
const PUBLIC_FIELDS: Record<string, readonly string[] | "all"> = {
  // Pure presentation, no secrets possible.
  nav: "all",
  footer: "all",
  contact: "all",
  branding: "all",

  checkout: ["brandColor", "supportEmail", "termsUrl", "showCoupons"],
  seo: ["defaultTitle", "defaultDescription", "ogImage"],
  // The site key belongs in the page; the secret verifies the token server-side.
  form_settings: ["spamProtection", "turnstileSiteKey", "recaptchaSiteKey"],
  // Measurement ids are public by design; the access token signs server-side
  // conversion events and is not.
  analytics: ["ga4MeasurementId", "metaPixelId"],
  // The sign-in screen needs to know whether to offer a magic link.
  member_signin: ["magicLinkEnabled"],
  // The physical address is required in the footer by CAN-SPAM anyway.
  marketing_email: ["address"],
};

export function publicView(key: string, value: unknown): unknown | undefined {
  // `hasOwn`, not a plain lookup. `PUBLIC_FIELDS["constructor"]` resolves to the
  // inherited Object constructor — truthy, and not an array — so a settings row
  // named after anything on Object.prototype would pass the guard and then throw
  // on iteration. Settings keys are free text written through the admin, so that
  // row is reachable.
  if (!Object.hasOwn(PUBLIC_FIELDS, key)) return undefined;
  const allowed = PUBLIC_FIELDS[key];
  if (!allowed) return undefined;
  if (allowed === "all") return value;
  if (typeof value !== "object" || value === null) return undefined;

  const source = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const field of allowed) {
    if (source[field] !== undefined) out[field] = source[field];
  }
  return out;
}

settingsRouter.get(
  "/settings",
  asyncHandler(async (_req, res) => {
    const result = await pool.query<{ key: string; value: unknown }>(
      "SELECT key, value FROM settings"
    );

    const merged: Record<string, unknown> = {};
    for (const row of result.rows) {
      const view = publicView(row.key, row.value);
      if (view !== undefined) merged[row.key] = view;
    }
    res.json(merged);
  })
);
