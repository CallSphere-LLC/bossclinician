import { memberRequest, getAccessToken } from "@/lib/memberApi";
import { sessionFetch } from "@/lib/adminTransport";
import type { VoiceApiClient, VoiceSurface } from "../contract";

/**
 * api-client.ts — the one place the concierge's server calls learn who is
 * calling.
 *
 * Tools never own a fetch client (see the contract's dependency-inversion
 * note), so every server call a tool makes arrives here. This file DELEGATES to
 * the two transports this app already has rather than rolling a third, because
 * there is no single way to authenticate here and each of those transports owns
 * state that must not be duplicated:
 *
 *  - A signed-in member is identified by a short-lived access token held in
 *    page MEMORY, not by a cookie: the refresh cookie is scoped to
 *    `path=/api/auth` and is therefore never sent to `/api/voice/*` or to
 *    `/api/member/*`. A hand-rolled fetch would get a 401 on every member call
 *    and have no way to recover. `memberRequest` attaches the bearer and owns
 *    the single-flight refresh that a second copy would fight with — rotating
 *    the cookie behind the first one's back, which each would then read as a
 *    stolen token.
 *  - The admin is the opposite: HttpOnly cookies, no bearer, and its own
 *    refresh-once-on-401 inside `sessionFetch`.
 *
 * And what is NOT here, deliberately: there is no CSRF token anywhere in this
 * app. Both `memberAuthCsrf` and `adminCsrf` are standard-header checks that
 * compare `Origin` and `Sec-Fetch-Site` against the site's own origin, which a
 * same-origin fetch from our own page already satisfies. Inventing a header
 * would look like protection while doing nothing, which is the failure mode
 * this paragraph exists to prevent.
 */

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "/api";

/**
 * Admin routes are cookie-authenticated and have their own refresh dance, so
 * they are chosen by PATH rather than by surface.
 *
 * That distinction matters: an admin session also calls routes that are not
 * under `/admin` — the concierge's own `/voice/...` endpoints, for one — and
 * `sessionFetch` passes anything that is not an admin URL straight through
 * WITHOUT credentials, which would send those calls out signed as nobody.
 */
function isAdminPath(path: string): boolean {
  return path === "/admin" || path.startsWith("/admin/") || path.startsWith("/admin?");
}

async function adminRequest<T>(path: string, init: RequestInit): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const response = await sessionFetch(`${API_BASE}${path}`, { ...init, headers, credentials: "include" });
  if (!response.ok) throw new Error(await readServerMessage(response));
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/**
 * The server's own words, whatever shape it used.
 *
 * A refusal that reaches the model as "request failed" is a refusal the owner
 * cannot act on, so the JSON `error`/`message` the API actually sent is what
 * gets thrown, and only a body we genuinely cannot read falls back to a status.
 */
export async function readServerMessage(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  if (text) {
    try {
      const body = JSON.parse(text) as { error?: string; message?: string };
      const message = body.message ?? body.error;
      if (message) return message;
    } catch {
      // Not JSON — nginx's own 413/502 pages land here, and their text is
      // still more useful than the status alone.
      return text.slice(0, 500);
    }
  }
  return `The server refused the request (HTTP ${response.status}).`;
}

/**
 * Fetch wrapper with credentials and whichever proof of identity applies.
 *
 * `surface` is the one the SERVER admitted the call to. It is used for a single
 * decision: on the admin surface there is no member token to refresh, so a 401
 * on a non-admin route must not send the member client off to rotate a refresh
 * cookie that is not there. Leaving it out keeps the member behaviour, which is
 * also right for a public session, where there is simply no token to attach.
 */
export function createVoiceApiClient(surface?: VoiceSurface): VoiceApiClient {
  const skipRefresh = surface === "admin";

  const send = <T,>(path: string, method: string, body?: unknown): Promise<T> => {
    const init: RequestInit = {
      method,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    };
    return isAdminPath(path)
      ? adminRequest<T>(path, init)
      : memberRequest<T>(path, { ...init, skipRefresh });
  };

  return {
    get: <T,>(path: string) => send<T>(path, "GET"),
    post: <T,>(path: string, body?: unknown) => send<T>(path, "POST", body),
    put: <T,>(path: string, body?: unknown) => send<T>(path, "PUT", body),
    del: <T,>(path: string) => send<T>(path, "DELETE"),
  };
}

/**
 * Upload one slice of a call's audio.
 *
 * Deliberately not part of `VoiceApiClient`: that type is the surface tools get,
 * and a tool has no business shipping a recording. It is also the one call in
 * the concierge whose body is not JSON, so it goes out as a raw `fetch` with
 * the same credentials the client above would have attached.
 *
 * `seq` counts from zero and the store appends in that order. Slices go up
 * DURING the call rather than as one upload at the end, because the audio only
 * exists in this tab: a person who closes it mid-sentence would otherwise leave
 * nothing behind at all, which is how a recording feature ends up empty.
 */
export async function putVoiceRecording(
  sessionId: string,
  seq: number,
  audio: Blob,
  options: { keepalive?: boolean } = {},
): Promise<void> {
  const headers = new Headers({ "Content-Type": audio.type || "audio/webm" });
  const token = getAccessToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const query = new URLSearchParams({ sessionId, seq: String(seq) });
  const response = await fetch(`${API_BASE}/voice/recording?${query.toString()}`, {
    method: "PUT",
    headers,
    credentials: "include",
    body: audio,
    // Set only on the page-is-leaving flush, where the request has to outlive
    // the document. It caps the body at 64 KB, which one slice is well inside,
    // but it is not worth spending on the ordinary in-call uploads.
    ...(options.keepalive ? { keepalive: true } : {}),
  });
  if (!response.ok) throw new Error(await readServerMessage(response));
}
