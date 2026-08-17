import { useCallback, useEffect, useState, type FormEvent } from "react";
import { motion } from "motion/react";
import { FileText } from "lucide-react";
import { toast } from "sonner";
import { formatDateTime } from "@/lib/format";
import { marketingApi, type EmailTemplate } from "@/lib/marketingApi";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNotice,
  Field,
  Input,
  PageHeader,
  Skeleton,
  Textarea,
} from "@/pages/admin/ui/primitives";
import { Modal } from "@/pages/admin/ui/Dialog";
import { friendlyError } from "@/pages/admin/ui/friendly";

/**
 * The emails the platform sends on its own: receipts, password resets, the
 * "your access is ready" note.
 *
 * Editable without a developer, and safe to get wrong: an email left blank or
 * switched off falls back to the wording the platform ships with, so the worst
 * an edit here can do is return a message to its original words. Nothing on
 * this screen can stop a receipt going out.
 */

interface Draft {
  key: string;
  name: string;
  subject: string;
  bodyMd: string;
  enabled: boolean;
}

export default function EmailTemplates() {
  const [templates, setTemplates] = useState<EmailTemplate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    marketingApi
      .emailTemplates()
      .then((rows) => {
        setTemplates(rows);
        setError(null);
      })
      .catch(() => setError("We couldn't load your automatic emails just now."));
  }, []);

  useEffect(load, [load]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!editing) return;

    setSaving(true);
    try {
      await marketingApi.updateEmailTemplate(editing.key, {
        subject: editing.subject,
        bodyMd: editing.bodyMd,
        enabled: editing.enabled,
      });
      toast.success("Email saved");
      setEditing(null);
      load();
    } catch (err) {
      toast.error(friendlyError(err, "email"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Marketing"
        title="Automatic emails"
        description="The ones your site sends on its own — receipts, password resets, welcome notes. Change the words without touching anything else."
      />

      {error && <ErrorNotice message={error} />}

      {templates === null ? (
        <div className="grid gap-4 md:grid-cols-2">
          {[0, 1, 2, 3].map((key) => (
            <Skeleton key={key} className="h-32 rounded-2xl" />
          ))}
        </div>
      ) : templates.length === 0 ? (
        <Card>
          <EmptyState
            icon={<FileText />}
            title="Nothing to edit yet"
            description="Your automatic emails will appear here once the site has been set up."
          />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {templates.map((template, index) => (
            <motion.div
              key={template.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(index * 0.04, 0.3) }}
            >
              <Card className="flex h-full flex-col gap-3 p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-display text-base text-ink">{template.name}</p>
                    <p className="mt-1 text-sm text-ink-soft">{template.description}</p>
                  </div>
                  {!template.enabled && <Badge tone="slate">Turned off</Badge>}
                </div>

                <p className="text-sm text-ink-soft">
                  <span className="text-ink-soft/70">Subject: </span>
                  {template.subject || "Using the wording we ship with"}
                </p>

                <div className="mt-auto flex items-center justify-between gap-2 pt-2">
                  <span className="text-xs text-ink-soft/80">
                    Last changed {formatDateTime(template.updatedAt)}
                  </span>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() =>
                      setEditing({
                        key: template.key,
                        name: template.name,
                        subject: template.subject,
                        bodyMd: template.bodyMd,
                        enabled: template.enabled,
                      })
                    }
                  >
                    Edit the wording
                  </Button>
                </div>
              </Card>
            </motion.div>
          ))}
        </div>
      )}

      <Modal
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        title={editing ? editing.name : ""}
        description="Leave anything blank to go back to the wording we ship with."
        size="lg"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button size="sm" type="submit" form="template-form" disabled={saving}>
              {saving ? "Saving…" : "Save wording"}
            </Button>
          </>
        }
      >
        {editing && (
          <form id="template-form" onSubmit={save} className="grid gap-4">
            <Field label="Subject line" hint="What they see in their inbox">
              <Input
                value={editing.subject}
                onChange={(event) =>
                  setEditing((draft) => draft && { ...draft, subject: event.target.value })
                }
                autoFocus
              />
            </Field>

            <Field label="What the email says" hint="Use {{firstName}} to greet them by name">
              <Textarea
                rows={14}
                value={editing.bodyMd}
                onChange={(event) =>
                  setEditing((draft) => draft && { ...draft, bodyMd: event.target.value })
                }
                placeholder="Hi {{firstName}},"
              />
            </Field>

            <label className="flex items-start gap-3 text-sm text-ink">
              <input
                type="checkbox"
                className="mt-1 size-4 rounded border-hairline text-plum focus-visible:ring-plum/30"
                checked={editing.enabled}
                onChange={(event) =>
                  setEditing((draft) => draft && { ...draft, enabled: event.target.checked })
                }
              />
              <span>
                Send this email
                <span className="block text-xs text-ink-soft">
                  Turning it off means people stop getting it altogether.
                </span>
              </span>
            </label>
          </form>
        )}
      </Modal>
    </div>
  );
}
