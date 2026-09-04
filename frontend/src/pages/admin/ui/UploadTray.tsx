import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronDown, ChevronUp, UploadCloud } from "lucide-react";
import { uploadManager } from "@/lib/uploads/manager";
import { useUploads } from "@/hooks/useUploads";
import { cn } from "@/lib/cn";
import { pluralize } from "@/pages/admin/ui/friendly";
import { Button } from "@/pages/admin/ui/primitives";
import { UploadRow } from "@/pages/admin/ui/UploadRow";

/**
 * The uploads, wherever she is.
 *
 * Mounted once in the admin shell rather than on the media library, because
 * that is the whole point: she starts a 400MB lesson video, goes off to write
 * the lesson description, and the upload has to still be visibly happening.
 * It is also where an upload interrupted yesterday reappears, with the Resume
 * button that finishes it from the byte it stopped on.
 */

const COLLAPSED_KEY = "bc_upload_tray_collapsed";

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

export function UploadTray() {
  const items = useUploads();
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => setCollapsed(readCollapsed()), []);

  function toggle(): void {
    setCollapsed((was) => {
      const next = !was;
      try {
        localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0");
      } catch {
        // A browser that refuses storage still gets a working tray.
      }
      return next;
    });
  }

  if (items.length === 0) return null;

  const busy = items.filter(
    (item) => item.status === "uploading" || item.status === "queued" || item.status === "retrying",
  );
  const waiting = items.filter(
    (item) =>
      item.status === "paused" || item.status === "offline" || item.status === "needs-signin",
  );
  const stuck = items.filter((item) => item.status === "needs-file" || item.status === "error");

  const sent = items.reduce((total, item) => total + item.loaded, 0);
  const total = items.reduce((sum, item) => sum + item.sizeBytes, 0);
  const percent = total > 0 ? Math.floor((sent / total) * 100) : 0;

  const headline =
    busy.length > 0
      ? `${pluralize(busy.length, "file")} uploading — ${percent}%`
      : stuck.length > 0
        ? `${pluralize(stuck.length, "upload")} needs you`
        : waiting.length > 0
          ? `${pluralize(waiting.length, "upload")} paused`
          : "Uploads finished";

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 w-[min(26rem,calc(100vw-2rem))]">
      <motion.div
        layout
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="pointer-events-auto overflow-hidden rounded-2xl border border-hairline bg-surface/95 shadow-[0_24px_60px_-24px_rgba(15,30,58,0.55)] backdrop-blur"
      >
        <button
          type="button"
          onClick={toggle}
          aria-expanded={!collapsed}
          className="flex w-full items-center gap-3 px-4 py-3 text-left"
        >
          <span
            className={cn(
              "grid size-8 shrink-0 place-items-center rounded-lg",
              stuck.length > 0
                ? "bg-red-500/15 text-red-400"
                : waiting.length > 0 && busy.length === 0
                  ? "bg-amber-500/15 text-amber-600"
                  : "bg-lilac-tint text-plum",
            )}
          >
            <UploadCloud className="size-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-ink">{headline}</span>
            <span className="block text-[0.7rem] text-ink-soft">
              {busy.length > 0
                ? "Keeps going while you work on other pages."
                : "Resumes from where each one stopped."}
            </span>
          </span>
          {collapsed ? (
            <ChevronUp className="size-4 shrink-0 text-ink-soft" />
          ) : (
            <ChevronDown className="size-4 shrink-0 text-ink-soft" />
          )}
        </button>

        <AnimatePresence initial={false}>
          {!collapsed && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden border-t border-hairline/60"
            >
              <ul className="max-h-[min(24rem,50vh)] space-y-2 overflow-y-auto p-3">
                <AnimatePresence initial={false}>
                  {items.map((item) => (
                    <UploadRow key={item.id} item={item} />
                  ))}
                </AnimatePresence>
              </ul>

              {waiting.length > 1 && (
                <div className="flex justify-end border-t border-hairline/60 px-3 py-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => waiting.forEach((item) => uploadManager.resume(item.id))}
                  >
                    Resume all
                  </Button>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
