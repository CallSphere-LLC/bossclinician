import { useCallback, useRef, useState, type DragEvent } from "react";
import { useLocation } from "react-router-dom";
import { motion } from "motion/react";
import { CloudUpload } from "lucide-react";
import { toast } from "sonner";
import { uploadManager } from "@/lib/uploads/manager";
import { useUploadCompletions, useUploads } from "@/hooks/useUploads";
import type { MediaAsset, MediaVisibility } from "@/types/admin";
import { cn } from "@/lib/cn";
import { pluralize } from "@/pages/admin/ui/friendly";
import { Button } from "@/pages/admin/ui/primitives";

export { iconForKind } from "@/pages/admin/ui/UploadRow";

/**
 * Drag-and-drop uploader.
 *
 * It no longer owns the upload. Handing the files to the manager
 * (lib/uploads/manager.ts) is the whole of its job, because an upload that
 * lived in this component's state died the moment she clicked through to
 * another screen — and the files this admin exists to handle are 400MB course
 * videos that take longer than any one screen holds her attention.
 *
 * So: files go to the manager, the manager keeps uploading wherever she goes,
 * the tray in the corner (UploadTray) shows every upload on every page, and
 * this component is told when one of *its* files has landed.
 */

/**
 * The one refusal the server words for itself, said her way.
 *
 * It answers "Unsupported file type: image/heic" — true, and half of it is a
 * machine name she has never seen. What she needs is which files do work.
 */
export function uploadProblem(err: unknown): string | null {
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
  scope,
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
  /**
   * Which uploads belong to this box.
   *
   * The finished file has to find its way back to the right place — a lesson's
   * video field, a post's cover, the library grid — and the box that asked for
   * it may well have been unmounted and remounted in between. The route path is
   * a good enough name when a screen has one dropzone; a screen with several
   * must name them apart, or a lesson video will arrive in the thumbnail slot.
   */
  scope?: string;
}) {
  const location = useLocation();
  const zone = scope ?? location.pathname;
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const mine = useUploads(zone);
  const working = mine.filter(
    (item) => item.status !== "done" && item.status !== "cancelled",
  ).length;

  const handleUploaded = useCallback(
    (asset: MediaAsset) => {
      onUploaded(asset);
      toast.success(`${asset.originalName} is in your files`);
    },
    [onUploaded],
  );
  useUploadCompletions(zone, handleUploaded);

  function start(files: FileList | File[]): void {
    const list = Array.from(files);
    if (list.length === 0) return;
    uploadManager.enqueue(list, { visibility, scope: zone });
  }

  function handleDrop(e: DragEvent<HTMLDivElement>): void {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files?.length) start(e.dataTransfer.files);
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
          "relative rounded-2xl border-2 border-dashed transition-all duration-150",
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
              if (e.target.files) start(e.target.files);
              // Reset so selecting the same file twice re-triggers change.
              e.target.value = "";
            }}
          />

          {/* Said once, where the file was handed over, because the progress
              itself has moved to the corner of the screen and a box that shows
              nothing after a drop reads as a box that did nothing. */}
          {working > 0 ? (
            <p className="mt-3 text-xs font-medium text-plum">
              {pluralize(working, "file")} uploading — it carries on while you work, and picks
              up again if the internet drops.
            </p>
          ) : (
            <p className="mt-3 text-[0.7rem] text-ink-soft/80">
              Big videos are safe here: uploads survive a lost connection and can be resumed
              later.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
