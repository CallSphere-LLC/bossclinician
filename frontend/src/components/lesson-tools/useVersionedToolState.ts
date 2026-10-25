import { useCallback, useEffect, useRef, useState } from "react";
import { usePlayerSource } from "@/components/player/playerSource";
import { useMember } from "@/hooks/useMember";
import { MemberApiError, memberRequest } from "@/lib/memberApi";
import type { SaveStatus } from "./useToolState";

/** Private, revision-checked persistence. A stale device never silently replaces
 * another device's work. Idle tabs refresh on focus and every 15 seconds. */
export function useVersionedToolState<T extends object>(key: string, defaults: () => T, normalise: (value: unknown) => T) {
  const {preview} = usePlayerSource();
  const {member} = useMember();
  const memberId = member?.id ?? null;
  const readonly = member?.impersonatedBy != null;
  const [state, local] = useState<T>(defaults);
  const [status, setStatus] = useState<SaveStatus>(preview ? "preview" : "loading");
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [ready, setReady] = useState(!!preview);
  const version = useRef(0), epoch = useRef(0);
  const pending = useRef<T | null>(null), busy = useRef(false), loaded = useRef(false), blocked = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const path = `/member/tool-state/${encodeURIComponent(key)}`;
  const norm = useRef(normalise); norm.current = normalise;
  const init = useRef(defaults); init.current = defaults;
  const refresh = useCallback(async (replace = false) => {
    if (preview || busy.current || (!replace && (pending.current || blocked.current))) return;
    const generation = epoch.current, readRevision = version.current;
    try {
      const result = await memberRequest<{state: unknown; revision: number; updatedAt: string | null}>(path);
      if (generation !== epoch.current || readRevision !== version.current || busy.current || (!replace && pending.current)) return;
      if (replace || !loaded.current || version.current !== result.revision) local(norm.current(result.state));
      version.current = result.revision;
      loaded.current = true; blocked.current = false;
      if (replace) pending.current = null;
      setReady(true); setSavedAt(result.updatedAt); setStatus(readonly ? "readonly" : result.updatedAt ? "saved" : "idle");
    } catch { if (generation === epoch.current && !loaded.current) setStatus("offline"); }
  }, [path, preview, readonly]);
  const flush = useCallback(async (keepalive = false) => {
    clearTimeout(timer.current);
    if (preview || readonly || busy.current || !loaded.current || blocked.current || !pending.current) return;
    const next = pending.current, generation = epoch.current;
    pending.current = null; busy.current = true;
    setStatus("saving");
    try {
      const result = await memberRequest<{updatedAt: string; revision: number}>(path, {method:"PUT", body:JSON.stringify({state:next, revision:version.current, expectedMemberId:memberId}), keepalive});
      if (generation !== epoch.current) return;
      version.current = result.revision; setSavedAt(result.updatedAt); setStatus(pending.current ? "saving" : "saved");
    } catch (error) {
      if (generation !== epoch.current) return;
      pending.current ??= next;
      if (error instanceof MemberApiError && error.status === 409) { blocked.current = true; setStatus("conflict"); }
      else if (error instanceof MemberApiError && [401,403,404].includes(error.status)) { blocked.current = true; setStatus("readonly"); }
      else setStatus("error");
    } finally {
      if (generation === epoch.current) {
        busy.current = false;
        if (pending.current && !blocked.current) timer.current = setTimeout(() => void flush(), 2000);
      }
    }
  }, [path, preview, readonly, memberId]);
  useEffect(() => {
    epoch.current++; loaded.current = false; blocked.current = false; pending.current = null; busy.current = false; version.current = 0;
    local(init.current()); setReady(!!preview); setStatus(preview ? "preview" : "loading");
    void refresh();
    const focus = () => void refresh();
    const visibility = () => document.visibilityState === "hidden" ? void flush(true) : void refresh();
    window.addEventListener("focus", focus); window.addEventListener("online", focus); document.addEventListener("visibilitychange", visibility);
    const interval = setInterval(focus, 15000);
    return () => { clearInterval(interval); clearTimeout(timer.current); window.removeEventListener("focus", focus); window.removeEventListener("online", focus); document.removeEventListener("visibilitychange", visibility); void flush(true); };
  }, [member?.id, preview, refresh, flush]);
  const setState = useCallback((next: T) => {
    if (!preview && (readonly || !loaded.current || blocked.current)) return;
    local(next);
    if (preview) return;
    pending.current = next; setStatus("saving"); clearTimeout(timer.current); timer.current = setTimeout(() => void flush(), 700);
  }, [preview, readonly, flush]);
  return {state, setState, status, savedAt, ready, reload: () => refresh(true)};
}
