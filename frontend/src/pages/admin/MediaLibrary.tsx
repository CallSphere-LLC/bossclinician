import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { Check, Copy, ExternalLink, FolderOpen, Play, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { adminApi } from "@/lib/api";
import type { MediaAsset, MediaKind } from "@/types/admin";
import { cn } from "@/lib/cn";
import { formatBytes, formatRelative } from "@/lib/format";
import { friendlyError, pluralize } from "@/pages/admin/ui/friendly";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNotice,
  Input,
  PageHeader,
  Skeleton,
} from "@/pages/admin/ui/primitives";
import { UploadDropzone, iconForKind } from "@/pages/admin/ui/Uploader";
import { Modal, useConfirm } from "@/pages/admin/ui/Dialog";

/** `plural` names the group in a sentence: "No images yet — upload your first one." */
const FILTERS: { key: MediaKind | "all"; label: string; plural: string }[] = [
  { key: "all", label: "Everything", plural: "files" },
  { key: "image", label: "Images", plural: "images" },
  { key: "video", label: "Videos", plural: "videos" },
  { key: "audio", label: "Audio", plural: "audio files" },
  { key: "document", label: "Documents", plural: "documents" },
];

/** The stored kind → the word she'd use for it. Never show the raw value. */
const KIND_LABEL: Record<string, string> = {
  image: "Image",
  video: "Video",
  audio: "Audio",
  document: "Document",
  file: "File",
};

function kindLabel(kind: string): string {
  return KIND_LABEL[kind] ?? "File";
}

/** "Copy image link" reads as an instruction; "Copy URL" reads as a chore. */
function copyLabel(kind: string): string {
  if (kind === "image") return "Copy image link";
  if (kind === "video") return "Copy video link";
  if (kind === "audio") return "Copy audio link";
  return "Copy link";
}

