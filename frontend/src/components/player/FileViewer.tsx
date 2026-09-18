import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * Reads a lesson file on the page instead of sending it to the Downloads folder.
 *
 * The bytes are fetched once through the same signed, member-bound link a
 * download uses, and everything below renders from that one in-memory copy — so
 * a viewing is one request and one row in the download log, however long the
 * member spends scrolling a PDF. Nothing here puts the signed URL in the DOM.
 *
 * What can be shown natively is (images, video, audio, text); PDF and Word are
 * drawn by libraries loaded only when one is opened. Anything else says so and
 * points at the download button beside it, rather than pretending.
 */

export type ViewerKind = "pdf" | "image" | "video" | "audio" | "text" | "table" | "docx" | "none";

const TEXT_EXTENSIONS = new Set([
  "txt", "md", "markdown", "json", "xml", "yaml", "yml", "log", "rtf", "html", "htm", "css", "js", "ts", "ics", "vtt", "srt",
]);
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "svg"]);
const VIDEO_EXTENSIONS = new Set(["mp4", "webm", "mov", "m4v", "ogv"]);
const AUDIO_EXTENSIONS = new Set(["mp3", "wav", "m4a", "ogg", "oga", "aac", "flac"]);

/** Past this the whole-file fetch is the wrong tool; the download is the honest answer. */
export const MAX_VIEW_BYTES = 150 * 1024 * 1024;
/** A text file longer than this is cut, with a note, so one log cannot freeze the tab. */
const MAX_TEXT_CHARS = 400_000;
const MAX_TABLE_ROWS = 500;
const MAX_PDF_PAGES = 80;

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot === -1 ? "" : filename.slice(dot + 1).toLowerCase();
}

export function viewerKindFor(file: { filename: string; mime: string }): ViewerKind {
  const mime = file.mime.toLowerCase();
  const ext = extensionOf(file.filename);

  if (mime === "application/pdf" || ext === "pdf") return "pdf";
  if (ext === "docx" || mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    return "docx";
  }
  if (ext === "csv" || ext === "tsv" || mime === "text/csv" || mime === "text/tab-separated-values") {
    return "table";
  }
  if (mime.startsWith("image/") || IMAGE_EXTENSIONS.has(ext)) return "image";
  if (mime.startsWith("video/") || VIDEO_EXTENSIONS.has(ext)) return "video";
  if (mime.startsWith("audio/") || AUDIO_EXTENSIONS.has(ext)) return "audio";
  if (mime.startsWith("text/") || mime === "application/json" || TEXT_EXTENSIONS.has(ext)) return "text";
  return "none";
}

/** Splits one CSV/TSV line-set into rows, honouring quoted cells and embedded newlines. */
export function parseDelimited(source: string, delimiter: string, maxRows: number): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === delimiter) {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[i + 1] === "\n") i += 1;
      row.push(cell);
      cell = "";
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
      if (rows.length >= maxRows) return rows;
    } else {
      cell += char;
    }
  }
  row.push(cell);
  if (row.some((value) => value !== "")) rows.push(row);
  return rows;
}

interface FileViewerProps {
  kind: ViewerKind;
  blob: Blob;
  filename: string;
  title: string;
  className?: string;
}

export function FileViewer({ kind, blob, filename, title, className }: FileViewerProps) {
  return (
    <div
      className={cn(
        "mt-2 overflow-hidden rounded-xl border border-white/10 bg-night-deep/60",
        className,
      )}
    >
      {kind === "pdf" && <PdfView blob={blob} title={title} />}
      {kind === "docx" && <DocxView blob={blob} />}
      {kind === "image" && <ObjectUrlView blob={blob} filename={filename} title={title} as="image" />}
      {kind === "video" && <ObjectUrlView blob={blob} filename={filename} title={title} as="video" />}
      {kind === "audio" && <ObjectUrlView blob={blob} filename={filename} title={title} as="audio" />}
      {kind === "text" && <TextView blob={blob} />}
      {kind === "table" && <TableView blob={blob} filename={filename} />}
    </div>
  );
}

