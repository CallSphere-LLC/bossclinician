import { lazy, Suspense } from "react";
import { Outlet, Route, Routes } from "react-router-dom";
import { Layout } from "@/components/layout/Layout";
import { AuthProvider } from "@/hooks/useAuth";
import { MemberAuthProvider, RequireMember } from "@/hooks/useMember";
import { lazyRoute, type RouteComponent } from "@/ssr/lazyRoute";

import NotFound from "@/pages/NotFound";

const AdminApp = lazy(() => import("@/pages/admin/AdminApp"));

// Member surfaces. Split from the marketing bundle because a visitor who never
// signs in should not download the account area, and a member deep in the
// course player should not be carrying the home page's motion code.
const MemberLogin = lazy(() => import("@/pages/member/Login"));
const MemberSignup = lazy(() => import("@/pages/member/Signup"));
const MemberForgotPassword = lazy(() => import("@/pages/member/ForgotPassword"));
const MemberResetPassword = lazy(() => import("@/pages/member/ResetPassword"));
const MemberVerifyEmail = lazy(() => import("@/pages/member/VerifyEmail"));
const MemberAccount = lazy(() => import("@/pages/member/Account"));
const MemberProfile = lazy(() => import("@/pages/member/Profile"));
const MemberSecurity = lazy(() => import("@/pages/member/Security"));
const MemberBilling = lazy(() => import("@/pages/member/Billing"));
const MemberPurchases = lazy(() => import("@/pages/member/Purchases"));
const MemberLibrary = lazy(() => import("@/pages/member/Library"));
const MemberCoursePlayer = lazy(() => import("@/pages/member/CoursePlayer"));
const MemberCommunity = lazy(() => import("@/pages/member/Community"));
const MemberCommunityChannel = lazy(() => import("@/pages/member/CommunityChannel"));
const MemberCommunityProfile = lazy(() => import("@/pages/member/CommunityProfile"));
const MemberCoaching = lazy(() => import("@/pages/member/Coaching"));
const MemberCoachingSession = lazy(() => import("@/pages/member/CoachingSession"));
const MemberPodcasts = lazy(() => import("@/pages/member/Podcasts"));
const MemberNewsletters = lazy(() => import("@/pages/member/Newsletters"));
const MemberAffiliatePortal = lazy(() => import("@/pages/member/AffiliatePortal"));
const Checkout = lazy(() => import("@/pages/Checkout"));
const CheckoutUpsell = lazy(() => import("@/pages/CheckoutUpsell"));

/**
 * The order confirmation, named rather than inlined into the table below.
 *
 * It has to be reachable two ways: as a public page, and from the outer router,
 * where it needs a route of its own to keep `/checkout/:offerSlug` from reading
 * "success" as an offer slug. One component behind both, so the two can never
 * drift into loading different chunks.
 */
const CheckoutSuccessPage = lazyRoute(() => import("@/pages/CheckoutSuccess"));

/**
 * The public marketing surface, as data.
 *
 * A table rather than JSX because two other things read it: `entry-server`
 * resolves the page component for a URL before rendering it to HTML, and
 * `entry-client` resolves the same one before hydrating. A route missing from
 * here would hydrate against a loading placeholder instead of the server's
 * markup, so the routes and the preload list cannot be allowed to drift apart.
 */
