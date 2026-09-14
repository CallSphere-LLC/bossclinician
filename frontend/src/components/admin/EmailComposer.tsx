import { publicSiteUrl } from "@/lib/siteOrigins";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Bold,
  Copy,
  Heading2,
  Image,
  Italic,
  LayoutTemplate,
  Link2,
  List,
  ListOrdered,
  Minus,
  Monitor,
  MousePointerClick,
  Pencil,
  Pilcrow,
  Save,
  Smartphone,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { Button, Textarea, selectStyles } from "@/pages/admin/ui/primitives";
import MediaPickerDialog from "@/components/admin/MediaPickerDialog";
import type { MediaAsset, MergeTag, SavedEmailTemplate } from "@/types/admin";
import { adminApi } from "@/lib/api";
import { toast } from "sonner";
import { cn } from "@/lib/cn";

type FormatId = "bold" | "italic" | "heading" | "bullets" | "numbers" | "link";

const WRAPPERS: Record<"bold" | "italic", { marker: string; placeholder: string }> = {
  bold: { marker: "**", placeholder: "bold words" },
  italic: { marker: "_", placeholder: "italic words" },
};

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

export function applyEmailFormat(id: FormatId, value: string, start: number, end: number): TextEdit {
  if (id === "bold" || id === "italic") {
    const { marker, placeholder } = WRAPPERS[id];
    const selected = value.slice(start, end) || placeholder;
    const inserted = `${marker}${selected}${marker}`;
    return {
      value: value.slice(0, start) + inserted + value.slice(end),
      selectionStart: start + marker.length,
      selectionEnd: start + marker.length + selected.length,
    };
  }

  if (id === "link") {
    const label = value.slice(start, end) || "the words people click";
    const href = "https://";
    const inserted = `[${label}](${href})`;
    const hrefStart = start + label.length + "[](".length;
    return {
      value: value.slice(0, start) + inserted + value.slice(end),
      selectionStart: hrefStart,
      selectionEnd: hrefStart + href.length,
    };
  }

  const lineStart = start === 0 ? 0 : value.lastIndexOf("\n", start - 1) + 1;
  const nextBreak = value.indexOf("\n", end);
  const lineEnd = nextBreak === -1 ? value.length : nextBreak;
  const rule = LINE_RULES[id];
  const lines = value.slice(lineStart, lineEnd).split("\n");
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

const BLOCKS: Record<string, { label: string; body: string; Icon: LucideIcon }> = {
  text: { label: "Text", body: "Write your message here.", Icon: Pilcrow },
  heading: { label: "Heading", body: "## Your heading", Icon: Heading2 },
  button: {
    label: "Button",
    body: '[Button text](https://your-link.example "button")',
    Icon: MousePointerClick,
  },
  image: {
    label: "Image",
    body: "![Describe this image](https://your-image.example/image.jpg)",
    Icon: Image,
  },
  divider: { label: "Divider", body: "---", Icon: Minus },
};

export const EMAIL_STARTERS = [
  {
    key: "welcome",
    label: "Welcome",
    body: "Hi {{firstName}},\n\n## Welcome — I’m glad you’re here\n\nHere’s what happens next.\n\n[Get started](https://your-link.example \"button\")",
  },
  {
    key: "announcement",
    label: "Announcement",
    body: "Hi {{firstName}},\n\n## Something new is here\n\nShare the news and why it matters to them.\n\n[Take a look](https://your-link.example \"button\")",
  },
  {
    key: "reminder",
    label: "Reminder",
    body: "Hi {{firstName}},\n\n## A quick reminder\n\nAdd the date, time and anything they need to bring.\n\n[View the details](https://your-link.example \"button\")",
  },
] as const;

/**
 * 3.11. The two widths the preview can be seen at.
 *
 * Exported so the mapping is testable without a DOM: the frontend suite runs in
 * node, and the thing worth pinning here is that "phone" is a fixed narrow
 * width rather than whatever the browser window happens to be. A preview that
 * inherits the viewport shows a desktop layout on a desktop and cannot show the
 * other one at all, which is the bug this replaced.
 */
export const PREVIEW_DEVICES = ["desktop", "mobile"] as const;

export type PreviewDevice = (typeof PREVIEW_DEVICES)[number];

/** 390px is an iPhone's CSS width; `max-w-full` keeps it honest on a narrow screen. */
export function previewWidthClass(device: PreviewDevice): string {
  // Centred, so the narrow case reads as a phone rather than as a broken
  // desktop layout pinned to the left.
  return device === "mobile" ? "mx-auto w-[390px] max-w-full" : "";
}

function insertAt(value: string, start: number, end: number, body: string): TextEdit {
  const before = value.slice(0, start);
  const after = value.slice(end);
  const prefix = before.length > 0 && !before.endsWith("\n\n") ? (before.endsWith("\n") ? "\n" : "\n\n") : "";
  const suffix = after.length > 0 && !after.startsWith("\n\n") ? (after.startsWith("\n") ? "\n" : "\n\n") : "";
  const inserted = `${prefix}${body}${suffix}`;
  return {
    value: before + inserted + after,
    selectionStart: start + prefix.length,
    selectionEnd: start + prefix.length + body.length,
  };
}

export default function EmailComposer({
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
  const [choosingImage, setChoosingImage] = useState(false);
  /**
   * 3.11. Which width the preview is shown at. Not a media query — the point is
   * to see the DESKTOP layout on a desktop and the phone layout beside it,
   * which a responsive preview cannot do because it only ever has the one
   * viewport.
   */
  const [device, setDevice] = useState<PreviewDevice>("desktop");
  const [mergeTags, setMergeTags] = useState<MergeTag[]>([]);
  const [templates, setTemplates] = useState<SavedEmailTemplate[]>([]);
  const [savingTemplate, setSavingTemplate] = useState(false);
  /**
   * 3.2. Whether the template library is open.
   *
   * The library used to be a row of buttons that appeared only while the
   * composer was EMPTY, which made it unreachable in the one situation it is
   * most wanted: an email half-written, and a saved layout that would have
   * saved the work. It is a panel now, reachable at any point, and it can
   * duplicate and rename and delete — which is what makes it a library rather
   * than three fixed starters.
   */
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [busyTemplateId, setBusyTemplateId] = useState<number | null>(null);

  // Both lists are small, cached by the browser, and only needed once the
  // composer is on screen — so they are fetched here rather than threaded
  // through every screen that renders one.
  useEffect(() => {
    adminApi.mergeTags().then(setMergeTags).catch(() => setMergeTags([]));
    adminApi.savedTemplates().then(setTemplates).catch(() => setTemplates([]));
  }, []);

  useEffect(() => {
    const range = pendingSelection.current;
    const el = ref.current;
    if (!range || !el) return;
    pendingSelection.current = null;
    el.focus();
    el.setSelectionRange(range[0], range[1]);
  });

  function commit(edit: TextEdit) {
    pendingSelection.current = [edit.selectionStart, edit.selectionEnd];
    onChange(edit.value);
  }

  function addBlock(key: string) {
    if (key === "image") {
      setChoosingImage(true);
      return;
    }
    const block = BLOCKS[key];
    const el = ref.current;
    if (!block || !el) return;
    commit(insertAt(el.value, el.selectionStart, el.selectionEnd, block.body));
  }

  /** Drops a merge tag in at the caret, which is where she is looking. */
  function addMergeTag(token: string) {
    const el = ref.current;
    if (!el) return;
    const before = el.value.slice(0, el.selectionStart);
    const after = el.value.slice(el.selectionEnd);
    commit({
      value: before + token + after,
      selectionStart: before.length + token.length,
      selectionEnd: before.length + token.length,
    });
  }

  /**
   * Puts a template's body into the composer.
   *
   * Confirms first when there is work on screen. Replacing half a written email
   * with a starter, with no undo and no warning, is the kind of loss that makes
   * somebody stop using a feature.
   */
  function applyTemplate(label: string, body: string) {
    if (
      value.trim() &&
      !window.confirm(`Replace what you've written with “${label}”? This can't be undone.`)
    ) {
      return;
    }
    onChange(body);
    setLibraryOpen(false);
    setPreview(false);
  }

  async function saveAsTemplate() {
    const name = window.prompt("Save this as a template called…");
    if (!name?.trim()) return;
    setSavingTemplate(true);
    try {
      const saved = await adminApi.savedTemplateCreate({ name: name.trim(), bodyMd: value });
      setTemplates((prev) => [...prev, saved].sort((a, b) => a.name.localeCompare(b.name)));
      toast.success(`Saved as “${saved.name}”.`);
    } catch {
      toast.error("We couldn't save that as a template.");
    } finally {
      setSavingTemplate(false);
    }
  }

  async function runTemplateAction(
    id: number,
    action: () => Promise<SavedEmailTemplate[] | void>,
    failure: string,
  ) {
    setBusyTemplateId(id);
    try {
      const next = await action();
      if (next) setTemplates(next.sort((a, b) => a.name.localeCompare(b.name)));
    } catch {
      toast.error(failure);
    } finally {
      setBusyTemplateId(null);
    }
  }

  function addImage(asset: MediaAsset) {
    const el = ref.current;
    if (!el) return;
    const source = asset.url.startsWith("/") && typeof window !== "undefined"
      ? publicSiteUrl(asset.url)
      : asset.url;
    const alt = (asset.title || asset.originalName || "Image").replace(/[\[\]]/g, "");
    commit(insertAt(el.value, el.selectionStart, el.selectionEnd, `![${alt}](${source})`));
  }

  return (
    <>
    <div className="space-y-3">
      {!value.trim() && !libraryOpen && (
        <div className="rounded-xl border border-hairline bg-cream/60 p-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-soft">
            Start from a template
          </p>
          <div className="flex flex-wrap gap-2">
            {EMAIL_STARTERS.map((starter) => (
              <Button
                key={starter.key}
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => applyTemplate(starter.label, starter.body)}
              >
                {starter.label}
              </Button>
            ))}
            {/* Her own saved templates alongside the three built-in starters —
                3.2. On an empty composer this row IS the picker; the Templates
                button in the toolbar is the way back to it once she is
                writing, and is where duplicating and renaming live. */}
            {templates.map((template) => (
              <Button
                key={template.id}
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => applyTemplate(template.name, template.bodyMd)}
              >
                {template.name}
              </Button>
            ))}
          </div>
        </div>
      )}

      {libraryOpen && (
        <div className="rounded-xl border border-hairline bg-cream/60 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
              Template library
            </p>
            <div className="flex items-center gap-2">
              {value.trim().length > 0 && (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={savingTemplate}
                  onClick={() => void saveAsTemplate()}
                >
                  <Save />
                  Save this email as a template
                </Button>
              )}
              <Button type="button" variant="ghost" size="sm" onClick={() => setLibraryOpen(false)}>
                Close
              </Button>
            </div>
          </div>

          <p className="mt-2 text-xs text-ink-soft">
            Starters come with the platform. Anything you save is yours to rename, copy or delete.
          </p>

          <div className="mt-3 space-y-2">
            {EMAIL_STARTERS.map((starter) => (
              <div
                key={starter.key}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-hairline bg-white/[0.04] px-3 py-2"
              >
                <span className="text-sm font-medium text-ink">
                  {starter.label}
                  <span className="ml-2 text-xs font-normal text-ink-soft">starter</span>
                </span>
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => applyTemplate(starter.label, starter.body)}
                  >
                    Use this
                  </Button>
                  {/* Copying a starter is how a starter becomes hers: the copy
                      is a saved template she can then edit and rename, which
                      the three fixed starters never allowed. */}
                  <Button
                    type="button"
                    variant="ghost"
                    size="iconSm"
                    title={`Save a copy of ${starter.label}`}
                    aria-label={`Save a copy of ${starter.label}`}
                    disabled={savingTemplate}
                    onClick={async () => {
                      setSavingTemplate(true);
                      try {
                        const saved = await adminApi.savedTemplateCreate({
                          name: `${starter.label} (my copy)`,
                          bodyMd: starter.body,
                        });
                        setTemplates((prev) =>
                          [...prev, saved].sort((a, b) => a.name.localeCompare(b.name)),
                        );
                        toast.success(`Saved as “${saved.name}”.`);
                      } catch {
                        toast.error("We couldn't copy that starter.");
                      } finally {
                        setSavingTemplate(false);
                      }
                    }}
                  >
                    <Copy />
                  </Button>
                </div>
              </div>
            ))}

            {templates.map((template) => (
              <div
                key={template.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-hairline bg-white/[0.04] px-3 py-2"
              >
                <span className="min-w-0 truncate text-sm font-medium text-ink">
                  {template.name}
                </span>
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => applyTemplate(template.name, template.bodyMd)}
                  >
                    Use this
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="iconSm"
                    title={`Make a copy of ${template.name}`}
                    aria-label={`Make a copy of ${template.name}`}
                    disabled={busyTemplateId === template.id}
                    onClick={() =>
                      void runTemplateAction(
                        template.id,
                        async () => {
                          const copy = await adminApi.savedTemplateDuplicate(template.id);
                          toast.success(`Copied to “${copy.name}”.`);
                          return [...templates, copy];
                        },
                        "We couldn't copy that template.",
                      )
                    }
                  >
                    <Copy />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="iconSm"
                    title={`Rename ${template.name}`}
                    aria-label={`Rename ${template.name}`}
                    disabled={busyTemplateId === template.id}
                    onClick={() => {
                      const name = window.prompt("Rename this template to…", template.name);
                      if (!name?.trim() || name.trim() === template.name) return;
                      void runTemplateAction(
                        template.id,
                        async () => {
                          const renamed = await adminApi.savedTemplateRename(
                            template.id,
                            name.trim(),
                          );
                          return templates.map((row) => (row.id === template.id ? renamed : row));
                        },
                        "We couldn't rename that template.",
                      );
                    }}
                  >
                    <Pencil />
                  </Button>
                  <Button
                    type="button"
                    variant="dangerGhost"
                    size="iconSm"
                    title={`Delete ${template.name}`}
                    aria-label={`Delete ${template.name}`}
                    disabled={busyTemplateId === template.id}
                    onClick={() => {
                      if (!window.confirm(`Delete the template “${template.name}”? Emails you already wrote from it are not affected.`)) {
                        return;
                      }
                      void runTemplateAction(
                        template.id,
                        async () => {
                          await adminApi.savedTemplateDelete(template.id);
                          toast.success("Template deleted.");
                          return templates.filter((row) => row.id !== template.id);
                        },
                        "We couldn't delete that template.",
                      );
                    }}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </div>
            ))}

            {templates.length === 0 && (
              <p className="text-sm text-ink-soft">
                You haven't saved any of your own yet. Write an email, then choose “Save this email
                as a template”.
              </p>
            )}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1 rounded-xl border border-hairline bg-white/[0.04] p-1">
        {!preview && (
          <Button
            type="button"
            variant={libraryOpen ? "secondary" : "ghost"}
            size="sm"
            aria-expanded={libraryOpen}
            onClick={() => setLibraryOpen((open) => !open)}
          >
            <LayoutTemplate />
            Templates
          </Button>
        )}
        {!preview &&
          TOOLBAR.map(({ id, label, Icon }) => (
            <Button
              key={id}
              type="button"
              variant="ghost"
              size="iconSm"
              title={label}
              aria-label={label}
              onClick={() => {
                const el = ref.current;
                if (el) commit(applyEmailFormat(id, el.value, el.selectionStart, el.selectionEnd));
              }}
            >
              <Icon />
            </Button>
          ))}
        {!preview && (
          <label className="ml-1">
            <span className="sr-only">Add a content block</span>
            <select
              className={`${selectStyles} min-h-11 py-1.5 text-sm`}
              defaultValue=""
              onChange={(event) => {
                addBlock(event.target.value);
                event.target.value = "";
              }}
            >
              <option value="" disabled>Add a block…</option>
              {Object.entries(BLOCKS).map(([key, block]) => (
                <option key={key} value={key}>{block.label}</option>
              ))}
            </select>
          </label>
        )}
        {!preview && mergeTags.length > 0 && (
          <label className="ml-1">
            <span className="sr-only">Insert something about the reader</span>
            <select
              className={`${selectStyles} min-h-11 py-1.5 text-sm`}
              defaultValue=""
              onChange={(event) => {
                if (event.target.value) addMergeTag(event.target.value);
                event.target.value = "";
              }}
            >
              <option value="" disabled>
                Insert their details…
              </option>
              {mergeTags.map((tag) => (
                <option key={tag.token} value={tag.token}>
                  {tag.label} — {tag.example}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="ml-auto flex items-center gap-1">
          {preview && (
            /*
             * 3.11. Desktop and phone widths, with the words on them.
             *
             * Two bare icons in the corner of a toolbar were not found by
             * somebody looking for a mobile preview — the feature was there and
             * read as absent. Labelled, grouped, and given a heading, it is a
             * control rather than a pair of glyphs.
             */
            <div
              role="group"
              aria-label="Preview width"
              className="mr-1 flex items-center gap-1 rounded-lg border border-hairline p-0.5"
            >
              <Button
                type="button"
                variant={device === "desktop" ? "secondary" : "ghost"}
                size="sm"
                title="See it at desktop width"
                aria-pressed={device === "desktop"}
                onClick={() => setDevice("desktop")}
              >
                <Monitor />
                Desktop
              </Button>
              <Button
                type="button"
                variant={device === "mobile" ? "secondary" : "ghost"}
                size="sm"
                title="See it at phone width"
                aria-pressed={device === "mobile"}
                onClick={() => setDevice("mobile")}
              >
                <Smartphone />
                Phone
              </Button>
            </div>
          )}
          {!preview && value.trim().length > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={savingTemplate}
              onClick={() => void saveAsTemplate()}
            >
              <Save />
              Save as template
            </Button>
          )}
          <Button type="button" variant={preview ? "ghost" : "secondary"} size="sm" onClick={() => setPreview(false)}>
            Write
          </Button>
          <Button type="button" variant={preview ? "secondary" : "ghost"} size="sm" onClick={() => setPreview(true)}>
            Preview
          </Button>
        </div>
      </div>

      {preview ? (
        <div>
          <p className="mb-2 text-xs text-ink-soft">
            {device === "mobile"
              ? "Phone width — 390px, about an iPhone."
              : "Desktop width — the full width of the email."}
          </p>
        <div
          className={cn(
            "prose-boss min-h-[14rem] rounded-xl border border-hairline bg-white/[0.03] p-4",
            previewWidthClass(device),
          )}
        >
          {value.trim() ? (
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                a: ({ title, ...props }) => title === "button"
                  ? <a {...props} className="inline-block rounded-lg bg-plum px-5 py-3 font-semibold text-white no-underline" />
                  : <a {...props} />,
              }}
            >
              {value}
            </ReactMarkdown>
          ) : (
            <p className="text-sm text-ink-soft">Nothing written yet — switch to Write and start typing.</p>
          )}
        </div>
        </div>
      ) : (
        <Textarea ref={ref} rows={rows} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
      )}
    </div>
    <MediaPickerDialog open={choosingImage} onOpenChange={setChoosingImage} onSelect={addImage} />
    </>
  );
}
