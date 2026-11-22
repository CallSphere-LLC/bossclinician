import { useCallback, useEffect, useMemo, useState } from "react";
import { Images, Upload } from "lucide-react";
import { toast } from "sonner";
import { adminRetreatsApi, type AdminMemoryItem } from "@/lib/retreatsApi";
import { useConfirm } from "@/pages/admin/ui/Dialog";
import { Badge, Button, Card, CardHeader, Chip, EmptyState, ErrorNotice, Field, Input, chipRowStyles, legibleDisabledStyles } from "@/pages/admin/ui/primitives";
import { formatBytes } from "./retreatAdminRules";

type StatusFilter = AdminMemoryItem["status"] | "reported";

const STATUS_TONE = { pending: "gold", approved: "green", hidden: "neutral", removed: "red" } as const;

/**
 * The private retreat gallery, as the organizer moderates it. Every URL is a
 * short-lived signed link; reloading the tab mints fresh ones.
 */
export function RetreatMemories({ retreatId }: { retreatId: number }) {
  const [items, setItems] = useState<AdminMemoryItem[]>([]);
  const [storage, setStorage] = useState(0);
  const [filter, setFilter] = useState<StatusFilter>("pending");
  const [error, setError] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [caption, setCaption] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, confirmDialog] = useConfirm();

  const load = useCallback(async () => {
    try {
      const data = await adminRetreatsApi.media(retreatId);
      setItems(data.items);
      setStorage(data.storageBytes);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the gallery.");
    }
  }, [retreatId]);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(() => {
    const c: Record<StatusFilter, number> = { pending: 0, approved: 0, hidden: 0, removed: 0, reported: 0 };
    for (const item of items) {
      c[item.status] += 1;
      if (item.reports.some((r) => r.resolvedAt === null)) c.reported += 1;
    }
    return c;
  }, [items]);

  const shown = items.filter((i) => (filter === "reported" ? i.reports.some((r) => r.resolvedAt === null) : i.status === filter));

  async function moderate(item: AdminMemoryItem, status: "approved" | "hidden" | "removed") {
    if (status === "removed" && !(await confirm({ title: "Remove this upload?", description: "It stops showing and downloading for everyone, including the guest who shared it.", confirmLabel: "Yes, remove it", destructive: true }))) return;
    try {
      const updated = await adminRetreatsApi.moderateMedia(retreatId, item.id, status);
      setItems((all) => all.map((i) => (i.id === item.id ? { ...updated, url: i.url } : i)));
      toast.success(status === "approved" ? "Approved — guests of this retreat can see it" : status === "hidden" ? "Hidden from guests" : "Removed");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update it.");
    }
  }

  async function resolve(reportId: number) {
    try {
      await adminRetreatsApi.resolveReport(retreatId, reportId);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not resolve the report.");
    }
  }

  async function upload() {
    if (!file) return;
    setBusy(true);
    try {
      await adminRetreatsApi.uploadMedia(retreatId, file, caption);
      toast.success("Uploaded");
      setFile(null);
      setCaption("");
      setFilter("approved");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "That upload didn't go through.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      {confirmDialog}
      {error && <ErrorNotice message={error} />}
      <Card>
        <CardHeader
          icon={<Upload />}
          title="Add your own photo or video"
          subtitle={<span>Storage used by this retreat: <strong className="font-sans font-bold tabular-nums">{formatBytes(storage)}</strong></span>}
        />
        <div className="grid gap-4 p-5 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <Field label="File">
            <Input className="h-auto py-2.5" type="file" accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime,video/webm" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </Field>
          <Field label="Caption (optional)"><Input value={caption} maxLength={300} onChange={(e) => setCaption(e.target.value)} /></Field>
          <Button className={legibleDisabledStyles} disabled={busy || !file} onClick={() => void upload()}>{busy ? "Uploading…" : "Upload"}</Button>
        </div>
        <p className="px-5 pb-5 text-xs text-ink-soft">Gallery photos are for this retreat's guests only. Being in the gallery is never permission to use a photo in marketing.</p>
      </Card>

      <div className={chipRowStyles}>
        {(["pending", "approved", "hidden", "removed", "reported"] as StatusFilter[]).map((s) => (
          <Chip key={s} selected={filter === s} onClick={() => setFilter(s)}>
            {s === "reported" ? "Reported" : s[0].toUpperCase() + s.slice(1)} <span className="font-sans font-bold tabular-nums">{counts[s]}</span>
          </Chip>
        ))}
      </div>

      <Card>
        {shown.length === 0 ? (
          <EmptyState icon={<Images />} title="Nothing here" />
        ) : (
          <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3">
            {shown.map((item) => (
              <div key={item.id} className="overflow-hidden rounded-xl border border-hairline">
                {item.kind === "photo" ? (
                  <img src={item.url} alt={item.caption || `Upload by ${item.uploadedBy}`} className="aspect-[4/3] w-full bg-black/30 object-cover" loading="lazy" />
                ) : (
                  <video src={item.url} controls preload="metadata" className="aspect-[4/3] w-full bg-black" />
                )}
                <div className="space-y-2 p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={STATUS_TONE[item.status]}>{item.status}</Badge>
                    {item.memberId !== null && !item.sharingConsent && <Badge tone="red">No sharing consent</Badge>}
                  </div>
                  {item.caption && <p className="text-ink">{item.caption}</p>}
                  <p className="text-xs text-ink-soft">
                    {item.uploadedBy} · {new Date(item.createdAt).toLocaleDateString()} · <span className="font-sans font-bold tabular-nums">{formatBytes(item.sizeBytes)}</span>
                  </p>
                  {item.reports.filter((r) => r.resolvedAt === null).map((r) => (
                    <div key={r.id} className="rounded-lg border border-red-400/30 bg-red-500/10 p-2 text-xs text-red-200">
                      <p>Reported by {r.reportedBy}: {r.reason || "no reason given"}</p>
                      <button type="button" className="mt-1 underline" onClick={() => void resolve(r.id)}>Mark resolved</button>
                    </div>
                  ))}
                  <div className="flex flex-wrap gap-2">
                    {item.status !== "approved" && item.status !== "removed" && <Button size="sm" onClick={() => void moderate(item, "approved")}>Approve</Button>}
                    {item.status !== "hidden" && item.status !== "removed" && <Button size="sm" variant="secondary" onClick={() => void moderate(item, "hidden")}>Hide</Button>}
                    {item.status !== "removed" && <Button size="sm" variant="dangerGhost" onClick={() => void moderate(item, "removed")}>Remove</Button>}
                    <Button size="sm" variant="ghost" asChild><a href={item.url} download>Download</a></Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
