import { useCallback, useRef, useState, type DragEvent } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CloudUpload, FileText, Film, Music, Image as ImageIcon, X } from "lucide-react";
import { toast } from "sonner";
import { uploadMediaWithProgress } from "@/lib/api";
import type { MediaAsset, MediaVisibility } from "@/types/admin";
import { cn } from "@/lib/cn";
import { formatBytes } from "@/lib/format";
import { friendlyError } from "@/pages/admin/ui/friendly";
import { Button } from "@/pages/admin/ui/primitives";

interface QueueItem {
  id: string;
  file: File;
  progress: number;
  // "cancelled" is separate from "error" so a file she stopped on purpose
  // doesn't come back reading like something broke.
  status: "uploading" | "done" | "error" | "cancelled";
  error?: string;
  controller: AbortController;
}

export function iconForKind(kind: string) {
  if (kind === "image") return ImageIcon;
  if (kind === "video") return Film;
  if (kind === "audio") return Music;
  return FileText;
}

function kindForFile(file: File): string {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";
  return "document";
}

/**
 * Drag-and-drop uploader with a per-file progress queue.
 *
 * Uploads run concurrently and report independently: one 400MB video failing
 * must not discard the four images that already succeeded, so each queue entry
 * owns its own AbortController and error state.
 */
/**
 * The one refusal the server words for itself, said her way.
 *
 * It answers "Unsupported file type: image/heic" — true, and half of it is a
 * machine name she has never seen. What she needs is which files do work.
 */
function uploadProblem(err: unknown): string | null {
  const said = err instanceof Error ? err.message : "";
  return /unsupported file type/i.test(said)
    ? "That kind of file can't be used here. Pictures work best as JPG or PNG, and videos as MP4."
    : null;
}

