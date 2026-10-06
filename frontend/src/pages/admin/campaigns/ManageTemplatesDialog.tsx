import { useCallback, useEffect, useState } from "react";
import { Check, Copy, LayoutTemplate, Pencil, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { adminApi } from "@/lib/api";
import { formatDate } from "@/lib/format";
import type { SavedEmailTemplate } from "@/types/admin";
import { Button, EmptyState, ErrorNotice, Input, Skeleton } from "@/pages/admin/ui/primitives";
import { Modal, useConfirm } from "@/pages/admin/ui/Dialog";
import { friendlyError } from "@/pages/admin/ui/friendly";

/**
 * "Manage Templates" on Email Campaigns, as in Kajabi.
 *
 * Her saved email templates — the ones made with "Save as template" in the
 * email editor — renamed, copied or deleted in one place. Using one is still
 * done from the editor's "Start from a template" row.
 */
export default function ManageTemplatesDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [templates, setTemplates] = useState<SavedEmailTemplate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: number; name: string } | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [confirm, confirmDialog] = useConfirm();

  const load = useCallback(() => {
    adminApi
      .savedTemplates()
      .then((rows) => {
        setTemplates([...rows].sort((a, b) => a.name.localeCompare(b.name)));
        setError(null);
      })
      .catch(() => {
        setTemplates([]);
        setError("We couldn't load your templates just now.");
      });
  }, []);

  useEffect(() => {
    if (!open) return;
    setTemplates(null);
    setRenaming(null);
    load();
  }, [open, load]);

  async function run(id: number, action: () => Promise<unknown>, done: string) {
    setBusyId(id);
    try {
      await action();
      toast.success(done);
      load();
    } catch (err) {
      toast.error(friendlyError(err, "template"));
    } finally {
      setBusyId(null);
    }
  }

  async function saveRename() {
    if (!renaming) return;
    const name = renaming.name.trim();
    if (!name) {
      toast.error("Give the template a name.");
      return;
    }
    const { id } = renaming;
    setRenaming(null);
    await run(id, () => adminApi.savedTemplateRename(id, name), "Template renamed");
  }

  async function remove(template: SavedEmailTemplate) {
    const ok = await confirm({
      title: `Delete “${template.name}”?`,
      description: "Emails already written from it keep their words. This cannot be undone.",
      confirmLabel: "Yes, delete it",
      destructive: true,
    });
    if (!ok) return;
    await run(template.id, () => adminApi.savedTemplateDelete(template.id), "Template deleted");
  }

  return (
    <>
      <Modal
        open={open}
        onOpenChange={onOpenChange}
        title="Email templates"
        description="Save any email as a template from the email editor; rename, copy or delete them here."
        size="lg"
        footer={
          <Button size="sm" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        }
      >
        {error && <ErrorNotice message={error} />}
        {templates === null ? (
          <div className="space-y-2">
            {[0, 1, 2].map((key) => (
              <Skeleton key={key} className="h-14 rounded-xl" />
            ))}
          </div>
        ) : templates.length === 0 ? (
          <EmptyState
            icon={<LayoutTemplate />}
            title="No saved templates yet"
            description="Write an email you like, then choose “Save as template” in the editor and it will be listed here."
          />
        ) : (
          <ul className="divide-y divide-hairline/60 rounded-xl border border-hairline">
            {templates.map((template) => (
              <li key={template.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                {renaming?.id === template.id ? (
                  <Input
                    value={renaming.name}
                    aria-label="Template name"
                    autoFocus
                    className="min-w-0 flex-1"
                    onChange={(event) => setRenaming({ id: template.id, name: event.target.value })}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void saveRename();
                      }
                    }}
                  />
                ) : (
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-ink">{template.name}</p>
                    <p className="truncate text-xs text-ink-soft">
                      {template.subject || "No subject line"} · updated {formatDate(template.updatedAt)}
                    </p>
                  </div>
                )}
                <div className="flex items-center gap-1.5">
                  {renaming?.id === template.id ? (
                    <>
                      <Button size="iconSm" variant="secondary" aria-label="Save the name" onClick={() => void saveRename()}>
                        <Check />
                      </Button>
                      <Button size="iconSm" variant="ghost" aria-label="Keep the old name" onClick={() => setRenaming(null)}>
                        <X />
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button
                        size="iconSm"
                        variant="ghost"
                        title="Rename"
                        aria-label={`Rename ${template.name}`}
                        disabled={busyId === template.id}
                        onClick={() => setRenaming({ id: template.id, name: template.name })}
                      >
                        <Pencil />
                      </Button>
                      <Button
                        size="iconSm"
                        variant="ghost"
                        title="Make a copy"
                        aria-label={`Make a copy of ${template.name}`}
                        disabled={busyId === template.id}
                        onClick={() =>
                          void run(template.id, () => adminApi.savedTemplateDuplicate(template.id), "Template copied")
                        }
                      >
                        <Copy />
                      </Button>
                      <Button
                        size="iconSm"
                        variant="dangerGhost"
                        aria-label={`Delete ${template.name}`}
                        disabled={busyId === template.id}
                        onClick={() => void remove(template)}
                      >
                        <Trash2 />
                      </Button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Modal>
      {confirmDialog}
    </>
  );
}
