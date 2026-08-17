import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router-dom";
import { Layout } from "@/components/layout/Layout";
import { AuthProvider } from "@/hooks/useAuth";

import Home from "@/pages/Home";
import NotFound from "@/pages/NotFound";

const About = lazy(() => import("@/pages/About"));
const WorkWithMe = lazy(() => import("@/pages/WorkWithMe"));
const Courses = lazy(() => import("@/pages/Courses"));
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

function PublicRoutes() {
  return (
    <Layout>
      <Suspense fallback={<PageFallback />}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/about" element={<About />} />
          <Route path="/work-with-me" element={<WorkWithMe />} />
          <Route path="/courses" element={<Courses />} />
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

export default function App() {
  return (
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
      <Route path="/*" element={<PublicRoutes />} />
    </Routes>
  );
}

function AdminFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-sand text-ink-soft">
      Loading admin…
    </div>
  );
}

function PageFallback() {
  return <div className="min-h-[40vh]" aria-hidden />;
}
