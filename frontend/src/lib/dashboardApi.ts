import { ApiError, getToken } from "@/lib/api";
import type { ReportPoint, ValueFormat } from "@/lib/reportsApi";

/**
 * The home dashboard's client — Part II §14, §18–§30.
 *
 * Separate from `reportsApi` because the shapes differ in kind: a report is one
 * question answered over a range, where these are the panels of a command
 * centre, each with its own vocabulary. They share the report client's
 * `formatValue`, so a figure printed here and the same figure printed in a
 * report cannot disagree.
 *
 * Every section below is **optional**. The server omits a section the signed-in
 * role may not see rather than sending it empty, so `undefined` here means
 * "not permitted or not applicable" and `[]` means "permitted, and there is
 * nothing in it" — two states the UI renders very differently (§43).
 */

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "/api";

async function request<T>(path: string): Promise<T> {
  const token = getToken();
  const headers = new Headers({ "Content-Type": "application/json" });
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(`${API_BASE}${path}`, { headers });
  if (!res.ok) {
    let message = "Something went wrong. Please try again in a moment.";
    try {
      const body = (await res.json()) as { error?: string; message?: string };
      message = body.error ?? body.message ?? message;
    } catch {
      // A non-JSON body tells us nothing worth showing.
    }
    throw new ApiError(message, res.status);
  }
  return (await res.json()) as T;
}

/* ── §14 KPIs ───────────────────────────────────────────────────────────── */

export interface Kpi {
  key: string;
  label: string;
  description: string;
  format: ValueFormat;
  currency: string;
  value: number;
  previousValue: number | null;
  changePercent: number | null;
  sparkline: number[];
  sense: "higher-is-better" | "lower-is-better" | "neutral";
  to: string | null;
}

export interface RevenueSeries {
  gross: ReportPoint[];
  net: ReportPoint[];
  subscriptions: ReportPoint[];
  currency: string;
  summary: {
    grossCents: number;
    netCents: number;
    refundCents: number;
    subscriptionCents: number;
    averageOrderCents: number;
    orders: number;
  };
}

export interface DashboardMoney {
  range: { from: string; to: string; previousFrom: string; previousTo: string; days: number };
  figuresUpdatedAt: string | null;
  kpis: { primary: Kpi[]; secondary: Kpi[] };
  revenue: RevenueSeries;
  /** Absent entirely when card payments aren't set up — never a zero (§14). */
  balance?: {
    available: { amountCents: number; currency: string }[];
    pending: { amountCents: number; currency: string }[];
  };
}

/* ── §19 Needs attention ────────────────────────────────────────────────── */

export type AttentionSeverity = "critical" | "warning" | "info";

export interface AttentionItem {
  key: string;
  title: string;
  detail: string;
  count: number;
  severity: AttentionSeverity;
  actionLabel: string;
  to: string;
}

/* ── §20 Today ──────────────────────────────────────────────────────────── */

export interface TodayEntry {
  key: string;
  at: string;
  title: string;
  subtitle: string;
  kind: "coaching" | "community-event" | "event";
  to: string;
}

/* ── §21–§30 Pulse ──────────────────────────────────────────────────────── */

export interface ProgramRow {
  id: number;
  title: string;
  kind: string;
  members: number;
  revenueCents: number;
  /** Null when the product is not a course — not the same as 0%. */
  completionPercent: number | null;
}

export interface RecentSale {
  id: number;
  customer: string;
  email: string;
  offer: string;
  type: string;
  amountCents: number;
  currency: string;
  status: string;
  at: string;
}

export interface DashboardPulse {
  days: number;
  programs?: ProgramRow[];
  sales?: {
    purchases: number;
    refunds: number;
    upsells: number;
    recoveredCheckouts: number;
    abandonedCheckouts: number;
    recent: RecentSale[];
  };
  contacts?: {
    total: number;
    newThisPeriod: number;
    members: number;
    subscribed: number;
    topCustomer: { name: string; email: string; lifetimeValueCents: number } | null;
  };
  marketing?: {
    sends: number;
    opens: number;
    clicks: number;
    unsubscribes: number;
    openRate: number | null;
    clickRate: number | null;
    unsubscribeRate: number | null;
    activeSequences: number;
    activeAutomations: number;
  };
  courses?: { id: number; title: string; learners: number; completionPercent: number }[];
  coaching?: {
    today: number;
    thisWeek: number;
    completed: number;
    cancelled: number;
    upcoming: number;
    next: { id: number; at: string; title: string; member: string }[];
  };
  community?: {
    activeMembers: number;
    postsThisWeek: number;
    commentsThisWeek: number;
    reportedPosts: number;
  };
  applications?: { status: string; count: number }[];
  activity?: {
    id: number;
    kind: string;
    title: string;
    at: string;
    contactId: number | null;
    person: string;
  }[];
}

export const dashboardApi = {
  money: (days = 30) => request<DashboardMoney>(`/admin/dashboard?days=${days}`),
  attention: () => request<{ items: AttentionItem[] }>("/admin/dashboard/attention"),
  today: () => request<{ entries: TodayEntry[] }>("/admin/dashboard/today"),
  pulse: (days = 30) => request<DashboardPulse>(`/admin/dashboard/pulse?days=${days}`),
};

/* ── §11 Date range ─────────────────────────────────────────────────────── */

export interface RangeOption {
  key: string;
  label: string;
  days: number;
}

/**
 * The presets §11 names. "Today" is one day of data, and comparing it against
 * yesterday is exactly what the previous-period comparison already does, so it
 * needs no special case.
 */
export const DASHBOARD_RANGES: RangeOption[] = [
  { key: "today", label: "Today", days: 2 },
  { key: "7", label: "7 days", days: 7 },
  { key: "30", label: "30 days", days: 30 },
  { key: "90", label: "90 days", days: 90 },
];

/** "vs previous 30 days" — the comparison line every KPI card carries (§12). */
export function comparisonLabel(days: number): string {
  if (days <= 2) return "vs yesterday";
  return `vs previous ${days} days`;
}
