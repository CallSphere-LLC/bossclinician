import { lazyRoute, type RouteComponent } from "@/ssr/lazyRoute";

/**
 * The same routes as ./routes.tsx in App's PUBLIC_ROUTES shape, split into
 * their own chunks: `entry-server` / `entry-client` preload a route's
 * component before rendering it, so these are safe to server-render once they
 * are spread into PUBLIC_ROUTES (`...quizRouteTable`).
 */
export const quizRouteTable: readonly { path: string; Component: RouteComponent }[] = [
  { path: "/offer-quiz", Component: lazyRoute(() => import("./OfferQuiz")) },
  { path: "/hiring-quiz", Component: lazyRoute(() => import("./HiringQuiz")) },
  { path: "/hire-form", Component: lazyRoute(() => import("./HireForm")) },
  { path: "/retreat-needed-quiz", Component: lazyRoute(() => import("./RetreatNeededQuiz")) },
  { path: "/retreat-thank-you-page", Component: lazyRoute(() => import("./RetreatThankYou")) },
  { path: "/boss-assessment", Component: lazyRoute(() => import("./BossAssessment")) },
  {
    path: "/visionary-form",
    Component: lazyRoute(() => import("./PracticeResultForm").then((m) => ({ default: m.VisionaryForm }))),
  },
  {
    path: "/careful-form",
    Component: lazyRoute(() => import("./PracticeResultForm").then((m) => ({ default: m.CarefulForm }))),
  },
  {
    path: "/steady-form",
    Component: lazyRoute(() => import("./PracticeResultForm").then((m) => ({ default: m.SteadyForm }))),
  },
  {
    path: "/reluctant-form",
    Component: lazyRoute(() => import("./PracticeResultForm").then((m) => ({ default: m.ReluctantForm }))),
  },
  { path: "/practice-set-up-quiz-ty", Component: lazyRoute(() => import("./PracticeQuizThankYou")) },
];