export function UploadDropzone({
  onUploaded,
  accept,
  compact = false,
  visibility = "public",
}: {
  onUploaded: (asset: MediaAsset) => void;
  accept?: string;
  compact?: boolean;
  /**
   * Where the file is stored, and therefore who can open it.
   *
   * Defaults to "public" because most uploads in this admin are website
   * imagery — a blog cover, a headshot, a course thumbnail — and those have to
   * be reachable by a browser with no session. Every screen that uploads
   * something a customer paid for passes "protected" explicitly: course video,
   * lesson attachments, download-product files, coaching recordings.
   */
  visibility?: MediaVisibility;
}) {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // Monotonic counter for stable queue keys — filenames can repeat.
  const seqRef = useRef(0);

  const startUpload = useCallback(
    (files: FileList | File[]) => {
      const list = Array.from(files);
      if (list.length === 0) return;

      for (const file of list) {
        const id = `${Date.now()}-${seqRef.current++}`;
        const controller = new AbortController();
        setQueue((prev) => [...prev, { id, file, progress: 0, status: "uploading", controller }]);

        uploadMediaWithProgress(
          file,
          visibility,
          (percent) =>
            setQueue((prev) =>
              prev.map((item) => (item.id === id ? { ...item, progress: percent } : item)),
            ),
          controller.signal,
        )
          .then((asset) => {
            setQueue((prev) =>
              prev.map((item) =>
                item.id === id ? { ...item, status: "done", progress: 100 } : item,
              ),
            );
            onUploaded(asset);
            toast.success(`${asset.originalName} is in your files`);
            // Clear finished rows so the queue doesn't grow without bound.
            window.setTimeout(
              () => setQueue((prev) => prev.filter((item) => item.id !== id)),
              1800,
            );
          })
          .catch((err: unknown) => {
            // She pressed the stop button — that is not a failure, and it must
            // not shout at her in red.
            const stopped = controller.signal.aborted;
            const message = stopped
              ? "You stopped this one."
              : uploadProblem(err) ?? friendlyError(err, "file");
            setQueue((prev) =>
              prev.map((item) =>
                item.id === id
                  ? { ...item, status: stopped ? "cancelled" : "error", error: message }
                  : item,
              ),
            );
            if (!stopped) toast.error(`${file.name} didn't upload. ${message}`);
          });
      }
    },
    [onUploaded, visibility],
  );

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files?.length) startUpload(e.dataTransfer.files);
  }

  return (
    <div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        className={cn(
          "relative rounded-2xl border-2 border-dashed transition-all duration-200",
          compact ? "p-5" : "p-9",
          dragging
            ? "border-plum bg-lilac-tint/60 shadow-[0_0_0_6px_rgba(92,69,125,0.08)]"
            : "border-hairline bg-cream/40 hover:border-plum/50 hover:bg-lilac-tint/25",
        )}
      >
        <div className="flex flex-col items-center text-center">
          <motion.span
            animate={dragging ? { y: -4, scale: 1.06 } : { y: 0, scale: 1 }}
            transition={{ type: "spring", stiffness: 300, damping: 20 }}
            className="grid size-12 place-items-center rounded-2xl bg-brand-gradient text-white shadow-[0_10px_24px_-10px_rgba(92,69,125,0.8)]"
          >
            <CloudUpload className="size-6" />
          </motion.span>

          <p className={cn("font-display text-ink", compact ? "mt-3 text-base" : "mt-4 text-lg")}>
            {dragging ? "Let go to add them" : "Drag your files here"}
          </p>
          <p className="mt-1 text-xs text-ink-soft">
            Videos, images, audio, PDFs and documents — up to 512MB each
          </p>

          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="mt-4"
            onClick={() => inputRef.current?.click()}
          >
            Choose from my computer
          </Button>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={accept}
            className="sr-only"
            onChange={(e) => {
              if (e.target.files) startUpload(e.target.files);
              // Reset so selecting the same file twice re-triggers change.
              e.target.value = "";
            }}
          />
        </div>
      </div>

      <AnimatePresence initial={false}>
        {queue.length > 0 && (
          <motion.ul
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-4 space-y-2 overflow-hidden"
          >
            {queue.map((item) => {
              const Icon = iconForKind(kindForFile(item.file));
              return (
                <motion.li
                  key={item.id}
                  layout
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: 12 }}
                  className="flex items-center gap-3 rounded-xl border border-hairline bg-white/[0.04] px-3.5 py-3"
                >
                  <span
                    className={cn(
                      "grid size-9 shrink-0 place-items-center rounded-lg",
                      item.status === "error"
                        ? "bg-red-500/15 text-red-300"
                        : "bg-lilac-tint text-plum",
                    )}
                  >
                    <Icon className="size-4" />
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="truncate text-sm font-medium text-ink">{item.file.name}</p>
                      <span className="shrink-0 text-xs tabular-nums text-ink-soft">
                        {item.status === "error"
                          ? "Didn't upload"
                          : item.status === "cancelled"
                            ? "Stopped"
                            : item.status === "done"
                              ? formatBytes(item.file.size)
                              : `${item.progress}% uploaded`}
                      </span>
                    </div>

                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-lilac-tint">
                      <motion.div
                        className={cn(
                          "h-full rounded-full",
                          item.status === "error" ? "bg-red-500" : "bg-gold-foil",
                        )}
                        initial={{ width: 0 }}
                        animate={{ width: `${item.status === "error" ? 100 : item.progress}%` }}
                        transition={{ ease: "easeOut", duration: 0.25 }}
                      />
                    </div>
                    {item.error && (
                      <p
                        className={cn(
                          "mt-1 text-xs",
                          item.status === "cancelled" ? "text-ink-soft" : "text-red-300",
                        )}
                      >
                        {item.error}
                      </p>
                    )}
                  </div>

                  {item.status === "uploading" ? (
                    <Button
                      variant="ghost"
                      size="iconSm"
                      aria-label={`Stop uploading ${item.file.name}`}
                      onClick={() => item.controller.abort()}
                    >
                      <X />
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      size="iconSm"
                      aria-label={`Hide ${item.file.name} from this list`}
                      onClick={() => setQueue((prev) => prev.filter((q) => q.id !== item.id))}
                    >
                      <X />
                    </Button>
                  )}
                </motion.li>
              );
            })}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}
