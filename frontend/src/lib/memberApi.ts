/**
 * Member-side API client.
 *
 * Deliberately separate from lib/api.ts (the admin client) on two counts:
 *
 * 1. The access token lives in a module variable, not localStorage. It expires
 *    in 15 minutes and is replaced from an HttpOnly refresh cookie, so there is
 *    nothing worth stealing sitting in browser storage where any injected
 *    script could read it.
 * 2. Every request sends credentials, because that refresh cookie is how a
 *    reload knows who you are.
 *
 * A 401 triggers exactly one refresh-and-retry. If that fails the member is
 * signed out — no retry storm, no infinite loop.
 */

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "/api";

let accessToken: string | null = null;
let onSignedOut: (() => void) | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

/** Lets the auth context clear its state when a refresh finally fails. */
export function setSignedOutHandler(fn: (() => void) | null): void {
  onSignedOut = fn;
}

export class MemberApiError extends Error {
  status: number;
  details?: unknown;
  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export interface MemberProfile {
  id: number;
  email: string;
  firstName: string;
  lastName: string;
  name: string;
  avatarUrl: string;
  timezone: string;
  locale: string;
  status: string;
  emailVerifiedAt: string | null;
  createdAt: string;
  /** Present only while an admin is viewing the site as this member. */
  impersonatedBy?: number;
}

export interface MemberSessionInfo {
  id: number;
  userAgent: string;
  ip: string;
  createdAt: string;
  lastUsedAt: string | null;
  current: boolean;
}

interface AuthSuccess {
  member: MemberProfile;
  accessToken: string;
}

/**
 * Registration has two outcomes, and the difference is not an error.
 *
 * A brand-new address is signed straight in. An address that already has an
 * account — whether or not it has a password yet — gets a link in the inbox
 * instead, and the response says only that. The server deliberately answers the
 * two existing-account cases identically, so this type must not try to
 * distinguish them either.
 */
export interface RegistrationPending {
  status: "check_email";
  message: string;
}

export type RegisterResult = AuthSuccess | RegistrationPending;

export function isRegistrationPending(result: RegisterResult): result is RegistrationPending {
  return (result as RegistrationPending).status === "check_email";
}

async function parseError(res: Response): Promise<MemberApiError> {
  let message = "Something went wrong. Please try again in a moment.";
  let details: unknown;
  try {
    const body = (await res.json()) as { error?: string; message?: string; details?: unknown };
    message = body.error ?? body.message ?? message;
    details = body.details;
  } catch {
    // Non-JSON error (nginx 413/502) keeps the readable default.
  }
  return new MemberApiError(message, res.status, details);
}

/**
 * Single-flight refresh.
 *
 * Several requests can 401 at the same moment when a token expires mid-page;
 * they must not each rotate the refresh cookie, because rotation invalidates
 * the previous token and the losers would be treated as stolen.
 */
let refreshInFlight: Promise<boolean> | null = null;

async function refreshAccessToken(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const res = await fetch(`${API_BASE}/auth/refresh`, {
          method: "POST",
          credentials: "include",
        });
        if (!res.ok) return false;
        const body = (await res.json()) as AuthSuccess;
        accessToken = body.accessToken;
        return true;
      } catch {
        return false;
      } finally {
        // Cleared on the next tick so concurrent awaiters all observe this run.
        setTimeout(() => {
          refreshInFlight = null;
        }, 0);
      }
    })();
  }
  return refreshInFlight;
}

export interface RequestOptions extends RequestInit {
  /** Set on the refresh call itself, to stop it recursing into a refresh. */
  skipRefresh?: boolean;
}

/**
 * The single authenticated fetch for the whole member app.
 *
 * Exported so each domain can keep its own client module — `libraryApi`,
 * `commerceApi`, `communityApi` and so on — instead of everything piling into
 * this file. They all share one access token, one refresh, and one error shape,
 * which is the part that must not be duplicated: a second copy of the refresh
 * logic would rotate the cookie behind this one's back and each would see the
 * other's rotation as a stolen token.
 */
export async function memberRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  return request<T>(path, options);
}

/**
 * The same authenticated fetch, for the few answers that are not JSON.
 *
 * A certificate PDF sits behind the Bearer token like everything else under
 * `/member`, so an `<a href>` to it is a 401: a link cannot carry the header.
 * This hands back the raw `Response` — after the same single refresh-and-retry
 * — so the caller can read it as a blob. Errors are thrown as `MemberApiError`
 * exactly as `memberRequest` throws them.
 */
