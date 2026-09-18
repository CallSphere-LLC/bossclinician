import { useState } from "react";
import { toast } from "sonner";
import { Download, Eye, EyeOff, Loader2, Paperclip } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatBytes } from "@/lib/format";
import { MemberApiError } from "@/lib/memberApi";
import { downloadFile, fetchFileBlob, type DownloadKind } from "@/lib/libraryApi";
import { FileViewer, MAX_VIEW_BYTES, viewerKindFor, type ViewerKind } from "./FileViewer";

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
  /** Rows only, without the card and heading — for a page that has its own. */
  bare?: boolean;
}

interface OpenFile {
  id: number;
  viewer: ViewerKind;
  blob: Blob;
}

const ACTION =
  "inline-flex min-h-[2.75rem] shrink-0 items-center gap-2 rounded-lg border border-white/10 px-3 " +
  "text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-orchid transition-colors duration-300 " +
  // Gold, not white, on hover: the light theme remaps `text-white` but not its
  // `hover:` form, and a white label on a white page is an empty box.
  "hover:border-gold/40 hover:bg-white/[0.05] hover:text-gold " +
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold " +
  "disabled:cursor-wait disabled:opacity-60";

/**
 * Files that come with a lesson.
 *
 * Every action is a button, not a link. The bytes live behind a signed token
 * minted per click for one member and valid for minutes, so there is no href to
 * put on an anchor — and that is the point: a URL a member could copy out of the
 * page is a URL that ends up in a Facebook group.
 *
 * View reads the file here on the page (see FileViewer); Download saves it.
 */
export function Attachments({
  files,
  kind,
  heading = "Downloads",
  className,
  bare = false,
}: AttachmentsProps) {
  const [pending, setPending] = useState<{ id: number; action: "view" | "download" } | null>(null);
  const [open, setOpen] = useState<OpenFile | null>(null);
  const [status, setStatus] = useState("");

  if (files.length === 0) return null;

  const fail = (err: unknown, fallback: string) => {
    // The server refuses an attachment on a lesson that has not dripped yet,
    // and says when it opens. That sentence is more use than "download failed".
    const message = err instanceof MemberApiError ? err.message : fallback;
    setStatus(message);
    toast.error(message);
  };

  const start = async (file: AttachmentItem) => {
    setPending({ id: file.id, action: "download" });
    setStatus(`Preparing ${file.title}…`);
    try {
      await downloadFile(kind, file.id);
      setStatus(`${file.title} is downloading.`);
    } catch (err) {
      fail(err, "We could not start that download. Please try again.");
    } finally {
      setPending(null);
    }
  };

  const view = async (file: AttachmentItem, viewer: ViewerKind) => {
    if (open?.id === file.id) {
      setOpen(null);
      setStatus(`${file.title} closed.`);
      return;
    }
    setPending({ id: file.id, action: "view" });
    setStatus(`Opening ${file.title}…`);
    try {
      const blob = await fetchFileBlob(kind, file.id);
      setOpen({ id: file.id, viewer, blob });
      setStatus(`${file.title} is open below.`);
    } catch (err) {
      fail(err, "We could not open that file here. Please try again, or download it.");
    } finally {
      setPending(null);
    }
  };

  const Frame = bare ? "div" : "section";

  return (
    <Frame
      className={cn(!bare && "rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5", className)}
    >
      {!bare && (
        <h2 className="flex items-center gap-2.5 font-display text-base text-white">
          <Paperclip aria-hidden className="size-4 text-gold" />
          {heading}
        </h2>
      )}

      <ul className={cn("flex flex-col gap-2", !bare && "mt-3.5")}>
        {files.map((file) => {
          const busy = pending?.id === file.id ? pending.action : null;
          const size = file.sizeBytes > 0 ? formatBytes(file.sizeBytes) : "";
          const viewer = viewerKindFor(file);
          const tooBig = file.sizeBytes > MAX_VIEW_BYTES;
          const canView = viewer !== "none" && !tooBig;
          const isOpen = open?.id === file.id;

          return (
            <li key={file.id}>
              <div
                className={cn(
                  "flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-white/10",
                  "bg-white/[0.02] px-3.5 py-3",
                  isOpen && "border-gold/40",
                )}
              >
                <span className="min-w-0 flex-1 basis-48">
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

                <span className="flex items-center gap-2">
                  {canView && (
                    <button
                      type="button"
                      onClick={() => void view(file, viewer)}
                      disabled={busy !== null}
                      aria-expanded={isOpen}
                      className={ACTION}
                    >
                      {busy === "view" ? (
                        <Loader2 aria-hidden className="size-4 animate-spin text-gold" />
                      ) : isOpen ? (
                        <EyeOff aria-hidden className="size-4" />
                      ) : (
                        <Eye aria-hidden className="size-4" />
                      )}
                      {isOpen ? "Close" : "View"}
                      <span className="sr-only"> {file.title}</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void start(file)}
                    disabled={busy !== null}
                    className={ACTION}
                  >
                    {busy === "download" ? (
                      <Loader2 aria-hidden className="size-4 animate-spin text-gold" />
                    ) : (
                      <Download aria-hidden className="size-4" />
                    )}
                    Download
                    <span className="sr-only"> {file.title}</span>
                  </button>
                </span>
              </div>

              {!canView && (
                <p className="mt-1 px-1 text-[0.7rem] text-orchid-faint">
                  {tooBig
                    ? "Too large to open on the page. Download it to watch or read it."
                    : "This kind of file cannot be shown on the page. Download it to open it."}
                </p>
              )}

              {isOpen && open && (
                <FileViewer kind={open.viewer} blob={open.blob} filename={file.filename} title={file.title} />
              )}
            </li>
          );
        })}
      </ul>

      <p aria-live="polite" className="sr-only">
        {status}
      </p>
    </Frame>
  );
}
