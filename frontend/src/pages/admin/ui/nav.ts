import {
  BarChart3,
  Bell,
  Building2,
  CalendarDays,
  CreditCard,
  Download,
  FileText,
  FolderOpen,
  Globe,
  GraduationCap,
  HelpCircle,
  LayoutDashboard,
  Mail,
  Megaphone,
  MessagesSquare,
  Package,
  Settings,
  Share2,
  Sparkles,
  Ticket,
  Users,
  type LucideIcon,
} from "lucide-react";

/**
 * Admin information architecture — Final Sidebar & Page UX Requirements §2.
 *
 * Eight areas: Main, People, Content & Services, Engagement, Marketing,
 * Growth, Website, Administration. Plain business language throughout, and no
 * page has two homes.
 *
 * §2 kept a Customer Experience area for "existing remaining pages that are
 * not moved above". Newsletters was the only page left in it and has since
 * moved to Marketing, so the section is gone rather than left as an empty
 * heading.
 *
 * Three placements the approved list does not name, resolved here rather than
 * left to chance — §1 forbids orphaning working pages, and §2's "keep existing
 * remaining pages" clauses are the bucket for exactly this:
 *
 * - **All Products / Catalogue** sat in Main, which §2 reduces to four
 *   entries. They are the record of what a customer receives, which is what
 *   Content & Services means, so they sit there as two flat entries.
 * - **Downloads** has no screen of its own. `products.kind` already includes
 *   'download' and the catalogue groups by kind, so /admin/downloads renders
 *   the catalogue narrowed to that one kind — a view, not the duplicate page
 *   §1 rules out.
 * - **Conversations** leaves the sidebar entirely. §3 puts one-to-one
 *   conversations in the top-right Inbox, and a second entrance in the sidebar
 *   is the duplication §1 warns about.
 *
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
  /** Single-destination groups have no children. */
  to?: string;
  end?: boolean;
  /** The section caption drawn above this group. */
  section?: string;
  badge?: "leads";
  children?: NavChild[];
}

