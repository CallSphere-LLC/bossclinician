import type { ComponentType, JSX } from "react";
import { lazyRoute, type RouteComponent } from "@/ssr/lazyRoute";

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

export const kajabiPublicRoutes: readonly { path: string; Component: RouteComponent }[] = [
  // Practice Reset Audit / Planner family
  { path: "/reset-audit", Component: page(() => import("./ResetAudit")) },
  { path: "/reset-audit-form", Component: page(optIns, "ResetAuditForm") },
  { path: "/practice-reset-audit-ty", Component: page(() => import("./PracticeResetAuditTy")) },
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
  {
    path: "/profitable-private-practice-leap-accelerator",
    Component: page(() => import("./LeapAccelerator")),
  },
  { path: "/leap-accelerator-thank-you", Component: page(() => import("./LeapAcceleratorThankYou")) },
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
  { path: "/the-club-ty", Component: page(() => import("./ClubThankYou")) },
];

export const kajabiPageRoutes: { path: string; element: JSX.Element }[] = kajabiPublicRoutes.map(
  ({ path, Component }) => ({ path, element: <Component /> }),
);