function Busy({ label }: { label: string }) {
  return (
    <p className="flex items-center gap-2.5 px-4 py-6 text-sm text-orchid-dim">
      <Loader2 aria-hidden className="size-4 animate-spin text-gold" />
      {label}
    </p>
  );
}

function Problem({ children }: { children: string }) {
  return <p className="px-4 py-6 text-sm text-orchid-dim">{children}</p>;
}

/** Images, video and audio: the browser already knows how, given a URL for the bytes. */
function ObjectUrlView({
  blob,
  filename,
  title,
  as,
}: {
  blob: Blob;
  filename: string;
  title: string;
  as: "image" | "video" | "audio";
}) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    // An SVG keeps its type so it renders as an image; inside <img> its scripts
    // never run, which is the only place it is put.
    const typed =
      as === "image" && extensionOf(filename) === "svg" && blob.type !== "image/svg+xml"
        ? new Blob([blob], { type: "image/svg+xml" })
        : blob;
    const created = URL.createObjectURL(typed);
    setUrl(created);
    return () => URL.revokeObjectURL(created);
  }, [blob, filename, as]);

  if (url === null) return <Busy label="Opening…" />;

  if (as === "image") {
    return <img src={url} alt={title} className="mx-auto block max-h-[80vh] w-auto max-w-full" />;
  }
  if (as === "video") {
    return (
      <video src={url} controls playsInline className="block max-h-[80vh] w-full bg-black">
        <track kind="captions" />
      </video>
    );
  }
  return (
    <div className="px-4 py-5">
      <audio src={url} controls className="w-full">
        <track kind="captions" />
      </audio>
    </div>
  );
}

function TextView({ blob }: { blob: Blob }) {
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void blob.text().then((value) => {
      if (!cancelled) setText(value);
    });
    return () => {
      cancelled = true;
    };
  }, [blob]);

  if (text === null) return <Busy label="Opening…" />;
  const cut = text.length > MAX_TEXT_CHARS;

  return (
    <div className="max-h-[70vh] overflow-auto">
      <pre className="whitespace-pre-wrap break-words px-4 py-4 font-mono text-[0.8rem] leading-relaxed text-orchid">
        {cut ? text.slice(0, MAX_TEXT_CHARS) : text}
      </pre>
      {cut && (
        <p className="border-t border-white/10 px-4 py-3 text-xs text-orchid-faint">
          This is the first part of a long file. Download it to read the rest.
        </p>
      )}
    </div>
  );
}

