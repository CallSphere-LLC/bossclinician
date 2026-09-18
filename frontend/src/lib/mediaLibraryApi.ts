import { sessionFetch } from "@/lib/adminTransport";
import { ApiError } from "@/lib/api";
import type { MediaAsset } from "@/types/admin";

/**
 * Folders, alt text and tags for the media library.
 *
 * Kept off `lib/api.ts` because that file is shared by every other screen in
 * the console. Uploading, deleting and previewing still go through `adminApi`;
 * this carries only what the library screen itself organises files with.
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

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/**
 * A library row with the two fields the shared `MediaAsset` type has not named.
 * Optional, because an asset handed back by the uploader is typed as the shared
 * shape even though the server sends both.
 */
export type LibraryAsset = MediaAsset & { altText?: string; tags?: string[] };

export interface MediaFolder {
  name: string;
  count: number;
}

export interface MediaPatch {
  title?: string;
  /** "" takes the file out of its folder. */
  folder?: string;
  altText?: string;
  tags?: string[];
}

export interface MediaListFilters {
  kind?: string;
  /** "" asks for files that are not in a folder. */
  folder?: string;
  tag?: string;
  q?: string;
}

export const mediaLibraryApi = {
  list: (filters: MediaListFilters = {}) => {
    const params = new URLSearchParams();
    if (filters.kind && filters.kind !== "all") params.set("kind", filters.kind);
    if (filters.folder !== undefined) params.set("folder", filters.folder);
    if (filters.tag) params.set("tag", filters.tag);
    if (filters.q?.trim()) params.set("q", filters.q.trim());
    const query = params.toString();
    return request<LibraryAsset[]>(`/admin/media${query ? `?${query}` : ""}`);
  },
  folders: () => request<MediaFolder[]>("/admin/media/folders"),
  update: (id: number, patch: MediaPatch) =>
    request<LibraryAsset>(`/admin/media/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
};

/** "brand, Logo , #hero" → ["brand", "Logo", "hero"]. The server does the rest. */
export function parseTagInput(input: string): string[] {
  return input
    .split(",")
    .map((tag) => tag.replace(/^\s*#+/, "").trim())
    .filter((tag) => tag !== "");
}
