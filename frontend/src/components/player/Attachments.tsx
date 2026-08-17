import { useState } from "react";
import { toast } from "sonner";
import { Download, Loader2, Paperclip } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatBytes } from "@/lib/format";
import { MemberApiError } from "@/lib/memberApi";
import { downloadFile, type DownloadKind } from "@/lib/libraryApi";

export interface AttachmentItem {
  id: number;
  title: string;
  filename: string;
  mime: string;
  sizeBytes: number;
  description?: string;
}

interface AttachmentsProps {
  files: AttachmentItem[];
  /** `lesson` for a workbook beside a video, `product` for a download product. */
  kind: DownloadKind;
  heading?: string;
  className?: string;
}

/**
 * Files that come with a lesson.
 *
 * Every row is a button, not a link. The bytes live behind a signed token minted
 * per click for one member and valid for minutes, so there is no href to put on
 * an anchor — and that is the point: a URL a member could copy out of the page is
 * a URL that ends up in a Facebook group.
 */
export function Attachments({ files, kind, heading = "Downloads", className }: AttachmentsProps) {
  const [pending, setPending] = useState<number | null>(null);
  const [status, setStatus] = useState("");

  if (files.length === 0) return null;

  const start = async (file: AttachmentItem) => {
    setPending(file.id);
    setStatus(`Preparing ${file.title}…`);
    try {
      await downloadFile(kind, file.id);
      setStatus(`${file.title} is downloading.`);
    } catch (err) {
      // The server refuses an attachment on a lesson that has not dripped yet,
      // and says when it opens. That sentence is more use than "download failed".
      const message =
        err instanceof MemberApiError
          ? err.message
          : "We could not start that download. Please try again.";
      setStatus(message);
      toast.error(message);
    } finally {
      setPending(null);
    }
  };

  return (
    <section className={cn("rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5", className)}>
      <h2 className="flex items-center gap-2.5 font-display text-base text-white">
        <Paperclip aria-hidden className="size-4 text-gold" />
        {heading}
      </h2>

      <ul className="mt-3.5 flex flex-col gap-2">
        {files.map((file) => {
          const busy = pending === file.id;
          const size = file.sizeBytes > 0 ? formatBytes(file.sizeBytes) : "";

          return (
            <li key={file.id}>
              <button
                type="button"
                onClick={() => void start(file)}
                disabled={busy}
                className={cn(
                  "flex min-h-[2.75rem] w-full items-center gap-3 rounded-xl border border-white/10",
                  "bg-white/[0.02] px-3.5 py-3 text-left transition-colors duration-300",
                  "hover:border-gold/40 hover:bg-white/[0.05]",
                  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold",
                  "disabled:cursor-wait disabled:opacity-60",
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-white">{file.title}</span>
                  {file.description && (
                    <span className="mt-0.5 block text-xs leading-relaxed text-orchid-dim">
                      {file.description}
                    </span>
                  )}
                  <span className="mt-0.5 block truncate text-[0.7rem] uppercase tracking-[0.12em] text-orchid-faint">
                    {file.filename}
                    {size && ` · ${size}`}
                  </span>
                </span>

                {busy ? (
                  <Loader2 aria-hidden className="size-4 shrink-0 animate-spin text-gold" />
                ) : (
                  <Download aria-hidden className="size-4 shrink-0 text-orchid-dim" />
                )}
                <span className="sr-only">Download {file.title}</span>
              </button>
            </li>
          );
        })}
      </ul>

      <p aria-live="polite" className="sr-only">
        {status}
      </p>
    </section>
  );
}
