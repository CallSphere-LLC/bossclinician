import { ApiError, getToken } from "@/lib/api";

/**
 * Client for the settings, team and connections screens.
 *
 * Kept off `lib/api.ts` for the same reason `adminCommerceApi.ts` is: that file
 * is imported by every screen in the console, and these three pages are the only
 * ones that need any of this.
 *
 * The vocabulary in here is deliberately the platform's, not the owner's — the
 * translation into "Two-step sign-in" and "Customer support" happens once, on
 * the screens, where the sentence around it gives it meaning.
 */

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "/api";

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });

  if (!res.ok) {
    let message = "";
    try {
      const body = (await res.json()) as { error?: string; message?: string };
      message = body.error ?? body.message ?? "";
    } catch {
      // A response with no JSON body still has a status, which is the part the
      // screens read.
    }
    throw new ApiError(message, res.status);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const body = (value: unknown): RequestInit => ({ body: JSON.stringify(value) });

/* ── Settings ───────────────────────────────────────────────────────────── */

export type SettingFieldType =
  | "text"
  | "longtext"
  | "email"
  | "url"
  | "number"
  | "boolean"
  | "time"
  | "timezone"
  | "choice"
  | "color"
  | "secret";

export interface SettingChoice {
  value: string;
  label: string;
}

export interface SettingField {
  name: string;
  label: string;
  help?: string;
  type: SettingFieldType;
  choices?: SettingChoice[];
  placeholder?: string;
  min?: number;
  max?: number;
  unit?: string;
  /** Stored value = what she typed x this. Only the tax rate uses it today. */
  displayScale?: number;
  /** Absent for a secret — the server never sends one back. */
  value?: unknown;
  hasValue?: boolean;
  hint?: string;
}

export interface SettingCard {
  key: string;
  label: string;
  description: string;
  fields: SettingField[];
}

export interface SettingGroup {
  key: string;
  label: string;
  description: string;
  settings: SettingCard[];
}

export const settingsApi = {
  groups: () => request<{ groups: SettingGroup[] }>("/admin/settings-v2/groups"),

  save: (key: string, values: Record<string, unknown>) =>
    request<{ key: string; values: Record<string, unknown> }>(`/admin/settings-v2/${key}`, {
      method: "PUT",
      ...body(values),
    }),

  sendTestEmail: (to?: string) =>
    request<{ to: string; configured: boolean; sent: boolean; failure: string }>(
      "/admin/settings-v2/test-email",
      {
        method: "POST",
        ...body(to ? { to } : {}),
      },
    ),
};

/* ── People ─────────────────────────────────────────────────────────────── */

export type AdminRole = "owner" | "admin" | "marketing" | "support" | "coach";

export interface AdminPerson {
  id: number;
  email: string;
  name: string;
  role: AdminRole;
  status: "active" | "invited" | "suspended";
  mfaEnabled: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface AdminInvite {
  id: number;
  email: string;
  role: AdminRole;
  expiresAt: string;
  createdAt: string;
  invitedByName: string | null;
}

export interface RoleDescriptor {
  role: AdminRole;
  label: string;
  summary: string;
  canDo: string[];
  cannotDo: string[];
}

export interface AdminSession {
  id: number;
  userAgent: string;
  ip: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string;
}

export interface MySecurity {
  email: string;
  name: string;
  role: AdminRole;
  mfaEnabled: boolean;
  recoveryCodesLeft: number;
  sessions: AdminSession[];
}

export const teamApi = {
  list: () => request<{ people: AdminPerson[]; invites: AdminInvite[] }>("/admin/admins"),
  roles: () => request<{ roles: RoleDescriptor[] }>("/admin/admins/roles"),

  invite: (input: { email: string; name: string; role: Exclude<AdminRole, "owner"> }) =>
    request<{ email: string; role: AdminRole }>("/admin/admins/invite", {
      method: "POST",
      ...body(input),
    }),

  withdrawInvite: (id: number) =>
    request<void>(`/admin/admins/invites/${id}`, { method: "DELETE" }),

  update: (id: number, input: { name?: string; role?: AdminRole }) =>
    request<AdminPerson>(`/admin/admins/${id}`, { method: "PATCH", ...body(input) }),

  suspend: (id: number) => request<{ ok: true }>(`/admin/admins/${id}/suspend`, { method: "POST" }),
  restore: (id: number) => request<{ ok: true }>(`/admin/admins/${id}/restore`, { method: "POST" }),
  remove: (id: number) => request<void>(`/admin/admins/${id}`, { method: "DELETE" }),

  signOutEverywhere: (id: number) =>
    request<{ signedOut: number }>(`/admin/admins/${id}/sessions/revoke`, { method: "POST" }),

  mySecurity: () => request<MySecurity>("/admin/admins/me/security"),

  startMfa: () =>
    request<{ secret: string; otpauthUrl: string }>("/admin/admins/me/mfa/start", {
      method: "POST",
    }),

  confirmMfa: (code: string) =>
    request<{ ok: true; recoveryCodes: string[] }>("/admin/admins/me/mfa/confirm", {
      method: "POST",
      ...body({ code }),
    }),

  disableMfa: (code: string) =>
    request<{ ok: true }>("/admin/admins/me/mfa/disable", { method: "POST", ...body({ code }) }),

  newRecoveryCodes: (code: string) =>
    request<{ recoveryCodes: string[] }>("/admin/admins/me/mfa/recovery-codes", {
      method: "POST",
      ...body({ code }),
    }),

  endSession: (id: number) =>
    request<void>(`/admin/admins/me/sessions/${id}`, { method: "DELETE" }),
};

export interface InvitePreview {
  email: string;
  role: AdminRole;
  expiresAt: string;
}

/**
 * The two calls the invitation page makes.
 *
 * Separate from `teamApi` because they are the only ones here made by somebody
 * who is not signed in — no token is sent, and none is expected back.
 */
export const acceptInviteApi = {
  preview: (token: string) =>
    request<InvitePreview>(`/admin/invite/${encodeURIComponent(token)}`),

  accept: (token: string, input: { name: string; password: string }) =>
    request<{ ok: true; email: string }>(`/admin/invite/${encodeURIComponent(token)}`, {
      method: "POST",
      ...body(input),
    }),
};

/* ── Connections ────────────────────────────────────────────────────────── */

export interface WebhookEvent {
  type: string;
  label: string;
}

export interface WebhookEndpoint {
  id: number;
  name: string;
  url: string;
  eventTypes: string[];
  enabled: boolean;
  consecutiveFailures: number;
  disabledReason: string;
  deliveredCount: number;
  failingCount: number;
  lastEventAt: string | null;
  createdAt: string;
}

export interface WebhookDelivery {
  id: string;
  endpointId: number;
  endpointName: string;
  endpointUrl: string;
  eventType: string;
  status: "pending" | "delivered" | "failed" | "dead";
  attempts: number;
  responseStatus: number | null;
  error: string;
  createdAt: string;
  deliveredAt: string | null;
  nextAttemptAt: string | null;
}

export interface ApiKeySummary {
  id: number;
  name: string;
  keyPrefix: string;
  scopes: string[];
  hint: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  createdByName: string | null;
}

export interface ApiScope {
  value: string;
  label: string;
}

export const integrationsApi = {
  events: () => request<{ events: WebhookEvent[] }>("/admin/integrations/events"),
  endpoints: () => request<{ endpoints: WebhookEndpoint[] }>("/admin/integrations/webhooks"),

  createEndpoint: (input: { name: string; url: string; eventTypes: string[] }) =>
    request<{ endpoint: WebhookEndpoint; signingSecret: string }>("/admin/integrations/webhooks", {
      method: "POST",
      ...body(input),
    }),

  updateEndpoint: (
    id: number,
    input: { name?: string; url?: string; eventTypes?: string[]; enabled?: boolean },
  ) =>
    request<WebhookEndpoint>(`/admin/integrations/webhooks/${id}`, {
      method: "PUT",
      ...body(input),
    }),

  deleteEndpoint: (id: number) =>
    request<void>(`/admin/integrations/webhooks/${id}`, { method: "DELETE" }),

  testEndpoint: (id: number) =>
    request<{ queued: boolean }>(`/admin/integrations/webhooks/${id}/test`, { method: "POST" }),

  deliveries: (endpointId?: number) =>
    request<{ deliveries: WebhookDelivery[] }>(
      `/admin/integrations/deliveries${endpointId ? `?endpointId=${endpointId}` : ""}`,
    ),

  replay: (id: string) =>
    request<{ deliveryId: string }>(`/admin/integrations/deliveries/${id}/replay`, {
      method: "POST",
    }),

  apiKeys: () => request<{ keys: ApiKeySummary[] }>("/admin/integrations/api-keys"),
  apiScopes: () => request<{ scopes: ApiScope[] }>("/admin/integrations/api-scopes"),

  createApiKey: (input: { name: string; scopes: string[] }) =>
    request<{ apiKey: ApiKeySummary; key: string }>("/admin/integrations/api-keys", {
      method: "POST",
      ...body(input),
    }),

  revokeApiKey: (id: number) =>
    request<{ ok: true }>(`/admin/integrations/api-keys/${id}/revoke`, { method: "POST" }),
};

/* ── Shared wording ─────────────────────────────────────────────────────── */

/** "2 days ago" — every one of these screens shows a "last used" column. */
export function timeAgo(value: string | null | undefined): string {
  if (!value) return "Never";
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return "Never";

  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 60) return "Just now";

  const steps: [limit: number, size: number, one: string, many: string][] = [
    [3600, 60, "a minute ago", "minutes ago"],
    [86400, 3600, "an hour ago", "hours ago"],
    [2592000, 86400, "yesterday", "days ago"],
    [31536000, 2592000, "last month", "months ago"],
  ];

  for (const [limit, size, one, many] of steps) {
    if (seconds < limit) {
      const count = Math.floor(seconds / size);
      return count <= 1 ? one : `${count} ${many}`;
    }
  }

  const years = Math.floor(seconds / 31536000);
  return years <= 1 ? "last year" : `${years} years ago`;
}

/** The browser and machine behind a sign-in, without the full user-agent soup. */
export function describeDevice(userAgent: string): string {
  if (!userAgent) return "Unknown device";

  const browser =
    /edg\//i.test(userAgent) ? "Edge"
    : /chrome|crios/i.test(userAgent) ? "Chrome"
    : /firefox|fxios/i.test(userAgent) ? "Firefox"
    : /safari/i.test(userAgent) ? "Safari"
    : "A browser";

  const platform =
    /iphone|ipad/i.test(userAgent) ? "iPhone or iPad"
    : /android/i.test(userAgent) ? "Android"
    : /mac os x/i.test(userAgent) ? "a Mac"
    : /windows/i.test(userAgent) ? "Windows"
    : /linux/i.test(userAgent) ? "Linux"
    : "an unknown device";

  return `${browser} on ${platform}`;
}
