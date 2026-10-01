import type { JSX } from "react";
import { lazyRoute, type RouteComponent } from "@/ssr/lazyRoute";

/**
 * The Kajabi opt-in / lead-magnet family, each at the address it had on
 * bossclinician.com. Migration 097 deletes the /resources redirects that stood
 * in for them (nginx/redirects.map must drop the same lines).
 *
 * Two shapes of the same list:
 *   - `leadMagnetPublicRoutes` is PUBLIC_ROUTES' own shape ({ path, Component }
 *     with `preload`), so spreading it into PUBLIC_ROUTES in App.tsx makes the
 *     pages server-rendered and hydrated like every other marketing page.
 *   - `leadMagnetRoutes` is the { path, element } form, for a plain <Routes>.
 * Use one or the other, not both.
 */

const DocumentationThankYouCe = lazyRoute(() =>
  import("./DocumentationThankYou").then((m) => ({ default: m.DocumentationThankYouCe })),
);
const DocumentationThankYouEdu = lazyRoute(() =>
  import("./DocumentationThankYou").then((m) => ({ default: m.DocumentationThankYouEdu })),
);

export const leadMagnetPublicRoutes: readonly { path: string; Component: RouteComponent }[] = [
  { path: "/5-step-marketing", Component: lazyRoute(() => import("./FiveStepMarketing")) },
  { path: "/marketing-step-form", Component: lazyRoute(() => import("./MarketingStepForm")) },
  { path: "/business-plan-guide", Component: lazyRoute(() => import("./BusinessPlanGuide")) },
  { path: "/business-plan-ty", Component: lazyRoute(() => import("./BusinessPlanThankYou")) },
  { path: "/insurance-guide", Component: lazyRoute(() => import("./InsuranceGuide")) },
  { path: "/kickstartguide", Component: lazyRoute(() => import("./KickstartGuide")) },
  {
    path: "/step-by-step-guide-thank-you-page",
    Component: lazyRoute(() => import("./KickstartThankYou")),
  },
  { path: "/doc-registration", Component: lazyRoute(() => import("./DocRegistration")) },
  { path: "/dos-and-donts-ty", Component: DocumentationThankYouCe },
  { path: "/dos-donts-ty", Component: DocumentationThankYouEdu },
  {
    path: "/on-demand-audit-your-private-practice",
    Component: lazyRoute(() => import("./OnDemandAudit")),
  },
  { path: "/replay-documentation", Component: lazyRoute(() => import("./ReplayDocumentation")) },
  { path: "/opt-in", Component: lazyRoute(() => import("./OptIn")) },
  { path: "/profile-audit-ty", Component: lazyRoute(() => import("./ProfileAuditThankYou")) },
];

export const leadMagnetRoutes: { path: string; element: JSX.Element }[] = leadMagnetPublicRoutes.map(
  ({ path, Component }) => ({ path, element: <Component /> }),
);
