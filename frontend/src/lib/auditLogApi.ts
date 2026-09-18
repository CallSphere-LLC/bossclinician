import { sessionFetch } from "@/lib/adminTransport";
import { ApiError } from "@/lib/api";

/**
 * The activity log — who did what in the admin, and when.
 *
 * Kept off `lib/api.ts` for the same reason the contacts client is: that file is
 * shared by every screen in the console, and this one carries only the shapes
 * the log speaks.
 */

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "/api";

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  const res = await sessionFetch(`${API_BASE}${path}`, { ...options, headers });

  if (!res.ok) {
    let message = "Something went wrong. Please try again in a moment.";
    try {
      const body = (await res.json()) as { error?: string; message?: string };
      message = body.error ?? body.message ?? message;
    } catch {
      // A non-JSON body tells us nothing worth showing.
    }
    throw new ApiError(message, res.status);
  }

  return (await res.json()) as T;
}

export interface AuditLogEntry {
  /** A bigint in the database, so it travels as text. */
  id: string;
  adminUserId: number | null;
  adminEmail: string;
  /** Null once the admin's account has been removed; the email above survives. */
  adminName: string | null;
  action: string;
  entityType: string;
  entityId: string;
  /** Whatever the recording route captured — shown as it was stored. */
  beforeState: unknown;
  afterState: unknown;
  ip: string;
  createdAt: string;
}

export interface AuditLogPage {
  items: AuditLogEntry[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AuditLogFilters {
  actor?: string;
  /** Matched from the start: "offer." finds every offer action. */
  action?: string;
  entityType?: string;
  /** ISO instants. */
  from?: string;
  to?: string;
}

export interface AuditLogFacets {
  entityTypes: string[];
  actors: string[];
}

export const auditLogApi = {
  list: (filters: AuditLogFilters, page: number, limit = 50) => {
    const query = new URLSearchParams({ page: String(page), limit: String(limit) });
    for (const [key, value] of Object.entries(filters)) {
      if (typeof value === "string" && value !== "") query.set(key, value);
    }
    return request<AuditLogPage>(`/admin/audit-log?${query.toString()}`);
  },
  facets: () => request<AuditLogFacets>("/admin/audit-log/facets"),
};
