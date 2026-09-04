import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Bold,
  Heading2,
  Image,
  Italic,
  Link2,
  List,
  ListOrdered,
  Minus,
  MousePointerClick,
  Pilcrow,
  type LucideIcon,
} from "lucide-react";
import { Button, Textarea, selectStyles } from "@/pages/admin/ui/primitives";
import MediaPickerDialog from "@/components/admin/MediaPickerDialog";
import type { MediaAsset } from "@/types/admin";

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

  function addImage(asset: MediaAsset) {
    const el = ref.current;
    if (!el) return;
    const source = asset.url.startsWith("/") && typeof window !== "undefined"
      ? `${window.location.origin}${asset.url}`
      : asset.url;
    const alt = (asset.title || asset.originalName || "Image").replace(/[\[\]]/g, "");
    commit(insertAt(el.value, el.selectionStart, el.selectionEnd, `![${alt}](${source})`));
  }

  return (
    <>
    <div className="space-y-3">
      {!value.trim() && (
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
                onClick={() => onChange(starter.body)}
              >
                {starter.label}
              </Button>
            ))}
          </div>
        </div>
      )}

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
        <div className="ml-auto flex items-center gap-1">
          <Button type="button" variant={preview ? "ghost" : "secondary"} size="sm" onClick={() => setPreview(false)}>
            Write
          </Button>
          <Button type="button" variant={preview ? "secondary" : "ghost"} size="sm" onClick={() => setPreview(true)}>
            Preview
          </Button>
        </div>
      </div>

      {preview ? (
        <div className="prose-boss min-h-[14rem] rounded-xl border border-hairline bg-white/[0.03] p-4">
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
      ) : (
        <Textarea ref={ref} rows={rows} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
      )}
    </div>
    <MediaPickerDialog open={choosingImage} onOpenChange={setChoosingImage} onSelect={addImage} />
    </>
  );
}
