/** Formatting helpers shared across the admin. */

export function formatCurrency(cents: number, currency = "usd"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

/** Compact form for tiles where space is tight: $9.8k rather than $9,760.00. */
export function formatCurrencyCompact(cents: number, currency = "usd"): string {
  const value = cents / 100;
  if (Math.abs(value) < 1000) return formatCurrency(cents, currency);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(value >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** "3 days ago" / "in 2 hours" via Intl so it localises properly. */
export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return "—";
  const diffMs = new Date(iso).getTime() - Date.now();
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const divisions: [number, Intl.RelativeTimeFormatUnit][] = [
    [60_000, "second"],
    [3_600_000, "minute"],
    [86_400_000, "hour"],
    [604_800_000, "day"],
    [2_629_800_000, "week"],
    [31_557_600_000, "month"],
    [Infinity, "year"],
  ];

  let duration = diffMs;
  let unit: Intl.RelativeTimeFormatUnit = "second";
  const unitMs: Record<string, number> = {
    second: 1000,
    minute: 60_000,
    hour: 3_600_000,
    day: 86_400_000,
    week: 604_800_000,
    month: 2_629_800_000,
    year: 31_557_600_000,
  };

  for (const [limit, candidate] of divisions) {
    if (Math.abs(diffMs) < limit) {
      unit = candidate;
      duration = diffMs / unitMs[candidate];
      break;
    }
  }
  return rtf.format(Math.round(duration), unit);
}

/**
 * Percent change between two periods.
 * Returns null when the previous period was zero — "+∞%" is noise, not signal.
 */
export function percentDelta(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

/** Short axis label for a YYYY-MM-DD series point. */
export function shortDay(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
