import type { MediaVisibility } from "@/types/admin";

/**
 * The half of a resumable upload the server cannot keep: the file itself.
 *
 * The server remembers how many bytes of "Module 3.mp4" it has. It has no way
 * to remember *which file on her laptop* those bytes came from, so a browser
 * that has been closed and reopened knows there is an upload to finish and has
 * nothing to finish it with. IndexedDB does store a File — the handle survives
 * a reload, a crash and a logout, and stays valid as long as the file on disk
 * is untouched — so this is what turns "you have an unfinished upload, please
 * find the file again" into a Resume button that just works.
 *
 * Everything here fails soft. Private windows, storage-blocking settings and
 * quota refusals all end with the same fallback: no stored handle, and a resume
 * that asks her to pick the file. That is worse than a Resume button and much
 * better than an exception on a page that was only trying to show a progress
 * bar.
 */

const DB_NAME = "bc-admin-uploads";
const DB_VERSION = 1;
const STORE = "pending";

export interface PendingUpload {
  /** The server's session id. The same value the resume endpoints take. */
  uploadId: string;
  fileName: string;
  sizeBytes: number;
  mime: string;
  lastModified: number;
  visibility: MediaVisibility;
  /** Where the client believed it had got to. The server's figure still wins. */
  offset: number;
  /** Which screen started it, so a dropzone can show its own work. */
  scope: string;
  startedAt: number;
  updatedAt: number;
  /**
   * Undefined when the browser would not store it, or when the record was
   * rebuilt from the server's list on a machine that never had the file.
   */
  file?: File;
}

function available(): boolean {
  return typeof indexedDB !== "undefined";
}

let opening: Promise<IDBDatabase | null> | null = null;

function open(): Promise<IDBDatabase | null> {
  if (!available()) return Promise.resolve(null);
  if (opening) return opening;
  opening = new Promise<IDBDatabase | null>((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "uploadId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
  return opening;
}

function run<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  return open().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) {
          resolve(null);
          return;
        }
        let request: IDBRequest<T>;
        try {
          request = work(db.transaction(STORE, mode).objectStore(STORE));
        } catch {
          resolve(null);
          return;
        }
        request.onsuccess = () => resolve(request.result);
        // A quota refusal on a 400MB File is the common one. The upload still
        // works in this tab; it just cannot be resumed after a reload.
        request.onerror = () => resolve(null);
      }),
  );
}

export async function rememberUpload(record: PendingUpload): Promise<void> {
  await run("readwrite", (store) => store.put(record));
}

export async function forgetUpload(uploadId: string): Promise<void> {
  await run("readwrite", (store) => store.delete(uploadId));
}

export async function listRememberedUploads(): Promise<PendingUpload[]> {
  const all = await run<PendingUpload[]>("readonly", (store) => store.getAll());
  return all ?? [];
}

export async function rememberedUpload(uploadId: string): Promise<PendingUpload | null> {
  return (await run<PendingUpload>("readonly", (store) => store.get(uploadId))) ?? null;
}

/**
 * Whether the handle still points at readable bytes.
 *
 * A File in IndexedDB is a reference to a path, not a copy. Move, rename, edit
 * or delete the file and the handle is still there and still claims a size,
 * and every read throws NotReadableError — which, mid-resume, looks exactly
 * like a network fault and would be retried forever. One byte, read up front,
 * turns that into a plain "find the file again".
 */
export async function fileStillReadable(file: File): Promise<boolean> {
  try {
    await file.slice(0, 1).arrayBuffer();
    return true;
  } catch {
    return false;
  }
}
