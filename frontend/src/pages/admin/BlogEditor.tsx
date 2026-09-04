import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowLeft,
  Bold,
  Heading2,
  Image as ImageIcon,
  Italic,
  Link2,
  List,
  ListOrdered,
  Pencil,
  Quote,
  Sparkles,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { adminApi } from "@/lib/api";
import type { BlogPost } from "@/types";
import type { MediaAsset } from "@/types/admin";
import { formatDate } from "@/lib/format";
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
  Skeleton,
  Textarea,
} from "@/pages/admin/ui/primitives";
import { Modal, useConfirm } from "@/pages/admin/ui/Dialog";
import { UploadDropzone } from "@/pages/admin/ui/Uploader";
import {
  friendlyError,
  pluralize,
  publishLabel,
  slugify,
  uniqueKey,
  webAddress,
  webAddressLabel,
} from "@/pages/admin/ui/friendly";

/**
 * The saved post also carries the `published` flag the public site filters on.
 * The shared BlogCard type predates that column, so the editor widens it here
 * rather than guessing "is this live?" from the date alone — a post can carry a
 * published date and still be taken down.
 */
type EditablePost = Partial<BlogPost> & { published?: boolean };

const EMPTY_POST: EditablePost = {
  title: "",
  slug: "",
  excerpt: "",
  coverImage: "",
  tags: [],
  author: "Yvette Howard, LCSW",
  bodyMd: "",
};

/* ------------------------------------------------------- Formatting toolbar */

type FormatId = "bold" | "italic" | "heading" | "bullets" | "numbers" | "link" | "quote";

/** Formats that wrap whatever is selected. */
const WRAPPERS: Record<"bold" | "italic", { marker: string; placeholder: string }> = {
  bold: { marker: "**", placeholder: "bold words" },
  italic: { marker: "_", placeholder: "italic words" },
};

/** Formats that act on whole lines. `prefix` takes the line's position so a
 *  numbered list counts up. */
const LINE_RULES: Record<
  "heading" | "bullets" | "numbers" | "quote",
  { match: RegExp; prefix: (index: number) => string }
