import { sessionFetch } from "@/lib/adminTransport";
import { API_BASE } from "@/lib/api";

/**
 * Receipt documents on the admin side, without opening a window.
 *
 * Downloads use the shared HttpOnly-cookie transport, including refresh after
 * access expiry. Fetching PDF bytes preserves the existing in-tab download UI.
 */

export class AdminDocumentError extends Error {
  status: number;
  constructor(status: number) {
    super(status === 404 ? "We couldn't find that receipt." : "We could not open that receipt.");
    this.status = status;
  }
}

async function send(path: string): Promise<Response> {
  const res = await sessionFetch(`${API_BASE}${path}`, {
    
  });
  if (!res.ok) throw new AdminDocumentError(res.status);
  return res;
}

/** A server-rendered document's markup, e.g. `/admin/sales/invoices/7/receipt`. */
export async function fetchAdminDocument(path: string): Promise<string> {
  return (await send(path)).text();
}

/** Saves a PDF from this tab, under the filename the server gave it. */
export async function downloadAdminDocument(path: string, fallbackName: string): Promise<void> {
  const res = await send(path);
  const disposition = res.headers.get("Content-Disposition") ?? "";
  const name = /filename="([^"]+)"/.exec(disposition)?.[1] ?? fallbackName;

  const url = URL.createObjectURL(await res.blob());
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Long enough for the download to have started; not held for the session.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
