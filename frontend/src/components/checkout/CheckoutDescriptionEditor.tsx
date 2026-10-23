import { useLayoutEffect, useRef, useState } from "react";
import {
  Bold,
  Heading2,
  Image as ImageIcon,
  Italic,
  Link2,
  List,
  ListOrdered,
  type LucideIcon,
} from "lucide-react";
import MediaPickerDialog from "@/components/admin/MediaPickerDialog";
import { PasteOptions, useSmartPaste } from "@/components/admin/smartPaste";
import { Button, Field, Textarea, selectStyles } from "@/pages/admin/ui/primitives";
import { applyDescriptionFormat, type DescriptionFormat } from "@/components/community/descriptionFormat";
import { cn } from "@/lib/cn";
import { CheckoutMarkdown } from "./CheckoutMarkdown";
import {
  CHECKOUT_STYLES,
  applyCheckoutStyle,
  insertCheckoutImage,
  type CheckoutStyleGroup,
  type CheckoutTextEdit,
} from "./checkoutMarkdown";

const TOOLBAR: { id: DescriptionFormat; label: string; Icon: LucideIcon }[] = [
  { id: "bold", label: "Bold", Icon: Bold },
  { id: "italic", label: "Italic", Icon: Italic },
  { id: "heading", label: "Heading", Icon: Heading2 },
  { id: "bullets", label: "Bulleted list", Icon: List },
  { id: "numbers", label: "Numbered list", Icon: ListOrdered },
  { id: "link", label: "Add a link", Icon: Link2 },
];

const STYLE_MENUS: { group: CheckoutStyleGroup; label: string; none: string }[] = [
  { group: "bullets", label: "Bullet style", none: "Gold diamonds (standard)" },
  { group: "numbers", label: "Number style", none: "Gold circles (standard)" },
  { group: "font", label: "Font", none: "Standard font" },
  { group: "look", label: "Look", none: "Standard look" },
];

/**
 * The offer's checkout description: a formatting toolbar, "Add a photo" (from
 * or into the media library), style menus for bullets, numbers and fonts, and
 * a "See how it looks" view drawn by the checkout's own renderer on the
 * checkout's own dark background.
 *
 * The menus write style lines (`{checks}`, `{serif}` — checkoutMarkdown.ts)
 * above the block the cursor is in, so she never has to remember the words.
 */
