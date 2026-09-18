import { GOOGLE_TOKEN_ENDPOINT, type GoogleConfig } from "./googleOAuth";

/**
 * The one network call in "Continue with Google": the single-use code goes to
 * Google's token endpoint, and an id_token comes back.
 *
 * It is a file of its own for two reasons. auth/googleOAuth.ts promises to
 * decide things without a database or a network, and this is the network. And
 * two routers need it — routes/auth/googleAuth.ts for members and
 * routes/admin/googleAuth.ts for the admin — which differ in whom they will
 * sign in and in nothing about how Google is asked. The redirect URI travels in
 * `config`, so each flow presents the one its own /start sent.
 */

const TOKEN_EXCHANGE_TIMEOUT_MS = 8000;

/** Swaps the single-use code for Google's id_token. Throws with a loggable reason. */
export async function exchangeCode(config: GoogleConfig, code: string, verifier: string): Promise<unknown> {
  const controller = new AbortController();
  // A sign-in waiting on a stalled third party is a visitor staring at a blank
  // tab. Eight seconds is far beyond Google's normal answer and well inside
  // nginx's proxy timeout, so the visitor gets our error page rather than a 504.
  const timer = setTimeout(() => controller.abort(), TOKEN_EXCHANGE_TIMEOUT_MS);
  try {
    const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        code,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: config.redirectUri,
        grant_type: "authorization_code",
        code_verifier: verifier,
      }).toString(),
      signal: controller.signal,
    });
    const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (!response.ok) {
      // Google's `error` is a short machine code (invalid_grant, invalid_client).
      // The description is left out: it can quote the request back.
      const errorCode = typeof body?.error === "string" ? body.error.slice(0, 40) : "no error code";
      throw new Error(`token endpoint answered ${response.status} (${errorCode})`);
    }
    return body?.id_token;
  } finally {
    clearTimeout(timer);
  }
}
