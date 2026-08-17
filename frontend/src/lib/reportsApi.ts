import { ApiError, getToken } from "@/lib/api";

/**
 * The reports and dashboard client.
 *
 * Kept off `lib/api.ts` because that file is shared by every other screen and
 * this one carries a vocabulary only these three screens speak: a report is a
 * catalogue entry, a range, and one common result shape that every one of the
 * thirty-eight reports answers in.
 *
 * The server sends numbers and format hints — `money`, `count`, `percent` — and
 * nothing else. Turning those into "£1,240" or "12.4%" happens here, in one
 * place, so the tile, the chart tooltip, the totals row and the breakdown table
 * cannot drift into printing the same figure three different ways.
 */

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "/api";

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers = new Headers(options.headers);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });

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

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/* ── Shapes ─────────────────────────────────────────────────────────────── */

export type ValueFormat = "money" | "count" | "percent";

export interface ReportPoint {
  date: string;
  value: number;
}

export interface ReportSeries {
  label: string;
  format: ValueFormat;
  points: ReportPoint[];
}

export interface ReportTotal {
  label: string;
  value: number;
  format: ValueFormat;
}

export interface ReportBreakdownRow {
  label: string;
  value: number;
  count: number;
}

export interface ReportComparison {
  from: string;
  to: string;
  totals: Record<string, ReportTotal>;
  change: Record<string, number | null>;
  /** The earlier period's daily values, aligned by position with the series. */
  points?: number[];
}

export interface ReportCatalogueEntry {
  id: string;
  name: string;
  group: string;
  description: string;
  dimensions?: { key: string; label: string }[];
}

export interface ReportCatalogue {
  groups: string[];
  reports: ReportCatalogueEntry[];
  figuresUpdatedAt: string | null;
}

export interface ReportResult extends ReportCatalogueEntry {
  dimension: string | null;
  from: string;
  to: string;
  series: ReportSeries[];
  totals: Record<string, ReportTotal>;
  comparison?: ReportComparison;
  breakdown?: ReportBreakdownRow[];
  breakdownLabel?: string;
  breakdownValueLabel?: string;
  breakdownCountLabel?: string;
  breakdownFormat?: ValueFormat;
  breakdownCountFormat?: ValueFormat;
  currency: string;
  note?: string;
}

export interface SavedView {
  id: number;
  name: string;
  slug: string | null;
  description: string;
  kind: string;
  config: {
    reportId: string;
    days: number | null;
    from: string | null;
    to: string | null;
    compare: "previous" | "none";
    dimension: string | null;
  };
  createdAt: string;
  updatedAt: string;
}

export interface SaveViewPayload {
  name: string;
  description?: string;
  reportId: string;
  days?: number;
  from?: string;
  to?: string;
  compare: "previous" | "none";
  dimension?: string;
}

export interface DashboardTile {
  key: string;
  label: string;
  description: string;
  format: "money" | "count";
  currency: string;
  value: number;
  previousValue: number | null;
  changePercent: number | null;
  sparkline: ReportPoint[];
  reportId: string | null;
}

export interface DashboardBalance {
  available: { amountCents: number; currency: string }[];
  pending: { amountCents: number; currency: string }[];
}

export interface DashboardOverview {
  range: { from: string; to: string; previousFrom: string; previousTo: string; days: number };
  figuresUpdatedAt: string | null;
  tiles: DashboardTile[];
  /** Absent entirely when card payments aren't set up — never a zero. */
  balance?: DashboardBalance;
}

/* ── Range helpers ──────────────────────────────────────────────────────── */

/** Local calendar day as YYYY-MM-DD. `toISOString` would shift it in the evening. */
export function today(): string {
  return new Intl.DateTimeFormat("en-CA").format(new Date());
}

export function shiftDay(from: string, days: number): string {
  const at = new Date(`${from}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

/** The ranges she actually asks for, in her words. */
export const RANGE_PRESETS = [
  { key: "7", label: "Last 7 days", days: 7 },
  { key: "30", label: "Last 30 days", days: 30 },
  { key: "90", label: "Last 3 months", days: 90 },
  { key: "365", label: "Last 12 months", days: 365 },
] as const;

/* ── Formatting ─────────────────────────────────────────────────────────── */

/**
 * A figure with its unit.
 *
 * `mixed` is the rollup's honest answer when a day's takings span more than one
 * currency; it cannot be printed with a symbol without lying about it, so it is
 * printed as a plain number and the screen carries the explanation.
 */
export function formatValue(value: number, format: ValueFormat, currency = "usd"): string {
  if (format === "percent") return `${value}%`;
  if (format === "count") return new Intl.NumberFormat("en-US").format(value);

  if (currency === "mixed") {
    return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2 }).format(value / 100);
  }
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency.toUpperCase(),
      maximumFractionDigits: 2,
    }).format(value / 100);
  } catch {
    // An unrecognised code would otherwise throw and blank the whole screen.
    return `${currency.toUpperCase()} ${(value / 100).toFixed(2)}`;
  }
}

/* ── Calls ──────────────────────────────────────────────────────────────── */

interface RunOptions {
  from?: string;
  to?: string;
  compare?: "previous" | "none";
  dimension?: string;
}

function runQuery(options: RunOptions): string {
  const params = new URLSearchParams();
  if (options.from) params.set("from", options.from);
  if (options.to) params.set("to", options.to);
  if (options.compare) params.set("compare", options.compare);
  if (options.dimension) params.set("dimension", options.dimension);
  const query = params.toString();
  return query ? `?${query}` : "";
}

export const reportsApi = {
  catalogue: () => request<ReportCatalogue>("/admin/reports"),

  run: (id: string, options: RunOptions = {}) =>
    request<ReportResult>(`/admin/reports/${encodeURIComponent(id)}${runQuery(options)}`),

  dashboard: (days = 30) => request<DashboardOverview>(`/admin/dashboard?days=${days}`),

  savedViews: () => request<SavedView[]>("/admin/reports/saved"),

  saveView: (payload: SaveViewPayload) =>
    request<SavedView>("/admin/reports/saved", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  updateView: (id: number, payload: SaveViewPayload) =>
    request<SavedView>(`/admin/reports/saved/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),

  deleteView: (id: number) =>
    request<void>(`/admin/reports/saved/${id}`, { method: "DELETE" }),

  refresh: (from?: string, to?: string) =>
    request<{ queued: boolean; from: string; to: string }>("/admin/reports/refresh", {
      method: "POST",
      body: JSON.stringify({ from, to }),
    }),

  /**
   * Downloads the spreadsheet.
   *
   * Fetched rather than linked because the API wants an Authorization header,
   * and an <a href> cannot carry one. The blob is released immediately after the
   * click so a morning of exports does not hold every file in memory.
   */
  async downloadCsv(id: string, name: string, options: RunOptions = {}): Promise<void> {
    const token = getToken();
    const res = await fetch(
      `${API_BASE}/admin/reports/${encodeURIComponent(id)}/export.csv${runQuery(options)}`,
      { headers: token ? { Authorization: `Bearer ${token}` } : {} },
    );
    if (!res.ok) throw new ApiError("That download didn't work.", res.status);

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  },
};