export const NAV_GROUPS: NavGroup[] = [
  /* ── Main ──────────────────────────────────────────────────────────── */
  {
    id: "dashboard",
    section: "Main",
    label: "Dashboard",
    icon: LayoutDashboard,
    to: "/admin",
    end: true,
  },
  {
    id: "calendar",
    label: "Calendar",
    icon: CalendarDays,
    to: "/admin/calendar",
  },
  {
    id: "offers",
    label: "Offers",
    icon: Ticket,
    to: "/admin/offers",
  },
  {
    // §2: "Orders & Payments remains one combined page." One entry with its
    // sub-pages beneath, rather than six siblings in the sidebar.
    id: "orders",
    label: "Orders & Payments",
    icon: CreditCard,
    children: [
      { to: "/admin/sales/payments", label: "Payments", ready: true },
      { to: "/admin/sales/subscriptions", label: "Subscriptions", ready: true },
      { to: "/admin/sales/plans", label: "Payment Plans", ready: true },
      { to: "/admin/sales/invoices", label: "Invoices", ready: true },
      { to: "/admin/sales/coupons", label: "Coupons", ready: true },
      { to: "/admin/sales/payouts", label: "Payouts", ready: true },
    ],
  },

  /* ── People ────────────────────────────────────────────────────────── */
  {
    id: "people",
    section: "People",
    label: "People",
    icon: Users,
    children: [
      { to: "/admin/contacts", label: "Everyone", ready: true },
      { to: "/admin/segments", label: "Groups", ready: true },
      { to: "/admin/tags", label: "Tags", ready: true },
      { to: "/admin/members", label: "Members", ready: true },
      { to: "/admin/subscribers", label: "Subscribers", ready: true },
    ],
  },
  {
    id: "enquiries",
    label: "Enquiries",
    icon: FileText,
    to: "/admin/leads",
    badge: "leads",
  },

  /* ── Content & services ────────────────────────────────────────────── */
  {
    id: "products",
    section: "Content & Services",
    label: "All Products",
    icon: Package,
    to: "/admin/products",
  },
  {
    id: "courses",
    label: "Courses",
    icon: GraduationCap,
    to: "/admin/courses",
  },
  {
    id: "coaching",
    label: "Coaching",
    icon: CalendarDays,
    to: "/admin/coaching",
  },
  {
    id: "community",
    label: "Community",
    icon: MessagesSquare,
    to: "/admin/community",
  },
  {
    id: "downloads",
    label: "Downloads",
    icon: Download,
    to: "/admin/downloads",
  },
  {
    id: "podcasts",
    label: "Podcasts",
    icon: Megaphone,
    to: "/admin/podcasts",
  },
  {
    id: "media",
    label: "Media Library",
    icon: FolderOpen,
    to: "/admin/media",
  },
  {
    id: "catalogue",
    label: "Catalogue",
    icon: Package,
    to: "/admin/catalogue",
    end: true,
  },

  /* ── Engagement ────────────────────────────────────────────────────── */
  {
    id: "forms",
    section: "Engagement",
    label: "Forms",
    icon: Building2,
    children: [
      { to: "/admin/marketing/forms-v2", label: "Forms", ready: true },
      { to: "/admin/marketing/funnels", label: "Funnels", ready: true },
    ],
  },
  {
    id: "quizzes",
    label: "Quizzes",
    icon: HelpCircle,
    to: "/admin/marketing/quizzes",
  },

  /* ── Marketing ─────────────────────────────────────────────────────── */
  {
    id: "email",
    section: "Marketing",
    label: "Email",
    icon: Mail,
    children: [
      { to: "/admin/marketing/campaigns", label: "Broadcasts", ready: true },
      { to: "/admin/marketing/sequences", label: "Email Series", ready: true },
      { to: "/admin/marketing/emails", label: "Templates", ready: true },
    ],
  },
  {
    id: "automations",
    label: "Automations",
    icon: Sparkles,
    // The first automations screen is deliberately not listed. It reads and
    // writes the same records as this one, in an older shape: opening an
    // automation built here and saving it there flattens its conditions into
    // text the engine cannot read, and the automation quietly stops running.
    to: "/admin/marketing/automations-v2",
  },
  {
    id: "events",
    label: "Events",
    icon: Ticket,
    children: [
      { to: "/admin/marketing/events-v2", label: "Events", ready: true },
      // Two different things were both called "Events": this one schedules an
      // event inside a community, while the one above takes registrations for
      // a webinar or a live class.
      { to: "/admin/marketing/events", label: "Community Events", ready: true },
    ],
  },
  {
    id: "affiliates",
    label: "Affiliates",
    icon: Share2,
    to: "/admin/partners",
  },
  {
    id: "social",
    label: "Social Media",
    icon: Share2,
    to: "/admin/marketing/social",
  },

  /* ── Growth ────────────────────────────────────────────────────────── */
  {
    id: "reports",
    section: "Growth",
    label: "Reports",
    icon: BarChart3,
    children: [
      { to: "/admin/analytics", label: "Overview", ready: true },
      { to: "/admin/analytics/reports", label: "Report Catalogue", ready: true },
    ],
  },

  /* ── Website ───────────────────────────────────────────────────────── */
  {
    id: "website",
    section: "Website",
    label: "Website",
    icon: Globe,
    children: [
      { to: "/admin/blog", label: "Blog Posts", ready: true },
      { to: "/admin/testimonials", label: "Testimonials", ready: true },
      { to: "/admin/resources", label: "Resources", ready: true },
      { to: "/admin/pages", label: "Pages", ready: true },
    ],
  },

  /* ── Administration ────────────────────────────────────────────────── */
  {
    id: "notifications",
    section: "Administration",
    label: "Notifications",
    icon: Bell,
    to: "/admin/notifications",
  },
  {
    id: "staff",
    label: "Staff",
    icon: Users,
    to: "/admin/settings/team",
  },
  {
    id: "integrations",
    label: "Integrations",
    icon: Building2,
    to: "/admin/settings/connections",
  },
  {
    id: "settings",
    label: "Settings",
    icon: Settings,
    to: "/admin/settings",
    end: true,
  },
];

/** Which group contains a given pathname — used to auto-open the active group. */
export function groupForPath(pathname: string): string | null {
  for (const group of NAV_GROUPS) {
    if (group.children?.some((c) => pathname.startsWith(c.to))) return group.id;
  }
  return null;
}