export const PUBLIC_ROUTES: readonly { path: string; Component: RouteComponent }[] = [
  { path: "/", Component: lazyRoute(() => import("@/pages/Home")) },
  { path: "/about", Component: lazyRoute(() => import("@/pages/About")) },
  { path: "/work-with-me", Component: lazyRoute(() => import("@/pages/WorkWithMe")) },
  { path: "/courses", Component: lazyRoute(() => import("@/pages/Courses")) },
  // Where 55 of the legacy bossclinician.com product URLs land.
  { path: "/courses/:slug", Component: lazyRoute(() => import("@/pages/CourseDetail")) },
  { path: "/partners", Component: lazyRoute(() => import("@/pages/AffiliateSignup")) },
  // One route per builder-created thing, so a quiz or an event is shareable the
  // moment it is published — no deploy to add one.
  { path: "/quiz/:slug", Component: lazyRoute(() => import("@/pages/Quiz")) },
  { path: "/events/:slug", Component: lazyRoute(() => import("@/pages/EventRegister")) },
  { path: "/events/:slug/room", Component: lazyRoute(() => import("@/pages/EventRoom")) },
  { path: "/resources", Component: lazyRoute(() => import("@/pages/Resources")) },
  { path: "/resource-hub", Component: lazyRoute(() => import("@/pages/ResourceHub")) },
  { path: "/blog", Component: lazyRoute(() => import("@/pages/Blog")) },
  { path: "/blog/:slug", Component: lazyRoute(() => import("@/pages/BlogPost")) },
  { path: "/apply", Component: lazyRoute(() => import("@/pages/Apply")) },
  { path: "/checkout/success", Component: CheckoutSuccessPage },
  { path: "/contact", Component: lazyRoute(() => import("@/pages/Contact")) },
  { path: "/retreats", Component: lazyRoute(() => import("@/pages/Retreats")) },
  { path: "/store", Component: lazyRoute(() => import("@/pages/Store")) },
  { path: "/practice-quiz", Component: lazyRoute(() => import("@/pages/PracticeQuiz")) },
  {
    path: "/practice-reset-planner",
    Component: lazyRoute(() => import("@/pages/PracticeResetPlanner")),
  },
  // Forms built in the admin live under one short prefix so a new one is
  // shareable the moment it is published — no route to add here.
  { path: "/f/:slug", Component: lazyRoute(() => import("@/pages/FormPage")) },
  // Same arrangement for funnels: one route walks every step, so a step added
  // in the builder is live without a deploy. The bare path opens the first step.
  { path: "/funnel/:slug", Component: lazyRoute(() => import("@/pages/FunnelPage")) },
  { path: "/funnel/:slug/:step", Component: lazyRoute(() => import("@/pages/FunnelPage")) },
  { path: "/privacy-policy", Component: lazyRoute(() => import("@/pages/legal/PrivacyPolicy")) },
  { path: "/terms", Component: lazyRoute(() => import("@/pages/legal/Terms")) },
  { path: "/disclaimer", Component: lazyRoute(() => import("@/pages/legal/Disclaimer")) },
  {
    path: "/financial-disclaimer",
    Component: lazyRoute(() => import("@/pages/legal/FinancialDisclaimer")),
  },
];

function PublicRoutes() {
  return (
    <Layout>
      <Suspense fallback={<PageFallback />}>
        <Routes>
          {PUBLIC_ROUTES.map(({ path, Component }) => (
            <Route key={path} path={path} element={<Component />} />
          ))}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </Layout>
  );
}

/**
 * The member app: sign-in, the account area, and (from Phase 3) the library.
 *
 * Rendered outside `Layout` on purpose. These pages carry their own chrome —
 * `AuthCard` for the signed-out screens and `MemberShell` for the signed-in
 * ones — because the marketing header, footer and sales chat widget belong to a
 * page that is trying to sell something, not to the product someone has already
 * bought.
 *
 * Returned as `<Route>` elements spliced into the app's one `<Routes>`, never as
 * a nested `<Routes>` of its own. A descendant `<Routes>` matches what is left of
 * the URL *after* its parent route consumed it, so `/account/profile` reaches it
 * as `/profile` and a child declared at `/account/profile` never matches —
 * every member screen renders as a blank page. The admin gets away with a nested
 * `<Routes>` because its children are written relative to `/admin/*`; these are
 * absolute site paths and so belong at the top level.
 */
