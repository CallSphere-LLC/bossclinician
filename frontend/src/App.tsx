import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router-dom";
import { Layout } from "@/components/layout/Layout";
import { AuthProvider } from "@/hooks/useAuth";
import { MemberAuthProvider, RequireMember } from "@/hooks/useMember";

import Home from "@/pages/Home";
import NotFound from "@/pages/NotFound";

const About = lazy(() => import("@/pages/About"));
const WorkWithMe = lazy(() => import("@/pages/WorkWithMe"));
const Courses = lazy(() => import("@/pages/Courses"));
const CourseDetail = lazy(() => import("@/pages/CourseDetail"));
const Resources = lazy(() => import("@/pages/Resources"));
const ResourceHub = lazy(() => import("@/pages/ResourceHub"));
const Blog = lazy(() => import("@/pages/Blog"));
const BlogPost = lazy(() => import("@/pages/BlogPost"));
const Apply = lazy(() => import("@/pages/Apply"));
const CheckoutSuccess = lazy(() => import("@/pages/CheckoutSuccess"));
const Contact = lazy(() => import("@/pages/Contact"));
const Retreats = lazy(() => import("@/pages/Retreats"));
const Store = lazy(() => import("@/pages/Store"));
const PracticeQuiz = lazy(() => import("@/pages/PracticeQuiz"));
const PracticeResetPlanner = lazy(() => import("@/pages/PracticeResetPlanner"));
const FormPage = lazy(() => import("@/pages/FormPage"));
const FunnelPage = lazy(() => import("@/pages/FunnelPage"));
const PrivacyPolicy = lazy(() => import("@/pages/legal/PrivacyPolicy"));
const Terms = lazy(() => import("@/pages/legal/Terms"));
const Disclaimer = lazy(() => import("@/pages/legal/Disclaimer"));
const FinancialDisclaimer = lazy(() => import("@/pages/legal/FinancialDisclaimer"));
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

function PublicRoutes() {
  return (
    <Layout>
      <Suspense fallback={<PageFallback />}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/about" element={<About />} />
          <Route path="/work-with-me" element={<WorkWithMe />} />
          <Route path="/courses" element={<Courses />} />
          {/* Where 55 of the legacy bossclinician.com product URLs land. */}
          <Route path="/courses/:slug" element={<CourseDetail />} />
          <Route path="/resources" element={<Resources />} />
          <Route path="/resource-hub" element={<ResourceHub />} />
          <Route path="/blog" element={<Blog />} />
          <Route path="/blog/:slug" element={<BlogPost />} />
          <Route path="/apply" element={<Apply />} />
          <Route path="/checkout/success" element={<CheckoutSuccess />} />
          <Route path="/contact" element={<Contact />} />
          <Route path="/retreats" element={<Retreats />} />
          <Route path="/store" element={<Store />} />
          <Route path="/practice-quiz" element={<PracticeQuiz />} />
          <Route path="/practice-reset-planner" element={<PracticeResetPlanner />} />
          {/* Forms built in the admin live under one short prefix so a new one
              is shareable the moment it is published — no route to add here. */}
          <Route path="/f/:slug" element={<FormPage />} />
          {/* Same arrangement for funnels: one route walks every step, so a
              step added in the builder is live without a deploy. The bare
              path opens the first step. */}
          <Route path="/funnel/:slug" element={<FunnelPage />} />
          <Route path="/funnel/:slug/:step" element={<FunnelPage />} />
          <Route path="/privacy-policy" element={<PrivacyPolicy />} />
          <Route path="/terms" element={<Terms />} />
          <Route path="/disclaimer" element={<Disclaimer />} />
          <Route path="/financial-disclaimer" element={<FinancialDisclaimer />} />
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
 */
function MemberRoutes() {
  return (
    <Suspense fallback={<MemberFallback />}>
      <Routes>
        <Route path="/login" element={<MemberLogin />} />
        <Route path="/signup" element={<MemberSignup />} />
        <Route path="/forgot-password" element={<MemberForgotPassword />} />
        <Route path="/reset-password/:token" element={<MemberResetPassword />} />
        <Route path="/verify-email/:token" element={<MemberVerifyEmail />} />

        <Route
          path="/account"
          element={
            <RequireMember>
              <MemberAccount />
            </RequireMember>
          }
        />
        <Route
          path="/account/profile"
          element={
            <RequireMember>
              <MemberProfile />
            </RequireMember>
          }
        />
        <Route
          path="/account/security"
          element={
            <RequireMember>
              <MemberSecurity />
            </RequireMember>
          }
        />
        <Route
          path="/account/billing"
          element={
            <RequireMember>
              <MemberBilling />
            </RequireMember>
          }
        />
        <Route
          path="/account/purchases"
          element={
            <RequireMember>
              <MemberPurchases />
            </RequireMember>
          }
        />
      </Routes>
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

        <Route path="/login" element={<MemberRoutes />} />
        <Route path="/signup" element={<MemberRoutes />} />
        <Route path="/forgot-password" element={<MemberRoutes />} />
        <Route path="/reset-password/*" element={<MemberRoutes />} />
        <Route path="/verify-email/*" element={<MemberRoutes />} />
        <Route path="/account/*" element={<MemberRoutes />} />

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
