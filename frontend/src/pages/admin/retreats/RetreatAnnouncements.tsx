import { useCallback, useEffect, useState } from "react";
import { Megaphone } from "lucide-react";
import { toast } from "sonner";
import { adminRetreatsApi, type AdminAnnouncement } from "@/lib/retreatsApi";
import { useConfirm } from "@/pages/admin/ui/Dialog";
import { Badge, Button, Card, CardHeader, EmptyState, ErrorNotice, Field, Input, Textarea, legibleDisabledStyles } from "@/pages/admin/ui/primitives";

interface Draft {
  id?: number;
  title: string;
  bodyMd: string;
  published: boolean;
}

const EMPTY: Draft = { title: "", bodyMd: "", published: false };

export function RetreatAnnouncements({ retreatId }: { retreatId: number }) {
  const [items, setItems] = useState<AdminAnnouncement[]>([]);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, confirmDialog] = useConfirm();

  const load = useCallback(async () => {
    try {
      setItems((await adminRetreatsApi.announcements(retreatId)).announcements);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load announcements.");
    }
  }, [retreatId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    setBusy(true);
    try {
      await adminRetreatsApi.saveAnnouncement(retreatId, draft);
      toast.success(draft.id ? "Announcement updated" : "Announcement saved");
      setDraft(EMPTY);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the announcement.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(a: AdminAnnouncement) {
    if (!(await confirm({ title: `Delete “${a.title}”?`, description: "Guests will no longer see it.", confirmLabel: "Yes, delete it", destructive: true }))) return;
    try {
      await adminRetreatsApi.deleteAnnouncement(retreatId, a.id);
      toast.success("Announcement deleted");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not delete it.");
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_1.2fr]">
      {confirmDialog}
      <Card>
        <CardHeader icon={<Megaphone />} title={draft.id ? "Edit announcement" : "New announcement"} subtitle="Posting here does not send email." />
        <div className="space-y-4 p-5">
          <Field label="Title"><Input value={draft.title} maxLength={200} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></Field>
          <Field label="Message (Markdown)"><Textarea rows={8} value={draft.bodyMd} onChange={(e) => setDraft({ ...draft, bodyMd: e.target.value })} /></Field>
          <label className="flex min-h-10 items-center gap-3 text-sm text-ink">
            <input type="checkbox" className="size-4" checked={draft.published} onChange={(e) => setDraft({ ...draft, published: e.target.checked })} />
            Show to guests on the dashboard
          </label>
          <div className="flex gap-2">
            <Button className={legibleDisabledStyles} disabled={busy || draft.title.trim() === ""} onClick={() => void save()}>
              {draft.id ? "Save changes" : "Save announcement"}
            </Button>
            {draft.id && <Button variant="ghost" onClick={() => setDraft(EMPTY)}>Cancel</Button>}
          </div>
        </div>
      </Card>
      <Card>
        <CardHeader title="Announcements" />
        {error && <div className="p-5"><ErrorNotice message={error} /></div>}
        {items.length === 0 ? (
          <EmptyState icon={<Megaphone />} title="No announcements yet" />
        ) : (
          <ul className="divide-y divide-hairline/60">
            {items.map((a) => (
              <li key={a.id} className="flex flex-wrap items-start justify-between gap-3 p-5">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-ink">{a.title}</p>
                    <Badge tone={a.published ? "green" : "neutral"}>{a.published ? "Shown" : "Hidden"}</Badge>
                  </div>
                  <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-sm text-ink-soft">{a.bodyMd}</p>
                  <p className="mt-1 text-xs text-ink-soft">Updated {new Date(a.updatedAt).toLocaleString()}</p>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setDraft({ id: a.id, title: a.title, bodyMd: a.bodyMd, published: a.published })}>Edit</Button>
                  <Button size="sm" variant="dangerGhost" onClick={() => void remove(a)}>Delete</Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
