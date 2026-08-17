import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Filter, Pencil, Plus, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { motion } from "motion/react";
import { cn } from "@/lib/cn";
import { formatRelative } from "@/lib/format";
import {
  EMAIL_STATUS_LABEL,
  contactsApi,
  dollarsToCents,
  emailStatusLabel,
  money,
  type EmailStatus,
  type Segment,
  type SegmentDefinition,
  type SegmentOptions,
  type SegmentPerson,
  type SegmentRule,
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
} from "@/pages/admin/ui/primitives";
import { Modal, useConfirm } from "@/pages/admin/ui/Dialog";
import { friendlyError, orNone, pluralize } from "@/pages/admin/ui/friendly";

/**
 * Groups — a saved question about her people.
 *
 * "Everyone who bought the masterclass and hasn't been heard from since March"
 * is a sentence, and this screen is built to read as one. It is deliberately not
 * a query builder: no field names, no operators, no brackets. Each row is
 * "[what] [is/isn't] [value]", the rows are joined by "all of these" or "any of
 * these", and the count underneath updates as she goes so she can see the
 * sentence working before she saves it.
 */

/* ── The vocabulary ─────────────────────────────────────────────────────── */

type ValueInput = "tag" | "offer" | "sequence" | "money" | "number" | "date" | "text" | "status";

interface FieldSpec {
  field: string;
  /** The subject, as the first dropdown in a row reads it. */
  label: string;
  input: ValueInput;
  /** Operator → the words between the subject and the value, in a row. */
  ops: { op: string; label: string }[];
  defaultValue: string | number;
  /**
   * The same rule as a clause in a sentence.
   *
   * A row reads as three dropdowns ("A tag" / "is on them" / "Bali 2027"), and
   * a summary has to read as English ("they have the tag Bali 2027"). The two
   * are different sentences about the same rule, so the row cannot be strung
   * together to make the summary.
   */
  phrase: (op: string, value: string) => string;
}

const FIELDS: FieldSpec[] = [
  {
    field: "tag",
    label: "A tag",
    input: "tag",
    ops: [
      { op: "has", label: "is on them" },
      { op: "not_has", label: "is not on them" },
    ],
    defaultValue: "",
    phrase: (op, value) =>
      op === "has" ? `they have the tag ${value}` : `they do not have the tag ${value}`,
  },
  {
    field: "purchased_offer",
    label: "Something you sell",
    input: "offer",
    ops: [
      { op: "has", label: "they bought" },
      { op: "not_has", label: "they have not bought" },
    ],
    defaultValue: 0,
    phrase: (op, value) => (op === "has" ? `they bought ${value}` : `they never bought ${value}`),
  },
  {
    field: "in_sequence",
    label: "An email sequence",
    input: "sequence",
    ops: [
      { op: "has", label: "they are in" },
      { op: "not_has", label: "they are not in" },
    ],
    defaultValue: 0,
    phrase: (op, value) => (op === "has" ? `they are in ${value}` : `they are not in ${value}`),
  },
  {
    field: "lifetime_value_cents",
    label: "Total spent with you",
    input: "money",
    ops: [
      { op: "gt", label: "is more than" },
      { op: "lt", label: "is less than" },
      { op: "eq", label: "is exactly" },
    ],
    defaultValue: 0,
    phrase: (op, value) =>
      `they have spent ${op === "gt" ? "more than" : op === "lt" ? "less than" : "exactly"} ${value}`,
  },
  {
    field: "order_count",
    label: "Number of purchases",
    input: "number",
    ops: [
      { op: "gt", label: "is more than" },
      { op: "lt", label: "is less than" },
      { op: "eq", label: "is exactly" },
    ],
    defaultValue: 0,
    phrase: (op, value) =>
      `they have bought ${op === "gt" ? "more than" : op === "lt" ? "fewer than" : "exactly"} ${value} times`,
  },
  {
    field: "email_marketing_status",
    label: "Whether you can email them",
    input: "status",
    ops: [
      { op: "eq", label: "is" },
      { op: "neq", label: "is not" },
    ],
    defaultValue: "subscribed",
    phrase: (op, value) =>
      op === "eq" ? `their email setting is “${value}”` : `their email setting is not “${value}”`,
  },
  {
    field: "last_activity_at",
    label: "Last heard from",
    input: "date",
    ops: [
      { op: "before", label: "before" },
      { op: "after", label: "after" },
    ],
    defaultValue: "",
    phrase: (op, value) =>
      op === "before" ? `you last heard from them before ${value}` : `you heard from them after ${value}`,
  },
  {
    field: "created_at",
    label: "Added to your list",
    input: "date",
    ops: [
      { op: "before", label: "before" },
      { op: "after", label: "after" },
    ],
    defaultValue: "",
    phrase: (op, value) =>
      op === "before" ? `they joined your list before ${value}` : `they joined your list after ${value}`,
  },
  {
    field: "email",
    label: "Their email address",
    input: "text",
    ops: [
      { op: "contains", label: "contains" },
      { op: "eq", label: "is" },
      { op: "neq", label: "is not" },
    ],
    defaultValue: "",
    phrase: (op, value) =>
      `their email address ${op === "contains" ? "contains" : op === "eq" ? "is" : "is not"} ${value}`,
  },
  {
    field: "name",
    label: "Their name",
    input: "text",
    ops: [
      { op: "contains", label: "contains" },
      { op: "eq", label: "is" },
      { op: "neq", label: "is not" },
    ],
    defaultValue: "",
    phrase: (op, value) =>
      `their name ${op === "contains" ? "contains" : op === "eq" ? "is" : "is not"} ${value}`,
  },
];

