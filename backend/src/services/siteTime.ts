import { pool } from "../db/pool";
import { isValidTimeZone } from "./availability";

/**
 * The site's own time zone — the one Kajabi showed every date in.
 *
 * QA sheet row 24: Kajabi dated a purchase "August 10, 2026 09:47 AM" and the
 * admin here said 12:47 PM, because it formatted in the viewer's browser zone
 * and the tester was in New York. Kajabi's site ran on America/Los_Angeles, and
 * the imported Kajabi timestamps all carry its -07:00/-08:00 offsets.
 *
 * Stored in `settings.site_timezone` (migration 075) and read here, briefly
 * cached, so the admin's date helper (frontend pages/admin/ui/siteTime.ts) and
 * the People filters' calendar days ("today", "this month") agree on where a
 * day starts. A missing or unreadable value falls back to Los Angeles rather
 * than to the server's own zone, which is UTC and matches nobody.
 */
export const DEFAULT_SITE_TIMEZONE = "America/Los_Angeles";

const CACHE_MS = 60_000;
let cached: { zone: string; at: number } | null = null;

export async function siteTimeZone(): Promise<string> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.zone;
  let zone = DEFAULT_SITE_TIMEZONE;
  try {
    const result = await pool.query<{ zone: string | null }>(
      `SELECT value->>'timezone' AS zone FROM settings WHERE key = 'site_timezone'`,
    );
    const stored = result.rows[0]?.zone?.trim() ?? "";
    if (stored && isValidTimeZone(stored)) zone = stored;
  } catch (err) {
    // A settings read that fails must not take the People list down with it.
    console.error("[siteTime] couldn't read the site time zone:", err);
  }
  cached = { zone, at: Date.now() };
  return zone;
}
