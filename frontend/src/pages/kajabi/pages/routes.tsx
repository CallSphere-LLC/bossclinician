import type { ComponentType, JSX } from "react";
import { lazyRoute, type RouteComponent } from "@/ssr/lazyRoute";
import { RETIRED_PAGE_TARGETS } from "./retiredPages";

/**
 * Routes for the one-off pages rebuilt from bossclinician.com (Kajabi), each at
 * the exact path it had there. Migration 100 deletes the `redirects` rows that
 * used to send these paths to generic pages.
 *
 * Paths keep Kajabi's casing (`/credential-with-confidencekit-Confirmed`);
 * React Router matches case-insensitively, as do the nginx redirect map and
 * `normalizePath`, so the lowercase spelling reaches the same page.
 *
 * `kajabiPublicRoutes` is the shape `PUBLIC_ROUTES` in App.tsx uses — spread it
 * there, so `ssr/preload.ts` resolves these chunks before render and hydration.
 * `kajabiPageRoutes` is the same table as `{ path, element }` for a plain
 * `<Route>` list.
 */

/** A lazy route for a file's default export, or one of its named exports. */
function page(load: () => Promise<unknown>, name = "default"): RouteComponent {
  return lazyRoute(() =>
    load().then((m) => ({ default: (m as Record<string, ComponentType>)[name] })),
  );
}

const optIns = () => import("./OptInFormPages");
const upsells = () => import("./UpsellThankYou");
const purchases = () => import("./PurchaseThankYou");
const retired = page(() => import("./RetiredPageRedirect"));

export const kajabiPublicRoutes: readonly { path: string; Component: RouteComponent }[] = [
  // Practice Freedom Audit / Planner family. The separate Practice Reset Audit
  // pages were retired on 22 Nov 2026 (Yvette, item 9): see `retired` below.
  { path: "/reset-planner-form", Component: page(optIns, "ResetPlannerForm") },
  { path: "/practice-reset-snapshot", Component: page(() => import("./PracticeResetSnapshot")) },
  { path: "/practice-planner", Component: page(() => import("./PracticePlanner")) },
  { path: "/practice-planner-thank-you", Component: page(upsells, "PracticePlannerThankYou") },

  // Legal documents Kajabi kept as separate pages
  { path: "/terms-of-use", Component: page(() => import("./TermsOfUse")) },
  { path: "/coaching-terms", Component: page(() => import("./CoachingTerms")) },
  { path: "/ceu-terms-boss-clinician", Component: page(() => import("./CeuTerms")) },
  { path: "/retreatagreement", Component: page(() => import("./RetreatAgreement")) },
  {
    path: "/continuing-education-boss-clinician",
    Component: page(() => import("./ContinuingEducation")),
  },

  // Programs and misc
  { path: "/private-practice-for-you", Component: page(() => import("./PrivatePracticeForYou")) },
  { path: "/private-practice-for-you-ty", Component: page(() => import("./PrivatePracticeForYouTy")) },
  { path: "/next-steps-consult", Component: page(() => import("./NextStepsConsult")) },
  { path: "/link-in-bio", Component: page(() => import("./LinkInBio")) },
  { path: "/masterclass-review-sheet", Component: page(() => import("./MasterclassReviewSheet")) },

  // Purchase thank-you pages
  { path: "/credential-with-confidencekit-Confirmed", Component: page(purchases, "CredentialKitConfirmed") },
  { path: "/protectionpackthanks", Component: page(upsells, "ProtectionPackThanks") },
  { path: "/starterconfirmed", Component: page(() => import("./StarterConfirmed")) },
  { path: "/thank-you", Component: page(purchases, "GenericThankYou") },
  { path: "/thank-you-audit-proof", Component: page(purchases, "ThankYouAuditProof") },
  { path: "/thank-you-fullybooked", Component: page(purchases, "ThankYouFullyBooked") },
  { path: "/thank-you-rate-renegotiate", Component: page(purchases, "ThankYouRateRenegotiate") },
  { path: "/lounge-confirmed", Component: page(() => import("./LoungeConfirmed")) },
  { path: "/the-club-ty", Component: page(() => import("./ClubThankYou")) },

  // Retired 22 Nov 2026 (Yvette, item 9): Leap Accelerator / Boss Builders
  // Collective → /club, Practice Reset Audit → Practice Freedom Audit. A full
  // page load gets the 301 from nginx/redirects.map first; these cover
  // in-app navigation.
  ...Object.keys(RETIRED_PAGE_TARGETS).map((path) => ({ path, Component: retired })),
];

export const kajabiPageRoutes: { path: string; element: JSX.Element }[] = kajabiPublicRoutes.map(
  ({ path, Component }) => ({ path, element: <Component /> }),
);
