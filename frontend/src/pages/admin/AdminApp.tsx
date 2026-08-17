import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { AdminLayout } from "@/pages/admin/AdminLayout";
import Login from "@/pages/admin/Login";
import Dashboard from "@/pages/admin/Dashboard";
import Products from "@/pages/admin/Products";
import BlogList from "@/pages/admin/BlogList";
import BlogEditor from "@/pages/admin/BlogEditor";
import CoursesAdmin from "@/pages/admin/CoursesAdmin";
import CourseBuilder from "@/pages/admin/CourseBuilder";
import CommunityList from "@/pages/admin/CommunityList";
import CommunityDetail from "@/pages/admin/CommunityDetail";
import MediaLibrary from "@/pages/admin/MediaLibrary";
import TestimonialsAdmin from "@/pages/admin/TestimonialsAdmin";
import ResourcesAdmin from "@/pages/admin/ResourcesAdmin";
import Leads from "@/pages/admin/Leads";
import Conversations from "@/pages/admin/Conversations";
import Members from "@/pages/admin/Members";
import Subscribers from "@/pages/admin/Subscribers";
import Analytics from "@/pages/admin/Analytics";
import SettingsPage from "@/pages/admin/Settings";
import {
  CouponsPage,
  InvoicesPage,
  PaymentsPage,
  PayoutsPage,
  PlansPage,
  SubscriptionsPage,
} from "@/pages/admin/SalesPages";
import Coaching from "@/pages/admin/Coaching";
import Podcasts from "@/pages/admin/Podcasts";
import Newsletters from "@/pages/admin/Newsletters";
import Campaigns from "@/pages/admin/Campaigns";
import Funnels from "@/pages/admin/Funnels";
import Automations from "@/pages/admin/Automations";
import Forms from "@/pages/admin/Forms";
import Events from "@/pages/admin/Events";
import PagesAdmin from "@/pages/admin/PagesAdmin";
import Reports from "@/pages/admin/Reports";

function LoadingScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-cream">
      <div className="flex flex-col items-center gap-3">
        <span className="size-9 animate-spin rounded-full border-2 border-lilac border-t-plum" />
        <p className="text-sm text-ink-soft">Just a moment…</p>
      </div>
    </div>
  );
}

function ProtectedRoutes() {
  const { user, loading } = useAuth();

  if (loading) return <LoadingScreen />;
  if (!user) return <Navigate to="/admin/login" replace />;

  return (
    <AdminLayout>
      <Routes>
        <Route path="/" element={<Dashboard />} />

        {/* Products */}
        <Route path="/products" element={<Products />} />
        <Route path="/courses" element={<CoursesAdmin />} />
        <Route path="/courses/:id/curriculum" element={<CourseBuilder />} />
        <Route path="/community" element={<CommunityList />} />
        <Route path="/community/:id" element={<CommunityDetail />} />
        <Route path="/media" element={<MediaLibrary />} />
        <Route path="/coaching" element={<Coaching />} />
        <Route path="/podcasts" element={<Podcasts />} />
        <Route path="/newsletters" element={<Newsletters />} />

        {/* Sales */}
        <Route path="/sales/payments" element={<PaymentsPage />} />
        <Route path="/sales/plans" element={<PlansPage />} />
        <Route path="/sales/subscriptions" element={<SubscriptionsPage />} />
        <Route path="/sales/invoices" element={<InvoicesPage />} />
        <Route path="/sales/coupons" element={<CouponsPage />} />
        <Route path="/sales/payouts" element={<PayoutsPage />} />

        {/* Website */}
        <Route path="/blog" element={<BlogList />} />
        <Route path="/blog/new" element={<BlogEditor />} />
        <Route path="/blog/:id" element={<BlogEditor />} />
        <Route path="/testimonials" element={<TestimonialsAdmin />} />
        <Route path="/resources" element={<ResourcesAdmin />} />
        <Route path="/pages" element={<PagesAdmin />} />

        {/* Marketing */}
        <Route path="/marketing/events" element={<Events />} />
        <Route path="/marketing/campaigns" element={<Campaigns />} />
        <Route path="/marketing/funnels" element={<Funnels />} />
        <Route path="/marketing/automations" element={<Automations />} />
        <Route path="/marketing/forms" element={<Forms />} />

        {/* Contacts */}
        <Route path="/leads" element={<Leads />} />
        <Route path="/conversations" element={<Conversations />} />
        <Route path="/members" element={<Members />} />
        <Route path="/subscribers" element={<Subscribers />} />

        {/* Analytics */}
        <Route path="/analytics" element={<Analytics />} />
        <Route path="/analytics/reports" element={<Reports />} />

        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Routes>
    </AdminLayout>
  );
}

export default function AdminApp() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/*" element={<ProtectedRoutes />} />
    </Routes>
  );
}
