/**
 * Cookie consent: what a visitor has allowed beyond what the site needs to work.
 *
 * Privacy-preserving by default. Until a visitor chooses, only essential
 * storage is used (sign-in, cart, theme, checkout, and this choice itself);
 * everything else stays off. Two optional categories:
 *
 *   media      embedded content from other companies — the Instagram feed
 *              (LightWidget) on the home page, and video players hosted by
 *              YouTube, Vimeo, Loom or Wistia when a page uses one
 *   analytics  measurement and advertising tags (Google Analytics, the Meta
 *              pixel). None are loaded today; anything added later must check
 *              `hasConsent("analytics")` first.
 *
 * The choice is kept in localStorage — this browser only, never sent to the
 * server — with a version, so changing the categories can ask again. Pages
 * learn about changes through the CONSENT_EVENT window event, and the footer's
 * "Cookie preferences" link reopens the panel with OPEN_PREFERENCES_EVENT.
 */

export type ConsentCategory = "media" | "analytics";

export interface ConsentState {
  media: boolean;
  analytics: boolean;
  /** When the choice was made (ISO), for the record. */
  decidedAt: string;
}

/** Bump when the categories change, so every visitor is asked again. */
const CONSENT_VERSION = 1;
const STORAGE_KEY = "bc_cookie_consent";

export const CONSENT_EVENT = "bossclinician-consent";
export const OPEN_PREFERENCES_EVENT = "bossclinician-cookie-preferences";

/**
 * A choice made while storage is blocked still has to hold for the rest of the
 * visit, or the banner would come back on every page.
 */
let memory: ConsentState | null = null;

/** The visitor's stored choice, or null if they have not chosen (or storage is unavailable). */
export function readConsent(): ConsentState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ConsentState> & { v?: number };
    if (parsed.v !== CONSENT_VERSION) return null;
    return {
      media: parsed.media === true,
      analytics: parsed.analytics === true,
      decidedAt: typeof parsed.decidedAt === "string" ? parsed.decidedAt : "",
    };
  } catch {
    return null;
  }
}

/** Store a choice and tell the page. Works for the session even if storage is blocked. */
export function saveConsent(choice: Pick<ConsentState, ConsentCategory>): ConsentState {
  const state: ConsentState = { ...choice, decidedAt: new Date().toISOString() };
  memory = state;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: CONSENT_VERSION, ...state }));
  } catch {
    // Private mode or blocked storage: the choice holds until the tab closes.
  }
  window.dispatchEvent(new CustomEvent(CONSENT_EVENT, { detail: state }));
  return state;
}

export function currentConsent(): ConsentState | null {
  return readConsent() ?? memory;
}

export function hasConsent(category: ConsentCategory): boolean {
  return currentConsent()?.[category] === true;
}

/** Reopen the preferences panel (the footer link, the media placeholders). */
export function openCookiePreferences(): void {
  window.dispatchEvent(new Event(OPEN_PREFERENCES_EVENT));
}
