import { useNewProductRequest } from "./ui/useNewProductRequest";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Bold,
  Heading2,
  Italic,
  Link2,
  List,
  ListOrdered,
  Mail,
  Plus,
  Send,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { adminApi } from "@/lib/api";
import type { Newsletter, NewsletterIssue, Plan } from "@/types/admin";
import { cn } from "@/lib/cn";
import { formatDateTime } from "@/lib/format";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorNotice,
  Field,
  Input,
  PageHeader,
  selectStyles,
  Skeleton,
  Textarea,
  type BadgeProps,
} from "@/pages/admin/ui/primitives";
import { Modal, useConfirm } from "@/pages/admin/ui/Dialog";
import {
  friendlyError,
  humanizeKey,
  orNone,
  pluralize,
  slugify,
  uniqueKey,
} from "@/pages/admin/ui/friendly";

const STATUS_TONE: Record<string, NonNullable<BadgeProps["tone"]>> = {
  draft: "slate",
  scheduled: "gold",
  sent: "green",
};

/**
 * Stored status → what she'd say about it. "Draft" is a publishing word she
 * knows, but "Not sent yet" answers the only question she's actually asking
 * when she looks down this list.
 */
const STATUS_LABEL: Record<string, string> = {
  draft: "Not sent yet",
  scheduled: "Scheduled",
  sent: "Sent",
};

/* --------------------------------------------------- Writing box + toolbar */

type FormatId = "bold" | "italic" | "heading" | "bullets" | "numbers" | "link";

/** Formats that wrap whatever is selected. */
const WRAPPERS: Record<"bold" | "italic", { marker: string; placeholder: string }> = {
  bold: { marker: "**", placeholder: "bold words" },
  italic: { marker: "_", placeholder: "italic words" },
};

/** Formats that act on whole lines; a numbered list needs the line's position. */
const LINE_RULES: Record<
  "heading" | "bullets" | "numbers",
  { match: RegExp; prefix: (index: number) => string }
