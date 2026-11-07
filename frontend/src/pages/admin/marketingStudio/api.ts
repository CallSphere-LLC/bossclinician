import { sessionFetch } from "@/lib/adminTransport";
import { ApiError } from "@/lib/api";

/**
 * Marketing Studio storage — see backend routes/admin/marketingStudio.ts.
 *
 * The whole studio (settings, posts, saved ideas, hook-template changes) is
 * one document with a version number. A save names the version it was based
 * on; if another device saved first the server refuses with 409 rather than
 * overwrite that work.
 */

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "/api";

export interface StudioDocument {
  state: Record<string, unknown> | null;
  recovery: Record<string, unknown> | null;
  version: number;
  updatedAt: string | null;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const res = await sessionFetch(`${API_BASE}${path}`, { ...options, headers });
  if (!res.ok) {
    let message = "";
    try {
      const body = (await res.json()) as { error?: string; message?: string };
      message = body.message ?? body.error ?? "";
    } catch {
      // status alone is enough for the screen
    }
    throw new ApiError(message, res.status);
  }
  return (await res.json()) as T;
}

export const marketingStudioApi = {
  load: () => request<StudioDocument>("/admin/marketing-studio"),
  save: (body: { state: unknown; version: number; recovery?: unknown }) =>
    request<{ version: number; updatedAt: string }>("/admin/marketing-studio", {
      method: "PUT",
      body: JSON.stringify(body),
    }),
};
