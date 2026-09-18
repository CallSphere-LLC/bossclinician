import { Navigate, Route, Routes, useLocation } from "react-router";
import { useAuth } from "@/hooks/useAuth";
import { AdminLayout } from "@/pages/admin/AdminLayout";
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
import CommunityList from "@/pages/admin/CommunityList";
import CommunityDetail from "@/pages/admin/CommunityDetail";
import MediaLibrary from "@/pages/admin/MediaLibrary";
import TestimonialsAdmin from "@/pages/admin/TestimonialsAdmin";
import ResourcesAdmin from "@/pages/admin/ResourcesAdmin";
import Leads from "@/pages/admin/Leads";
import Contacts from "@/pages/admin/Contacts";
import ContactsInsights from "@/pages/admin/ContactsInsights";
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
import AuditLog from "@/pages/admin/AuditLog";
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
import { AdminReceiptPage } from "@/pages/admin/AdminReceipt";
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
import Forms from "@/pages/admin/Forms";
import Events from "@/pages/admin/Events";
import PagesAdmin from "@/pages/admin/PagesAdmin";
import Reports from "@/pages/admin/Reports";
import Availability from "@/pages/admin/Availability";
import MarketingOverview from "@/pages/admin/MarketingOverview";

import EmailLog from "@/pages/admin/EmailLog";
import AdminNotFound, { AliasFirst } from "@/pages/admin/AdminNotFound";
import { loginPathFor } from "@/pages/admin/adminReturnTo";

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
  const location = useLocation();

  if (loading) return <LoadingScreen />;
  // The address asked for rides along as ?next=, so signing in lands on it
  // rather than on the dashboard — see adminReturnTo.
  if (!user) return <Navigate to={loginPathFor(location)} replace />;

  return (
    <AdminLayout>
      <Routes>
        <Route path="/" element={<Dashboard />} />

        {/* Products */}
        <Route path="/products" element={<Products />} />
        <Route path="/catalogue" element={<ProductsCatalog />} />
        <Route path="/downloads" element={<ProductsCatalog downloadOnly />} />
        <Route path="/courses" element={<CoursesAdmin />} />
        <Route path="/courses/:id/curriculum" element={<CourseBuilder />} />
        <Route path="/community" element={<CommunityList />} />
        <Route path="/community/:id" element={<CommunityDetail />} />
        <Route path="/media" element={<MediaLibrary />} />
        <Route path="/coaching" element={<Coaching />} />
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
        <Route path="/sales/invoices/:id/receipt" element={<AdminReceiptPage />} />
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
        <Route path="/marketing/overview" element={<MarketingOverview />} />
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
        <Route path="/marketing/forms" element={<Forms />} />

        {/* Contacts */}
        <Route path="/contacts" element={<Contacts />} />
        <Route path="/contacts/insights" element={<ContactsInsights />} />
        {/* AliasFirst: /contacts/tags and friends are aliases, not contact ids. */}
        <Route path="/contacts/:id" element={<AliasFirst><ContactDetail /></AliasFirst>} />
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

        <Route path="/settings" element={<SettingsHub />} />
        <Route path="/settings/team" element={<AdminUsers />} />
        <Route path="/settings/connections" element={<Integrations />} />
        <Route path="/settings/availability" element={<Availability />} />
        <Route path="/settings/advanced" element={<SettingsPage />} />
        <Route path="/settings/activity" element={<AuditLog />} />
        {/* Three segments, so it is ranked above /settings/:group rather than
            competing with it: the log is a page of its own, and the address
            people write down for it used to match nothing at all. */}
        <Route path="/settings/email/log" element={<EmailLog />} />
        {/* AliasFirst: /settings/users and friends are aliases, not group keys. */}
        <Route path="/settings/:group" element={<AliasFirst><SettingsGroup /></AliasFirst>} />
        {/* Not a redirect to /admin. This answers with a 404 for a path that
            really does not exist, and with a real redirect for the handful we
            recognise from an older layout — see adminAliases. Because it only
            runs once matching has failed, an alias can never shadow a route
            added above. */}
        <Route path="*" element={<AdminNotFound />} />
      </Routes>
    </AdminLayout>
  );
}

export default function AdminApp() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      {/* The invitee has no account yet — a guard here would bounce them to a
          sign-in they cannot pass. The token in the link is the credential. */}
      <Route path="/invite/:token" element={<AcceptInvite />} />
      <Route path="/*" element={<ProtectedRoutes />} />
    </Routes>
  );
}
