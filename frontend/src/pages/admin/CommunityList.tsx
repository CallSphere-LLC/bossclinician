import { useNewProductRequest } from "./ui/useNewProductRequest";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { motion } from "motion/react";
import { ArrowUpRight, Hash, MessagesSquare, Plus, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { adminApi } from "@/lib/api";
import type { Community } from "@/types/admin";
import { formatNumber } from "@/lib/format";
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
import { Modal, useConfirm } from "@/pages/admin/ui/Dialog";
import { friendlyError, PUBLISH_LABEL } from "@/pages/admin/ui/friendly";

/**
 * How a space is joined, in her words. The stored values are "free" and "paid";
 * on a card the useful thing to know is who can walk in, so the badge says that
 * rather than capitalising the raw value.
 */
const ACCESS_OPTIONS = [
  { value: "free", label: "Anyone can join", badge: "Free to join" },
  { value: "paid", label: "Paying members only", badge: "Paid" },
] as const;

function accessBadge(access: string): string {
  return ACCESS_OPTIONS.find((option) => option.value === access)?.badge ?? "Free to join";
}

export default function CommunityList() {
  const [communities, setCommunities] = useState<Community[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: "", description: "", access: "free" });
  const [confirm, confirmDialog] = useConfirm();

  const load = useCallback(() => {
    adminApi
      .communities()
      .then(setCommunities)
      .catch(() => setError("We couldn't load your communities. Try refreshing the page."));
  }, []);

  useEffect(load, [load]);
  useNewProductRequest(() => setCreating(true));

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      await adminApi.communityCreate(form);
      toast.success("Community created");
      setCreating(false);
      setForm({ name: "", description: "", access: "free" });
      load();
    } catch (err) {
      toast.error(friendlyError(err, "community"));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(community: Community) {
    const ok = await confirm({
      title: `Delete “${community.name}”?`,
      description:
        "Everything inside it goes too — every channel, post, comment, challenge and who's a member. You can't get it back.",
      confirmLabel: "Delete community",
      destructive: true,
    });
    if (!ok) return;

    try {
      await adminApi.communityDelete(community.id);
      toast.success("Community deleted");
      load();
    } catch (err) {
      toast.error(friendlyError(err, "community"));
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Products"
        title="Community"
        description="Private spaces where your members talk to you and to each other — with channels, challenges and live events."
        actions={
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus />
            New community
          </Button>
        }
      />

      {error && <ErrorNotice message={error} />}

      {communities === null ? (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-52 w-full" />
          ))}
        </div>
      ) : communities.length === 0 ? (
        <Card>
          <EmptyState
            icon={<MessagesSquare />}
            title="No communities yet"
            description="Create your first space, then add the channels, challenges and live events your members get."
            action={
              <Button size="sm" onClick={() => setCreating(true)}>
                <Plus />
                Create community
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
          {communities.map((community, i) => (
            <motion.div
              key={community.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i * 0.05, 0.3) }}
            >
              <Card className="group relative h-full overflow-hidden transition-all hover:-translate-y-0.5 hover:border-plum/30 hover:shadow-[0_20px_44px_-22px_rgba(15,30,58,0.4)]">
                <div className="relative h-24 bg-surface-raised">
                  {community.coverImage && (
                    <img
                      src={community.coverImage}
                      alt=""
                      className="size-full object-cover opacity-70"
                    />
                  )}
                  <div className="absolute inset-x-4 bottom-3 flex items-center gap-2">
                    <Badge
                      tone={community.access === "paid" ? "gold" : "neutral"}
                      className="!bg-night-deep/80 !text-white ring-1 ring-white/15 backdrop-blur"
                    >
                      {accessBadge(community.access)}
                    </Badge>
                    {!community.published && (
                      <Badge tone="slate" className="!bg-night-deep/80 !text-white ring-1 ring-white/15 backdrop-blur">
                        {PUBLISH_LABEL.draft}
                      </Badge>
                    )}
                  </div>
                </div>

                <div className="p-5">
                  <h3 className="font-display text-lg text-ink">{community.name}</h3>
                  <p className="mt-1 line-clamp-2 min-h-[2.5rem] text-sm text-ink-soft">
                    {community.description || "No description yet."}
                  </p>

                  <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-hairline/70 pt-3.5">
                    <Stat icon={<Hash className="size-3.5" />} label="Channels" value={community.channelCount} />
                    <Stat icon={<Users className="size-3.5" />} label="Members" value={community.memberCount} />
                    <Stat
                      icon={<MessagesSquare className="size-3.5" />}
                      label="Posts"
                      value={community.postCount}
                    />
                  </dl>

                  <div className="mt-4 flex gap-2">
                    <Button asChild size="sm" className="flex-1">
                      <Link to={`/admin/community/${community.id}`}>
                        Manage
                        <ArrowUpRight />
                      </Link>
                    </Button>
                    <Button
                      variant="dangerGhost"
                      size="iconSm"
                      aria-label={`Delete ${community.name}`}
                      onClick={() => handleDelete(community)}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </div>
              </Card>
            </motion.div>
          ))}
        </div>
      )}

      <Modal
        open={creating}
        onOpenChange={setCreating}
        title="New community"
        description="You can add channels, challenges and events as soon as it's created."
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button size="sm" form="new-community" type="submit" disabled={saving}>
              {saving ? "Creating…" : "Create community"}
            </Button>
          </>
        }
      >
        <form id="new-community" onSubmit={handleCreate} className="space-y-4">
          <Field label="What's it called?" htmlFor="community-name">
            <Input
              id="community-name"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="The Boss Clinician Collective"
              required
              autoFocus
            />
          </Field>
          <Field
            label="What's it for?"
            hint="people see this before they join"
            htmlFor="community-desc"
          >
            <Textarea
              id="community-desc"
              rows={3}
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="A place for clinicians building their own practice to swap wins, ask questions and stay accountable."
            />
          </Field>
          <Field
            label="Who can join?"
            hint="a paid space opens up when someone subscribes to one of your plans"
          >
            <div className="flex gap-2">
              {ACCESS_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, access: option.value }))}
                  className={
                    form.access === option.value
                      ? "flex-1 rounded-xl bg-brand-gradient px-4 py-2.5 text-sm font-semibold text-white"
                      : "flex-1 rounded-xl border border-hairline px-4 py-2.5 text-sm font-semibold text-ink-soft transition-colors hover:border-plum/40 hover:text-plum"
                  }
                >
                  {option.label}
                </button>
              ))}
            </div>
          </Field>
        </form>
      </Modal>

      {confirmDialog}
    </div>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div>
      <dt className="flex items-center gap-1 text-[0.62rem] font-semibold uppercase tracking-wide text-ink-soft">
        {icon}
        {label}
      </dt>
      <dd className="mt-0.5 font-display text-base text-ink">{formatNumber(value)}</dd>
    </div>
  );
}
