/**
 * Flip together with backend/scripts/lounge-billing-activate.sql, in one release:
 * the page must never describe billing the checkout does not do.
 */
export const LOUNGE_BILLING_LIVE = false;

/** Her button wording (sheet rows 195-196). The preview draft shows it before the switch. */
const JOIN_PREFIX: Record<string, string> = {
  "the-lounge": "Join Lounge",
  "the-lounge-vip": "Join VIP",
  "lounge-billing-preview": "Join Lounge",
};

export function loungeButtonLabel(slug: string, formattedTotal: string): string | null {
  const prefix = JOIN_PREFIX[slug];
  if (!prefix || (!LOUNGE_BILLING_LIVE && slug !== "lounge-billing-preview")) return null;
  return `${prefix} — Pay ${formattedTotal.replace(/\.00$/, "")} Today`;
}
