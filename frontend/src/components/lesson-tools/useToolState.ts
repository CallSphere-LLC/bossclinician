import { useCallback, useEffect, useRef, useState } from "react";
import { usePlayerSource } from "@/components/player/playerSource";
import { useMember } from "@/hooks/useMember";
import { MemberApiError, memberRequest } from "@/lib/memberApi";

/**
 * A lesson tool's entries, saved to the member's account (migration 119,
 * routes/member/toolState.ts) instead of the prototypes' localStorage.
 *
 * - Loads once from GET /member/tool-state/:toolKey, then writes the whole
 *   document back with a debounced PUT after each pause in typing, and once
 *   more as the tool unmounts or the tab is hidden, so a member who types and
 *   leaves does not lose the last few keystrokes.
 * - Nothing is written until the load has succeeded: a failed read followed by
 *   an autosave would replace the member's real plan with the example values.
 * - The admin's "Preview as student" has no member session. The tool runs on
 *   its defaults there and nothing is read or written ("preview").
 * - "View as member" reads the student's entries but never saves ("readonly");
 *   the server refuses that write anyway (denyImpersonation).
 */

export type SaveStatus = "loading" | "idle" | "saving" | "saved" | "error" | "offline" | "preview" | "readonly";

const SAVE_DELAY_MS = 900;

const path = (toolKey: string) => `/member/tool-state/${encodeURIComponent(toolKey)}`;

export interface ToolStateHandle<T> {
  state: T;
  /** Same contract as React's setState. */
  setState: (next: T | ((prev: T) => T)) => void;
  status: SaveStatus;
  /** False until the saved entries (or the defaults) are in place. */
  ready: boolean;
  /** When the server last stored this document, or null before the first save. */
  savedAt: string | null;
  /** Whether this session writes to the account at all. */
  persists: boolean;
}

export function useToolState<T extends object>(
  toolKey: string,
  defaults: () => T,
  /** Merges whatever was stored (or imported) over the defaults; must not throw. */
  normalise: (raw: unknown) => T,
): ToolStateHandle<T> {
  const { preview } = usePlayerSource();
  const { member } = useMember();
  const readOnly = member?.impersonatedBy != null;

  const [state, setLocal] = useState<T>(defaults);
  // The latest value, so an update can be computed and saved outside React's
  // state updater (which may run twice and must stay free of side effects).
  const latest = useRef<T>(state);
  const [status, setStatus] = useState<SaveStatus>(preview ? "preview" : "loading");
  const [ready, setReady] = useState<boolean>(Boolean(preview));
  const [savedAt, setSavedAt] = useState<string | null>(null);

  // Writes are allowed only after a successful load, never in a preview, never
  // while an admin is looking through a member's account.
  const writable = useRef(false);
  const pending = useRef<T | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const normaliseRef = useRef(normalise);
  normaliseRef.current = normalise;

  useEffect(() => {
    if (preview) return;
    let cancelled = false;
    memberRequest<{ state: unknown; updatedAt: string | null }>(path(toolKey))
      .then((stored) => {
        if (cancelled) return;
        if (stored.state && typeof stored.state === "object") {
          latest.current = normaliseRef.current(stored.state);
          setLocal(latest.current);
        }
        setSavedAt(stored.updatedAt);
        writable.current = !readOnly;
        setStatus(readOnly ? "readonly" : "idle");
        setReady(true);
      })
      .catch(() => {
        if (cancelled) return;
        // Usable on its defaults, but never saved over whatever is stored.
        writable.current = false;
        setStatus("offline");
        setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [preview, readOnly, toolKey]);

  const flush = useCallback(
    async (keepalive = false) => {
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
      const next = pending.current;
      if (!next || !writable.current) return;
      pending.current = null;
      if (!keepalive) setStatus("saving");
      try {
        const saved = await memberRequest<{ ok: true; updatedAt: string }>(path(toolKey), {
          method: "PUT",
          body: JSON.stringify({ state: next }),
          keepalive,
        });
        if (keepalive) return;
        setSavedAt(saved.updatedAt);
        // A newer edit may have queued while this one was in flight.
        setStatus(pending.current ? "saving" : "saved");
      } catch (err) {
        if (keepalive) return;
        if (err instanceof MemberApiError && err.status === 403) {
          writable.current = false;
          setStatus("readonly");
          return;
        }
        // Keep the unsent entries so the next edit (or the retry) carries them.
        pending.current = pending.current ?? next;
        setStatus("error");
      }
    },
    [toolKey],
  );

  const schedule = useCallback(
    (next: T) => {
      if (!writable.current) return;
      pending.current = next;
      setStatus("saving");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), SAVE_DELAY_MS);
    },
    [flush],
  );

  const setState = useCallback(
    (next: T | ((prev: T) => T)) => {
      const prev = latest.current;
      const value = typeof next === "function" ? (next as (prev: T) => T)(prev) : next;
      if (value === prev) return;
      latest.current = value;
      setLocal(value);
      schedule(value);
    },
    [schedule],
  );

  // The last edit, sent as the tool goes away or the tab is put down.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") void flush(true);
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      void flush(true);
    };
  }, [flush]);

  // A failed save tries again on its own after a short wait.
  useEffect(() => {
    if (status !== "error") return;
    const retry = setTimeout(() => void flush(), 8000);
    return () => clearTimeout(retry);
  }, [status, flush]);

  return { state, setState, status, ready, savedAt, persists: !preview && !readOnly };
}