function memberRoutes() {
  return (
    <Route element={<MemberBoundary />}>
      <Route path="/login" element={<MemberLogin />} />
      <Route path="/signup" element={<MemberSignup />} />
      <Route path="/forgot-password" element={<MemberForgotPassword />} />
      <Route path="/reset-password/:token" element={<MemberResetPassword />} />
      <Route path="/verify-email/:token" element={<MemberVerifyEmail />} />

      {/* One guard for the whole signed-in half: `RequireMember` renders the
          matched child through `<Outlet>`, so the check happens once rather
          than being repeated — and forgotten — on each new screen. */}
      <Route
        element={
          <RequireMember>
            <Outlet />
          </RequireMember>
        }
      >
        <Route path="/account" element={<MemberAccount />} />
        <Route path="/account/profile" element={<MemberProfile />} />
        <Route path="/account/security" element={<MemberSecurity />} />
        <Route path="/account/billing" element={<MemberBilling />} />
        <Route path="/account/purchases" element={<MemberPurchases />} />

        <Route path="/library" element={<MemberLibrary />} />
        <Route path="/library/:productSlug" element={<MemberCoursePlayer />} />
        <Route
          path="/library/:productSlug/lessons/:lessonSlug"
          element={<MemberCoursePlayer />}
        />
        <Route path="/community" element={<MemberCommunity />} />
        <Route path="/community/:slug" element={<MemberCommunity />} />
        {/* The people directory and one person's profile. Declared alongside
            the channel wildcard below, which is two segments of the same
            shape: React Router ranks a static segment above a dynamic one, so
            `/community/x/members` reaches this and not the wildcard whatever
            order they are written in. That ranking is what makes any future
            `/community/:slug/<something>` page safe to add — it does not have
            to be squeezed in above the wildcard by hand. The one thing it
            cannot survive is a channel actually called "members", which the
            directory would then shadow. */}
        <Route path="/community/:slug/members" element={<MemberCommunityProfile />} />
        <Route
          path="/community/:slug/members/:memberId"
          element={<MemberCommunityProfile />}
        />
        {/* Two segments, no `channels` in the middle: that is the shape the
            API builds into every channel's own `href`, and a route that
            disagreed sent each one to the marketing 404. */}
        <Route path="/community/:slug/:channelSlug" element={<MemberCommunityChannel />} />
        <Route path="/coaching" element={<MemberCoaching />} />
        <Route path="/coaching/sessions/:id" element={<MemberCoachingSession />} />
        <Route path="/podcasts" element={<MemberPodcasts />} />
        <Route path="/partners/dashboard" element={<MemberAffiliatePortal />} />
        <Route path="/newsletters" element={<MemberNewsletters />} />
      </Route>
    </Route>
  );
}

/** The member bundle's loading state, held open until the page's chunk lands. */
function MemberBoundary() {
  return (
    <Suspense fallback={<MemberFallback />}>
      <Outlet />
    </Suspense>
  );
}

export default function App() {
  return (
    // MemberAuthProvider wraps the marketing site too, so the header can offer
    // "My library" to someone already signed in. It costs nothing for a
    // stranger: with no session-hint cookie present it skips the refresh call
    // entirely rather than discovering the absence over the network.
    <MemberAuthProvider>
      <Routes>
        <Route
          path="/admin/*"
          element={
            <AuthProvider>
              <Suspense fallback={<AdminFallback />}>
                <AdminApp />
              </Suspense>
            </AuthProvider>
          }
        />

        {memberRoutes()}

        {/* Ranked above /checkout/:offerSlug — React Router prefers a static
            segment to a dynamic one, so this keeps the success page from being
            read as an offer whose slug happens to be "success". The page is
            rendered here rather than handed to <PublicRoutes>, whose own
            <Routes> would be matching against what is left of the URL after
            this route consumed all of it — and would answer with its 404. */}
        <Route
          path="/checkout/success"
          element={
            <Layout>
              <Suspense fallback={<PageFallback />}>
                <CheckoutSuccessPage />
              </Suspense>
            </Layout>
          }
        />

        {/* Checkout stays outside RequireMember: it is still a sales page, and a
            guest buying without an account must not meet a sign-in wall. It is
            wrapped in Suspense of its own because it is not part of either
            existing bundle. */}
        <Route
          path="/checkout/:offerSlug"
          element={
            <Suspense fallback={<MemberFallback />}>
              <Checkout />
            </Suspense>
          }
        />
        <Route
          path="/checkout/:offerSlug/upsell/:step"
          element={
            <Suspense fallback={<MemberFallback />}>
              <CheckoutUpsell />
            </Suspense>
          }
        />

        <Route path="/*" element={<PublicRoutes />} />
      </Routes>
    </MemberAuthProvider>
  );
}

function AdminFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-sand text-ink-soft">
      Loading admin…
    </div>
  );
}

function MemberFallback() {
  return (
    <div className="theme-luxe flex min-h-screen items-center justify-center bg-night-deep">
      <span
        className="size-9 animate-spin rounded-full border-2 border-lilac border-t-plum"
        role="status"
        aria-label="Loading"
      />
    </div>
  );
}

function PageFallback() {
  return <div className="min-h-[40vh]" aria-hidden />;
}
