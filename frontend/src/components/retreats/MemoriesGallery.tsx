import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Flag, Loader2, RotateCcw, Trash2, Upload } from "lucide-react";
import { memberRetreatsApi, uploadMemory, type MemoriesView, type MemoryItem } from "@/lib/retreatsApi";
import { cn } from "@/lib/cn";
import { BUTTON_OUTLINE, BUTTON_PRIMARY, INPUT, PreviewNote, SaveStatus } from "./retreatUi";

/**
 * Retreat Memories — the private, per-retreat photo and video gallery.
 *
 * Every file URL is a short-lived signed link minted by the server after it
 * re-checked that this guest belongs to this retreat. Uploading never grants
 * marketing use: the consent box below is about sharing inside the group only.
 */

const ACCEPT = "image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime,video/webm";

interface QueuedUpload {
  key: string;
  file: File;
  progress: number;
  state: "uploading" | "done" | "failed";
  error: string;
}

export function sizeProblem(file: File, view: Pick<MemoriesView, "maxPhotoMb" | "maxVideoMb">): string | null {
  const isVideo = file.type.startsWith("video/");
  const isImage = file.type.startsWith("image/");
  if (!isVideo && !isImage) return `${file.name}: choose a photo (JPEG, PNG, WebP or GIF) or a video (MP4, MOV or WebM).`;
  const limit = (isVideo ? view.maxVideoMb : view.maxPhotoMb) * 1024 * 1024;
  if (file.size > limit) {
    return `${file.name} is larger than ${isVideo ? view.maxVideoMb : view.maxPhotoMb} MB. Please choose a smaller ${isVideo ? "video" : "photo"}.`;
  }
  return null;
}