function specFor(field: string): FieldSpec {
  return FIELDS.find((spec) => spec.field === field) ?? FIELDS[0];
}

const EMPTY_DEFINITION: SegmentDefinition = { match: "all", rules: [] };

/** One rule as a clause — "they bought The Masterclass". */
function describeRule(rule: SegmentRule, options: SegmentOptions | null): string {
  const spec = specFor(rule.field);

  let value = String(rule.value ?? "");
  if (spec.input === "money") value = money(Number(rule.value) || 0);
  if (spec.input === "tag") {
    value = options?.tags.find((tag) => tag.slug === rule.value)?.name ?? value;
  }
  if (spec.input === "offer") {
    value = options?.offers.find((offer) => offer.id === Number(rule.value))?.title ?? "something";
  }
  if (spec.input === "sequence") {
    value =
      options?.sequences.find((sequence) => sequence.id === Number(rule.value))?.name ?? "a sequence";
  }
  if (spec.input === "status") value = emailStatusLabel(String(rule.value));
  if (spec.input === "date" && value) value = new Date(value).toLocaleDateString("en-US");
  if (!value) value = "…";

  return spec.phrase(rule.op, value);
}

function describe(definition: SegmentDefinition, options: SegmentOptions | null): string {
  if (definition.rules.length === 0) return "Everyone on your list";
  const joiner = definition.match === "any" ? " or " : " and ";
  return `People where ${definition.rules.map((rule) => describeRule(rule, options)).join(joiner)}.`;
}

/* ── Screen ─────────────────────────────────────────────────────────────── */

