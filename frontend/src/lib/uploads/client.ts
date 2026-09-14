import { sessionFetch, refreshAdminSession } from "@/lib/adminTransport";
import { API_BASE } from "@/lib/api";
import type { MediaAsset, MediaVisibility } from "@/types/admin";

/**
 * The wire calls for a resumable upload.
 *
 * XMLHttpRequest rather than fetch, and not by nostalgia: fetch still cannot
 * report how much of a request body has gone out, and a 400MB upload with no
 * progress bar is indistinguishable from a hung one. Everything else here is a
 * plain fetch.
 */

export class UploadHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** The offset the server says the file is really at, on a 409. */
    readonly offset?: number,
  ) {
    super(message);
  }
}

export interface ServerUploadSession {
  uploadId: string;
  fileName: string;
  mime: string;
  visibility: MediaVisibility;
  sizeBytes: number;
  offset: number;
  status: "open" | "completed" | "aborted";
  chunkSize: number;
  updatedAt: string;
  expiresAt: string;
  resumed?: boolean;
}

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return extra;
}

async function readError(res: Response): Promise<UploadHttpError> {
  let message = "That upload was interrupted.";
  let offset: number | undefined;
  try {
    const body = (await res.json()) as {
      error?: string;
      details?: { offset?: number };
    };
    if (body.error) message = body.error;
    if (typeof body.details?.offset === "number") offset = body.details.offset;
  } catch {
    // nginx answers 413 and 502 with HTML. The status is the whole message.
    if (res.status === 413) message = "That file is too large.";
  }
  return new UploadHttpError(message, res.status, offset);
}

/**
 * Opens a session, resumes the one already open for this file, or is told the
 * file is in the library already.
 */
export async function createUploadSession(input: {
  file: File;
  visibility: MediaVisibility;
}): Promise<
  { duplicate: true; asset: MediaAsset } | { duplicate: false; session: ServerUploadSession }
> {
  const res = await sessionFetch(`${API_BASE}/admin/media/uploads`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      fileName: input.file.name,
      sizeBytes: input.file.size,
      mime: input.file.type,
      lastModified: input.file.lastModified,
      visibility: input.visibility,
    }),
  });
  if (!res.ok) throw await readError(res);

  const body = (await res.json()) as
    | { duplicate: true; asset: MediaAsset }
    | ServerUploadSession;
  if ("duplicate" in body && body.duplicate) return { duplicate: true, asset: body.asset };
  return { duplicate: false, session: body as ServerUploadSession };
}

/** Everything this administrator started and never finished, from any device. */
export async function fetchUploadSessions(): Promise<ServerUploadSession[]> {
  const res = await sessionFetch(`${API_BASE}/admin/media/uploads`, { headers: authHeaders() });
  if (!res.ok) throw await readError(res);
  return (await res.json()) as ServerUploadSession[];
}

/** Where the server says this upload has got to. The client's own count never wins. */
export async function fetchUploadSession(uploadId: string): Promise<ServerUploadSession> {
  const res = await sessionFetch(`${API_BASE}/admin/media/uploads/${uploadId}`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw await readError(res);
  return (await res.json()) as ServerUploadSession;
}

export interface ChunkResult {
  offset: number;
  sizeBytes: number;
  complete: boolean;
}

/** One chunk, with progress and a working cancel. */
type ChunkInput = {
  uploadId: string;
  offset: number;
  body: Blob;
  onProgress: (sentBytes: number) => void;
  signal: AbortSignal;
};
export async function putChunk(input: ChunkInput): Promise<ChunkResult> {
  try { return await sendChunk(input); }
  catch (error) {
    if (!(error instanceof UploadHttpError) || error.status !== 401 || input.signal.aborted || !(await refreshAdminSession())) throw error;
    return sendChunk(input);
  }
}
function sendChunk(input: ChunkInput): Promise<ChunkResult> {
  if (input.signal.aborted) return Promise.reject(new UploadHttpError("Stopped.", 0));
  return new Promise<ChunkResult>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", `${API_BASE}/admin/media/uploads/${input.uploadId}?offset=${input.offset}`);
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.withCredentials = true;

    const onAbort = (): void => xhr.abort();
    input.signal.addEventListener("abort", onAbort);
    const done = (): void => input.signal.removeEventListener("abort", onAbort);

    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) input.onProgress(event.loaded);
    });

    xhr.addEventListener("load", () => {
      done();
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const body = JSON.parse(xhr.responseText) as ChunkResult;
          resolve(body);
        } catch {
          reject(new UploadHttpError("The server's answer made no sense.", xhr.status));
        }
        return;
      }
      let message = "That part of the file didn't get through.";
      let offset: number | undefined;
      try {
        const body = JSON.parse(xhr.responseText) as {
          error?: string;
          details?: { offset?: number };
        };
        if (body.error) message = body.error;
        if (typeof body.details?.offset === "number") offset = body.details.offset;
      } catch {
        if (xhr.status === 413) message = "That chunk was too large.";
      }
      reject(new UploadHttpError(message, xhr.status, offset));
    });

    // status 0 throughout: there is no response, which is precisely the case
    // the whole resumable path exists for.
    xhr.addEventListener("error", () => {
      done();
      reject(new UploadHttpError("The connection dropped.", 0));
    });
    xhr.addEventListener("timeout", () => {
      done();
      reject(new UploadHttpError("The connection timed out.", 0));
    });
    xhr.addEventListener("abort", () => {
      done();
      reject(new UploadHttpError("Stopped.", 0));
    });

    xhr.send(input.body);
  });
}

/** Turns a finished session into a library asset. Safe to call twice. */
export async function finishUpload(uploadId: string): Promise<MediaAsset> {
  const res = await sessionFetch(`${API_BASE}/admin/media/uploads/${uploadId}/complete`, {
    method: "POST",
    headers: authHeaders(),
  });
  if (!res.ok) throw await readError(res);
  return (await res.json()) as MediaAsset;
}

/** Throws the half-file away, on the server as well as here. */
export async function discardUpload(uploadId: string): Promise<void> {
  const res = await sessionFetch(`${API_BASE}/admin/media/uploads/${uploadId}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  // A session already gone is the outcome the caller wanted.
  if (!res.ok && res.status !== 404) throw await readError(res);
}
