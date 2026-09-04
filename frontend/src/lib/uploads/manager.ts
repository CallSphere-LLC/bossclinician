import type { MediaAsset, MediaVisibility } from "@/types/admin";
import {
  UploadHttpError,
  createUploadSession,
  discardUpload,
  fetchUploadSession,
  fetchUploadSessions,
  finishUpload,
  putChunk,
} from "./client";
import {
  MAX_ATTEMPTS,
  backoffDelay,
  classifyStatus,
  nextChunkSize,
  type FailureAction,
} from "./retry";
import {
  fileStillReadable,
  forgetUpload,
  listRememberedUploads,
  rememberUpload,
  type PendingUpload,
} from "./store";

/**
 * The upload engine, and deliberately not a React component.
 *
 * It is a module singleton for one reason: an upload must not care what is on
 * screen. The admin is a single-page app, so the dropzone she started a 400MB
 * lesson video from unmounts the moment she clicks through to the course
 * builder to write its description — and if the upload lived in that
 * component's state, that click would cancel it. Living here, it keeps going
 * while she works, and every screen that wants to show it subscribes.
 *
 * What survives what:
 *
 *   navigating between admin pages   the upload keeps running, untouched
 *   closing the tab / reloading      the bytes and the session survive on the
 *                                    server; the File handle survives in
 *                                    IndexedDB; the upload comes back as a
 *                                    Resume button
 *   losing the network               chunks retry with backoff, then wait for
 *                                    the `online` event, then offer Resume
 *   being logged out mid-upload      it stops, says so, and resumes after she
 *                                    signs back in
 *   a different browser or machine   the server still lists the unfinished
 *                                    upload; she picks the file again to
 *                                    continue it from where it stopped
 */

export type UploadStatus =
  | "queued"
  | "uploading"
  | "retrying"
  | "offline"
  | "paused"
  | "needs-file"
  | "needs-signin"
  | "error"
  | "done"
  | "cancelled";

export interface UploadItem {
  /** Stable across a resume: the server's session id once there is one. */
  id: string;
  uploadId?: string;
  fileName: string;
  sizeBytes: number;
  loaded: number;
  visibility: MediaVisibility;
  /** Which screen started it. A dropzone shows its own; the tray shows all. */
  scope: string;
  status: UploadStatus;
  /** Plain-English detail for the row: why it stopped, or what to do. */
  message?: string;
  asset?: MediaAsset;
  /** False when there is a session to resume but no file to resume it from. */
  hasFile: boolean;
  attempts: number;
  startedAt: number;
  expiresAt?: string;
}

type Listener = (items: UploadItem[]) => void;
type CompletionListener = (asset: MediaAsset) => void;

interface Runtime {
  file?: File;
  controller: AbortController;
  chunkSize: number;
  running: boolean;
  /** Set by pause/cancel so a rejected request is not read as a network fault. */
  intent: "run" | "pause" | "cancel";
  timer?: number;
}

/** Two at a time. More divides the same line and finishes nothing sooner. */
const MAX_ACTIVE = 2;

const DEFAULT_CHUNK_BYTES = 4 * 1024 * 1024;

/**
 * How long an upload waits for the network before it stops waiting.
 *
 * It comes back by itself from a tunnel or a lift. An outage measured in tens
 * of minutes is a different thing: the laptop may be shut soon, the file may be
 * about to change, and a row that has said "waiting for internet" since this
 * morning is indistinguishable from a broken one. After this it parks itself
 * behind a Resume button, which is the honest state and the one that survives
 * everything else.
 */
const OFFLINE_PATIENCE_MS = 5 * 60 * 1000;