export default function Segments() {
  const [segments, setSegments] = useState<Segment[] | null>(null);
  const [options, setOptions] = useState<SegmentOptions | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Partial<Segment> | null>(null);
  const [viewing, setViewing] = useState<Segment | null>(null);
  const [confirm, confirmDialog] = useConfirm();

  const load = useCallback(() => {
    contactsApi
      .segments()
      .then((list) => {
        setSegments(list);
        setError(null);
      })
      .catch(() => setError("We couldn't load your groups. Try refreshing the page."));
  }, []);

  useEffect(load, [load]);

  useEffect(() => {
    contactsApi
      .segmentOptions()
      .then(setOptions)
      .catch(() => setOptions({ tags: [], offers: [], sequences: [] }));
  }, []);

  async function remove(segment: Segment) {
    const ok = await confirm({
      title: `Delete the “${segment.name}” group?`,
      description:
        "The group goes; nobody is removed from your list and nothing they've done changes. Any email you set up to go to this group will need a new audience.",
      confirmLabel: "Yes, delete it",
      destructive: true,
    });
    if (!ok) return;
    try {
      await contactsApi.segmentDelete(segment.id);
      toast.success("Group deleted");
      load();
    } catch (err) {
      toast.error(friendlyError(err, "group"));
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Contacts"
        title="Groups"
        description="Saved questions about your people — “bought the masterclass”, “on the retreat waitlist and never bought”. A group keeps itself up to date."
        actions={
          <>
            <Button variant="secondary" size="sm" asChild>
              <Link to="/admin/contacts">
                <Users />
                All people
              </Link>
            </Button>
            <Button
              size="sm"
              onClick={() => setEditing({ name: "", description: "", definition: EMPTY_DEFINITION })}
            >
              <Plus />
              Create a group
            </Button>
          </>
        }
      />

      {error && <ErrorNotice message={error} />}

      {segments === null ? (
        <div className="grid gap-5 md:grid-cols-2">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-40 w-full" />
          ))}
        </div>
      ) : segments.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Filter />}
            title="No groups yet"
            description="Create one to hold a question you keep asking — like everyone who bought a course but hasn't been back since."
            action={
              <Button
                size="sm"
                onClick={() =>
                  setEditing({ name: "", description: "", definition: EMPTY_DEFINITION })
                }
              >
                Create a group
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid gap-5 md:grid-cols-2">
          {segments.map((segment, i) => (
            <motion.div
              key={segment.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i * 0.04, 0.3) }}
            >
              <Card className="flex h-full flex-col p-5">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="font-display text-lg leading-snug text-ink">{segment.name}</h3>
                  <Badge tone="gold">
                    {pluralize(segment.contactCount, "person", "people")}
                  </Badge>
                </div>

                {segment.description && (
                  <p className="mt-1.5 text-sm text-ink-soft">{segment.description}</p>
                )}

                <p className="mt-3 text-sm leading-relaxed text-ink-soft">
                  {describe(segment.definition, options)}
                </p>

                <p className="mt-2 text-xs text-ink-soft/80">
                  {segment.countedAt
                    ? `Counted ${formatRelative(segment.countedAt)}`
                    : "Not counted yet"}
                </p>

                <div className="mt-auto flex gap-2 pt-4">
                  <Button
                    variant="secondary"
                    size="sm"
                    className="flex-1"
                    onClick={() => setViewing(segment)}
                  >
                    See who's in it
                  </Button>
                  <Button
                    variant="secondary"
                    size="iconSm"
                    aria-label={`Edit ${segment.name}`}
                    onClick={() => setEditing(segment)}
                  >
                    <Pencil />
                  </Button>
                  <Button
                    variant="dangerGhost"
                    size="iconSm"
                    aria-label={`Delete ${segment.name}`}
                    onClick={() => remove(segment)}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </Card>
            </motion.div>
          ))}
        </div>
      )}

      <SegmentEditor
        segment={editing}
        options={options}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          load();
        }}
      />

      <SegmentPeople segment={viewing} onClose={() => setViewing(null)} />

      {confirmDialog}
    </div>
  );
}

/* ── The builder ────────────────────────────────────────────────────────── */

