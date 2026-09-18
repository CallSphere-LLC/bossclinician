import { publicSiteUrl } from "@/lib/siteOrigins";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import {
  Check,
  Copy,
  ExternalLink,
  Folder,
  FolderInput,
  FolderOpen,
  Pencil,
  Play,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { adminApi } from "@/lib/api";
import { mediaLibraryApi, parseTagInput, type LibraryAsset } from "@/lib/mediaLibraryApi";
import type { MediaAsset, MediaKind, MediaVisibility } from "@/types/admin";
import { cn } from "@/lib/cn";
import { formatBytes, formatRelative } from "@/lib/format";
import { friendlyError, pluralize } from "@/pages/admin/ui/friendly";
import {
  Badge,
  Button,
  Card,
  Chip,
  chipRowStyles,
  EmptyState,
  ErrorNotice,
  Field,
  Input,
  PageHeader,
  Skeleton,
  Textarea,
} from "@/pages/admin/ui/primitives";
import { UploadDropzone, iconForKind } from "@/pages/admin/ui/Uploader";
import { Modal, useConfirm } from "@/pages/admin/ui/Dialog";
import { Link } from "react-router";

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

/**
 * Who a file is for — the question, in the only two answers that exist.
 *
 * It decides which of the two storage areas the bytes land in, and that is not
 * something a later edit can undo: the choice has to be made here, before the
 * upload starts. "Public" and "protected" are words about directories; these are
 * words about people, which is what the person choosing is actually thinking
 * about.
 */
const AUDIENCES: { key: MediaVisibility; label: string; hint: string }[] = [
  {
    key: "public",
    label: "Anyone on the website",
    hint: "Pictures for your pages, blog covers, headshots — things a visitor should see.",
  },
  {
    key: "protected",
    label: "Only people who bought it",
    hint: "Course videos, workbooks, anything somebody paid for. It never gets a public web address.",
  },
];

/** The short version, for the badge on a file that is already uploaded. */
function audienceBadge(visibility: MediaVisibility | undefined): string {
  return visibility === "protected" ? "Buyers only" : "Everyone";
}

function isPaidFile(asset: MediaAsset): boolean {
  return asset.visibility === "protected";
}

const PAID_FILE_NOTE =
  "You're the only one who can see it here. There's no web address to copy — add it from inside the course, product or session it belongs to.";

/**
 * A file somebody sent through a public form. The library row carries the
 * contact it belongs to (media_assets.contact_id, migration 049), and the API
 * already returns every column, so the card can open that person.
 */
type FormUploadAsset = MediaAsset & { contactId?: number | null; formSubmissionId?: number | null };

function sentByContact(asset: MediaAsset): number | null {
  const contactId = (asset as FormUploadAsset).contactId;
  return typeof contactId === "number" && contactId > 0 ? contactId : null;
}

export default function MediaLibrary() {
  const [assets, setAssets] = useState<LibraryAsset[] | null>(null);
  const [filter, setFilter] = useState<MediaKind | "all">("all");
  // null is every folder; "" is the files that are not in one.
  const [folderFilter, setFolderFilter] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<LibraryAsset | null>(null);
  const [editing, setEditing] = useState<LibraryAsset | null>(null);
  const [editFocus, setEditFocus] = useState<"name" | "folder">("name");
  const [details, setDetails] = useState({ title: "", folder: "", altText: "", tags: "" });
  const [saving, setSaving] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const folderListId = useId();
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [audience, setAudience] = useState<MediaVisibility>("public");
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
    // "#intake" and "intake" find the same tag.
    const bare = term.replace(/^#+/, "");
    return assets.filter((a) => {
      if (filter !== "all" && a.kind !== filter) return false;
      if (folderFilter !== null && (a.folder ?? "") !== folderFilter) return false;
      if (!term) return true;
      return (
        a.title.toLowerCase().includes(term) ||
        a.originalName.toLowerCase().includes(term) ||
        (a.altText ?? "").toLowerCase().includes(term) ||
        (bare !== "" && (a.tags ?? []).some((tag) => tag.toLowerCase().includes(bare)))
      );
    });
  }, [assets, filter, folderFilter, search]);

  /** Folders in use, A to Z. A folder exists only while something is in it. */
  const folders = useMemo(() => {
    const map = new Map<string, number>();
    for (const a of assets ?? []) {
      const name = a.folder ?? "";
      if (name !== "") map.set(name, (map.get(name) ?? 0) + 1);
    }
    return Array.from(map, ([name, count]) => ({ name, count })).sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
    );
  }, [assets]);

  const unfiledCount = useMemo(
    () => (assets ?? []).filter((a) => (a.folder ?? "") === "").length,
    [assets],
  );

  // Moving the last file out of a folder removes the folder, and a filter left
  // pointing at it would show an empty library with no chip to explain why.
  useEffect(() => {
    if (folderFilter && !folders.some((f) => f.name === folderFilter)) setFolderFilter(null);
  }, [folders, folderFilter]);

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
    // Filtered, not just prepended: choosing a file that is already in the
    // library hands back the row she already has rather than storing it twice,
    // and a grid with the same key in it twice is a React warning and a
    // duplicate tile.
    setAssets((prev) =>
      prev ? [asset, ...prev.filter((existing) => existing.id !== asset.id)] : [asset],
    );

    // Uploaded while looking at a folder: that is where she expects to find it.
    // Only a file with no folder yet — one she already filed elsewhere stays put.
    if (folderFilter && !asset.folder) {
      mediaLibraryApi
        .update(asset.id, { folder: folderFilter })
        .then(replaceAsset)
        .catch(() => undefined);
    }
  }

  function replaceAsset(updated: LibraryAsset) {
    setAssets(
      (current) => current?.map((asset) => (asset.id === updated.id ? updated : asset)) ?? current,
    );
    setPreview((current) => (current?.id === updated.id ? updated : current));
  }

  async function copyLink(asset: MediaAsset) {
    const absolute = publicSiteUrl(asset.url);
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

  async function saveDetails() {
    if (!editing || !details.title.trim() || saving) return;
    setSaving(true);
    try {
      const updated = await mediaLibraryApi.update(editing.id, {
        title: details.title.trim(),
        folder: details.folder.trim(),
        altText: details.altText.trim(),
        tags: parseTagInput(details.tags),
      });
      replaceAsset(updated);
      setEditing(null);
      toast.success("File details saved");
    } catch (err) {
      toast.error(friendlyError(err, "file"));
    } finally {
      setSaving(false);
    }
  }

  /** `focus` is which box the dialog opens on: the name, or the folder for "Move". */
  function openDetails(asset: LibraryAsset, focus: "name" | "folder" = "name") {
    setEditing(asset);
    setEditFocus(focus);
    setDetails({
      title: asset.title || asset.originalName,
      folder: asset.folder ?? "",
      altText: asset.altText ?? "",
      tags: (asset.tags ?? []).join(", "),
    });
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
    if (folderFilter !== null) {
      return {
        title:
          folderFilter === ""
            ? `Every one of your ${group?.plural ?? "files"} is in a folder`
            : `No ${group?.plural ?? "files"} in “${folderFilter}”`,
        description: "Choose “All folders” to see everything again.",
      };
    }
    return {
      title: `No ${group?.plural ?? "files"} yet — upload your first one`,
      description: "Anything you add in the box above will show up here.",
    };
  }, [assets, filter, folderFilter, search]);

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

      {/* Asked before the box, not after: the answer decides where the bytes are
          written, and a file uploaded for everyone cannot be made private
          afterwards without uploading it again. */}
      <Card className="p-4">
        <p className="text-sm font-semibold text-ink">Who is this file for?</p>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {AUDIENCES.map((choice) => {
            const active = audience === choice.key;
            return (
              <button
                key={choice.key}
                type="button"
                aria-pressed={active}
                onClick={() => setAudience(choice.key)}
                className={cn(
                  "rounded-xl border p-3 text-left transition-colors",
                  active
                    ? "border-plum bg-lilac-tint/50"
                    : "border-hairline hover:border-plum/40 hover:bg-lilac-tint/20",
                )}
              >
                <span className="flex items-center gap-2 text-sm font-semibold text-ink">
                  <span
                    className={cn(
                      "grid size-4 shrink-0 place-items-center rounded-full border",
                      active ? "border-plum bg-plum text-white" : "border-hairline",
                    )}
                  >
                    {active && <Check className="size-3" />}
                  </span>
                  {choice.label}
                </span>
                <span className="mt-1 block text-xs text-ink-soft">{choice.hint}</span>
              </button>
            );
          })}
        </div>
      </Card>

      <UploadDropzone onUploaded={handleUploaded} visibility={audience} />

      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-hairline/60 px-4 py-3.5">
          <div className={chipRowStyles}>
            {FILTERS.map((f) => {
              const active = filter === f.key;
              const count = f.key === "all" ? (assets?.length ?? 0) : (counts.get(f.key) ?? 0);
              return (
                <Chip key={f.key} selected={active} onClick={() => setFilter(f.key)}>
                  {f.label}
                  <span className={cn(active ? "text-white/70" : "text-ink-soft/60")}>
                    {count}
                  </span>
                </Chip>
              );
            })}
          </div>
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or tag…"
            aria-label="Search your files by name, tag or description"
            className="ml-auto h-9 w-full sm:w-56"
          />
        </div>

        {/* Shown once there is a folder to choose. Until then the row would be
            two chips that both mean "everything". */}
        {folders.length > 0 && (
          <div
            className="flex flex-wrap items-center gap-2 border-b border-hairline/60 px-4 py-3"
            role="group"
            aria-label="Folders"
          >
            <Folder aria-hidden className="size-4 shrink-0 text-ink-soft" />
            <Chip selected={folderFilter === null} onClick={() => setFolderFilter(null)}>
              All folders
            </Chip>
            {folders.map((f) => {
              const active = folderFilter === f.name;
              return (
                <Chip key={f.name} selected={active} onClick={() => setFolderFilter(f.name)}>
                  {f.name}
                  <span className={cn(active ? "text-white/70" : "text-ink-soft/60")}>{f.count}</span>
                </Chip>
              );
            })}
            {unfiledCount > 0 && (
              <Chip selected={folderFilter === ""} onClick={() => setFolderFilter("")}>
                Not in a folder
                <span className={cn(folderFilter === "" ? "text-white/70" : "text-ink-soft/60")}>
                  {unfiledCount}
                </span>
              </Chip>
            )}
          </div>
        )}

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
                const paid = isPaidFile(asset);
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
                      {/* previewUrl, not url: `protected:abc.mp4` is a storage
                          reference and draws a broken frame. The icon stays for
                          the kinds that have no picture to show. */}
                      {asset.kind === "image" ? (
                        <img
                          src={asset.previewUrl}
                          alt={asset.altText || name}
                          loading="lazy"
                          className="size-full object-cover transition-transform duration-150 group-hover:scale-[1.04]"
                        />
                      ) : asset.kind === "video" ? (
                        <>
                          {/* Metadata-only preload: never pull whole videos into a grid. */}
                          <video
                            src={asset.previewUrl}
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
                      <Badge
                        tone={paid ? "gold" : "neutral"}
                        className="absolute right-2 top-2 !bg-night-deep/80 !text-white ring-1 ring-white/15 !text-[0.6rem] backdrop-blur"
                      >
                        {audienceBadge(asset.visibility)}
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
                      {(asset.folder || (asset.tags ?? []).length > 0) && (
                        <p className="mt-0.5 truncate text-[0.68rem] text-ink-soft">
                          {asset.folder && (
                            <button
                              type="button"
                              onClick={() => setFolderFilter(asset.folder)}
                              className="font-semibold text-plum hover:underline"
                            >
                              {asset.folder}
                            </button>
                          )}
                          {asset.folder && (asset.tags ?? []).length > 0 && " · "}
                          {(asset.tags ?? []).map((tag) => `#${tag}`).join(" ")}
                        </p>
                      )}
                      {sentByContact(asset) !== null && (
                        <Link
                          to={`/admin/contacts/${sentByContact(asset)}`}
                          className="mt-0.5 block truncate text-[0.68rem] font-semibold text-plum hover:underline"
                        >
                          Sent through a form · open their contact
                        </Link>
                      )}

                      <div className="mt-2.5 flex gap-1.5">
                        {paid ? (
                          <p className="flex-1 self-center text-[0.68rem] leading-snug text-ink-soft">
                            Add it from inside the course or product it belongs to.
                          </p>
                        ) : (
                          <Button
                            variant="secondary"
                            size="sm"
                            className="h-8 flex-1 px-2 text-[0.7rem]"
                            onClick={() => copyLink(asset)}
                          >
                            {copiedId === asset.id ? <Check /> : <Copy />}
                            {copiedId === asset.id ? "Copied" : copyLabel(asset.kind)}
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="iconSm"
                          className="h-8 w-8"
                          aria-label={`Move ${name} to a folder`}
                          title="Move to folder"
                          onClick={() => openDetails(asset, "folder")}
                        >
                          <FolderInput />
                        </Button>
                        <Button
                          variant="ghost"
                          size="iconSm"
                          className="h-8 w-8"
                          aria-label={`Edit the name, description and tags of ${name}`}
                          title="Edit details"
                          onClick={() => openDetails(asset)}
                        >
                          <Pencil />
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
            ? `${kindLabel(preview.kind)} · ${formatBytes(Number(preview.sizeBytes))} · added ${formatRelative(preview.createdAt)} · ${
                isPaidFile(preview) ? "Only people who bought it" : "Anyone on the website"
              }`
            : undefined
        }
        size="xl"
      >
        {preview && (
          <div className="space-y-4">
            {/* previewUrl throughout: a file only buyers can open has no public
                address, but she still has to be able to check the video she
                uploaded is the right one. The signed link plays here and
                nowhere else — it is not the link she can copy and hand out. */}
            <div className="overflow-hidden rounded-xl bg-ink/5">
              {preview.kind === "image" ? (
                <img
                  src={preview.previewUrl}
                  alt={preview.altText || preview.title || preview.originalName}
                  className="mx-auto max-h-[60vh] w-auto"
                />
              ) : preview.kind === "video" ? (
                <video src={preview.previewUrl} controls className="mx-auto max-h-[60vh] w-full" />
              ) : preview.kind === "audio" ? (
                <audio src={preview.previewUrl} controls className="w-full p-6" />
              ) : (
                <div className="p-10 text-center">
                  <p className="text-sm text-ink-soft">
                    We can't show this one here — open it to take a look.
                  </p>
                  <Button asChild variant="secondary" size="sm" className="mt-4">
                    <a href={preview.previewUrl} target="_blank" rel="noreferrer">
                      Open this file
                    </a>
                  </Button>
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-start gap-x-6 gap-y-2 rounded-xl border border-hairline px-3 py-2.5 text-xs text-ink-soft">
              <p className="min-w-0 flex-1 basis-56">
                <span className="font-semibold text-ink">Folder: </span>
                {preview.folder || "Not in a folder"}
                <span className="mx-2 text-ink-soft/50">·</span>
                <span className="font-semibold text-ink">Tags: </span>
                {(preview.tags ?? []).length > 0
                  ? (preview.tags ?? []).map((tag) => `#${tag}`).join(" ")
                  : "None yet"}
                {preview.kind === "image" && (
                  <>
                    <br />
                    <span className="font-semibold text-ink">Description: </span>
                    {preview.altText ||
                      "None yet — add one so people using a screen reader know what this picture shows."}
                  </>
                )}
              </p>
              <Button variant="secondary" size="sm" onClick={() => openDetails(preview)}>
                <Pencil />
                Edit details
              </Button>
            </div>

            {/* The link itself is machinery — she needs to be able to hand it
                to something, not to read it. A file only buyers can open has no
                link at all, so she gets the reason instead. */}
            {isPaidFile(preview) ? (
              <p className="rounded-xl border border-hairline bg-cream/60 px-3 py-2.5 text-xs leading-relaxed text-ink-soft">
                {PAID_FILE_NOTE}
              </p>
            ) : (
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
            )}
          </div>
        )}
      </Modal>

      <Modal
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        title={editFocus === "folder" ? "Move to folder" : "File details"}
        description="This only changes how the file is organised in your library; links and anything already using it keep working."
        size="md"
        initialFocusRef={editFocus === "folder" ? folderRef : nameRef}
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={!details.title.trim() || saving}
              onClick={() => void saveDetails()}
            >
              {saving ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        {editing && (
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void saveDetails();
            }}
          >
            <Field label="Name">
              <Input
                ref={nameRef}
                value={details.title}
                onChange={(event) => setDetails((d) => ({ ...d, title: event.target.value }))}
                aria-label="File name"
                maxLength={300}
              />
            </Field>
            <Field
              label="Folder"
              hint="choose one you've already made, or type a new name. Leave it empty to take the file out of its folder"
            >
              <Input
                ref={folderRef}
                list={folderListId}
                value={details.folder}
                onChange={(event) => setDetails((d) => ({ ...d, folder: event.target.value }))}
                placeholder="e.g. Course workbooks"
                aria-label="Folder"
                maxLength={80}
              />
              <datalist id={folderListId}>
                {folders.map((f) => (
                  <option key={f.name} value={f.name} />
                ))}
              </datalist>
            </Field>
            {editing.kind === "image" && (
              <Field
                label="Description of the picture"
                hint="read aloud to people who can't see it. Say what it shows, in a sentence"
              >
                <Textarea
                  rows={2}
                  value={details.altText}
                  onChange={(event) => setDetails((d) => ({ ...d, altText: event.target.value }))}
                  placeholder="Yvette smiling at her desk, laptop open"
                  maxLength={500}
                />
              </Field>
            )}
            <Field label="Tags" hint="separate them with commas — you can search by any of them">
              <Input
                value={details.tags}
                onChange={(event) => setDetails((d) => ({ ...d, tags: event.target.value }))}
                placeholder="intake, worksheet, 2026"
                aria-label="Tags"
              />
            </Field>
            {/* So Enter in any box saves, without a second visible button. */}
            <button type="submit" hidden aria-hidden tabIndex={-1} />
          </form>
        )}
      </Modal>

      {confirmDialog}
    </div>
  );
}
