/**
 * Addresses of pages retired on 22 Nov 2026 (Yvette, item 9). Client-navigation
 * counterpart to the permanent redirects in the `redirects` table (migration 226)
 * and nginx/redirects.map, which answer a full page load with a 301 first.
 *
 *   - The Leap Accelerator / Boss Builders Collective sales and thank-you pages
 *     ("I no longer offer Boss Builders Collective") → The Club.
 *   - The separate Practice Reset Audit pages → the Practice Freedom Audit.
 */
export const RETIRED_PAGE_TARGETS = {
  "/profitable-private-practice-leap-accelerator": "/club",
  "/leap-accelerator-thank-you": "/club",
  "/reset-audit": "/practice-reset-planner",
  "/reset-audit-form": "/reset-planner-form",
  "/practice-reset-audit-ty": "/practice-reset-planner",
} as const;

export type RetiredPath = keyof typeof RETIRED_PAGE_TARGETS;

export function retiredPageTarget(pathname: string): string | null {
  const key = pathname.toLowerCase().replace(/\/+$/, "") as RetiredPath;
  return RETIRED_PAGE_TARGETS[key] ?? null;
}