export default function MediaLibrary() {
  const [assets, setAssets] = useState<MediaAsset[] | null>(null);
  const [filter, setFilter] = useState<MediaKind | "all">("all");
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<MediaAsset | null>(null);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [confirm, confirmDialog] = useConfirm();

  const load = useCallback(() => {
    adminApi
      .mediaList()
      .then(setAssets)
      .catch(() => setError("We couldn't load your files. Try refreshing the page."));
  }, []);

  useEffect(load, [load]);

  const visible = useMemo(() => {
    if (!assets) return null;
    const term = search.trim().toLowerCase();
    return assets.filter((a) => {
      if (filter !== "all" && a.kind !== filter) return false;
      if (!term) return true;
      return (
        a.title.toLowerCase().includes(term) || a.originalName.toLowerCase().includes(term)
      );
    });
  }, [assets, filter, search]);

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const a of assets ?? []) map.set(a.kind, (map.get(a.kind) ?? 0) + 1);
    return map;
  }, [assets]);

  const totalBytes = useMemo(
    () => (assets ?? []).reduce((sum, a) => sum + Number(a.sizeBytes), 0),
    [assets],
  );

  function handleUploaded(asset: MediaAsset) {
    setAssets((prev) => (prev ? [asset, ...prev] : [asset]));
  }

  async function copyLink(asset: MediaAsset) {
    const absolute = `${window.location.origin}${asset.url}`;
    try {
      await navigator.clipboard.writeText(absolute);
      setCopiedId(asset.id);
      window.setTimeout(() => setCopiedId(null), 1600);
    } catch {
      toast.error("Your browser wouldn't let us copy that. Please try again.");
    }
  }

  async function handleDelete(asset: MediaAsset) {
    const name = asset.title || asset.originalName;
    const ok = await confirm({
      title: "Delete this file?",
      description: `“${name}” will be gone for good. If you've used it in a course, a post or on your website, it will stop showing up there.`,
      confirmLabel: "Yes, delete it",
      destructive: true,
    });
    if (!ok) return;

    // Optimistic: the grid feels instant, and we restore on failure.
    const snapshot = assets;
    setAssets((prev) => prev?.filter((a) => a.id !== asset.id) ?? prev);
    try {
      await adminApi.mediaDelete(asset.id);
      toast.success(`“${name}” was deleted`);
    } catch (err) {
      setAssets(snapshot ?? null);
      toast.error(friendlyError(err, "file"));
    }
  }

  /** What to say when the grid comes back empty — it depends on why it did. */
  const emptyCopy = useMemo(() => {
    const searching = search.trim().length > 0;
    if (!assets || assets.length === 0) {
      return {
        title: "No files yet — upload your first one",
        description:
          "Drag a picture, video, audio file or document into the box above, or choose one from your computer.",
      };
    }
    if (searching) {
      return {
        title: "Nothing matches what you typed",
        description: "Try a different word, or clear the search box to see everything again.",
      };
    }
    const group = FILTERS.find((f) => f.key === filter);
    return {
      title: `No ${group?.plural ?? "files"} yet — upload your first one`,
      description: "Anything you add in the box above will show up here.",
    };
  }, [assets, filter, search]);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Products"
        title="Media Library"
        description="Every picture, video, audio file and document you've uploaded — ready to drop into a course, a post, an episode or your website."
        actions={
          assets && (
            <Badge tone="neutral">
              {pluralize(assets.length, "file")} · {formatBytes(totalBytes)} used
            </Badge>
          )
        }
      />

      {error && <ErrorNotice message={error} />}

      <UploadDropzone onUploaded={handleUploaded} />

      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-hairline/60 px-4 py-3.5">
          <div className="flex flex-wrap gap-1.5">
            {FILTERS.map((f) => {
              const active = filter === f.key;
              const count = f.key === "all" ? (assets?.length ?? 0) : (counts.get(f.key) ?? 0);
              return (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setFilter(f.key)}
                  className={cn(
                    "rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors",
                    active
                      ? "bg-brand-gradient text-white"
                      : "border border-hairline text-ink-soft hover:border-plum/40 hover:text-plum",
                  )}
                >
                  {f.label}
                  <span className={cn("ml-1.5", active ? "text-white/70" : "text-ink-soft/60")}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name…"
            aria-label="Search your files by name"
            className="ml-auto h-9 w-full sm:w-56"
          />
        </div>

        <div className="p-4">
          {visible === null ? (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {Array.from({ length: 10 }, (_, i) => (
                <Skeleton key={i} className="aspect-[4/3] w-full" />
              ))}
            </div>
          ) : visible.length === 0 ? (
            <EmptyState
              icon={<FolderOpen />}
              title={emptyCopy.title}
              description={emptyCopy.description}
            />
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {visible.map((asset, i) => {
                const Icon = iconForKind(asset.kind);
                const name = asset.title || asset.originalName;
                return (
                  <motion.div
                    key={asset.id}
                    layout
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: Math.min(i * 0.02, 0.3) }}
                    className="group overflow-hidden rounded-xl border border-hairline/80 bg-surface transition-all hover:-translate-y-0.5 hover:border-plum/35 hover:shadow-[0_16px_36px_-18px_rgba(15,30,58,0.4)]"
                  >
                    <button
                      type="button"
                      onClick={() => setPreview(asset)}
                      aria-label={`Take a closer look at ${name}`}
                      className="relative block aspect-[4/3] w-full overflow-hidden bg-cream"
                    >
                      {asset.kind === "image" ? (
                        <img
                          src={asset.url}
                          alt={name}
                          loading="lazy"
                          className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
                        />
                      ) : asset.kind === "video" ? (
                        <>
                          {/* Metadata-only preload: never pull whole videos into a grid. */}
                          <video
                            src={asset.url}
                            preload="metadata"
                            muted
                            playsInline
                            className="size-full object-cover"
                          />
                          <span className="absolute inset-0 grid place-items-center bg-ink/35 transition-colors group-hover:bg-ink/45">
                            <span className="grid size-11 place-items-center rounded-full bg-night-deep/85 text-gold ring-1 ring-white/15 shadow-lg">
                              <Play className="size-5 translate-x-0.5 fill-current" />
                            </span>
                          </span>
                        </>
                      ) : (
                        <span className="grid size-full place-items-center text-plum/45">
                          <Icon className="size-9" />
                        </span>
                      )}

                      <Badge
                        tone={asset.kind === "video" ? "plum" : "neutral"}
                        className="absolute left-2 top-2 !bg-night-deep/80 !text-white ring-1 ring-white/15 !text-[0.6rem] backdrop-blur"
                      >
                        {kindLabel(asset.kind)}
                      </Badge>
                    </button>

                    <div className="p-3">
                      <p className="truncate text-[0.8rem] font-semibold text-ink" title={name}>
                        {name}
                      </p>
                      <p className="mt-0.5 text-[0.68rem] text-ink-soft">
                        {formatBytes(Number(asset.sizeBytes))} · added{" "}
                        {formatRelative(asset.createdAt)}
                      </p>

                      <div className="mt-2.5 flex gap-1.5">
                        <Button
                          variant="secondary"
                          size="sm"
                          className="h-8 flex-1 px-2 text-[0.7rem]"
                          onClick={() => copyLink(asset)}
                        >
                          {copiedId === asset.id ? <Check /> : <Copy />}
                          {copiedId === asset.id ? "Copied" : copyLabel(asset.kind)}
                        </Button>
                        <Button
                          variant="dangerGhost"
                          size="iconSm"
                          className="h-8 w-8"
                          aria-label={`Delete ${name}`}
                          onClick={() => handleDelete(asset)}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>
      </Card>

      <Modal
        open={preview !== null}
        onOpenChange={(open) => !open && setPreview(null)}
        title={preview?.title || preview?.originalName || "Your file"}
        description={
          preview
            ? `${kindLabel(preview.kind)} · ${formatBytes(Number(preview.sizeBytes))} · added ${formatRelative(preview.createdAt)}`
            : undefined
        }
        size="xl"
      >
        {preview && (
          <div className="space-y-4">
            <div className="overflow-hidden rounded-xl bg-ink/5">
              {preview.kind === "image" ? (
                <img
                  src={preview.url}
                  alt={preview.title || preview.originalName}
                  className="mx-auto max-h-[60vh] w-auto"
                />
              ) : preview.kind === "video" ? (
                <video src={preview.url} controls className="mx-auto max-h-[60vh] w-full" />
              ) : preview.kind === "audio" ? (
                <audio src={preview.url} controls className="w-full p-6" />
              ) : (
                <div className="p-10 text-center">
                  <p className="text-sm text-ink-soft">
                    We can't show this one here — open it to take a look.
                  </p>
                  <Button asChild variant="secondary" size="sm" className="mt-4">
                    <a href={preview.url} target="_blank" rel="noreferrer">
                      Open this file
                    </a>
                  </Button>
                </div>
              )}
            </div>

            {/* The link itself is machinery — she needs to be able to hand it
                to something, not to read it. */}
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-hairline bg-cream/60 px-3 py-2">
              <p className="min-w-0 flex-1 text-xs text-ink-soft">
                Copy the link to use this anywhere on your site.
              </p>
              <Button asChild variant="ghost" size="sm">
                <a href={preview.url} target="_blank" rel="noreferrer">
                  <ExternalLink />
                  Open in a new tab
                </a>
              </Button>
              <Button variant="secondary" size="sm" onClick={() => copyLink(preview)}>
                {copiedId === preview.id ? <Check /> : <Copy />}
                {copiedId === preview.id ? "Copied" : copyLabel(preview.kind)}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {confirmDialog}
    </div>
  );
}
