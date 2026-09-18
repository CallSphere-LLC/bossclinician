import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { Pencil, Plus, Tags as TagsIcon, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { motion } from "motion/react";
import { formatRelative } from "@/lib/format";
import {
  contactsApi,
  emailStatusLabel,
  money,
  type SegmentPerson,
  type Tag,
} from "@/lib/contactsApi";
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
import { friendlyError, orNone, pluralize } from "@/pages/admin/ui/friendly";

/**
 * Tags — the labels she puts on people.
 *
 * A tag's name is hers to change at any time; what automations and saved groups
 * actually match on is fixed when the tag is created and never shown. That is
 * why renaming here is safe and why there is no field to edit it.
 */

/** A small palette, because "pick a colour" should not be a colour picker. */
const COLOURS: { value: string; label: string }[] = [
  { value: "", label: "None" },
  { value: "#c9a46a", label: "Gold" },
  { value: "#6f6b64", label: "Grey" },
  { value: "#4f9d76", label: "Green" },
  { value: "#c4736a", label: "Red" },
  { value: "#5b86b5", label: "Blue" },
];

export default function Tags() {
  const [tags, setTags] = useState<Tag[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Partial<Tag> | null>(null);
  const [viewing, setViewing] = useState<Tag | null>(null);
  const [confirm, confirmDialog] = useConfirm();

  const load = useCallback(() => {
    contactsApi
      .tags()
      .then((list) => {
        setTags(list);
        setError(null);
      })
      .catch(() => setError("We couldn't load your tags. Try refreshing the page."));
  }, []);

  useEffect(load, [load]);

  async function remove(tag: Tag) {
    const ok = await confirm({
      title: `Delete the “${tag.name}” tag?`,
      description:
        tag.contactCount > 0
          ? `${pluralize(tag.contactCount, "person", "people")} will lose this tag, and anything set up to watch for it will stop finding anyone. Nobody is removed from your list.`
          : "Nobody has this tag, so nothing else changes.",
      confirmLabel: "Yes, delete it",
      destructive: true,
    });
    if (!ok) return;
    try {
      await contactsApi.tagDelete(tag.id);
      toast.success("Tag deleted");
      load();
    } catch (err) {
      toast.error(friendlyError(err, "tag"));
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Contacts"
        title="Tags"
        description="Labels you put on people so you can find them again — quiz answers, waitlists, anyone who's been to a retreat."
        actions={
          <>
            <Button variant="secondary" size="sm" asChild>
              <Link to="/admin/contacts">
                <Users />
                All people
              </Link>
            </Button>
            <Button size="sm" onClick={() => setEditing({ name: "", colour: "", description: "" })}>
              <Plus />
              Add a tag
            </Button>
          </>
        }
      />

      {error && <ErrorNotice message={error} />}

      {tags === null ? (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-32 w-full" />
          ))}
        </div>
      ) : tags.length === 0 ? (
        <Card>
          <EmptyState
            icon={<TagsIcon />}
            title="No tags yet"
            description="Add your first tag, then put it on people from their card or straight from the people list."
            action={
              <Button size="sm" onClick={() => setEditing({ name: "", colour: "", description: "" })}>
                Add a tag
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
          {tags.map((tag, i) => (
            <motion.div
              key={tag.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i * 0.04, 0.3) }}
            >
              <Card className="flex h-full flex-col p-5">
                <div className="flex items-start gap-3">
                  <span
                    aria-hidden="true"
                    className="mt-1.5 size-3 shrink-0 rounded-full"
                    style={{ background: tag.colour || "#d4af6e" }}
                  />
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate font-display text-lg leading-snug text-ink">
                      {tag.name}
                    </h3>
                    {tag.description && (
                      <p className="mt-1 line-clamp-2 text-sm text-ink-soft">{tag.description}</p>
                    )}
                  </div>
                </div>

                <p className="mt-4 text-sm text-ink-soft">
                  {tag.contactCount === 0
                    ? "Nobody has this yet"
                    : pluralize(tag.contactCount, "person has it", "people have it")}
                </p>

                <div className="mt-auto flex gap-2 pt-4">
                  <Button
                    variant="secondary"
                    size="sm"
                    className="flex-1"
                    onClick={() => setViewing(tag)}
                  >
                    See who has it
                  </Button>
                  <Button
                    variant="secondary"
                    size="iconSm"
                    aria-label={`Rename ${tag.name}`}
                    onClick={() => setEditing(tag)}
                  >
                    <Pencil />
                  </Button>
                  <Button
                    variant="dangerGhost"
                    size="iconSm"
                    aria-label={`Delete ${tag.name}`}
                    onClick={() => remove(tag)}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </Card>
            </motion.div>
          ))}
        </div>
      )}

      <TagEditor
        tag={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          load();
        }}
      />

      <TagPeople tag={viewing} onClose={() => setViewing(null)} />

      {confirmDialog}
    </div>
  );
}

