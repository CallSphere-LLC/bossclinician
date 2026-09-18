import crypto from "crypto";
import { env } from "../config/env";
import { googleStateSecret } from "./secrets";
import { safeEqual } from "./tokens";

/**
 * The pure half of "Continue with Google": everything that can be decided
 * without a database, a mailer or a network call.
 *
 * It lives apart from routes/auth/googleAuth.ts for the same reason
 * auth/memberCsrf.ts lives apart from the router it guards — these are the
 * security decisions (where may we send somebody afterwards, is this state
 * cookie ours, is this id_token one we should believe), and a decision that can
 * be imported without dragging the pool in behind it is one that actually gets
 * a table of tests.
 *
 * The flow itself is the OAuth 2.0 authorisation-code grant with PKCE, run
 * entirely server-side. No Google script is loaded by the page, which is why
 * the site's Content-Security-Policy did not have to change and why this works
 * inside the in-app browsers (Instagram, Facebook) that Google's own JavaScript
 * button refuses to run in.
 */

export const GOOGLE_AUTHORISE_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

/** Where the round trip is parked between /start and /callback. */
export const GOOGLE_STATE_COOKIE = "bc_google_oauth";
/** Scoped to the two routes that read it, so it rides on nothing else. */
export const GOOGLE_STATE_COOKIE_PATH = "/api/auth/google";
/** Ten minutes: long enough to pick an account and pass a 2-step prompt, short enough to be worthless later. */
export const GOOGLE_STATE_TTL_SECONDS = 10 * 60;

export const DEFAULT_NEXT = "/library";

/**
 * The only things the sign-in page is ever told. A fixed vocabulary rather than
 * a message, because the value travels in a URL anybody can write: a free-text
 * `?error=` would put whatever a stranger typed into our own sign-in screen.
 */
export type GoogleFailure =
  | "google_cancelled"
  | "google_unverified"
  | "google_failed"
  | "google_blocked"
  | "google_mismatch"
  | "google_disabled";

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/**
 * The credentials, or null when the feature is off.
 *
 * Both halves or nothing: a client id without its secret can send people to
 * Google but can never bring them back, which is worse than not offering the
 * button. The redirect URI is derived rather than configured so it cannot
 * drift from PUBLIC_SITE_URL — Google compares it byte for byte with the one
 * registered in the Cloud Console, and a mismatch is a dead end on Google's
 * side that nobody here ever sees.
 */
export function googleConfig(): GoogleConfig | null {
  const { clientId, clientSecret } = env.google;
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret, redirectUri: `${env.publicSiteUrl}/api/auth/google/callback` };
}

/** Non-secret, and safe to publish: it says a button exists, not how it is keyed. */
export function googleSignInEnabled(): boolean {
  return googleConfig() !== null;
}

const MAX_NEXT_LENGTH = 512;

/**
 * `?next=` is attacker-supplied by definition — it arrives on a link someone
 * else can write — and whatever survives this is where a freshly signed-in
 * member is sent. Only a plain same-site path survives.
 *
 * The same rule as `safeDestination` in the sign-in page, held again here
 * because this value never passes through that page: it goes into a cookie,
 * round Google, and straight into a Location header.
 *
 *  - must start with a single `/` — `//host` is protocol-relative;
 *  - no backslash anywhere — browsers read `/\host` as `//host`;
 *  - no control characters — browsers strip tabs and newlines out of a URL
 *    before parsing it, so `/<tab>/host` is `//host` by the time it matters;
 *  - no `://` before the query string, which is the "no scheme" rule for
 *    anything that slipped past the three above.
 */
