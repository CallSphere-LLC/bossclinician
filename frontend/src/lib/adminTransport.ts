/** Admin credentials exist only in server-issued HttpOnly cookies. */
const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "/api";
let refreshInFlight: Promise<boolean> | null = null;

export function clearLegacyAdminToken(): void {
  try { window.localStorage.removeItem("bc_admin_token"); } catch { /* Storage can be disabled. */ }
}

export function refreshAdminSession(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = fetch(`${API_BASE}/admin/refresh`, { method: "POST", credentials: "include" })
      .then((response) => response.ok)
      .finally(() => { refreshInFlight = null; });
  }
  return refreshInFlight;
}

/** One refresh/retry shared by JSON, CSV, PDF and media clients. */
export async function sessionFetch(input: RequestInfo | URL, options: RequestInit = {}): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const adminRequest = /\/admin(?:\/|\?|$)/.test(url);
  if (!adminRequest) return fetch(input, options);
  const init = { ...options, credentials: "include" as const };
  const response = await fetch(input, init);
  const authAction = /\/admin\/(login|logout|refresh)(?:\?|$)/.test(url);
  if (response.status !== 401 || authAction || !(await refreshAdminSession())) return response;
  return fetch(input, init);
}