function TableView({ blob, filename }: { blob: Blob; filename: string }) {
  const [rows, setRows] = useState<string[][] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void blob.text().then((value) => {
      if (cancelled) return;
      const delimiter = extensionOf(filename) === "tsv" ? "\t" : ",";
      setRows(parseDelimited(value, delimiter, MAX_TABLE_ROWS + 1));
    });
    return () => {
      cancelled = true;
    };
  }, [blob, filename]);

  if (rows === null) return <Busy label="Opening…" />;
  if (rows.length === 0) return <Problem>This file is empty.</Problem>;

  const [head, ...body] = rows;
  const cut = body.length >= MAX_TABLE_ROWS;

  return (
    <div className="max-h-[70vh] overflow-auto">
      <table className="w-full border-collapse text-left text-[0.8rem] text-orchid">
        <thead className="sticky top-0 bg-night-raised text-white">
          <tr>
            {head.map((cell, index) => (
              <th key={index} scope="col" className="border-b border-white/10 px-3 py-2 font-semibold">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.slice(0, MAX_TABLE_ROWS).map((row, rowIndex) => (
            <tr key={rowIndex} className="odd:bg-white/[0.02]">
              {row.map((cell, index) => (
                <td key={index} className="border-b border-white/5 px-3 py-2 align-top">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {cut && (
        <p className="border-t border-white/10 px-4 py-3 text-xs text-orchid-faint">
          Showing the first {MAX_TABLE_ROWS} rows. Download the file for all of them.
        </p>
      )}
    </div>
  );
}

/**
 * PDF, drawn page by page onto canvases.
 *
 * Not an <iframe> of the file: this site sends `frame-ancestors 'none'` and
 * `object-src 'none'`, and a framed PDF is also a PDF with a browser toolbar
 * offering to save a copy under a URL. pdf.js is loaded only here.
 */
function PdfView({ blob, title }: { blob: Blob; title: string }) {
  const holder = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const [note, setNote] = useState("");

  useEffect(() => {
    let cancelled = false;
    const target = holder.current;
    if (target === null) return undefined;
    target.replaceChildren();

    const draw = async () => {
      const pdfjs = await import("pdfjs-dist");
      const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;

      const data = new Uint8Array(await blob.arrayBuffer());
      const task = pdfjs.getDocument({ data, isEvalSupported: false });
      const pdf = await task.promise;
      const pages = Math.min(pdf.numPages, MAX_PDF_PAGES);
      const width = Math.max(target.clientWidth, 280);
      const density = Math.min(window.devicePixelRatio || 1, 2);

      for (let number = 1; number <= pages; number += 1) {
        if (cancelled) break;
        const page = await pdf.getPage(number);
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: (width / base.width) * density });

        const canvas = document.createElement("canvas");
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = "100%";
        canvas.style.height = "auto";
        canvas.style.display = "block";
        canvas.setAttribute("role", "img");
        canvas.setAttribute("aria-label", `${title}, page ${number} of ${pdf.numPages}`);
        if (number > 1) canvas.style.marginTop = "8px";

        const context = canvas.getContext("2d");
        if (context === null) throw new Error("no canvas");
        target.appendChild(canvas);
        await page.render({ canvasContext: context, viewport }).promise;
        if (number === 1 && !cancelled) setState("ready");
      }

      if (!cancelled && pdf.numPages > pages) {
        setNote(`Showing the first ${pages} of ${pdf.numPages} pages. Download the file for the rest.`);
      }
      await task.destroy();
    };

    draw().catch(() => {
      if (!cancelled) setState("failed");
    });

    return () => {
      cancelled = true;
    };
  }, [blob, title]);

  return (
    <div>
      {state === "loading" && <Busy label="Opening the PDF…" />}
      {state === "failed" && (
        <Problem>We could not open this PDF here. Download it and it will open as usual.</Problem>
      )}
      <div ref={holder} className={cn("max-h-[80vh] overflow-auto bg-white/[0.04]", state === "failed" && "hidden")} />
      {note && <p className="border-t border-white/10 px-4 py-3 text-xs text-orchid-faint">{note}</p>}
    </div>
  );
}

/** Word documents, rendered to HTML by docx-preview (loaded only here). */
function DocxView({ blob }: { blob: Blob }) {
  const holder = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");

  useEffect(() => {
    let cancelled = false;
    const target = holder.current;
    if (target === null) return undefined;
    target.replaceChildren();

    const draw = async () => {
      const { renderAsync } = await import("docx-preview");
      await renderAsync(blob, target, undefined, {
        inWrapper: true,
        ignoreLastRenderedPageBreak: true,
        // data: URLs for embedded pictures: the page's img-src allows them.
        useBase64URL: true,
      });
      if (!cancelled) setState("ready");
    };

    draw().catch(() => {
      if (!cancelled) setState("failed");
    });

    return () => {
      cancelled = true;
    };
  }, [blob]);

  return (
    <div>
      {state === "loading" && <Busy label="Opening the document…" />}
      {state === "failed" && (
        <Problem>We could not open this document here. Download it and it will open in Word.</Problem>
      )}
      <div
        ref={holder}
        className={cn("max-h-[80vh] overflow-auto bg-white text-black", state !== "ready" && "hidden")}
      />
    </div>
  );
}
