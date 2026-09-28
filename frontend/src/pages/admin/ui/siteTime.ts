import { useEffect, useSyncExternalStore } from "react";
import { sessionFetch } from "@/lib/adminTransport";

/**
 * Dates and times in the site's own time zone, the way Kajabi showed them.
 *
 * QA sheet row 24: Kajabi said a purchase happened on "August 10, 2026 09:47
 * AM"; the admin here said "Aug 10, 12:47 PM", because `lib/format.ts` formats
 * in whatever zone the viewer's browser is in, and the tester was in New York.
 * Kajabi shows everything in the site's zone (America/Los_Angeles for Boss
 * Clinician), so the owner, her assistant and the tester all read the same
 * clock whatever city they are in.
 *
 * The zone is the server's (`GET /admin/contacts/site-time`, stored in
 * `settings.site_timezone` by migration 075), fetched once per page load and
 * shared by every screen that asks. Until it arrives — and if it never does —
 * Los Angeles is used, which is what the setting holds anyway, so nothing
 * visibly shifts when it lands.
 *
 * Any admin screen can use this. The contacts screens do today; the others
 * still use lib/format.ts and so still show the viewer's own zone.
 */

export const DEFAULT_SITE_TIMEZONE = "America/Los_Angeles";

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "/api";

let zone = DEFAULT_SITE_TIMEZONE;
let pending: Promise<string> | null = null;
const listeners = new Set<() => void>();

function validZone(candidate: unknown): candidate is string {
  if (typeof candidate !== "string" || !candidate) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate });
    return true;
  } catch {
    return false;
  }
}

/** Asks the server once; every later caller shares the answer. */
export function loadSiteTimeZone(): Promise<string> {
  if (!pending) {
    pending = sessionFetch(`${API_BASE}/admin/contacts/site-time`)
      .then((res) => (res.ok ? (res.json() as Promise<{ timezone?: unknown }>) : { timezone: undefined }))
      .then((body) => {
        if (validZone(body.timezone) && body.timezone !== zone) {
          zone = body.timezone;
          listeners.forEach((notify) => notify());
        }
        return zone;
      })
      .catch(() => {
        // Try again on the next screen rather than never.
        pending = null;
        return zone;
      });
  }
  return pending;
}

function subscribe(notify: () => void): () => void {
  listeners.add(notify);
  return () => listeners.delete(notify);
}

/** The site's zone, re-rendering the caller once the server's answer arrives. */
export function useSiteTimeZone(): string {
  useEffect(() => {
    void loadSiteTimeZone();
  }, []);
  return useSyncExternalStore(subscribe, () => zone, () => zone);
}

/* -------------------------------------------------------------- formatting */

/** A bare calendar day — "2026-08-18" — which names a day, not an instant. */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Kajabi's own timestamp shape, as the importer kept it in custom fields:
 * `2026-09-18 08:20:23 -0700`. Safari will not parse it; this rewrites it as
 * ISO 8601 (the same reading the server's importer gives it).
 */
const KAJABI_STAMP = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)\s*([+-]\d{2}):?(\d{2})$/;

/** A stored value → an instant, or null when it isn't one. */
export function parseStamp(value: string | null | undefined): Date | null {
  if (!value) return null;
  const raw = value.trim();
  const kajabi = KAJABI_STAMP.exec(raw);
  const at = new Date(kajabi ? `${kajabi[1]}T${kajabi[2]}${kajabi[3]}:${kajabi[4]}` : raw);
  return Number.isNaN(at.getTime()) ? null : at;
}

type Parts = Partial<Record<Intl.DateTimeFormatPartTypes, string>>;

function partsOf(at: Date, options: Intl.DateTimeFormatOptions): Parts {
  const parts: Parts = {};
  for (const part of new Intl.DateTimeFormat("en-US", options).formatToParts(at)) parts[part.type] = part.value;
  return parts;
}

/** "Aug 10, 2026" — a day on the site's calendar. */
export function formatSiteDate(value: string | null | undefined, timeZone = zone): string {
  if (!value) return "—";
  // A day with no time on it is the same day everywhere; don't move it.
  if (DATE_ONLY.test(value.trim())) {
    const p = partsOf(new Date(`${value.trim()}T12:00:00Z`), { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });
    return `${p.month} ${p.day}, ${p.year}`;
  }
  const at = parseStamp(value);
  if (!at) return "—";
  const p = partsOf(at, { timeZone, month: "short", day: "numeric", year: "numeric" });
  return `${p.month} ${p.day}, ${p.year}`;
}

/**
 * "Aug 10, 2026 9:47 AM" — the short form, for lists and the feed. Built from
 * parts because Intl puts a comma after the year that Kajabi doesn't.
 */
export function formatSiteDateTime(value: string | null | undefined, timeZone = zone): string {
  const at = parseStamp(value);
  if (!at) return "—";
  const p = partsOf(at, {
    timeZone,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  return `${p.month} ${p.day}, ${p.year} ${p.hour}:${p.minute} ${p.dayPeriod}`;
}

/** "August 10, 2026 09:47 AM" — Kajabi's long form, for "Added on" and "Customer since". */
export function formatSiteDateTimeLong(value: string | null | undefined, timeZone = zone): string {
  const at = parseStamp(value);
  if (!at) return "—";
  const p = partsOf(at, {
    timeZone,
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
  return `${p.month} ${p.day}, ${p.year} ${p.hour}:${p.minute} ${p.dayPeriod}`;
}

/** "Pacific Time" — for a hint beside the times, so nobody wonders whose clock it is. */
export function siteZoneName(timeZone = zone, at: Date = new Date()): string {
  const name = partsOf(at, { timeZone, timeZoneName: "longGeneric" }).timeZoneName;
  return name || timeZone;
}

/**
 * The formatters bound to the site's zone, re-rendering when it loads.
 *
 *   const time = useSiteTime();
 *   time.dateTime(order.createdAt) // "Aug 10, 2026 9:47 AM"
 */
export function useSiteTime() {
  const timeZone = useSiteTimeZone();
  return {
    timeZone,
    zoneName: siteZoneName(timeZone),
    date: (value: string | null | undefined) => formatSiteDate(value, timeZone),
    dateTime: (value: string | null | undefined) => formatSiteDateTime(value, timeZone),
    dateTimeLong: (value: string | null | undefined) => formatSiteDateTimeLong(value, timeZone),
  };
}
