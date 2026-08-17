import {
  BarChart3,
  CreditCard,
  Globe,
  LayoutDashboard,
  Megaphone,
  Package,
  Settings,
  Users,
  type LucideIcon,
} from "lucide-react";

/**
 * Admin information architecture.
 *
 * Mirrors the Kajabi product structure (Products / Sales / Website /
 * Marketing / Contacts / Analytics) so the mental model transfers directly.
 * `ready: false` marks a destination that renders an honest placeholder rather
 * than a half-built screen — the nav still shows the shape of the product.
 */

export interface NavChild {
  to: string;
  label: string;
  ready?: boolean;
  badge?: "leads";
}

export interface NavGroup {
  id: string;
  label: string;
  icon: LucideIcon;
  /** Single-destination groups (Dashboard, Settings) have no children. */
  to?: string;
  end?: boolean;
  children?: NavChild[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    id: "dashboard",
    label: "Dashboard",
    icon: LayoutDashboard,
    to: "/admin",
    end: true,
  },
  {
    id: "products",
    label: "Products",
    icon: Package,
    children: [
      { to: "/admin/products", label: "All Products", ready: true },
      { to: "/admin/courses", label: "Courses", ready: true },
      { to: "/admin/community", label: "Community", ready: true },
      { to: "/admin/media", label: "Media Library", ready: true },
      { to: "/admin/coaching", label: "Coaching", ready: true },
      { to: "/admin/podcasts", label: "Podcasts", ready: true },
      { to: "/admin/newsletters", label: "Newsletters", ready: true },
    ],
  },
  {
    id: "sales",
    label: "Sales",
    icon: CreditCard,
    children: [
      { to: "/admin/sales/payments", label: "Payments", ready: true },
      { to: "/admin/sales/plans", label: "Plans & Pricing", ready: true },
      { to: "/admin/sales/subscriptions", label: "Subscriptions", ready: true },
      { to: "/admin/sales/invoices", label: "Invoices", ready: true },
      { to: "/admin/sales/coupons", label: "Coupons", ready: true },
      { to: "/admin/sales/payouts", label: "Payouts", ready: true },
    ],
  },
  {
    id: "website",
    label: "Website",
    icon: Globe,
    children: [
      { to: "/admin/blog", label: "Blog Posts", ready: true },
      { to: "/admin/testimonials", label: "Testimonials", ready: true },
      { to: "/admin/resources", label: "Resources", ready: true },
      { to: "/admin/pages", label: "Pages", ready: true },
    ],
  },
  {
    id: "marketing",
    label: "Marketing",
    icon: Megaphone,
    children: [
      { to: "/admin/marketing/events", label: "Events", ready: true },
      { to: "/admin/marketing/campaigns", label: "Email Campaigns", ready: true },
      { to: "/admin/marketing/funnels", label: "Funnels", ready: true },
      { to: "/admin/marketing/automations", label: "Automations", ready: true },
      { to: "/admin/marketing/forms", label: "Forms", ready: true },
    ],
  },
  {
    id: "contacts",
    label: "Contacts",
    icon: Users,
    children: [
      { to: "/admin/leads", label: "Leads Inbox", ready: true, badge: "leads" },
      { to: "/admin/conversations", label: "Conversations", ready: true },
      { to: "/admin/members", label: "Members", ready: true },
      { to: "/admin/subscribers", label: "Subscribers", ready: true },
    ],
  },
  {
    id: "analytics",
    label: "Analytics",
    icon: BarChart3,
    children: [
      { to: "/admin/analytics", label: "Overview", ready: true },
      { to: "/admin/analytics/reports", label: "Reports", ready: true },
    ],
  },
  {
    id: "settings",
    label: "Settings",
    icon: Settings,
    to: "/admin/settings",
  },
];

/** Which group contains a given pathname — used to auto-open the active group. */
export function groupForPath(pathname: string): string | null {
  for (const group of NAV_GROUPS) {
    if (group.children?.some((c) => pathname.startsWith(c.to))) return group.id;
  }
  return null;
}
