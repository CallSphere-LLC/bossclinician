import { ApiError, getToken } from "@/lib/api";

/**
 * The unified calendar client — Calendar addendum §5.
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

export type CalendarSource = "boss-clinician" | "google" | "outlook";
export type CalendarKind = "coaching" | "event" | "community-event";

export interface CalendarEntry {
  id: string;
  kind: CalendarKind;
  source: CalendarSource;
  title: string;
  start: string;
  end: string | null;
  timezone: string | null;
  attendee: string | null;
  attendeeEmail: string | null;
  type: string;
  location: string | null;
  status: string;
  to: string;
  detail: { label: string; value: string }[];
}

export interface CalendarResponse {
  range: { from: string; to: string };
  entries: CalendarEntry[];
  connections: {
    google: {
      available: boolean;
      connected: boolean;
      account: string | null;
      lastSyncedAt: string | null;
    };
  };
}

export const calendarApi = {
  range: (from: string, to: string) =>
    request<CalendarResponse>(`/admin/calendar?from=${from}&to=${to}`),
};

/* ── Date helpers ───────────────────────────────────────────────────────── */
/*
 * Everything here works in the browser's local time, which is the timezone the
 * operator is actually sitting in. The API answers in UTC instants; a calendar
 * grid that bucketed those by their UTC date would file a 9pm session under
 * tomorrow for anyone west of Greenwich.
 */

/** Local calendar day as YYYY-MM-DD. `toISOString` would shift it after 7pm ET. */
export function dayKey(date: Date): string {
  return new Intl.DateTimeFormat("en-CA").format(date);
}

export function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

export function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  // Anchor to the 1st before shifting: adding a month to the 31st otherwise
  // lands in the month after next.
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  return d;
}

/** Monday-first week start. */
export function startOfWeek(date: Date): Date {
  const d = startOfDay(date);
  const shift = (d.getDay() + 6) % 7;
  return addDays(d, -shift);
}

export function startOfMonth(date: Date): Date {
  const d = startOfDay(date);
  d.setDate(1);
  return d;
}

/** The 6×7 grid a month view draws, including the spill from either side. */
export function monthGrid(month: Date): Date[] {
  const first = startOfWeek(startOfMonth(month));
  return Array.from({ length: 42 }, (_, i) => addDays(first, i));
}

export function isSameDay(a: Date, b: Date): boolean {
  return dayKey(a) === dayKey(b);
}

export function isSameMonth(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** "2:00 – 3:00 PM", or just the start when nothing knows how long it runs. */
export function formatRange(entry: CalendarEntry): string {
  const start = formatTime(entry.start);
  return entry.end ? `${start} – ${formatTime(entry.end)}` : start;
}

/** Group entries by local day, for the month and agenda views. */
export function byDay(entries: CalendarEntry[]): Map<string, CalendarEntry[]> {
  const map = new Map<string, CalendarEntry[]>();
  for (const entry of entries) {
    const key = dayKey(new Date(entry.start));
    const list = map.get(key);
    if (list) list.push(entry);
    else map.set(key, [entry]);
  }
  return map;
}

/** The viewer's timezone, shown once in the header so times are unambiguous. */
export function localZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "your local time";
  } catch {
    return "your local time";
  }
}