export function MemoriesGallery({
  slug,
  readOnly,
  loadMemories,
}: {
  slug: string;
  readOnly: boolean;
  loadMemories: () => Promise<MemoriesView>;
}) {
  const id = useId();
  const [view, setView] = useState<MemoriesView | null>(null);
  const [loadError, setLoadError] = useState("");
  const [caption, setCaption] = useState("");
  const [consent, setConsent] = useState(false);
  const [queue, setQueue] = useState<QueuedUpload[]>([]);
  const [notice, setNotice] = useState<{ text: string; tone: "neutral" | "error" | "success" }>({ text: "", tone: "neutral" });
  const inputRef = useRef<HTMLInputElement>(null);
  const loader = useRef(loadMemories);
  loader.current = loadMemories;

  const refresh = useCallback(async () => {
    try {
      setView(await loader.current());
      setLoadError("");
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "We couldn't open the gallery.");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function runUpload(item: QueuedUpload) {
    setQueue((prev) => prev.map((q) => (q.key === item.key ? { ...q, state: "uploading", progress: 0, error: "" } : q)));
    try {
      await uploadMemory(slug, { file: item.file, caption: caption.trim(), sharingConsent: consent }, (fraction) =>
        setQueue((prev) => prev.map((q) => (q.key === item.key ? { ...q, progress: fraction } : q))),
      );
      setQueue((prev) => prev.map((q) => (q.key === item.key ? { ...q, state: "done", progress: 1 } : q)));
      await refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : "That upload didn't go through.";
      setQueue((prev) => prev.map((q) => (q.key === item.key ? { ...q, state: "failed", error: message } : q)));
    }
  }

  function onChoose(files: FileList | null) {
    if (!files || !view || readOnly) return;
    if (!consent) {
      setNotice({ text: "Please tick the sharing box before uploading.", tone: "error" });
      return;
    }
    const accepted: QueuedUpload[] = [];
    const problems: string[] = [];
    Array.from(files).forEach((file, index) => {
      const problem = sizeProblem(file, view);
      if (problem) problems.push(problem);
      else accepted.push({ key: `${Date.now()}-${index}-${file.name}`, file, progress: 0, state: "uploading", error: "" });
    });
    setNotice(problems.length ? { text: problems.join(" "), tone: "error" } : { text: "", tone: "neutral" });
    setQueue((prev) => [...prev.filter((q) => q.state !== "done"), ...accepted]);
    // One at a time keeps a phone on a weak connection from starving every upload.
    void (async () => {
      for (const item of accepted) await runUpload(item);
    })();
    if (inputRef.current) inputRef.current.value = "";
  }

  async function remove(item: MemoryItem) {
    if (readOnly || !window.confirm("Remove this from the retreat gallery?")) return;
    try {
      await memberRetreatsApi.deleteMemory(slug, item.id);
      setNotice({ text: "Removed.", tone: "success" });
      await refresh();
    } catch (error) {
      setNotice({ text: error instanceof Error ? error.message : "We couldn't remove that.", tone: "error" });
    }
  }

  async function report(item: MemoryItem) {
    if (readOnly) return;
    const reason = window.prompt("Tell us what's wrong (for example, you're in it and would like it removed).");
    if (reason === null) return;
    try {
      await memberRetreatsApi.reportMemory(slug, item.id, reason.trim().slice(0, 1000));
      setNotice({ text: "Thank you. Our team will review it privately.", tone: "success" });
    } catch (error) {
      setNotice({ text: error instanceof Error ? error.message : "We couldn't send that report.", tone: "error" });
    }
  }

  if (loadError) return <p role="alert" className="text-sm text-amber-200">{loadError}</p>;
  if (!view) {
    return (
      <p className="flex items-center gap-2 text-sm text-orchid-dim">
        <Loader2 aria-hidden className="size-4 animate-spin" /> Opening the gallery…
      </p>
    );
  }

  const canUpload = view.uploadsOpen && !readOnly;

  return (
    <div className="flex flex-col gap-6">
      <p>
        A private space for our retreat group's photos and videos. Please be mindful of other guests' privacy before
        sharing images of them anywhere else.
      </p>

      {view.items.length === 0 ? (
        <p className="rounded-2xl border border-white/10 p-5 text-orchid-dim">No photos or videos have been shared yet.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {view.items.map((item) => (
            <li key={item.id} className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-white/10 bg-night-raised">
              {item.kind === "video" ? (
                <video src={item.url} controls preload="metadata" playsInline className="aspect-square w-full bg-black object-cover" />
              ) : (
                <img src={item.url} alt={item.caption || `Retreat photo shared by ${item.uploadedBy}`} loading="lazy" className="aspect-square w-full object-cover" />
              )}
              <div className="flex flex-1 flex-col gap-2 p-3 text-xs">
                {item.caption && <p className="break-words text-white/85">{item.caption}</p>}
                <p className="text-orchid-dim">{item.mine ? "Shared by you" : item.uploadedBy}</p>
                {item.mine && item.status === "pending" && <p className="font-semibold text-lilac">Waiting for review</p>}
                {item.mine && item.status === "hidden" && <p className="font-semibold text-amber-200">Hidden by the organizer</p>}
                <div className="mt-auto flex flex-wrap gap-2">
                  {item.mine ? (
                    <button type="button" disabled={readOnly} onClick={() => void remove(item)} className="inline-flex min-h-[2.75rem] items-center gap-1.5 text-orchid hover:text-white disabled:opacity-45">
                      <Trash2 aria-hidden className="size-3.5" /> Remove
                    </button>
                  ) : (
                    <button type="button" disabled={readOnly} onClick={() => void report(item)} className="inline-flex min-h-[2.75rem] items-center gap-1.5 text-orchid hover:text-white disabled:opacity-45">
                      <Flag aria-hidden className="size-3.5" /> Report
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {view.uploadsOpen || readOnly ? (
        <div className="flex flex-col gap-4 rounded-2xl border border-gold/20 bg-white/[0.03] p-5">
          <h3 className="text-sm font-semibold text-white">Add your photos and videos</h3>
          <p className="text-xs text-orchid-dim">
            Photos up to <span className="font-bold tabular-nums">{view.maxPhotoMb}</span> MB, videos up to{" "}
            <span className="font-bold tabular-nums">{view.maxVideoMb}</span> MB.
            {view.requireReview ? " Uploads appear for everyone after a quick review by our team." : ""}
          </p>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-caption`} className="text-sm font-semibold text-white/90">
              Caption <span className="font-normal text-orchid-dim">(optional)</span>
            </label>
            <input id={`${id}-caption`} type="text" maxLength={300} value={caption} disabled={!canUpload} onChange={(e) => setCaption(e.target.value)} className={INPUT} />
          </div>
          <label className="flex items-start gap-3 text-sm text-white/90">
            <input type="checkbox" className="mt-1 accent-[#C9A24B]" checked={consent} disabled={!canUpload} onChange={(e) => setConsent(e.target.checked)} />
            <span>
              I have permission to share these, and I'll respect the privacy of anyone shown in them. I understand this
              gallery is private to our retreat group and is not a marketing album.<span className="text-gold"> *</span>
            </span>
          </label>
          <div>
            <input
              ref={inputRef}
              id={`${id}-files`}
              type="file"
              multiple
              accept={ACCEPT}
              className="sr-only"
              disabled={!canUpload || !consent}
              onChange={(e) => onChoose(e.target.files)}
            />
            <label
              htmlFor={`${id}-files`}
              aria-disabled={!canUpload || !consent}
              className={cn(BUTTON_PRIMARY, (!canUpload || !consent) && "pointer-events-none opacity-45", "cursor-pointer")}
            >
              <Upload aria-hidden className="size-4" /> Choose photos or videos
            </label>
          </div>
          {queue.length > 0 && (
            <ul className="flex flex-col gap-2" aria-live="polite">
              {queue.map((item) => (
                <li key={item.key} className="flex flex-wrap items-center gap-3 text-xs">
                  <span className="min-w-0 flex-1 truncate text-white/85">{item.file.name}</span>
                  {item.state === "uploading" && (
                    <span className="flex items-center gap-2">
                      <progress max={1} value={item.progress} className="h-1.5 w-28 accent-[#C9A24B]" aria-label={`Uploading ${item.file.name}`} />
                      <span className="font-bold tabular-nums">{Math.round(item.progress * 100)}%</span>
                    </span>
                  )}
                  {item.state === "done" && <span className="text-emerald-200">Uploaded</span>}
                  {item.state === "failed" && (
                    <span className="flex flex-wrap items-center gap-2 text-amber-200">
                      {item.error}
                      <button type="button" className={BUTTON_OUTLINE} onClick={() => void runUpload(item)}>
                        <RotateCcw aria-hidden className="size-3.5" /> Retry
                      </button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {readOnly && <PreviewNote />}
        </div>
      ) : (
        <p className="text-orchid-dim">Uploads aren't open right now.</p>
      )}
      <SaveStatus text={notice.text} tone={notice.tone} />
    </div>
  );
}
