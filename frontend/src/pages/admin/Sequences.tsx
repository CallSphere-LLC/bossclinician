import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { motion } from "motion/react";
import { CheckCircle2, Mails, Plus, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { formatNumber } from "@/lib/format";
import { marketingApi, type SequenceSummary } from "@/lib/marketingApi";
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
  type BadgeProps,
} from "@/pages/admin/ui/primitives";
import { Modal, useConfirm } from "@/pages/admin/ui/Dialog";
import { friendlyError, pluralize } from "@/pages/admin/ui/friendly";

/**
 * The list of email sequences.
 *
 * A sequence is a set of emails that go out one after another once somebody
 * joins it — the thing Kajabi calls an email sequence and the business calls
 * "the welcome emails". Everything on this screen is written that way: nobody
 * is shown a status code, a topic key or a delay in minutes.
 */

const STATUS_TONE: Record<string, NonNullable<BadgeProps["tone"]>> = {
  draft: "slate",
  active: "green",
  paused: "gold",
  archived: "neutral",
};

const STATUS_LABEL: Record<string, string> = {
  draft: "Not started yet",
  active: "Sending",
  paused: "Paused",
  archived: "Put away",
};

export default function Sequences() {
  const [sequences, setSequences] = useState<SequenceSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirm, confirmDialog] = useConfirm();

  const load = useCallback(() => {
    marketingApi
      .sequences()
      .then((rows) => {
        setSequences(rows);
        setError(null);
      })
      .catch(() => setError("We couldn't load your sequences just now."));
  }, []);

  useEffect(load, [load]);

  async function create(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;

    setSaving(true);
    try {
      await marketingApi.createSequence({ name: name.trim(), description: description.trim() });
      toast.success("Sequence created");
      setCreating(false);
      setName("");
      setDescription("");
      load();
    } catch (err) {
      toast.error(friendlyError(err, "sequence"));
    } finally {
      setSaving(false);
    }
  }

  async function remove(sequence: SequenceSummary) {
    const ok = await confirm({
      title: `Delete ${sequence.name}?`,
      description:
        "The emails in it go too, along with the record of who has been through it. This cannot be undone.",
      confirmLabel: "Delete it",
      destructive: true,
    });
    if (!ok) return;

    try {
      await marketingApi.deleteSequence(sequence.id);
      toast.success("Sequence deleted");
      load();
    } catch (err) {
      toast.error(friendlyError(err, "sequence"));
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Marketing"
        title="Email sequences"
        description="A set of emails that goes out one after another, on your schedule, once somebody joins it."
        actions={
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus />
            New sequence
          </Button>
        }
      />

      {error && <ErrorNotice message={error} />}

      {sequences === null ? (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((key) => (
            <Skeleton key={key} className="h-44 rounded-2xl" />
          ))}
        </div>
      ) : sequences.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Mails />}
            title="No sequences yet"
            description="Build one and everybody who joins it will get your emails in order, spaced however you like."
            action={
              <Button size="sm" onClick={() => setCreating(true)}>
                <Plus />
                New sequence
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {sequences.map((sequence, index) => (
            <motion.div
              key={sequence.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(index * 0.05, 0.3) }}
            >
              <Card className="flex h-full flex-col gap-4 p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <Link
                      to={`/admin/marketing/sequences/${sequence.id}`}
                      className="font-display text-lg text-ink hover:text-gold"
                    >
                      {sequence.name}
                    </Link>
                    <p className="mt-1 text-sm text-ink-soft">
                      {sequence.description || "No description yet."}
                    </p>
                  </div>
                  <Badge tone={STATUS_TONE[sequence.status] ?? "neutral"}>
                    {STATUS_LABEL[sequence.status] ?? sequence.status}
                  </Badge>
                </div>

                <dl className="grid grid-cols-3 gap-3 border-t border-hairline/60 pt-4 text-sm">
                  <div>
                    <dt className="text-xs text-ink-soft">Emails</dt>
                    <dd className="font-display text-lg text-ink">{sequence.emailCount}</dd>
                  </div>
                  <div>
                    <dt className="flex items-center gap-1 text-xs text-ink-soft">
                      <Users className="size-3" />
                      Going through
                    </dt>
                    <dd className="font-display text-lg text-ink">
                      {formatNumber(sequence.activeCount)}
                    </dd>
                  </div>
                  <div>
                    <dt className="flex items-center gap-1 text-xs text-ink-soft">
                      <CheckCircle2 className="size-3" />
                      Finished
                    </dt>
                    <dd className="font-display text-lg text-ink">
                      {formatNumber(sequence.completedCount)}
                    </dd>
                  </div>
                </dl>

                <div className="mt-auto flex items-center justify-between gap-2 pt-1">
                  <Button asChild size="sm" variant="secondary">
                    <Link to={`/admin/marketing/sequences/${sequence.id}`}>
                      {sequence.emailCount === 0
                        ? "Write the first email"
                        : `Edit ${pluralize(sequence.emailCount, "email")}`}
                    </Link>
                  </Button>
                  <Button
                    size="iconSm"
                    variant="dangerGhost"
                    aria-label={`Delete ${sequence.name}`}
                    onClick={() => void remove(sequence)}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </Card>
            </motion.div>
          ))}
        </div>
      )}

      <Modal
        open={creating}
        onOpenChange={(open) => !open && setCreating(false)}
        title="Start a new sequence"
        description="You can add the emails and choose when they go out next."
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button size="sm" type="submit" form="sequence-form" disabled={saving}>
              {saving ? "Creating…" : "Create sequence"}
            </Button>
          </>
        }
      >
        <form id="sequence-form" onSubmit={create} className="grid gap-4">
          <Field label="What is this sequence called?" hint="Only you see this">
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Welcome emails"
              required
              autoFocus
            />
          </Field>
          <Field label="What is it for?" hint="Optional">
            <Textarea
              rows={3}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="The five emails everyone gets after they download the guide."
            />
          </Field>
        </form>
      </Modal>

      {confirmDialog}
    </div>
  );
}
