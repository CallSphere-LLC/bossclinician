import { useRef } from "react";
import { motion } from "motion/react";
import {
  CloudOff,
  FileText,
  Film,
  FolderSearch,
  Image as ImageIcon,
  Music,
  Pause,
  Play,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { uploadManager, type UploadItem } from "@/lib/uploads/manager";
import { cn } from "@/lib/cn";
import { formatBytes } from "@/lib/format";
import { Button } from "@/pages/admin/ui/primitives";

/**
 * One file, mid-flight or stuck.
 *
 * Shared by the dropzone and by the tray that follows her around the admin, so
 * the same upload reads identically wherever she happens to be looking at it.
 */

export function iconForKind(kind: string) {
  if (kind === "image") return ImageIcon;
  if (kind === "video") return Film;
  if (kind === "audio") return Music;
  return FileText;
}

function kindForName(name: string): string {
  const ext = name.slice(name.lastIndexOf(".")).toLowerCase();
  if (/\.(png|jpe?g|webp|gif|avif)$/.test(ext)) return "image";
  if (/\.(mp4|m4v|webm|mov)$/.test(ext)) return "video";
  if (/\.(mp3|m4a|wav|ogg)$/.test(ext)) return "audio";
  return "document";
}

/** The right-hand line: what is happening, in the fewest honest words. */
function statusLine(item: UploadItem): string {
  const percent = item.sizeBytes > 0 ? Math.floor((item.loaded / item.sizeBytes) * 100) : 100;
  switch (item.status) {
    case "queued":
      return "Waiting its turn";
    case "uploading":
      return `${percent}% — ${formatBytes(item.loaded)} of ${formatBytes(item.sizeBytes)}`;
    case "retrying":
      return `${percent}% — trying again`;
    case "offline":
      return `${percent}% — waiting for internet`;
    case "paused":
      return `${percent}% — paused`;
    case "needs-file":
      return `${percent}% — needs the file`;
    case "needs-signin":
      return `${percent}% — signed out`;
    case "error":
      return "Didn't upload";
    case "cancelled":
      return "Stopped";
    case "done":
      return "Added to your files";
  }
}

const TROUBLE: UploadItem["status"][] = ["error", "needs-file", "needs-signin"];

export function UploadRow({ item }: { item: UploadItem }) {
  const filePicker = useRef<HTMLInputElement>(null);
  const Icon = item.status === "offline" ? CloudOff : iconForKind(kindForName(item.fileName));
  const percent = item.sizeBytes > 0 ? Math.min(100, (item.loaded / item.sizeBytes) * 100) : 100;
  const busy = item.status === "uploading" || item.status === "queued";
  const stopped =
    item.status === "paused" || item.status === "offline" || item.status === "retrying";
  const trouble = TROUBLE.includes(item.status);

  return (
    <motion.li
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
            : trouble || stopped
              ? "bg-amber-500/15 text-amber-600"
              : "bg-lilac-tint text-plum",
        )}
      >
        <Icon className="size-4" />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <p className="truncate text-sm font-medium text-ink">{item.fileName}</p>
          <span className="shrink-0 text-xs tabular-nums text-ink-soft">{statusLine(item)}</span>
        </div>

        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-lilac-tint">
          <motion.div
            className={cn(
              "h-full rounded-full",
              item.status === "error"
                ? "bg-red-500"
                : trouble || stopped
                  ? "bg-amber-500"
                  : "bg-gold-foil",
            )}
            initial={{ width: 0 }}
            animate={{ width: `${item.status === "error" ? 100 : percent}%` }}
            transition={{ ease: "easeOut", duration: 0.15 }}
          />
        </div>

        {item.message && (
          <p
            className={cn(
              "mt-1 text-xs",
              item.status === "error" ? "text-red-300" : "text-ink-soft",
            )}
          >
            {item.message}
          </p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {busy && (
          <Button
            variant="ghost"
            size="iconSm"
            aria-label={`Pause ${item.fileName}`}
            onClick={() => uploadManager.pause(item.id)}
          >
            <Pause />
          </Button>
        )}

        {stopped && (
          <Button
            variant="ghost"
            size="iconSm"
            aria-label={`Resume ${item.fileName}`}
            onClick={() => uploadManager.resume(item.id)}
          >
            <Play />
          </Button>
        )}

        {item.status === "needs-file" && (
          <>
            <Button
              variant="secondary"
              size="sm"
              className="h-8 px-2 text-[0.7rem]"
              onClick={() => filePicker.current?.click()}
            >
              <FolderSearch />
              Find the file
            </Button>
            <input
              ref={filePicker}
              type="file"
              className="sr-only"
              onChange={(event) => {
                const chosen = event.target.files?.[0];
                event.target.value = "";
                if (!chosen) return;
                const result = uploadManager.attachFile(item.id, chosen);
                if (!result.ok) toast.error(result.reason);
              }}
            />
          </>
        )}

        {item.status === "needs-signin" && (
          <Button
            variant="secondary"
            size="sm"
            className="h-8 px-2 text-[0.7rem]"
            onClick={() => uploadManager.resume(item.id)}
          >
            Try again
          </Button>
        )}

        <Button
          variant="ghost"
          size="iconSm"
          aria-label={
            busy || stopped ? `Stop uploading ${item.fileName}` : `Hide ${item.fileName}`
          }
          onClick={() =>
            busy || stopped || item.status === "needs-file" || item.status === "needs-signin"
              ? uploadManager.cancel(item.id)
              : uploadManager.dismiss(item.id)
          }
        >
          <X />
        </Button>
      </div>
    </motion.li>
  );
}