> = {
  heading: { match: /^#{1,6}\s+/, prefix: () => "## " },
  bullets: { match: /^[-*]\s+/, prefix: () => "- " },
  numbers: { match: /^\d+\.\s+/, prefix: (index) => `${index + 1}. ` },
};

interface TextEdit {
  value: string;
  selectionStart: number;
  selectionEnd: number;
}

/**
 * Writes the formatting into the stored text and says where the cursor should
 * land afterwards. The message is still Markdown on its way to the mailer —
 * that's what turns it into a formatted email — but she never types the syntax.
 *
 * Same rules as the blog editor's toolbar, deliberately: every writing box in
 * the dashboard should behave the same. It lives per screen only because the
 * shared UI kit doesn't carry a writing box yet.
 */
function applyFormat(id: FormatId, value: string, start: number, end: number): TextEdit {
  if (id === "bold" || id === "italic") {
    const { marker, placeholder } = WRAPPERS[id];
    // With nothing selected we drop in an example and select it, so her next
    // keystroke replaces it instead of leaving stray marks behind.
    const selected = value.slice(start, end) || placeholder;
    const inserted = `${marker}${selected}${marker}`;
    return {
      value: value.slice(0, start) + inserted + value.slice(end),
      selectionStart: start + marker.length,
      selectionEnd: start + marker.length + selected.length,
    };
  }

  if (id === "link") {
    const text = value.slice(start, end) || "the words people click";
    const href = "https://";
    const inserted = `[${text}](${href})`;
    // Leave the address half selected: pasting the link is the very next thing
    // she'll want to do.
    const hrefStart = start + text.length + "[](".length;
    return {
      value: value.slice(0, start) + inserted + value.slice(end),
      selectionStart: hrefStart,
      selectionEnd: hrefStart + href.length,
    };
  }

  // The rest change whole lines, so grow the range to cover every line the
  // selection touches before rewriting them.
  const lineStart = start === 0 ? 0 : value.lastIndexOf("\n", start - 1) + 1;
  const nextBreak = value.indexOf("\n", end);
  const lineEnd = nextBreak === -1 ? value.length : nextBreak;

  const rule = LINE_RULES[id];
  const lines = value.slice(lineStart, lineEnd).split("\n");
  // Pressing the same button again takes the formatting off, the way the list
  // button in a word processor does.
  const alreadyApplied = lines.every((line) => rule.match.test(line));
  const rewritten = lines
    .map((line, index) => {
      const bare = line.replace(rule.match, "");
      return alreadyApplied ? bare : rule.prefix(index) + bare;
    })
    .join("\n");

  return {
    value: value.slice(0, lineStart) + rewritten + value.slice(lineEnd),
    selectionStart: lineStart,
    selectionEnd: lineStart + rewritten.length,
  };
}

const TOOLBAR: { id: FormatId; label: string; Icon: LucideIcon }[] = [
  { id: "bold", label: "Bold", Icon: Bold },
  { id: "italic", label: "Italic", Icon: Italic },
  { id: "heading", label: "Heading", Icon: Heading2 },
  { id: "bullets", label: "Bulleted list", Icon: List },
  { id: "numbers", label: "Numbered list", Icon: ListOrdered },
  { id: "link", label: "Add a link", Icon: Link2 },
];

function BodyEditor({
  value,
  onChange,
  rows = 12,
  placeholder,
}: {
  value: string;
  onChange: (next: string) => void;
  rows?: number;
  placeholder?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const pendingSelection = useRef<[number, number] | null>(null);
  const [preview, setPreview] = useState(false);

  // A controlled textarea puts the caret back at the end after every re-render,
  // which would throw her cursor to the bottom each time she used the toolbar.
  useLayoutEffect(() => {
    const range = pendingSelection.current;
    const el = ref.current;
    if (!range || !el) return;
    pendingSelection.current = null;
    el.focus();
    el.setSelectionRange(range[0], range[1]);
  });

  function runFormat(id: FormatId) {
    const el = ref.current;
    if (!el) return;
    const edit = applyFormat(id, el.value, el.selectionStart, el.selectionEnd);
    pendingSelection.current = [edit.selectionStart, edit.selectionEnd];
    onChange(edit.value);
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1 rounded-xl border border-hairline bg-white/[0.04] p-1">
        {!preview &&
          TOOLBAR.map(({ id, label, Icon }) => (
            <Button
              key={id}
              type="button"
              variant="ghost"
              size="iconSm"
              title={label}
              aria-label={label}
              onClick={() => runFormat(id)}
            >
              <Icon />
            </Button>
          ))}
        <div className="ml-auto flex items-center gap-1">
          <Button
            type="button"
            variant={preview ? "ghost" : "secondary"}
            size="sm"
            onClick={() => setPreview(false)}
          >
            Write
          </Button>
          <Button
            type="button"
            variant={preview ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setPreview(true)}
          >
            See how it looks
          </Button>
        </div>
      </div>

      {preview ? (
        <div className="prose-boss min-h-[14rem] rounded-xl border border-hairline bg-white/[0.03] p-4">
          {value.trim() ? (
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{value}</ReactMarkdown>
          ) : (
            <p className="text-sm text-ink-soft">
              Nothing written yet — switch to Write and start typing.
            </p>
          )}
        </div>
      ) : (
        <Textarea
          ref={ref}
          rows={rows}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ Screen */

export default function Newsletters() {
  const [newsletters, setNewsletters] = useState<Newsletter[] | null>(null);
  const [active, setActive] = useState<Newsletter | null>(null);
  const [editions, setEditions] = useState<NewsletterIssue[] | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [nlDraft, setNlDraft] = useState<Partial<Newsletter> | null>(null);
  useNewProductRequest(() => setNlDraft({ access: "free", published: true }));
  const [editionDraft, setEditionDraft] = useState<Partial<NewsletterIssue> | null>(null);
  const [confirm, confirmDialog] = useConfirm();

  const load = useCallback(() => {
    adminApi
      .growthList<Newsletter>("newsletters")
      .then((list) => {
        setNewsletters(list);
        // Matched by id, not kept wholesale: holding the pre-save object meant
        // the send warning still described the audience she had just changed.
        setActive((prev) => (prev ? (list.find((n) => n.id === prev.id) ?? list[0]) : list[0]) ?? null);
      })
      .catch(() => setError("We couldn't load your newsletters. Try refreshing the page."));
  }, []);

  useEffect(load, [load]);
  useEffect(() => {
    adminApi.plans().then(setPlans).catch(() => undefined);
  }, []);

  const loadEditions = useCallback((id: number) => {
    setEditions(null);
    adminApi.newsletterIssues(id).then(setEditions).catch(() => setEditions([]));
  }, []);

  useEffect(() => {
    if (active) loadEditions(active.id);
  }, [active, loadEditions]);

  async function saveNewsletter(e: FormEvent) {
    e.preventDefault();
    if (!nlDraft?.name?.trim()) return;
    // "Paying members only" with no plan behind it does not restrict anything:
    // the send falls back to every subscriber on the list, while the send
    // warning promises it only reaches the people paying.
    if (nlDraft.access === "paid" && !nlDraft.planId) {
      toast.error("Choose which paid plan unlocks this newsletter.");
      return;
    }
    // The web address is derived from the name and never shown; an existing
    // newsletter keeps the one it already has.
    const takenAddresses = (newsletters ?? [])
      .filter((n) => n.id !== nlDraft.id)
      .map((n) => n.slug);
    const payload = {
      ...nlDraft,
      // `|| "newsletter"` covers a name that leaves nothing behind once it's
      // cleaned up, which would otherwise give it a blank address.
      slug:
        nlDraft.slug || uniqueKey(slugify(nlDraft.name) || "newsletter", takenAddresses, "-"),
    };
    try {
      if (nlDraft.id) await adminApi.growthUpdate("newsletters", nlDraft.id, payload);
      else await adminApi.growthCreate("newsletters", payload);
      toast.success("Newsletter saved");
      setNlDraft(null);
      load();
    } catch (err) {
      toast.error(friendlyError(err, "newsletter"));
    }
  }

  async function saveEdition(e: FormEvent) {
    e.preventDefault();
    if (!editionDraft?.subject?.trim() || !active) return;
    try {
      if (editionDraft.id) await adminApi.growthUpdate("issues", editionDraft.id, editionDraft);
      else await adminApi.growthCreate("issues", { ...editionDraft, newsletterId: active.id });
      toast.success("Edition saved");
      setEditionDraft(null);
      loadEditions(active.id);
    } catch (err) {
      toast.error(friendlyError(err, "edition"));
    }
  }

  async function send(edition: NewsletterIssue) {
    const paid = active?.access === "paid";
    const ok = await confirm({
      title: `Send “${edition.subject}”?`,
      description: paid
        ? "This goes to everyone paying for the plan you linked. Once it's gone you can't take it back."
        : "This goes to everyone on your list. Once it's gone you can't take it back.",
      confirmLabel: "Send it now",
    });
    if (!ok || !active) return;

    try {
      const result = await adminApi.issueSend(edition.id);
      toast.success(
        `Sending to ${pluralize(result.recipients, "person", "people")} — this takes a few minutes.`,
      );
      loadEditions(active.id);
    } catch (err) {
      toast.error(friendlyError(err, "edition"));
    }
  }

  async function remove(edition: NewsletterIssue) {
    const ok = await confirm({
      title: `Delete “${edition.subject}”?`,
      confirmLabel: "Yes, delete it",
      destructive: true,
    });
    if (!ok || !active) return;
    try {
      await adminApi.growthDelete("issues", edition.id);
      toast.success("Edition deleted");
      loadEditions(active.id);
    } catch (err) {
      toast.error(friendlyError(err, "edition"));
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Products"
        title="Newsletters"
        description="Write to your list on a regular rhythm. A newsletter can be free for everyone, or only for people paying for one of your plans."
        actions={
          <Button size="sm" onClick={() => setNlDraft({ access: "free", published: true })}>
            <Plus />
            New newsletter
          </Button>
        }
      />

      {error && <ErrorNotice message={error} />}

      {newsletters === null ? (
        <Skeleton className="h-64 w-full" />
      ) : newsletters.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Mail />}
            title="No newsletters yet"
            description="Set one up, then write your first edition and send it to your list."
            action={
              <Button size="sm" onClick={() => setNlDraft({ access: "free", published: true })}>
                Create a newsletter
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[17rem_minmax(0,1fr)]">
          <Card className="h-fit">
            <CardHeader title="Your newsletters" />
            <ul className="space-y-0.5 p-2">
              {newsletters.map((nl) => (
                <li key={nl.id}>
                  <button
                    type="button"
                    onClick={() => setActive(nl)}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm transition-colors",
                      active?.id === nl.id
                        ? "bg-lilac-tint font-semibold text-plum-deep"
                        : "text-ink-soft hover:bg-cream",
                    )}
                  >
                    <Mail className="size-4 shrink-0 opacity-60" />
                    <span className="min-w-0 flex-1 truncate">{nl.name}</span>
                    {nl.access === "paid" && (
                      <span className="shrink-0 text-[0.6rem] font-bold uppercase text-gold-muted">
                        Paid
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <CardHeader
              title={active ? `${active.name} — editions` : "Editions"}
              subtitle={active?.description}
              action={
                <div className="flex gap-2">
                  {active && (
                    <Button variant="secondary" size="sm" onClick={() => setNlDraft(active)}>
                      Edit this newsletter
                    </Button>
                  )}
                  <Button
                    size="sm"
                    disabled={!active}
                    onClick={() => setEditionDraft({ status: "draft" })}
                  >
                    <Plus />
                    New edition
                  </Button>
                </div>
              }
            />
            {editions === null ? (
              <div className="space-y-2 p-5">
                {Array.from({ length: 3 }, (_, i) => (
                  <Skeleton key={i} className="h-14 w-full" />
                ))}
              </div>
            ) : editions.length === 0 ? (
              <EmptyState
                icon={<Mail />}
                title="Nothing written yet"
                description="Start your first edition — you can save it and come back before you send."
              />
            ) : (
              <ul className="divide-y divide-hairline/60">
                {editions.map((edition) => (
                  <li key={edition.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                    <button
                      type="button"
                      onClick={() => setEditionDraft(edition)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <span className="block truncate font-semibold text-ink">
                        {edition.subject}
                      </span>
                      <span className="block truncate text-xs text-ink-soft">
                        {edition.status === "sent"
                          ? `Sent ${orNone(
                              formatDateTime(edition.sentAt),
                              "recently",
                            )} to ${pluralize(edition.recipientCount, "person", "people")}`
                          : edition.previewText || "Still writing this one"}
                      </span>
                    </button>
                    <Badge tone={STATUS_TONE[edition.status] ?? "neutral"}>
                      {STATUS_LABEL[edition.status] ?? humanizeKey(edition.status)}
                    </Badge>
                    {edition.status !== "sent" && (
                      <Button size="sm" onClick={() => send(edition)}>
                        <Send />
                        Send
                      </Button>
                    )}
                    <Button
                      variant="dangerGhost"
                      size="iconSm"
                      aria-label={`Delete ${edition.subject}`}
                      onClick={() => remove(edition)}
                    >
                      <Trash2 />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}

      <Modal
        open={nlDraft !== null}
        onOpenChange={(open) => !open && setNlDraft(null)}
        title={nlDraft?.id ? "Edit newsletter" : "New newsletter"}
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setNlDraft(null)}>
              Cancel
            </Button>
            <Button size="sm" type="submit" form="nl-form">
              Save
            </Button>
          </>
        }
      >
        {nlDraft && (
          <form id="nl-form" onSubmit={saveNewsletter} className="space-y-4">
            <Field label="Newsletter name">
              <Input
                value={nlDraft.name ?? ""}
                onChange={(e) => setNlDraft((d) => ({ ...d, name: e.target.value }))}
                placeholder="The Thursday Note"
                required
                autoFocus
              />
            </Field>
            <Field label="What's it about?" hint="a line about what people get">
              <Textarea
                rows={2}
                value={nlDraft.description ?? ""}
                onChange={(e) => setNlDraft((d) => ({ ...d, description: e.target.value }))}
              />
            </Field>
            <Field label="Who is this for?">
              <select
                value={nlDraft.access ?? "free"}
                onChange={(e) => setNlDraft((d) => ({ ...d, access: e.target.value }))}
                className={selectStyles}
              >
                <option value="free">Everyone on my list</option>
                <option value="paid">Paying members only</option>
              </select>
            </Field>
            {nlDraft.access === "paid" && (
              <Field
                label="Which paid plan unlocks this?"
                hint="only people paying for this plan get these editions"
              >
                <select
                  value={String(nlDraft.planId ?? "")}
                  onChange={(e) =>
                    setNlDraft((d) => ({
                      ...d,
                      planId: e.target.value ? Number(e.target.value) : null,
                    }))
                  }
                  className={selectStyles}
                >
                  <option value="">Choose a plan…</option>
                  {plans.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
          </form>
        )}
      </Modal>

      <Modal
        open={editionDraft !== null}
        onOpenChange={(open) => !open && setEditionDraft(null)}
        title={editionDraft?.id ? "Edit edition" : "New edition"}
        size="lg"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setEditionDraft(null)}>
              Cancel
            </Button>
            <Button size="sm" type="submit" form="edition-form">
              Save edition
            </Button>
          </>
        }
      >
        {editionDraft && (
          <form id="edition-form" onSubmit={saveEdition} className="space-y-4">
            <Field label="Subject line" hint="what people see in their inbox">
              <Input
                value={editionDraft.subject ?? ""}
                onChange={(e) => setEditionDraft((d) => ({ ...d, subject: e.target.value }))}
                placeholder="Three things I'd do differently"
                required
                autoFocus
              />
            </Field>
            <Field
              label="Preview line"
              hint="the grey line under the subject in their inbox"
            >
              <Input
                value={editionDraft.previewText ?? ""}
                onChange={(e) => setEditionDraft((d) => ({ ...d, previewText: e.target.value }))}
              />
            </Field>
            <Field label="Your message">
              <BodyEditor
                value={editionDraft.bodyMd ?? ""}
                onChange={(next) => setEditionDraft((d) => ({ ...d, bodyMd: next }))}
                placeholder={"Hi there,\n\nHere's what I've been thinking about this week…"}
              />
            </Field>
          </form>
        )}
      </Modal>

      {confirmDialog}
    </div>
  );
}
