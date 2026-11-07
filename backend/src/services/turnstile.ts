import { isIP } from "node:net";
import { readSetting } from "./settings";

/**
 * Cloudflare Turnstile, server half.
 *
 * The settings screen has offered "Cloudflare's checkbox" since form_settings
 * was defined, and the public settings endpoint has published the site key,
 * but until this file nothing checked a token: choosing Turnstile changed the
 * page and protected nothing. The widget proves nothing on its own — a script
 * can post straight to /api/leads — so the token is only worth anything once
 * it is sent back to Cloudflare with the secret.
 */

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const VERIFY_TIMEOUT_MS = 5_000;

/** The 400 a missing or rejected token gets. `error` matches errorHandler's shape. */
export const CAPTCHA_FAILED_MESSAGE = "Please complete the security check and try again.";
export const CAPTCHA_FAILED_BODY = {
  error: CAPTCHA_FAILED_MESSAGE,
  code: "captcha_failed",
  message: CAPTCHA_FAILED_MESSAGE,
} as const;

/** The lead sources whose form renders the widget. Others are unchanged. */
const TURNSTILE_SOURCES = new Set(["contact"]);

export interface TurnstileConfig {
  spamProtection: string;
  turnstileSiteKey: string;
  turnstileSecret: string;
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function turnstileConfig(raw: Record<string, unknown>): TurnstileConfig {
  return {
    spamProtection: str(raw.spamProtection),
    turnstileSiteKey: str(raw.turnstileSiteKey),
    turnstileSecret: str(raw.turnstileSecret),
  };
}

/**
 * Whether this submission must carry a valid token.
 *
 * All four, not just the switch: a site key without a secret would turn every
 * contact enquiry into a 400 nobody can get past, and a secret without a site
 * key means the page never drew the widget, so no visitor could have a token.
 */
export function turnstileRequired(config: TurnstileConfig, source: string): boolean {
  return (
    config.spamProtection === "turnstile" &&
    config.turnstileSiteKey !== "" &&
    config.turnstileSecret !== "" &&
    TURNSTILE_SOURCES.has(source)
  );
}

/**
 * Only an address worth telling Cloudflare about.
 *
 * req.ip is a constant cluster-internal address in production (the `trust
 * proxy` note in app.ts), and siteverify treats `remoteip` as a signal. A
 * private or loopback address is not the visitor's, so it is left out rather
 * than sent as a wrong answer.
 */
export function publicRemoteIp(ip: string | undefined): string | undefined {
  if (!ip) return undefined;
  const addr = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  const family = isIP(addr);
  if (family === 4) {
    const [a, b] = addr.split(".").map(Number);
    if (a === 10 || a === 127 || a === 0) return undefined;
    if (a === 172 && b >= 16 && b <= 31) return undefined;
    if (a === 192 && b === 168) return undefined;
    if (a === 169 && b === 254) return undefined;
    if (a === 100 && b >= 64 && b <= 127) return undefined; // CGNAT
    return addr;
  }
  if (family === 6) {
    const lower = addr.toLowerCase();
    if (lower === "::1" || lower === "::") return undefined;
    if (/^f[cd]/.test(lower) || /^fe[89ab]/.test(lower)) return undefined;
    return addr;
  }
  return undefined;
}

/**
 * Asks Cloudflare whether a widget token is genuine.
 *
 * Never throws. Anything other than an explicit `success: true` — a rejected
 * token, a non-200, an unreadable body, Cloudflare unreachable or slower than
 * five seconds — is false: an outage at Cloudflare must not become an open door.
 * Hostname is deliberately not checked, so previews and tests on other hosts work.
 */
export async function verifyTurnstile(
  token: string,
  secret: string,
  remoteIp?: string
): Promise<boolean> {
  if (!token || !secret) return false;

  const body = new URLSearchParams({ secret, response: token });
  if (remoteIp) body.set("remoteip", remoteIp);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS);
  try {
    const res = await fetch(SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: controller.signal,
    });
    if (!res.ok) {
      // eslint-disable-next-line no-console
      console.warn(`[turnstile] siteverify answered HTTP ${res.status}; failing closed`);
      return false;
    }
    const data = (await res.json()) as { success?: unknown; "error-codes"?: unknown };
    if (data?.success === true) return true;
    // A rejected token is routine (expired, reused, a bot); not worth a warning.
    return false;
  } catch (err) {
    const reason = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    // eslint-disable-next-line no-console
    console.warn(`[turnstile] siteverify unreachable (${reason}); failing closed`);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The lead route's whole check: true when this submission may proceed.
 *
 * Reads form_settings through the cached settings service, which returns the
 * secret in the clear to server code (it is masked only on the admin screen).
 */
export async function passesLeadCaptcha(
  source: string,
  token: string | undefined,
  ip: string | undefined
): Promise<boolean> {
  const config = turnstileConfig(await readSetting("form_settings"));
  if (!turnstileRequired(config, source)) return true;
  if (!token?.trim()) return false;
  return verifyTurnstile(token.trim(), config.turnstileSecret, publicRemoteIp(ip));
}