export async function memberFetch(path: string, options: RequestOptions = {}): Promise<Response> {
  const res = await authedFetch(path, options);
  if (!res.ok) throw await parseError(res);
  return res;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const res = await authedFetch(path, options);

  if (!res.ok) throw await parseError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Sends with the access token, and refreshes it exactly once on a 401. */
async function authedFetch(path: string, options: RequestOptions = {}): Promise<Response> {
  const { skipRefresh, ...init } = options;

  const send = async (): Promise<Response> => {
    const headers = new Headers(init.headers);
    if (!headers.has("Content-Type") && !(init.body instanceof FormData)) {
      headers.set("Content-Type", "application/json");
    }
    if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
    return fetch(`${API_BASE}${path}`, { ...init, headers, credentials: "include" });
  };

  let res = await send();

  if (res.status === 401 && !skipRefresh) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      res = await send();
    } else {
      accessToken = null;
      onSignedOut?.();
    }
  }

  return res;
}

export const memberApi = {
  // ---- Unauthenticated ----

  register: (input: {
    email: string;
    password: string;
    firstName: string;
    lastName?: string;
    timezone?: string;
  }) =>
    request<RegisterResult>("/auth/register", {
      method: "POST",
      body: JSON.stringify(input),
      skipRefresh: true,
    }),

  login: (email: string, password: string) =>
    request<AuthSuccess>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
      skipRefresh: true,
    }),

  logout: () => request<void>("/auth/logout", { method: "POST", skipRefresh: true }),

  /** Bootstraps a page load from the refresh cookie. Rejects when signed out. */
  refresh: () => request<AuthSuccess>("/auth/refresh", { method: "POST", skipRefresh: true }),

  /**
   * Always resolves, whether or not the address has an account — the response
   * must not tell a stranger which emails are registered here.
   */
  forgotPassword: (email: string) =>
    request<{ ok: true }>("/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email }),
      skipRefresh: true,
    }),

  resetPassword: (token: string, password: string) =>
    request<{ ok: true }>("/auth/reset-password", {
      method: "POST",
      body: JSON.stringify({ token, password }),
      skipRefresh: true,
    }),

  verifyEmail: (token: string) =>
    request<{ ok: true }>("/auth/verify-email", {
      method: "POST",
      body: JSON.stringify({ token }),
      skipRefresh: true,
    }),

  /**
   * `state` and `error` come back only for a signed-in caller — anonymously
   * this route stays deliberately silent so it cannot be used to test whether
   * an address has an account.
   */
  resendVerification: (email?: string) =>
    request<{
      ok: true;
      state?: "sent" | "throttled" | "failed" | "not_needed";
      error?: string;
    }>("/auth/resend-verification", {
      method: "POST",
      body: JSON.stringify(email ? { email } : {}),
    }),

  /** Passwordless sign-in. 404s when the feature is switched off in settings. */
  requestMagicLink: (email: string) =>
    request<{ ok: true }>("/auth/magic-link", {
      method: "POST",
      body: JSON.stringify({ email }),
      skipRefresh: true,
    }),

  consumeMagicLink: (token: string) =>
    request<AuthSuccess>("/auth/magic-link/consume", {
      method: "POST",
      body: JSON.stringify({ token }),
      skipRefresh: true,
    }),

  // ---- Signed in ----

  me: () => request<MemberProfile>("/auth/me"),

  updateProfile: (input: {
    firstName?: string;
    lastName?: string;
    timezone?: string;
    locale?: string;
  }) => request<MemberProfile>("/auth/me", { method: "PATCH", body: JSON.stringify(input) }),

  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ ok: true }>("/auth/me/password", {
      method: "POST",
      body: JSON.stringify({ currentPassword, newPassword }),
    }),

  uploadAvatar: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<{ avatarUrl: string }>("/auth/me/avatar", { method: "POST", body: form });
  },

  sessions: () => request<MemberSessionInfo[]>("/auth/me/sessions"),

  revokeSession: (id: number) =>
    request<void>(`/auth/me/sessions/${id}`, { method: "DELETE" }),

  /** Signs out every device except the one asking. Resolves with how many went. */
  revokeOtherSessions: () =>
    request<{ revoked: number }>("/auth/me/sessions", { method: "DELETE" }),
};
