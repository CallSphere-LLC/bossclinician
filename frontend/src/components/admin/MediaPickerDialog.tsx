import { useEffect, useMemo, useState } from "react";
import { Image as ImageIcon, Search } from "lucide-react";
import { adminApi } from "@/lib/api";
import type { MediaAsset } from "@/types/admin";
import { formatBytes } from "@/lib/format";
import { Modal } from "@/pages/admin/ui/Dialog";
import { EmptyState, Input, Skeleton } from "@/pages/admin/ui/primitives";
import { UploadDropzone } from "@/pages/admin/ui/Uploader";

/** Shared chooser for public images already stored in the site's media library. */
export default function MediaPickerDialog({
  open,
  onOpenChange,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (asset: MediaAsset) => void;
}) {
  const [assets, setAssets] = useState<MediaAsset[] | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!open) return;
    setAssets(null);
    adminApi
      .mediaList("image")
      .then((rows) => setAssets(rows.filter((asset) => asset.visibility !== "protected")))
      .catch(() => setAssets([]));
  }, [open]);

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return assets ?? [];
    return (assets ?? []).filter((asset) =>
      `${asset.title} ${asset.originalName}`.toLowerCase().includes(query),
    );
  }, [assets, search]);

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Choose an image"
      description="Pick something already in your media library, or upload a new public image."
      size="lg"
    >
      <div className="space-y-4">
        <UploadDropzone
          compact
          accept="image/*"
          visibility="public"
          scope="picture-picker"
          onUploaded={(asset) => setAssets((current) => current ? [asset, ...current] : [asset])}
        />

        <label className="relative block">
          <span className="sr-only">Search images</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-soft" />
          <Input
            className="pl-9"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search your images…"
          />
        </label>

        {assets === null ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="aspect-[4/3]" />)}
          </div>
        ) : visible.length === 0 ? (
          <EmptyState
            icon={<ImageIcon />}
            title={search ? "No images match that search" : "No images yet"}
            description={search ? "Try another word." : "Upload one above and it will appear here."}
          />
        ) : (
          <ul className="grid max-h-[26rem] grid-cols-2 gap-3 overflow-y-auto pr-1 sm:grid-cols-3">
            {visible.map((asset) => (
              <li key={asset.id}>
                <button
                  type="button"
                  className="group flex min-h-11 w-full flex-col overflow-hidden rounded-xl border border-hairline bg-surface text-left transition hover:border-plum focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-plum/40"
                  onClick={() => {
                    onSelect(asset);
                    onOpenChange(false);
                  }}
                >
                  <img
                    src={asset.previewUrl || asset.url}
                    alt=""
                    className="aspect-[4/3] w-full bg-cream object-cover"
                  />
                  <span className="w-full p-2.5">
                    <span className="block truncate text-sm font-semibold text-ink">
                      {asset.title || asset.originalName}
                    </span>
                    <span className="block text-xs text-ink-soft">{formatBytes(Number(asset.sizeBytes))}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