function TagEditor({
  tag,
  onClose,
  onSaved,
}: {
  tag: Partial<Tag> | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [colour, setColour] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!tag) return;
    setName(tag.name ?? "");
    setColour(tag.colour ?? "");
    setDescription(tag.description ?? "");
  }, [tag]);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!tag || !name.trim()) return;
    setSaving(true);
    try {
      if (tag.id) {
        await contactsApi.tagUpdate(tag.id, {
          name: name.trim(),
          colour,
          description: description.trim(),
        });
      } else {
        await contactsApi.tagCreate({
          name: name.trim(),
          colour,
          description: description.trim(),
        });
      }
      toast.success(tag.id ? "Tag saved" : "Tag added");
      onSaved();
    } catch (err) {
      toast.error(friendlyError(err, "tag"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={tag !== null}
      onOpenChange={(open) => !open && onClose()}
      title={tag?.id ? "Rename this tag" : "Add a tag"}
      description={
        tag?.id
          ? "Renaming is safe — anything already set up to watch for this tag keeps working."
          : undefined
      }
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" type="submit" form="tag-form" disabled={saving}>
            {saving ? "Saving…" : "Save tag"}
          </Button>
        </>
      }
    >
      <form id="tag-form" onSubmit={save} className="space-y-4">
        <Field label="Name">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Retreat waitlist"
            required
            autoFocus
          />
        </Field>
        <Field label="Colour" hint="just so it stands out in a list">
          <div className="flex flex-wrap gap-2">
            {COLOURS.map((option) => (
              <button
                key={option.value || "none"}
                type="button"
                onClick={() => setColour(option.value)}
                aria-label={option.label}
                aria-pressed={colour === option.value}
                className="flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors"
                style={{
                  borderColor: colour === option.value ? option.value || "#d4af6e" : undefined,
                }}
              >
                <span
                  aria-hidden="true"
                  className="size-3 rounded-full border border-white/20"
                  style={{ background: option.value || "transparent" }}
                />
                {option.label}
              </button>
            ))}
          </div>
        </Field>
        <Field label="What it means" hint="optional, a reminder for you">
          <Textarea
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Anyone who asked to hear about the 2027 retreat."
          />
        </Field>
      </form>
    </Modal>
  );
}

function TagPeople({ tag, onClose }: { tag: Tag | null; onClose: () => void }) {
  const [people, setPeople] = useState<SegmentPerson[] | null>(null);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    if (!tag) {
      setPeople(null);
      return;
    }
    let current = true;
    contactsApi
      .tagContacts(tag.id)
      .then((result) => {
        if (!current) return;
        setPeople(result.items);
        setTotal(result.total);
      })
      .catch(() => current && setPeople([]));
    return () => {
      current = false;
    };
  }, [tag]);

  return (
    <Modal
      open={tag !== null}
      onOpenChange={(open) => !open && onClose()}
      title={tag ? `Who has “${tag.name}”` : ""}
      description={people === null ? undefined : `${pluralize(total, "person", "people")} in total.`}
      size="lg"
      footer={
        <Button variant="secondary" size="sm" onClick={onClose}>
          Close
        </Button>
      }
    >
      {people === null ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : people.length === 0 ? (
        <p className="text-sm text-ink-soft">Nobody has this tag yet.</p>
      ) : (
        <ul className="divide-y divide-hairline/60">
          {people.map((person) => (
            <li key={person.id} className="flex flex-wrap items-center gap-3 py-3">
              <Link to={`/admin/contacts/${person.id}`} className="min-w-0 flex-1" onClick={onClose}>
                <span className="block truncate font-semibold text-ink">
                  {person.name || "No name yet"}
                </span>
                <span className="block truncate text-xs text-ink-soft">{person.email}</span>
              </Link>
              <span className="text-sm text-ink-soft">
                {person.lifetimeValueCents > 0 ? money(person.lifetimeValueCents) : "—"}
              </span>
              <Badge tone="neutral">{emailStatusLabel(person.emailMarketingStatus)}</Badge>
              <span className="w-28 shrink-0 text-right text-xs text-ink-soft">
                {orNone(
                  person.lastActivityAt ? formatRelative(person.lastActivityAt) : null,
                  "Nothing yet",
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {people !== null && total > people.length && (
        <p className="mt-3 text-xs text-ink-soft">
          Showing the first {people.length}. Open Contacts and filter by this tag to see everyone.
        </p>
      )}
    </Modal>
  );
}