> = {
  heading: { match: /^#{1,6}\s+/, prefix: () => "## " },
  bullets: { match: /^[-*]\s+/, prefix: () => "- " },
  numbers: { match: /^\d+\.\s+/, prefix: (index) => `${index + 1}. ` },
  quote: { match: /^>\s?/, prefix: () => "> " },
};

interface TextEdit {
  value: string;
  selectionStart: number;
  selectionEnd: number;
}

/**
 * Writes the formatting into the stored text and says where the cursor should
 * land afterwards.
 *
 * The body is still Markdown on the way to the database — that is what the
 * public site renders — but she never types a hash or an asterisk herself. Kept
 * as a plain function outside the component so the rules are readable on their
 * own.
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
  { id: "quote", label: "Quote", Icon: Quote },
];

/** Roughly 200 words a minute — fills the box so she never has to guess. */
function estimateReadMinutes(body: string): number {
  return Math.max(1, Math.round(countWords(body) / 200));
}

function countWords(body: string): number {
  const trimmed = body.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

/* ------------------------------------------------------------------ Editor */

export default function BlogEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isNew = !id || id === "new";

  const [form, setForm] = useState<EditablePost>(EMPTY_POST);
  const [tagsInput, setTagsInput] = useState("");
  // Kept as text so she can clear the box; a blank one means "work it out for me".
  const [readInput, setReadInput] = useState("");
  const [loading, setLoading] = useState(!isNew);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [topic, setTopic] = useState("");
  const [preview, setPreview] = useState(false);
  const [picking, setPicking] = useState(false);
  const [confirm, confirmDialog] = useConfirm();
  // Addresses already in use, so two posts called "Welcome" don't fight over one.
  const [takenAddresses, setTakenAddresses] = useState<string[]>([]);
  // True once the address is hers rather than ours: either she typed it, or the
  // post is already saved and must keep the address it was published under.
  const [addressChosen, setAddressChosen] = useState(false);
  const [editingAddress, setEditingAddress] = useState(false);
  const [addressDraft, setAddressDraft] = useState("");

  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const pendingSelection = useRef<[number, number] | null>(null);

  useEffect(() => {
    let cancelled = false;
    adminApi
      .blogList()
      .then((posts) => {
        if (cancelled) return;
        // The route carries the id as text while the saved id is a number, so
        // the two only match when both are compared as text.
        const found = isNew ? undefined : posts.find((post) => String(post.id) === String(id));
        setTakenAddresses(
          posts.filter((post) => String(post.id) !== String(id)).map((post) => post.slug),
        );
        if (found) {
          setForm(found);
          setTagsInput(found.tags.join(", "));
          setReadInput(found.readMinutes ? String(found.readMinutes) : "");
          setAddressChosen(true);
        } else if (!isNew) {
          setLoadError("We can't find that post — it may have been deleted.");
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // On a brand new post this request only feeds the duplicate-address
        // check, so a failure costs her nothing and shouldn't block writing.
        if (!isNew) setLoadError(friendlyError(err, "post"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id, isNew]);

  // A controlled textarea puts the caret back at the end after every re-render,
  // which would throw her cursor to the bottom of the article each time she used
  // the toolbar. Restore the selection once React has committed the new text.
  useLayoutEffect(() => {
    const range = pendingSelection.current;
    const el = bodyRef.current;
    if (!range || !el) return;
    pendingSelection.current = null;
    el.focus();
    el.setSelectionRange(range[0], range[1]);
  });

  const updateField = useCallback(<K extends keyof EditablePost>(key: K, value: EditablePost[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  }, []);

  const body = form.bodyMd ?? "";
  const words = useMemo(() => countWords(body), [body]);

  // What the post's address will be: her own once she has chosen one, otherwise
  // derived from the title as she types.
  const address = useMemo(() => {
    // An address that is already hers is used exactly as it stands. Cleaning it
    // again could shorten it — `slugify` caps the length — and silently move a
    // post people have already been sent the link to. Only the title, which is
    // hers to type freely, gets turned into an address here; an address she
    // types herself is cleaned once as she leaves the box.
    const base = addressChosen ? (form.slug ?? "") : slugify(form.title ?? "");
    return base ? uniqueKey(base, takenAddresses, "-") : "";
  }, [addressChosen, form.slug, form.title, takenAddresses]);

  const isLive = form.published ?? Boolean(form.publishedAt);

  function toggleLive(next: boolean) {
    setForm((prev) => ({
      ...prev,
      published: next,
      // Keep the original date when a post comes down, so putting it back up
      // doesn't make an old article look brand new.
      publishedAt: next ? prev.publishedAt || new Date().toISOString() : prev.publishedAt,
    }));
  }

  function runFormat(id: FormatId) {
    const el = bodyRef.current;
    if (!el) return;
    const edit = applyFormat(id, el.value, el.selectionStart, el.selectionEnd);
    pendingSelection.current = [edit.selectionStart, edit.selectionEnd];
    updateField("bodyMd", edit.value);
  }

  function openAddressEditor() {
    setAddressDraft(address);
    setEditingAddress(true);
  }

  function commitAddress() {
    const cleaned = slugify(addressDraft);
    if (cleaned) {
      setForm((prev) => ({ ...prev, slug: cleaned }));
      setAddressChosen(true);
    } else {
      // An address she has emptied would leave the post unreachable, so fall
      // back to building one from the title again.
      setAddressChosen(false);
    }
    setEditingAddress(false);
  }

  async function handleGenerate() {
    if (!topic.trim()) return;
    // It replaces the title, the summary and the whole body. Doing that to an
    // article she has already written, with nothing saved and nothing to undo,
    // needs asking first.
    if (
      (form.bodyMd ?? "").trim() &&
      !(await confirm({
        title: "Replace what you've written?",
        description: "The draft you have now will be written over.",
        confirmLabel: "Yes, write a new draft",
        destructive: true,
      }))
    ) {
      return;
    }
    setGenerating(true);
    try {
      const result = await adminApi.generateBlog(topic.trim());
      // Read before the form is touched: a reply without tags used to throw
      // here, after her article had already been replaced.
      const tags = (result.tags ?? []).join(", ");
      setForm((prev) => ({ ...prev, ...result }));
      setTagsInput(tags);
      toast.success("Here's a first draft — change anything you like.");
    } catch {
      toast.error("We couldn't write a draft just now. Please try again in a moment.");
    } finally {
      setGenerating(false);
    }
  }

  async function handleSave() {
    const title = (form.title ?? "").trim();
    if (!title) {
      setTitleError("Give your post a title — it's the first thing people read.");
      return;
    }
    setTitleError(null);
    setSaving(true);

    const typedMinutes = Number(readInput.trim());
    const payload: EditablePost = {
      ...form,
      title,
      slug: address || slugify(title) || "post",
      bodyMd: body,
      tags: tagsInput
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
      // A blank or nonsense reading time would be rejected outright, so fill it
      // in from the length of what she's written instead of bouncing her back.
      readMinutes:
        Number.isFinite(typedMinutes) && typedMinutes >= 1
          ? Math.round(typedMinutes)
          : estimateReadMinutes(body),
    };

    try {
      if (isNew) {
        const created = await adminApi.blogCreate(payload);
        toast.success("Your post is saved.");
        navigate(`/admin/blog/${created.id}`, { replace: true });
      } else if (id) {
        await adminApi.blogUpdate(id, payload);
        toast.success("Your post is saved.");
      }
    } catch (err) {
      toast.error(friendlyError(err, "post"));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-72" />
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_21rem]">
          <div className="space-y-6">
            <Skeleton className="h-52 w-full" />
            <Skeleton className="h-[26rem] w-full" />
          </div>
          <div className="space-y-6">
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-52 w-full" />
          </div>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="space-y-6">
        <PageHeader
          eyebrow="Blog"
          title="Your post"
          actions={
            <Button asChild variant="secondary" size="sm">
              <Link to="/admin/blog">
                <ArrowLeft />
                All posts
              </Link>
            </Button>
          }
        />
        <ErrorNotice message={loadError} />
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-16">
      <PageHeader
        eyebrow="Blog"
        title={isNew ? "Write a new post" : form.title || "Your post"}
        description="Write it, choose a picture, then turn it on when you're happy for people to read it."
        actions={
          <>
            <Badge tone={isLive ? "green" : "slate"}>{publishLabel(isLive)}</Badge>
            <Button asChild variant="secondary" size="sm">
              <Link to="/admin/blog">
                <ArrowLeft />
                All posts
              </Link>
            </Button>
            <Button size="sm" onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </>
        }
      />

      <Card>
        <CardHeader
          icon={<Sparkles />}
          title="Need a starting point?"
          subtitle="Draft a post with AI — you can edit everything after."
        />
        <div className="p-5">
          <Field label="What should this post be about?" htmlFor="post-topic">
            <div className="flex flex-wrap gap-3">
              <Input
                id="post-topic"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="Raising your rates without losing clients"
                className="min-w-0 flex-1 sm:min-w-[18rem]"
              />
              <Button
                variant="secondary"
                onClick={handleGenerate}
                disabled={generating || !topic.trim()}
              >
                {generating ? "Writing…" : "Write me a first draft"}
              </Button>
            </div>
          </Field>
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Title and summary" />
            <div className="space-y-4 p-5">
              <Field label="Title" error={titleError ?? undefined} htmlFor="post-title">
                <Input
                  id="post-title"
                  value={form.title ?? ""}
                  onChange={(e) => updateField("title", e.target.value)}
                  placeholder="Raising your rates without losing clients"
                />
              </Field>

              {editingAddress ? (
                <div className="rounded-xl border border-hairline bg-white/[0.03] p-4">
                  <Field
                    label="Web address"
                    hint="the last part is the bit you choose"
                    htmlFor="post-address"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="shrink-0 text-xs text-ink-soft">
                        {webAddress("blog", "")}/
                      </span>
                      <Input
                        id="post-address"
                        value={addressDraft}
                        onChange={(e) => setAddressDraft(e.target.value)}
                        placeholder="raising-your-rates"
                        className="min-w-0 flex-1"
                      />
                      <Button variant="secondary" size="sm" onClick={commitAddress}>
                        Done
                      </Button>
                    </div>
                  </Field>
                  {!isNew && (
                    <p className="mt-2 text-xs text-gold/90">
                      Changing this breaks any link you've already shared.
                    </p>
                  )}
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <p className="min-w-0 truncate text-xs text-ink-soft">
                    {address
                      ? webAddressLabel("blog", address)
                      : "Web address: add a title and we'll make one for you."}
                  </p>
                  <Button variant="ghost" size="sm" onClick={openAddressEditor}>
                    <Pencil />
                    Edit
                  </Button>
                </div>
              )}

              <Field label="Short summary" hint="shown in your blog list" htmlFor="post-summary">
                <Textarea
                  id="post-summary"
                  rows={3}
                  value={form.excerpt ?? ""}
                  onChange={(e) => updateField("excerpt", e.target.value)}
                  placeholder="A line or two about what someone will get from reading this."
                />
              </Field>
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Body"
              subtitle={words ? pluralize(words, "word") : "The article itself."}
              action={
                <div className="flex items-center gap-1 rounded-xl border border-hairline bg-white/[0.04] p-1">
                  <Button
                    variant={preview ? "ghost" : "secondary"}
                    size="sm"
                    onClick={() => setPreview(false)}
                  >
                    Write
                  </Button>
                  <Button
                    variant={preview ? "secondary" : "ghost"}
                    size="sm"
                    onClick={() => setPreview(true)}
                  >
                    See how it looks
                  </Button>
                </div>
              }
            />
            <div className="p-5">
              {preview ? (
                <div className="prose-boss min-h-[26rem] rounded-xl border border-hairline bg-white/[0.03] p-5">
                  {body.trim() ? (
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
                  ) : (
                    <p className="text-sm text-ink-soft">
                      Nothing written yet — switch to Write and start your post.
                    </p>
                  )}
                </div>
              ) : (
                <>
                  <div className="mb-2 flex flex-wrap items-center gap-1 rounded-xl border border-hairline bg-white/[0.04] p-1">
                    {TOOLBAR.map(({ id: formatId, label, Icon }) => (
                      <Button
                        key={formatId}
                        variant="ghost"
                        size="iconSm"
                        title={label}
                        aria-label={label}
                        onClick={() => runFormat(formatId)}
                      >
                        <Icon />
                      </Button>
                    ))}
                  </div>
                  <Textarea
                    ref={bodyRef}
                    id="post-body"
                    rows={20}
                    value={body}
                    onChange={(e) => updateField("bodyMd", e.target.value)}
                    placeholder="Start writing here. Highlight a few words and use the buttons above to make them bold, turn them into a heading, or add a link."
                    className="leading-[1.8]"
                  />
                  <p className="mt-2 text-xs text-ink-soft">
                    Use the buttons above to format your writing — press “See how it looks” to check
                    it the way your readers will.
                  </p>
                </>
              )}
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="On your site" />
            <div className="space-y-3 p-5">
              <label className="flex cursor-pointer items-start gap-2.5 text-sm font-medium text-ink">
                <input
                  type="checkbox"
                  checked={isLive}
                  onChange={(e) => toggleLive(e.target.checked)}
                  className="mt-0.5 size-4 rounded border-hairline text-plum focus-visible:ring-plum/30"
                />
                <span>
                  Live on your site
                  <span className="mt-0.5 block text-xs font-normal text-ink-soft">
                    {isLive
                      ? "Anyone can read this post."
                      : "Only you can see it until you tick this."}
                  </span>
                </span>
              </label>
              {isLive && form.publishedAt && (
                <p className="text-xs text-ink-soft">
                  First published {formatDate(form.publishedAt)}
                </p>
              )}
              <p className="text-xs text-ink-soft">
                {isNew
                  ? "Nothing is saved until you press Save."
                  : "Remember to press Save when you're done."}
              </p>
            </div>
          </Card>

          <Card>
            <CardHeader icon={<ImageIcon />} title="Cover image" />
            <div className="space-y-3 p-5">
              {form.coverImage ? (
                <>
                  <img
                    src={form.coverImage}
                    alt=""
                    className="aspect-[16/9] w-full rounded-xl border border-hairline object-cover"
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button variant="secondary" size="sm" onClick={() => setPicking(true)}>
                      Replace
                    </Button>
                    <Button
                      variant="dangerGhost"
                      size="sm"
                      onClick={() => updateField("coverImage", "")}
                    >
                      <Trash2 />
                      Remove
                    </Button>
                  </div>
                </>
              ) : (
                <Button variant="secondary" size="sm" onClick={() => setPicking(true)}>
                  Choose an image
                </Button>
              )}
              <p className="text-xs text-ink-soft">
                Shown at the top of the post and beside it in your blog list. A landscape picture
                works best — around 1200 by 630 pixels.
              </p>
            </div>
          </Card>

          <Card>
            <CardHeader title="Post details" />
            <div className="space-y-4 p-5">
              <Field label="Written by" htmlFor="post-author">
                <Input
                  id="post-author"
                  value={form.author ?? ""}
                  onChange={(e) => updateField("author", e.target.value)}
                />
              </Field>
              <Field
                label="Topics"
                hint="separate each one with a comma"
                htmlFor="post-topics"
              >
                <Input
                  id="post-topics"
                  value={tagsInput}
                  onChange={(e) => setTagsInput(e.target.value)}
                  placeholder="pricing, private practice"
                />
              </Field>
              <Field
                label="Estimated reading time"
                hint="in minutes — leave it blank and we'll work it out"
                htmlFor="post-minutes"
              >
                <Input
                  id="post-minutes"
                  type="number"
                  min={1}
                  value={readInput}
                  onChange={(e) => setReadInput(e.target.value)}
                  placeholder={String(estimateReadMinutes(body))}
                />
              </Field>
            </div>
          </Card>
        </div>
      </div>

      <ImagePickerModal
        open={picking}
        onOpenChange={setPicking}
        onSelect={(asset) => {
          updateField("coverImage", asset.url);
          setPicking(false);
        }}
      />

      {confirmDialog}
    </div>
  );
}

/* ------------------------------------------------------------ Image picker */

/**
 * Replaces the old "paste a file path" box: she either picks a picture she has
 * already uploaded or drops a new one in, and never sees where it lives.
 */
function ImagePickerModal({
  open,
  onOpenChange,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (asset: MediaAsset) => void;
}) {
  const [assets, setAssets] = useState<MediaAsset[] | null>(null);

  const load = useCallback(() => {
      // Buyers-only files are left out: they have no web address, so their
      // tile is blank, and choosing one makes a save the server will always
      // refuse — a picture nobody can see is never the picture she wanted.
    adminApi
      .mediaList("image")
      .then((all) => setAssets(all.filter((asset) => asset.visibility !== "protected")))
      .catch(() => setAssets([]));
  }, []);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Choose a picture"
      description="Pick one you've used before, or add a new one from your computer."
      size="xl"
    >
      <div className="space-y-5">
        <UploadDropzone
          compact
          accept="image/*"
          scope="blog-image-picker"
          onUploaded={(asset) => setAssets((prev) => (prev ? [asset, ...prev] : [asset]))}
        />

        {assets === null ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="aspect-[16/9] w-full" />
            ))}
          </div>
        ) : assets.length === 0 ? (
          <EmptyState
            icon={<ImageIcon />}
            title="No pictures yet"
            description="Drop one in above and it'll be here next time too."
          />
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {assets.map((asset) => (
              <button
                key={asset.id}
                type="button"
                onClick={() => onSelect(asset)}
                className="group overflow-hidden rounded-xl border border-hairline text-left transition-all hover:border-plum hover:shadow-[0_12px_28px_-14px_rgba(15,30,58,0.4)]"
              >
                <img
                  src={asset.previewUrl}
                  alt={asset.title || asset.originalName}
                  loading="lazy"
                  className="aspect-[16/9] w-full bg-white/[0.04] object-cover"
                />
                <span className="block truncate px-3 py-2 text-xs text-ink-soft">
                  {asset.title || asset.originalName}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
