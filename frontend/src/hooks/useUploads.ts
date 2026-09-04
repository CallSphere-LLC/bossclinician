import { useEffect, useMemo, useRef, useState } from "react";
import { uploadManager, type UploadItem } from "@/lib/uploads/manager";
import type { MediaAsset } from "@/types/admin";

/**
 * React's view of the upload engine.
 *
 * The engine is a module singleton (lib/uploads/manager.ts) so an upload
 * outlives the screen that started it. These hooks are the only thing that
 * knows about React: they subscribe, they re-render, and they unsubscribe.
 * Unmounting a component stops it *watching* an upload and never stops the
 * upload.
 */
export function useUploads(scope?: string): UploadItem[] {
  const [items, setItems] = useState<UploadItem[]>(() => uploadManager.list());

  useEffect(() => uploadManager.subscribe(setItems), []);

  return useMemo(
    () => (scope ? items.filter((item) => item.scope === scope) : items),
    [items, scope],
  );
}

/**
 * Fires when a file finishes for this screen.
 *
 * Including files that finished while the screen was elsewhere: those are held
 * by the manager and delivered on mount, so leaving the course builder
 * mid-upload and coming back still attaches the video.
 */
export function useUploadCompletions(scope: string, onUploaded: (asset: MediaAsset) => void): void {
  // Through a ref, so the subscription survives the caller passing a fresh
  // arrow function on every render. Re-subscribing each render would work, but
  // it would also re-deliver the backlog of files that finished while the
  // screen was closed, once per render.
  const latest = useRef(onUploaded);
  latest.current = onUploaded;

  useEffect(() => uploadManager.onComplete(scope, (asset) => latest.current(asset)), [scope]);
}