function SegmentEditor({
  segment,
  options,
  onClose,
  onSaved,
}: {
  segment: Partial<Segment> | null;
  options: SegmentOptions | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [definition, setDefinition] = useState<SegmentDefinition>(EMPTY_DEFINITION);
  const [preview, setPreview] = useState<{ count: number; items: SegmentPerson[] } | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!segment) return;
    setName(segment.name ?? "");
    setDescription(segment.description ?? "");
    setDefinition(segment.definition ?? EMPTY_DEFINITION);
    setPreview(null);
    setPreviewError(null);
  }, [segment]);

  // The count is the whole point of the screen, so it follows every edit —
  // debounced, because she is typing into a text box while it runs.
  useEffect(() => {
    if (!segment) return;
    const timer = setTimeout(() => {
      contactsApi
        .segmentPreview(definition)
        .then((result) => {
          setPreview(result);
          setPreviewError(null);
        })
        .catch(() => {
          setPreview(null);
          setPreviewError("One of these rows still needs filling in.");
        });
    }, 350);
    return () => clearTimeout(timer);
  }, [definition, segment]);

  function updateRule(index: number, patch: Partial<SegmentRule>) {
    setDefinition((current) => ({
      ...current,
      rules: current.rules.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)),
    }));
  }

  function addRule() {
    const spec = FIELDS[0];
    setDefinition((current) => ({
      ...current,
      rules: [...current.rules, { field: spec.field, op: spec.ops[0].op, value: spec.defaultValue }],
    }));
  }

  function removeRule(index: number) {
    setDefinition((current) => ({
      ...current,
      rules: current.rules.filter((_, i) => i !== index),
    }));
  }

  async function save() {
    if (!segment || !name.trim()) return;
    setSaving(true);
    try {
      if (segment.id) {
        await contactsApi.segmentUpdate(segment.id, {
          name: name.trim(),
          description: description.trim(),
          definition,
        });
      } else {
        await contactsApi.segmentCreate({
          name: name.trim(),
          description: description.trim(),
          definition,
        });
      }
      toast.success(segment.id ? "Group saved" : "Group created");
      onSaved();
    } catch (err) {
      toast.error(friendlyError(err, "group"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={segment !== null}
      onOpenChange={(open) => !open && onClose()}
      title={segment?.id ? "Edit this group" : "Create a group"}
      description="Describe who should be in it. The count at the bottom updates as you go."
      size="xl"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={save} disabled={saving || !name.trim()}>
            {saving ? "Saving…" : "Save group"}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name this group">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Masterclass buyers who've gone quiet"
              autoFocus
            />
          </Field>
          <Field label="What it's for" hint="optional">
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="For the win-back email"
            />
          </Field>
        </div>

        <div className="rounded-2xl border border-hairline bg-white/[0.03] p-4">
          <div className="flex flex-wrap items-center gap-2 text-sm text-ink">
            <span className="font-semibold">Include people where</span>
            <select
              value={definition.match}
              onChange={(e) =>
                setDefinition((current) => ({
                  ...current,
                  match: e.target.value === "any" ? "any" : "all",
                }))
              }
              aria-label="How the rows below fit together"
              className="h-9 rounded-lg border border-hairline bg-surface px-2.5 text-sm font-semibold text-ink outline-none focus-visible:border-plum focus-visible:ring-4 focus-visible:ring-plum/12"
            >
              <option value="all">every row below is true</option>
              <option value="any">any row below is true</option>
            </select>
          </div>

          <div className="mt-4 space-y-3">
            {definition.rules.length === 0 && (
              <p className="text-sm text-ink-soft">
                No rows yet, so this group is everyone on your list. Add a row to narrow it down.
              </p>
            )}

            {definition.rules.map((rule, index) => (
              <RuleRow
                key={index}
                rule={rule}
                options={options}
                onChange={(patch) => updateRule(index, patch)}
                onRemove={() => removeRule(index)}
              />
            ))}
          </div>

          <Button variant="secondary" size="sm" className="mt-4" onClick={addRule}>
            <Plus />
            Add a row
          </Button>
        </div>

        <div className="rounded-2xl border border-gold/40 bg-gold/[0.08] p-4">
          {previewError ? (
            <p className="text-sm text-ink">{previewError}</p>
          ) : preview === null ? (
            <Skeleton className="h-5 w-40" />
          ) : (
            <>
              <p className="font-display text-lg text-ink">
                {pluralize(preview.count, "person", "people")} in this group
              </p>
              {preview.items.length > 0 && (
                <ul className="mt-2 space-y-1 text-sm text-ink-soft">
                  {preview.items.slice(0, 6).map((person) => (
                    <li key={person.id} className="truncate">
                      {person.name || person.email}
                      {person.name ? ` — ${person.email}` : ""}
                    </li>
                  ))}
                  {preview.count > 6 && (
                    <li className="text-xs">
                      …and {pluralize(preview.count - 6, "other", "others")}.
                    </li>
                  )}
                </ul>
              )}
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}

function RuleRow({
  rule,
  options,
  onChange,
  onRemove,
}: {
  rule: SegmentRule;
  options: SegmentOptions | null;
  onChange: (patch: Partial<SegmentRule>) => void;
  onRemove: () => void;
}) {
  const spec = specFor(rule.field);
  const selectClass =
    "h-10 min-w-0 rounded-lg border border-hairline bg-surface px-2.5 text-sm text-ink outline-none focus-visible:border-plum focus-visible:ring-4 focus-visible:ring-plum/12";

  // Money is kept in the rule the way the server keeps it and shown the way she
  // thinks about it, so an integer of cents never reaches the screen.
  const moneyText = useMemo(
    () => (spec.input === "money" ? String((Number(rule.value) || 0) / 100) : ""),
    [rule.value, spec.input],
  );

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-hairline bg-surface px-3 py-2.5">
      <select
        value={rule.field}
        onChange={(e) => {
          const next = specFor(e.target.value);
          onChange({ field: next.field, op: next.ops[0].op, value: next.defaultValue });
        }}
        aria-label="What to look at"
        className={cn(selectClass, "flex-1 sm:flex-none sm:w-52")}
      >
        {FIELDS.map((option) => (
          <option key={option.field} value={option.field}>
            {option.label}
          </option>
        ))}
      </select>

      <select
        value={rule.op}
        onChange={(e) => onChange({ op: e.target.value })}
        aria-label="How to compare it"
        className={cn(selectClass, "flex-1 sm:flex-none sm:w-44")}
      >
        {spec.ops.map((option) => (
          <option key={option.op} value={option.op}>
            {option.label}
          </option>
        ))}
      </select>

      {spec.input === "tag" && (
        <select
          value={String(rule.value)}
          onChange={(e) => onChange({ value: e.target.value })}
          aria-label="Which tag"
          className={cn(selectClass, "flex-1")}
        >
          <option value="">Choose a tag…</option>
          {(options?.tags ?? []).map((tag) => (
            <option key={tag.slug} value={tag.slug}>
              {tag.name}
            </option>
          ))}
        </select>
      )}

      {spec.input === "offer" && (
        <select
          value={String(rule.value)}
          onChange={(e) => onChange({ value: Number(e.target.value) })}
          aria-label="Which thing you sell"
          className={cn(selectClass, "flex-1")}
        >
          <option value="0">Choose one…</option>
          {(options?.offers ?? []).map((offer) => (
            <option key={offer.id} value={offer.id}>
              {offer.title}
            </option>
          ))}
        </select>
      )}

      {spec.input === "sequence" && (
        <select
          value={String(rule.value)}
          onChange={(e) => onChange({ value: Number(e.target.value) })}
          aria-label="Which sequence"
          className={cn(selectClass, "flex-1")}
        >
          <option value="0">Choose one…</option>
          {(options?.sequences ?? []).map((sequence) => (
            <option key={sequence.id} value={sequence.id}>
              {sequence.name}
            </option>
          ))}
        </select>
      )}

      {spec.input === "status" && (
        <select
          value={String(rule.value)}
          onChange={(e) => onChange({ value: e.target.value })}
          aria-label="Which email state"
          className={cn(selectClass, "flex-1")}
        >
          {(Object.keys(EMAIL_STATUS_LABEL) as EmailStatus[]).map((status) => (
            <option key={status} value={status}>
              {EMAIL_STATUS_LABEL[status]}
            </option>
          ))}
        </select>
      )}

      {spec.input === "money" && (
        <div className="relative flex-1">
          <span
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-ink-soft"
          >
            $
          </span>
          <Input
            className="h-10 pl-7"
            inputMode="decimal"
            value={moneyText}
            aria-label="How much"
            onChange={(e) => onChange({ value: dollarsToCents(e.target.value) ?? 0 })}
            placeholder="497"
          />
        </div>
      )}

      {spec.input === "number" && (
        <Input
          className="h-10 flex-1"
          type="number"
          min={0}
          value={String(rule.value)}
          aria-label="How many"
          onChange={(e) => onChange({ value: Number(e.target.value) || 0 })}
        />
      )}

      {spec.input === "date" && (
        <Input
          className="h-10 flex-1"
          type="date"
          value={String(rule.value).slice(0, 10)}
          aria-label="Which date"
          onChange={(e) => onChange({ value: e.target.value })}
        />
      )}

      {spec.input === "text" && (
        <Input
          className="h-10 flex-1"
          value={String(rule.value)}
          aria-label="What to look for"
          onChange={(e) => onChange({ value: e.target.value })}
          placeholder="gmail.com"
        />
      )}

      <Button variant="dangerGhost" size="iconSm" aria-label="Remove this row" onClick={onRemove}>
        <Trash2 />
      </Button>
    </div>
  );
}

/* ── Who's in it ────────────────────────────────────────────────────────── */

function SegmentPeople({ segment, onClose }: { segment: Segment | null; onClose: () => void }) {
  const [people, setPeople] = useState<SegmentPerson[] | null>(null);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    if (!segment) {
      setPeople(null);
      return;
    }
    let current = true;
    contactsApi
      .segmentContacts(segment.id)
      .then((result) => {
        if (!current) return;
        setPeople(result.items);
        setTotal(result.total);
      })
      .catch(() => current && setPeople([]));
    return () => {
      current = false;
    };
  }, [segment]);

  return (
    <Modal
      open={segment !== null}
      onOpenChange={(open) => !open && onClose()}
      title={segment ? `Who's in “${segment.name}”` : ""}
      description={people === null ? undefined : `${pluralize(total, "person", "people")} right now.`}
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
        <p className="text-sm text-ink-soft">Nobody matches this group right now.</p>
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
    </Modal>
  );
}