export function safeNext(raw: unknown): string {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_NEXT_LENGTH) return DEFAULT_NEXT;
  if (!raw.startsWith("/") || raw.startsWith("//")) return DEFAULT_NEXT;
  if (raw.includes("\\")) return DEFAULT_NEXT;
  for (let i = 0; i < raw.length; i += 1) {
    const code = raw.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return DEFAULT_NEXT;
  }
  const path = raw.split(/[?#]/, 1)[0] ?? "";
  if (path.includes("://")) return DEFAULT_NEXT;
  return raw;
}

/** RFC 7636 S256: the challenge is the base64url SHA-256 of the verifier. */
export function pkceChallenge(verifier: string): string {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

export interface GoogleState {
  /** Echoed back by Google; must match what the cookie says we sent. */
  state: string;
  /** The PKCE verifier. Never leaves the server except inside this cookie. */
  verifier: string;
  next: string;
}

interface SignedState extends GoogleState {
  /** Unix seconds. Inside the signature, because Max-Age is only a request to the browser. */
  exp: number;
}

function sign(body: string): string {
  return crypto.createHmac("sha256", googleStateSecret()).update(body).digest("base64url");
}

/**
 * `<base64url JSON>.<base64url HMAC-SHA256>`.
 *
 * Signed rather than stored: there is no table to clean up and no row for a
 * visitor who opens Google's screen and wanders off. The signature is what
 * stops the cookie being useful to anybody who can plant one — a sibling
 * application on the same registrable domain can set a cookie for this host,
 * and an unsigned `{state, verifier, next}` would let it choose all three.
 */
export function signState(value: GoogleState, nowMs: number = Date.now()): string {
  const payload: SignedState = { ...value, exp: Math.floor(nowMs / 1000) + GOOGLE_STATE_TTL_SECONDS };
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${body}.${sign(body)}`;
}

/** The parked round trip, or null for anything forged, mangled or out of date. */
export function verifyState(raw: unknown, nowMs: number = Date.now()): GoogleState | null {
  if (typeof raw !== "string") return null;
  const parts = raw.split(".");
  if (parts.length !== 2) return null;
  const [body, mac] = parts as [string, string];
  if (!body || !mac || !safeEqual(sign(body), mac)) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const { state, verifier, next, exp } = parsed as Record<string, unknown>;
  if (typeof state !== "string" || typeof verifier !== "string" || typeof next !== "string") return null;
  if (typeof exp !== "number" || exp * 1000 <= nowMs) return null;
  // Validated again on the way out: the signature proves we wrote it, and this
  // keeps the redirect safe even if a future caller signs something unchecked.
  return { state, verifier, next: safeNext(next) };
}

/** The address the visitor is sent to at Google. */
export function buildAuthoriseUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string {
  const url = new URL(GOOGLE_AUTHORISE_ENDPOINT);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", input.state);
  url.searchParams.set("code_challenge", input.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  // Always show the chooser. Without it somebody with two Google accounts is
  // silently signed in with whichever one Google thinks is current, and ends up
  // holding a second, empty Boss Clinician account without knowing why.
  url.searchParams.set("prompt", "select_account");
  return url.toString();
}

/**
 * The claims of an id_token, unverified.
 *
 * The signature is deliberately not checked. This token is only ever read out
 * of the body of our own TLS request to Google's token endpoint, made with our
 * client secret and a single-use code — it never passes through the browser, so
 * there is nobody between Google and us who could have rewritten it. OpenID
 * Connect Core §3.1.3.7 allows exactly this for the code flow. The CLAIMS are
 * still checked below, because "it came from Google" does not mean "it was
 * issued for this site, recently, about an address Google has confirmed".
 */
export function decodeIdToken(idToken: unknown): unknown {
  if (typeof idToken !== "string") return null;
  const segments = idToken.split(".");
  if (segments.length !== 3 || !segments[1]) return null;
  try {
    return JSON.parse(Buffer.from(segments[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

export interface GoogleIdentity {
  sub: string;
  email: string;
  firstName: string;
  lastName: string;
}

export type IdTokenVerdict =
  | { ok: true; identity: GoogleIdentity }
  | { ok: false; failure: GoogleFailure; reason: string };

const GOOGLE_ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"]);
const MAX_NAME_LENGTH = 100;

function nameClaim(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, MAX_NAME_LENGTH) : "";
}

/**
 * Whether these claims are enough to sign somebody in as `email`.
 *
 * `email_verified` is the load-bearing one. Accounts here are joined to a
 * Google identity by address, so an address Google has not confirmed would let
 * anybody who can create a Google Workspace user called yvette@… walk into
 * Yvette's account. Strictly `=== true`: some providers send the string
 * "true", Google does not, and a loose check is how that class of bug starts.
 */
export function validateIdToken(payload: unknown, clientId: string, nowMs: number = Date.now()): IdTokenVerdict {
  const refuse = (reason: string, failure: GoogleFailure = "google_failed"): IdTokenVerdict => ({
    ok: false,
    failure,
    reason,
  });

  if (typeof payload !== "object" || payload === null) return refuse("id_token is not a JWT with a JSON payload");
  const claims = payload as Record<string, unknown>;

  if (typeof claims.iss !== "string" || !GOOGLE_ISSUERS.has(claims.iss)) return refuse("unexpected issuer");
  // A bare string only. Google never sends the array form, and accepting one
  // would mean deciding what a token for us AND somebody else is worth.
  if (claims.aud !== clientId) return refuse("audience is not this client");
  if (typeof claims.exp !== "number" || claims.exp * 1000 <= nowMs) return refuse("id_token has expired");
  if (typeof claims.sub !== "string" || claims.sub.length === 0 || claims.sub.length > 255) {
    return refuse("missing subject");
  }
  if (typeof claims.email !== "string" || !claims.email.includes("@") || claims.email.length > 320) {
    return refuse("missing email");
  }
  if (claims.email_verified !== true) return refuse("email not verified by Google", "google_unverified");

  return {
    ok: true,
    identity: {
      sub: claims.sub,
      email: claims.email.trim().toLowerCase(),
      firstName: nameClaim(claims.given_name),
      lastName: nameClaim(claims.family_name),
    },
  };
}