/**
 * The title and plain-English description every page carries — §4.
 *
 * §4 is emphatic that these are not decorative: the owner should never have to
 * guess what a page does. The wording below is the approved copy from the
 * requirements table verbatim where it was given, and written to the same
 * standard where a page was not in the table.
 *
 * Longest-prefix wins, so `/admin/sales/payments` picks the payments entry
 * rather than the `/admin/sales` one that also matches. `/admin` sits last
 * because every admin path starts with it.
 */
const PAGE_TITLES: { path: string; title: string; subtitle: string }[] = [
  /* People */
  { path: "/admin/contacts", title: "People", subtitle: "Everyone connected to your business — customers, subscribers, leads, and other contacts." },
  { path: "/admin/segments", title: "Groups", subtitle: "Saved groups of people you can email, automate against, and report on." },
  { path: "/admin/tags", title: "Tags", subtitle: "Labels you attach to people to organise them and trigger automations." },
  { path: "/admin/members", title: "Members", subtitle: "People who can sign in and use what they have bought." },
  { path: "/admin/subscribers", title: "Subscribers", subtitle: "People who have agreed to receive your marketing email." },
  { path: "/admin/leads", title: "Enquiries", subtitle: "Questions and requests received from people through your website, email, forms, applications, or other enquiry channels." },
  { path: "/admin/inbox", title: "Inbox", subtitle: "One-to-one conversations with the people who contact you." },
  { path: "/admin/conversations", title: "Inbox", subtitle: "One-to-one conversations with the people who contact you." },

  /* Content & services */
  { path: "/admin/courses", title: "Courses", subtitle: "Create and manage courses, lessons, and learning content for your customers and members." },
  { path: "/admin/coaching", title: "Coaching", subtitle: "Manage your coaching services, programs, sessions, and customer access." },
  { path: "/admin/community", title: "Community", subtitle: "Manage the space where members can connect, participate, and access community content." },
  { path: "/admin/podcasts", title: "Podcasts", subtitle: "Create and manage private or member-only podcast content." },
  { path: "/admin/media", title: "Media Library", subtitle: "Store and reuse your videos, images, PDFs, audio, and other media across Boss Clinician." },
  { path: "/admin/downloads", title: "Downloads", subtitle: "Manage downloadable resources and digital files you provide to customers or members." },
  { path: "/admin/catalogue", title: "Catalogue", subtitle: "Everything you sell or give away, grouped by what the customer receives." },
  { path: "/admin/products", title: "Products", subtitle: "What a customer receives when they buy. Pricing lives on Offers, not here." },
  { path: "/admin/newsletters", title: "Newsletters", subtitle: "The older standalone newsletter screen. Newsletters are now a kind of Broadcast." },

  /* Main */
  { path: "/admin/calendar", title: "Calendar", subtitle: "See your meetings, coaching sessions, events, and connected calendar schedule in one place." },
  { path: "/admin/offers", title: "Offers", subtitle: "Create and manage what customers can buy, including pricing and purchase options." },
  { path: "/admin/sales/payments", title: "Orders & Payments", subtitle: "See customer orders, payments, payment status, refunds, and related transaction activity." },
  { path: "/admin/sales/subscriptions", title: "Subscriptions", subtitle: "Memberships that renew on their own until somebody cancels them." },
  { path: "/admin/sales/plans", title: "Payment Plans", subtitle: "Purchases split into a fixed number of instalments that finish by themselves." },
  { path: "/admin/sales/invoices", title: "Invoices", subtitle: "What each customer was billed, and whether it was paid." },
  { path: "/admin/sales/coupons", title: "Coupons", subtitle: "Discount codes, what they take off, and how many times they can be used." },
  { path: "/admin/sales/payouts", title: "Payouts", subtitle: "Money on its way from your payment provider to your bank." },

  /* Engagement */
  { path: "/admin/marketing/forms-v2", title: "Forms", subtitle: "Create forms to collect sign-ups, applications, registrations, enquiries, and other information from your audience." },
  { path: "/admin/marketing/funnels", title: "Funnels", subtitle: "Multi-step paths that lead someone from first interest to a purchase." },
  { path: "/admin/marketing/quizzes", title: "Quizzes", subtitle: "Create interactive quizzes that use people's answers to provide a result, recommendation, or personalized outcome." },

  /* Marketing */
  { path: "/admin/marketing/campaigns", title: "Broadcasts", subtitle: "Send newsletters, promotions, announcements, event invitations, program updates, and other emails to a selected audience." },
  { path: "/admin/marketing/sequences", title: "Email Series", subtitle: "Create a series of emails that goes out in order over time. An Automation can start the series automatically when someone meets a condition." },
  { path: "/admin/marketing/emails", title: "Templates", subtitle: "Save reusable email designs and content for future emails." },
  { path: "/admin/marketing/automations-v2", title: "Automations", subtitle: "Automatically take actions when something happens in your business." },
  { path: "/admin/marketing/automations", title: "Automations (old)", subtitle: "The earlier automations screen, kept reachable while anything still uses it." },
  { path: "/admin/marketing/events-v2", title: "Events", subtitle: "Create and promote webinars, workshops, masterclasses, live sessions, registrations, and attendee communications." },
  { path: "/admin/marketing/events", title: "Community Events", subtitle: "Events that happen inside one of your communities." },
  { path: "/admin/marketing/social", title: "Social Media", subtitle: "Access and manage the social platforms Boss Clinician uses for marketing from one place." },
  { path: "/admin/partners", title: "Affiliates", subtitle: "Manage people who refer customers to Boss Clinician and track referral links, sales, commissions, and payouts." },

  /* Growth */
  { path: "/admin/analytics/reports", title: "Reports", subtitle: "The full catalogue of reports on how your business is performing." },
  { path: "/admin/analytics", title: "Analytics", subtitle: "How the business is performing, at a glance." },

  /* Website */
  { path: "/admin/blog", title: "Blog Posts", subtitle: "Write and publish articles on your website." },
  { path: "/admin/testimonials", title: "Testimonials", subtitle: "What your clients say about working with you." },
  { path: "/admin/resources", title: "Resources", subtitle: "Free guides and downloads you offer on your website." },
  { path: "/admin/pages", title: "Pages", subtitle: "Standalone pages on your website." },

  /* Administration */
  { path: "/admin/notifications", title: "Notifications", subtitle: "Review important system and business notifications that may need your attention." },
  { path: "/admin/settings/team", title: "Staff", subtitle: "Manage Boss Clinician team members, their roles, and their access." },
  { path: "/admin/settings/connections", title: "Integrations", subtitle: "Connect Boss Clinician with the external services and platforms your business uses." },
  { path: "/admin/settings", title: "Settings", subtitle: "Manage the main account, business, security, and platform settings." },

  { path: "/admin", title: "Dashboard", subtitle: "See the most important activity, performance, upcoming work, and items that need your attention." },
];