export function CheckoutDescriptionEditor({
  value,
  onChange,
  error,
}: {
  value: string;
  onChange: (value: string) => void;
  error?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const pendingSelection = useRef<[number, number] | null>(null);
  // Where the cursor was when "Add a photo" opened the library, which takes
  // focus (and so the textarea's selection) away.
  const photoRange = useRef<[number, number] | null>(null);
  const [preview, setPreview] = useState(false);
  const [picking, setPicking] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  // Pasting from Google Docs / Word keeps its formatting, with a plain-text option (QA row 169).
  const paste = useSmartPaste(onChange);

  useLayoutEffect(() => {
    const el = ref.current;
    const range = pendingSelection.current;
    if (!el || !range) return;
    pendingSelection.current = null;
    el.focus();
    el.setSelectionRange(range[0], range[1]);
  }, [value, preview]);

  function commit(edit: CheckoutTextEdit) {
    pendingSelection.current = [edit.selectionStart, edit.selectionEnd];
    onChange(edit.value);
  }

  function runFormat(format: DescriptionFormat) {
    const el = ref.current;
    if (!el) return;
    commit(applyDescriptionFormat(format, el.value, el.selectionStart, el.selectionEnd));
  }

  function runStyle(group: CheckoutStyleGroup, word: string) {
    const el = ref.current;
    if (!el) return;
    commit(applyCheckoutStyle(el.value, el.selectionStart, group, word));
  }

  function openPhotoPicker() {
    const el = ref.current;
    photoRange.current = el ? [el.selectionStart, el.selectionEnd] : [value.length, value.length];
    setPicking(true);
  }

  return (
    <Field label="Description" htmlFor="offer-description" error={error}
      hint="what they're getting — the checkout shows it under the headline">
      <div className="space-y-2">
        <div className="space-y-1 rounded-xl border border-hairline bg-white/[0.04] p-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1" role="toolbar" aria-label="Description formatting">
              {TOOLBAR.map(({ id, label, Icon }) => (
                <Button key={id} type="button" variant="ghost" size="iconSm" title={label} aria-label={label}
                  disabled={preview} onClick={() => runFormat(id)}>
                  <Icon />
                </Button>
              ))}
              <Button type="button" variant="ghost" size="sm" disabled={preview} onClick={openPhotoPicker}>
                <ImageIcon />
                Add a photo
              </Button>
            </div>
            <div className="flex gap-1">
              <Button type="button" variant={preview ? "ghost" : "secondary"} size="sm" onClick={() => setPreview(false)}>
                Write
              </Button>
              <Button type="button" variant={preview ? "secondary" : "ghost"} size="sm" onClick={() => setPreview(true)}>
                See how it looks
              </Button>
            </div>
          </div>
          {!preview && (
            <div className="grid grid-cols-2 gap-1 sm:grid-cols-4">
              {STYLE_MENUS.map(({ group, label, none }) => (
                <label key={group} className="block">
                  <span className="sr-only">{label} for the part your cursor is in</span>
                  <select
                    className={cn(selectStyles, "h-10 text-xs")}
                    value=""
                    title={`${label} for the list or paragraph your cursor is in`}
                    onChange={(event) => {
                      const word = event.target.value;
                      runStyle(group, word === "__none" ? "" : word);
                    }}
                  >
                    <option value="" disabled>{label}…</option>
                    {CHECKOUT_STYLES.filter((style) => style.group === group).map((style) => (
                      <option key={style.word} value={style.word}>{style.label}</option>
                    ))}
                    <option value="__none">{none}</option>
                  </select>
                </label>
              ))}
            </div>
          )}
          {!preview && <PasteOptions {...paste.options} className="px-1.5 pb-0.5" />}
        </div>

        {preview ? (
          <div className="theme-luxe min-h-[12rem] rounded-xl border border-hairline bg-night-deep p-5">
            {value.trim() ? (
              <CheckoutMarkdown text={value} className="max-w-xl" />
            ) : (
              <p className="text-sm text-white/60">Nothing written yet — switch to Write to add a description.</p>
            )}
          </div>
        ) : (
          <Textarea
            ref={ref}
            {...paste.textareaProps}
            id="offer-description"
            rows={10}
            value={value}
            aria-invalid={error ? true : undefined}
            onChange={(event) => onChange(event.target.value)}
            placeholder="Six weeks of teaching, the full workbook, and the templates you can use on Monday morning."
          />
        )}

        <div className="text-xs leading-relaxed text-ink-soft">
          <button type="button" className="font-semibold text-gold underline-offset-4 hover:underline"
            aria-expanded={showHelp} onClick={() => setShowHelp((open) => !open)}>
            {showHelp ? "Hide formatting tips" : "Formatting tips"}
          </button>
          {showHelp && (
            <div className="mt-2 space-y-1.5 rounded-xl border border-hairline bg-white/[0.03] p-3">
              <p>
                <code>## Heading</code>, <code>**bold**</code>, <code>_italic_</code>, <code>[link words](https://…)</code>,{" "}
                <code>- </code> for a bullet, <code>1. </code> for a numbered step, <code>---</code> for a dividing line.
                &ldquo;Add a photo&rdquo; puts <code>![description](address)</code> on its own line.
              </p>
              <p>
                To style a list or paragraph, put your cursor in it and pick from the menus — or type a line in curly
                braces straight above it:
              </p>
              <ul className="list-disc space-y-0.5 pl-5">
                <li>Bullets: <code>{"{checks}"}</code> <code>{"{diamonds}"}</code> <code>{"{stars}"}</code> <code>{"{hearts}"}</code> <code>{"{arrows}"}</code></li>
                <li>Numbers: <code>{"{circles}"}</code> (the standard) or <code>{"{steps}"}</code> for &ldquo;Step 1, Step 2&rdquo;</li>
                <li>Fonts: <code>{"{serif}"}</code> (Playfair Display), <code>{"{sans}"}</code> (Montserrat), <code>{"{italic}"}</code></li>
                <li>Look: <code>{"{gold}"}</code>, <code>{"{large}"}</code>, <code>{"{center}"}</code> — and you can combine them: <code>{"{checks large}"}</code></li>
              </ul>
              <p>A line with any other word in braces is shown as written. Line breaks you type are kept.</p>
            </div>
          )}
        </div>
      </div>

      <MediaPickerDialog
        open={picking}
        onOpenChange={setPicking}
        onSelect={(asset) => {
          const [start, end] = photoRange.current ?? [value.length, value.length];
          const alt = asset.title || asset.originalName.replace(/\.[a-z0-9]+$/i, "").replace(/[-_]+/g, " ");
          commit(insertCheckoutImage(value, start, end, asset.url, alt));
          setPicking(false);
          setPreview(false);
        }}
      />
    </Field>
  );
}
