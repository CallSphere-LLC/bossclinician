import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { AdminLayout } from "@/pages/admin/AdminLayout";
import { ConsoleThemeProvider } from "@/pages/admin/ui/theme";
import Login from "@/pages/admin/Login";
import Dashboard from "@/pages/admin/Dashboard";
import Products from "@/pages/admin/Products";
import ProductsCatalog from "@/pages/admin/ProductsCatalog";
import Offers from "@/pages/admin/Offers";
import OfferEditor from "@/pages/admin/OfferEditor";
import BlogList from "@/pages/admin/BlogList";
import BlogEditor from "@/pages/admin/BlogEditor";
import CoursesAdmin from "@/pages/admin/CoursesAdmin";
import CourseBuilder from "@/pages/admin/CourseBuilder";
import CoursePreview from "@/pages/admin/CoursePreview";
import CommunityList from "@/pages/admin/CommunityList";
import CommunityDetail from "@/pages/admin/CommunityDetail";
import MediaLibrary from "@/pages/admin/MediaLibrary";
import TestimonialsAdmin from "@/pages/admin/TestimonialsAdmin";
import ResourcesAdmin from "@/pages/admin/ResourcesAdmin";
import Leads from "@/pages/admin/Leads";
import Contacts from "@/pages/admin/Contacts";
import ContactDetail from "@/pages/admin/ContactDetail";
import Tags from "@/pages/admin/Tags";
import Segments from "@/pages/admin/Segments";
import Conversations from "@/pages/admin/Conversations";
import Members from "@/pages/admin/Members";
import Subscribers from "@/pages/admin/Subscribers";
import Analytics from "@/pages/admin/Analytics";
import SettingsPage from "@/pages/admin/Settings";
import Affiliates from "@/pages/admin/Affiliates";
import AffiliateDetail from "@/pages/admin/AffiliateDetail";
import SettingsHub from "@/pages/admin/SettingsHub";
import SettingsGroup from "@/pages/admin/SettingsGroup";
import AdminUsers from "@/pages/admin/AdminUsers";
import Integrations from "@/pages/admin/Integrations";
import AcceptInvite from "@/pages/admin/AcceptInvite";
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
import Sequences from "@/pages/admin/Sequences";
import SequenceEditor from "@/pages/admin/SequenceEditor";
import AutomationBuilder from "@/pages/admin/AutomationBuilder";
import EmailTemplates from "@/pages/admin/EmailTemplates";
import Assessments from "@/pages/admin/Assessments";
import AssessmentEditor from "@/pages/admin/AssessmentEditor";
import EventsAdmin from "@/pages/admin/EventsAdmin";
import FormBuilder from "@/pages/admin/FormBuilder";
import ReportsHub from "@/pages/admin/ReportsHub";
import ReportView from "@/pages/admin/ReportView";
import Events from "@/pages/admin/Events";
import PagesAdmin from "@/pages/admin/PagesAdmin";
import Reports from "@/pages/admin/Reports";
import NotificationsPage from "@/pages/admin/Notifications";
import CalendarPage from "@/pages/admin/Calendar";
import SocialMedia from "@/pages/admin/SocialMedia";

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
        <Route path="/catalogue" element={<ProductsCatalog />} />
        {/* The same catalogue screen, narrowed to one kind — not a second page. */}
        <Route
          path="/downloads"
          element={
            <ProductsCatalog
              restrictKind="download"
              heading="Downloads"
              description="Manage downloadable resources and digital files you provide to customers or members."
            />
          }
        />
        <Route path="/courses" element={<CoursesAdmin />} />
        <Route path="/courses/:id/curriculum" element={<CourseBuilder />} />
        <Route path="/courses/:id/preview" element={<CoursePreview />} />
        <Route path="/community" element={<CommunityList />} />
        <Route path="/community/:id" element={<CommunityDetail />} />
        <Route path="/media" element={<MediaLibrary />} />
        <Route path="/coaching" element={<Coaching />} />
        <Route path="/calendar" element={<CalendarPage />} />
        <Route path="/podcasts" element={<Podcasts />} />
        <Route path="/newsletters" element={<Newsletters />} />

        {/* Sales */}
        <Route path="/offers" element={<Offers />} />
        <Route path="/offers/new" element={<OfferEditor />} />
        <Route path="/offers/:id" element={<OfferEditor />} />
        <Route path="/sales/payments" element={<PaymentsPage />} />
        <Route path="/sales/plans" element={<PlansPage />} />
        <Route path="/sales/subscriptions" element={<SubscriptionsPage />} />
        <Route path="/sales/invoices" element={<InvoicesPage />} />
        <Route path="/sales/coupons" element={<CouponsPage />} />
        <Route path="/sales/payouts" element={<PayoutsPage />} />
        <Route path="/partners" element={<Affiliates />} />
        <Route path="/partners/:id" element={<AffiliateDetail />} />

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
        <Route path="/marketing/sequences" element={<Sequences />} />
        <Route path="/marketing/sequences/:id" element={<SequenceEditor />} />
        <Route path="/marketing/automations-v2" element={<AutomationBuilder />} />
        <Route path="/marketing/emails" element={<EmailTemplates />} />
        <Route path="/marketing/automations" element={<Automations />} />
        <Route path="/marketing/quizzes" element={<Assessments />} />
        <Route path="/marketing/quizzes/:id" element={<AssessmentEditor />} />
        <Route path="/marketing/events-v2" element={<EventsAdmin />} />
        <Route path="/marketing/forms-v2" element={<FormBuilder />} />
        <Route path="/marketing/social" element={<SocialMedia />} />

        {/* Contacts */}
        <Route path="/contacts" element={<Contacts />} />
        <Route path="/contacts/:id" element={<ContactDetail />} />
        <Route path="/tags" element={<Tags />} />
        <Route path="/segments" element={<Segments />} />
        <Route path="/leads" element={<Leads />} />
        <Route path="/conversations" element={<Conversations />} />
        <Route path="/members" element={<Members />} />
        <Route path="/subscribers" element={<Subscribers />} />

        {/* Analytics */}
        <Route path="/analytics" element={<Analytics />} />
        <Route path="/analytics/reports" element={<ReportsHub />} />
        <Route path="/analytics/reports/:reportId" element={<ReportView />} />
        {/* The previous four-report screen, kept reachable rather than deleted:
            it still works, and nothing is lost if the new hub has a gap. */}
        <Route path="/analytics/reports-legacy" element={<Reports />} />

        {/* Administration (§5) */}
        <Route path="/notifications" element={<NotificationsPage />} />

        <Route path="/settings" element={<SettingsHub />} />
        <Route path="/settings/team" element={<AdminUsers />} />
        <Route path="/settings/connections" element={<Integrations />} />
        <Route path="/settings/advanced" element={<SettingsPage />} />
        <Route path="/settings/:group" element={<SettingsGroup />} />
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Routes>
    </AdminLayout>
  );
}

export default function AdminApp() {
  return (
    // Outside the auth guard on purpose: the sign-in and invite screens are
    // part of the console and are read in whichever theme the operator set,
    // not in the marketing palette (Part II §6).
    <ConsoleThemeProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        {/* The invitee has no account yet — a guard here would bounce them to a
            sign-in they cannot pass. The token in the link is the credential. */}
        <Route path="/invite/:token" element={<AcceptInvite />} />
        <Route path="/*" element={<ProtectedRoutes />} />
      </Routes>
    </ConsoleThemeProvider>
  );
}