export function pageHeadingForPath(pathname: string): { title: string; subtitle: string } {
  const match = PAGE_TITLES.filter((entry) => pathname.startsWith(entry.path)).sort(
    (a, b) => b.path.length - a.path.length,
  )[0];
  return match ?? { title: "Boss Clinician", subtitle: "Admin" };
}

/** Which sidebar area a path belongs to — the category label above a title. */
export function sectionForPath(pathname: string): string {
  let current = "";
  for (const group of NAV_GROUPS) {
    if (group.section) current = group.section;
    const hit =
      (group.to && pathname.startsWith(group.to.split("?")[0]) && group.to !== "/admin") ||
      group.children?.some((c) => pathname.startsWith(c.to));
    if (hit) return current;
  }
  return "Main";
}

/**
 * Descriptions for sub-pages and tabs that are not routes of their own — §5.
 *
 * Keyed by a stable slug the screen passes in, because these live inside a
 * tabbed page and share its URL.
 */
export const TAB_DESCRIPTIONS: Record<string, string> = {
  "quiz-responses": "See how people answered your quiz and the result each person received.",
  "quiz-results": "Create and manage the outcomes people can receive based on their quiz answers.",
  "form-submissions": "See the information people submitted through this form.",
  "event-attendees": "See who registered, who attended, and the status of each attendee.",
  "course-lessons": "Organize the lessons and learning material included in this course.",
  "coaching-offers": "The coaching packages people can buy, and what each one includes.",
  "coaching-sessions": "Every session booked, with its time, its client, and where it stands.",
  "community-channels": "The spaces inside this community where members post and reply.",
  "community-members": "Who has joined this community, and what they can do in it.",
};