function localId(): string {
  return `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const ACTIVE: UploadStatus[] = ["queued", "uploading", "retrying", "offline"];

class UploadManager {
  private items = new Map<string, UploadItem>();
  private runtimes = new Map<string, Runtime>();
  private listeners = new Set<Listener>();
  private completions = new Map<string, Set<CompletionListener>>();
  /** Finished while nobody was listening for its scope. Delivered on subscribe. */
  private undelivered = new Map<string, MediaAsset[]>();
  private hydrated = false;
  private notifyQueued = false;
  private browserWired = false;

  // ---------------------------------------------------------------- reading

  list(): UploadItem[] {
    return [...this.items.values()].sort((a, b) => a.startedAt - b.startedAt);
  }

  active(): UploadItem[] {
    return this.list().filter((item) => ACTIVE.includes(item.status));
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    this.wireBrowser();
    void this.hydrate();
    listener(this.list());
    return () => this.listeners.delete(listener);
  }

  /**
   * Tells one screen about files that finished for it.
   *
   * Scoped, because "the video finished" means "attach it to lesson 12" on the
   * course builder and "add a row to the grid" in the media library. Anything
   * that completed while that screen was closed is handed over the moment it
   * comes back, so navigating away mid-upload loses the attachment and not the
   * file.
   */
  onComplete(scope: string, listener: CompletionListener): () => void {
    const set = this.completions.get(scope) ?? new Set<CompletionListener>();
    set.add(listener);
    this.completions.set(scope, set);

    const waiting = this.undelivered.get(scope);
    if (waiting?.length) {
      this.undelivered.delete(scope);
      for (const asset of waiting) listener(asset);
    }

    return () => {
      const current = this.completions.get(scope);
      current?.delete(listener);
      if (current && current.size === 0) this.completions.delete(scope);
    };
  }

  // ---------------------------------------------------------------- writing

  /** Files she just dropped or chose. */
  enqueue(files: File[], options: { visibility: MediaVisibility; scope: string }): void {
    this.wireBrowser();
    for (const file of files) {
      const id = localId();
      this.items.set(id, {
        id,
        fileName: file.name,
        sizeBytes: file.size,
        loaded: 0,
        visibility: options.visibility,
        scope: options.scope,
        status: "queued",
        hasFile: true,
        attempts: 0,
        startedAt: Date.now(),
      });
      this.runtimes.set(id, {
        file,
        controller: new AbortController(),
        chunkSize: DEFAULT_CHUNK_BYTES,
        running: false,
        intent: "run",
      });
    }
    this.changed();
    this.pump();
  }

  /** The Resume button, and what the `online` event presses on her behalf. */
  resume(id: string): void {
    const item = this.items.get(id);
    const runtime = this.runtimes.get(id);
    if (!item || !runtime) return;
    if (ACTIVE.includes(item.status)) return;
    if (!runtime.file) {
      this.patch(id, { status: "needs-file", message: "Find the file again to carry on." });
      return;
    }
    runtime.intent = "run";
    runtime.controller = new AbortController();
    this.patch(id, { status: "queued", attempts: 0, message: undefined });
    this.pump();
  }

  pause(id: string): void {
    const runtime = this.runtimes.get(id);
    if (!runtime) return;
    runtime.intent = "pause";
    if (runtime.timer) window.clearTimeout(runtime.timer);
    runtime.controller.abort();
    this.patch(id, { status: "paused", message: "Paused. It will carry on from here." });
  }

  /** Stop for good: the half-file goes, on the server too. */
  cancel(id: string): void {
    const item = this.items.get(id);
    const runtime = this.runtimes.get(id);
    if (!item || !runtime) return;
    runtime.intent = "cancel";
    if (runtime.timer) window.clearTimeout(runtime.timer);
    runtime.controller.abort();
    this.patch(id, { status: "cancelled", message: "You stopped this one." });
    if (item.uploadId) {
      void discardUpload(item.uploadId).catch(() => undefined);
      void forgetUpload(item.uploadId);
    }
    this.pump();
  }

  /** Takes the row off the list. The upload itself is already over. */
  dismiss(id: string): void {
    const item = this.items.get(id);
    if (item && ACTIVE.includes(item.status)) return;
    this.items.delete(id);
    this.runtimes.delete(id);
    this.changed();
  }

  /**
   * She picked the file again for an upload that had no handle for it.
   *
   * Checked rather than trusted: a different file of the same name would append
   * one video's bytes to another's and produce something that plays for two
   * minutes and then glitches, which is far worse than being asked to try
   * again.
   */
  attachFile(id: string, file: File): { ok: true } | { ok: false; reason: string } {
    const item = this.items.get(id);
    const runtime = this.runtimes.get(id);
    if (!item || !runtime) return { ok: false, reason: "That upload is no longer here." };
    if (file.size !== item.sizeBytes) {
      return {
        ok: false,
        reason: `That file is a different size from the one being uploaded (${item.fileName}). Pick the same file, or start it again.`,
      };
    }
    runtime.file = file;
    this.patch(id, { hasFile: true, status: "paused", message: undefined });
    this.resume(id);
    return { ok: true };
  }

  /** After signing back in: everything that stopped for want of a token. */
  resumeAfterSignIn(): void {
    for (const item of this.list()) {
      if (item.status === "needs-signin") this.resume(item.id);
    }
  }

  // -------------------------------------------------------------- hydration

  /**
   * Rebuilds the list after a reload from the two halves that survived it.
   *
   * The server knows which uploads are unfinished and exactly how many bytes it
   * holds; IndexedDB may still have the File. Everything lands as `paused`
   * rather than starting itself: she has just arrived on the page, possibly on
   * a metered connection, and a 400MB upload restarting unannounced is not a
   * pleasant surprise.
   */
  async hydrate(force = false): Promise<void> {
    if (this.hydrated && !force) return;
    this.hydrated = true;

    const remembered = new Map<string, PendingUpload>();
    for (const record of await listRememberedUploads()) {
      remembered.set(record.uploadId, record);
    }

    let sessions;
    try {
      sessions = await fetchUploadSessions();
    } catch {
      // Signed out, or the API is down. Nothing to show; a later hydrate will
      // find them. The local records stay untouched.
      return;
    }

    const live = new Set(sessions.map((session) => session.uploadId));
    for (const [uploadId] of remembered) {
      // Swept, finished elsewhere, or discarded. Stop remembering a file for it.
      if (!live.has(uploadId)) void forgetUpload(uploadId);
    }

    for (const session of sessions) {
      if (this.items.has(session.uploadId)) {
        this.patch(session.uploadId, { loaded: session.offset, expiresAt: session.expiresAt });
        continue;
      }
      const record = remembered.get(session.uploadId);
      const file = record?.file;
      const usable = file ? await fileStillReadable(file) : false;

      this.items.set(session.uploadId, {
        id: session.uploadId,
        uploadId: session.uploadId,
        fileName: session.fileName,
        sizeBytes: session.sizeBytes,
        loaded: session.offset,
        visibility: session.visibility,
        scope: record?.scope ?? "media-library",
        status: usable ? "paused" : "needs-file",
        message: usable
          ? "Stopped before it finished. Resume when you're ready."
          : "Find the file again to carry on from here.",
        hasFile: usable,
        attempts: 0,
        startedAt: record?.startedAt ?? (Date.parse(session.updatedAt) || Date.now()),
        expiresAt: session.expiresAt,
      });
      this.runtimes.set(session.uploadId, {
        file: usable ? file : undefined,
        controller: new AbortController(),
        chunkSize: session.chunkSize || DEFAULT_CHUNK_BYTES,
        running: false,
        intent: "run",
      });
    }
    this.changed();
  }

  // ----------------------------------------------------------------- engine

  private pump(): void {
    const running = this.list().filter(
      (item) => item.status === "uploading" || item.status === "retrying",
    ).length;
    let free = MAX_ACTIVE - running;
    if (free <= 0) return;

    for (const item of this.list()) {
      if (free <= 0) break;
      if (item.status !== "queued") continue;
      const runtime = this.runtimes.get(item.id);
      if (!runtime || runtime.running) continue;
      free -= 1;
      void this.run(item.id);
    }
  }

  private async run(id: string): Promise<void> {
    const runtime = this.runtimes.get(id);
    if (!runtime || runtime.running) return;
    runtime.running = true;
    this.patch(id, { status: "uploading" });

    // The id changes underneath us when the server assigns a session id, or
    // when an expired session forces a new one. The runtime object is carried
    // across both, and it is the one whose `running` flag has to be cleared.
    const finished = await this.drive(id)
      .catch((err: unknown) => {
        this.fail(this.currentIdFor(runtime) ?? id, err);
        return this.currentIdFor(runtime) ?? id;
      });
    const current = this.runtimes.get(finished);
    if (current) current.running = false;
    else runtime.running = false;
    this.pump();
  }

  /** Where a runtime object currently lives in the map, after any rekey. */
  private currentIdFor(runtime: Runtime): string | null {
    for (const [id, candidate] of this.runtimes) if (candidate === runtime) return id;
    return null;
  }

  /** Runs an upload to a conclusion and answers with the id it ended under. */
  private async drive(startId: string): Promise<string> {
    let id = startId;
    for (;;) {
      const item = this.items.get(id);
      const runtime = this.runtimes.get(id);
      if (!item || !runtime || runtime.intent !== "run") return id;

      const file = runtime.file;
      if (!file) {
        this.patch(id, { status: "needs-file", message: "Find the file again to carry on." });
        return id;
      }

      // Every step goes through the same recovery, because every step can be
      // the one the network dies during: opening the session, sending a chunk,
      // and finishing. A "complete" that never got its answer is exactly as
      // ordinary as a chunk that never got its answer.
      try {
        // A session first. Its offset, not ours, decides where we start: the
        // server may hold more than this tab ever sent (another tab, an
        // earlier visit) or less (a swept part file).
        if (!item.uploadId) {
          const created = await createUploadSession({ file, visibility: item.visibility });
          if (created.duplicate) {
            this.settle(id, created.asset, "That file is already in your library.");
            return id;
          }
          this.rekey(id, created.session.uploadId);
          id = created.session.uploadId;
          this.patch(id, {
            loaded: created.session.offset,
            expiresAt: created.session.expiresAt,
          });
          runtime.chunkSize = created.session.chunkSize || DEFAULT_CHUNK_BYTES;
          await this.remember(id);
          continue;
        }

        if (item.loaded >= item.sizeBytes) {
          const asset = await finishUpload(item.uploadId);
          void forgetUpload(item.uploadId);
          this.settle(id, asset);
          return id;
        }

        if (typeof navigator !== "undefined" && !navigator.onLine) {
          this.patch(id, {
            status: "offline",
            message: "No internet. This will pick up where it left off.",
          });
          if (!(await this.waitForNetwork(id))) {
            this.parkOffline(id);
            return id;
          }
          continue;
        }

        const base = item.loaded;
        const end = Math.min(base + runtime.chunkSize, item.sizeBytes);

        const result = await putChunk({
          uploadId: item.uploadId,
          offset: base,
          body: file.slice(base, end),
          onProgress: (sent) => this.progress(id, Math.min(base + sent, item.sizeBytes)),
          signal: runtime.controller.signal,
        });
        runtime.chunkSize = nextChunkSize(runtime.chunkSize, "ok");
        this.patch(id, {
          loaded: result.offset,
          attempts: 0,
          status: "uploading",
          message: undefined,
        });
        await this.remember(id);
      } catch (err) {
        const outcome = await this.recover(id, err);
        if (!outcome.carryOn) return outcome.id;
        id = outcome.id;
      }
    }
  }

  /**
   * One failed chunk: whether the loop should go round again, and under which
   * id, since an expired session is recovered by starting a new one.
   *
   * This is where a bad network stops being an error and becomes a wait.
   */
  private async recover(
    id: string,
    err: unknown,
  ): Promise<{ carryOn: boolean; id: string }> {
    const stop = { carryOn: false, id };
    const item = this.items.get(id);
    const runtime = this.runtimes.get(id);
    if (!item || !runtime) return stop;
    // She pressed pause or stop; the abort is the answer, not a fault.
    if (runtime.intent !== "run") return stop;

    const status = err instanceof UploadHttpError ? err.status : 0;
    let action: FailureAction = classifyStatus(status);
    const said = err instanceof Error ? err.message : "";

    // Before there is a session, a 409 is not an offset disagreement — it is
    // the library refusing the file, most often because a different file is
    // already stored under that name. Nothing to resync to, and no session to
    // restart.
    if (!item.uploadId && (action === "resync" || action === "restart")) action = "fatal";

    if (action === "reauth") {
      this.patch(id, {
        status: "needs-signin",
        message: "You were signed out. Sign in again and this will carry on.",
      });
      return stop;
    }

    if (action === "fatal") {
      this.patch(id, { status: "error", message: said || "That file couldn't be uploaded." });
      if (item.uploadId) void forgetUpload(item.uploadId);
      return stop;
    }

    if (action === "restart") {
      // The session expired or was swept. The bytes are gone; the file is not.
      if (item.uploadId) void forgetUpload(item.uploadId);
      this.patch(id, { uploadId: undefined, loaded: 0, attempts: 0, message: undefined });
      return { carryOn: true, id: this.rekeyToLocal(id) };
    }

    if (action === "resync") {
      const offset =
        err instanceof UploadHttpError && typeof err.offset === "number"
          ? err.offset
          : await this.askOffset(id);
      if (offset === null) {
        this.patch(id, {
          status: "paused",
          message: "Another tab is uploading this file. Let that one finish.",
        });
        return stop;
      }
      this.patch(id, { loaded: offset, attempts: 0 });
      return { carryOn: true, id };
    }

    // Retryable. The file itself is checked first: a moved or edited file fails
    // exactly like a dropped connection, and retrying it forever would be the
    // one failure the person watching can do nothing about.
    if (runtime.file && !(await fileStillReadable(runtime.file))) {
      runtime.file = undefined;
      this.patch(id, {
        status: "needs-file",
        hasFile: false,
        message: "That file has moved or changed. Find it again to carry on.",
      });
      return stop;
    }

    if (typeof navigator !== "undefined" && !navigator.onLine) {
      this.patch(id, {
        status: "offline",
        message: "No internet. This will pick up where it left off.",
      });
      if (!(await this.waitForNetwork(id))) {
        this.parkOffline(id);
        return stop;
      }
      return { carryOn: this.runtimes.get(id)?.intent === "run", id };
    }

    const attempts = item.attempts + 1;
    if (attempts >= MAX_ATTEMPTS) {
      this.patch(id, {
        status: "paused",
        attempts,
        message: "The connection keeps dropping. Resume when it's back.",
      });
      return stop;
    }

    const wait = backoffDelay(attempts);
    this.patch(id, {
      status: "retrying",
      attempts,
      message: `Connection trouble — trying again in ${Math.round(wait / 1000)}s.`,
    });
    await this.sleep(id, wait);
    return { carryOn: this.runtimes.get(id)?.intent === "run", id };
  }

  /** The server's own figure, when a 409 arrived without one. */
  private async askOffset(id: string): Promise<number | null> {
    const item = this.items.get(id);
    if (!item?.uploadId) return null;
    try {
      const session = await fetchUploadSession(item.uploadId);
      return session.offset;
    } catch {
      return null;
    }
  }

  private sleep(id: string, ms: number): Promise<void> {
    return new Promise((resolve) => {
      const runtime = this.runtimes.get(id);
      const timer = window.setTimeout(resolve, ms);
      if (runtime) runtime.timer = timer;
    });
  }

  /**
   * Waits for the network to come back. Answers false if it never did.
   *
   * The `online` event is the signal, and the poll behind it is the insurance:
   * a laptop that wakes from sleep on a different network does not always fire
   * one, and an upload that waits forever for an event that already happened is
   * indistinguishable from a broken feature.
   */
  private waitForNetwork(id: string): Promise<boolean> {
    return new Promise((resolve) => {
      const started = Date.now();
      const finish = (online: boolean): void => {
        window.removeEventListener("online", onOnline);
        window.clearInterval(poll);
        resolve(online);
      };
      const onOnline = (): void => finish(true);
      const poll = window.setInterval(() => {
        const runtime = this.runtimes.get(id);
        if (navigator.onLine) finish(true);
        else if (!runtime || runtime.intent !== "run") finish(false);
        else if (Date.now() - started > OFFLINE_PATIENCE_MS) finish(false);
      }, 5000);
      window.addEventListener("online", onOnline);
    });
  }

  /** Gives up waiting and hands her the button. Nothing is lost by doing so. */
  private parkOffline(id: string): void {
    const runtime = this.runtimes.get(id);
    if (runtime && runtime.intent !== "run") return;
    this.patch(id, {
      status: "paused",
      message: "Still no internet. Resume this when you're back online.",
    });
  }

  // ------------------------------------------------------------ bookkeeping

  private fail(id: string, err: unknown): void {
    const runtime = this.runtimes.get(id);
    if (runtime && runtime.intent !== "run") return;
    const status = err instanceof UploadHttpError ? err.status : 0;
    const said = err instanceof Error ? err.message : "";
    if (classifyStatus(status) === "reauth") {
      this.patch(id, {
        status: "needs-signin",
        message: "You were signed out. Sign in again and this will carry on.",
      });
      return;
    }
    this.patch(id, {
      status: status === 0 ? "paused" : "error",
      message: said || "That upload stopped. Resume to try again.",
    });
  }

  private settle(id: string, asset: MediaAsset, message?: string): void {
    this.patch(id, {
      status: "done",
      loaded: this.items.get(id)?.sizeBytes ?? 0,
      asset,
      message,
    });
    const item = this.items.get(id);
    if (!item) return;

    const listeners = this.completions.get(item.scope);
    if (listeners?.size) {
      for (const listener of listeners) listener(asset);
    } else {
      // Nobody is on that screen any more. Keep it for when they come back.
      const waiting = this.undelivered.get(item.scope) ?? [];
      waiting.push(asset);
      this.undelivered.set(item.scope, waiting);
    }

    // Finished rows clear themselves so the tray does not become a history.
    window.setTimeout(() => {
      const current = this.items.get(id);
      if (current?.status === "done") this.dismiss(id);
    }, 6000);
  }

  private async remember(id: string): Promise<void> {
    const item = this.items.get(id);
    const runtime = this.runtimes.get(id);
    if (!item?.uploadId || !runtime?.file) return;
    await rememberUpload({
      uploadId: item.uploadId,
      fileName: item.fileName,
      sizeBytes: item.sizeBytes,
      mime: runtime.file.type,
      lastModified: runtime.file.lastModified,
      visibility: item.visibility,
      offset: item.loaded,
      scope: item.scope,
      startedAt: item.startedAt,
      updatedAt: Date.now(),
      file: runtime.file,
    });
  }

  /** The local placeholder id becomes the server's, so a reload can match them. */
  private rekey(id: string, uploadId: string): void {
    const item = this.items.get(id);
    const runtime = this.runtimes.get(id);
    if (!item || !runtime) return;
    this.items.delete(id);
    this.runtimes.delete(id);
    this.items.set(uploadId, { ...item, id: uploadId, uploadId });
    this.runtimes.set(uploadId, runtime);
    this.changed();
  }

  /** The reverse, for a session the server has forgotten and we must recreate. */
  private rekeyToLocal(id: string): string {
    const item = this.items.get(id);
    const runtime = this.runtimes.get(id);
    if (!item || !runtime) return id;
    const fresh = localId();
    this.items.delete(id);
    this.runtimes.delete(id);
    this.items.set(fresh, { ...item, id: fresh, uploadId: undefined, loaded: 0 });
    this.runtimes.set(fresh, runtime);
    this.changed();
    return fresh;
  }

  private patch(id: string, changes: Partial<UploadItem>): void {
    const item = this.items.get(id);
    if (!item) return;
    this.items.set(id, { ...item, ...changes });
    this.changed();
  }

  /** Progress arrives many times a second; the UI does not need all of them. */
  private progress(id: string, loaded: number): void {
    const item = this.items.get(id);
    if (!item) return;
    this.items.set(id, { ...item, loaded });
    this.changed();
  }

  private changed(): void {
    if (this.notifyQueued) return;
    this.notifyQueued = true;
    const flush = (): void => {
      this.notifyQueued = false;
      const snapshot = this.list();
      for (const listener of this.listeners) listener(snapshot);
    };
    if (typeof window === "undefined") flush();
    else window.setTimeout(flush, 80);
  }

  private wireBrowser(): void {
    if (this.browserWired || typeof window === "undefined") return;
    this.browserWired = true;

    window.addEventListener("online", () => {
      for (const item of this.list()) {
        if (item.status === "offline" || item.status === "retrying") this.resume(item.id);
      }
    });
    window.addEventListener("offline", () => {
      for (const item of this.list()) {
        if (item.status === "uploading" || item.status === "retrying") {
          this.patch(item.id, {
            status: "offline",
            message: "No internet. This will pick up where it left off.",
          });
        }
      }
    });

    // Closing the tab does not lose the upload — that is the point of all of
    // this — but it does stop it, and she should be told rather than find out
    // tomorrow.
    window.addEventListener("beforeunload", (event) => {
      if (this.active().length === 0) return;
      event.preventDefault();
      event.returnValue = "";
    });
  }
}

export const uploadManager = new UploadManager();
