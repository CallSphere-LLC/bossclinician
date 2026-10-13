import { useLayoutEffect, useRef, useState } from "react";
import {
  Bold,
  Heading2,
  Image as ImageIcon,
  Italic,
  Link2,
  List,
  ListOrdered,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import MediaPickerDialog from "@/components/admin/MediaPickerDialog";
import { Button, Field, Textarea } from "@/pages/admin/ui/primitives";
import { CommunityCover, CommunityDescription } from "./CommunityDescription";
import { applyDescriptionFormat, type DescriptionFormat } from "./descriptionFormat";

/**
 * The two community details fields that are more than a text box, shared by
 * the New community dialog and Manage > Details so they behave the same.
 */

/** Cover photo: chosen from (or uploaded into) the media library, never a typed path. */
export function CommunityCoverField({
  value,
  onChange,
}: {
  value: string;
  onChange: (url: string) => void;
}) {
  const [picking, setPicking] = useState(false);
  return (
    <>
      <Field
        label="Cover photo"
        hint="optional — a wide landscape picture, about 1600 by 600 pixels, works best. It sits at the top of the community and on its card."
      >
        <div className="space-y-3">
          {value ? (
            <>
              <CommunityCover
                src={value}
                className="aspect-[8/3] w-full rounded-xl border border-hairline"
              />
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="secondary" size="sm" onClick={() => setPicking(true)}>
                  Replace
                </Button>
                <Button type="button" variant="dangerGhost" size="sm" onClick={() => onChange("")}>
                  <Trash2 />
                  Remove
                </Button>
              </div>
            </>
          ) : (
            <Button type="button" variant="secondary" size="sm" onClick={() => setPicking(true)}>
              <ImageIcon />
              Choose a cover photo
            </Button>
          )}
        </div>
      </Field>
      <MediaPickerDialog
        open={picking}
        onOpenChange={setPicking}
        onSelect={(asset) => {
          onChange(asset.url);
          setPicking(false);
        }}
      />
    </>
  );
}

const TOOLBAR: { id: DescriptionFormat; label: string; Icon: LucideIcon }[] = [
  { id: "bold", label: "Bold", Icon: Bold },
  { id: "italic", label: "Italic", Icon: Italic },
  { id: "heading", label: "Heading", Icon: Heading2 },
  { id: "bullets", label: "Bulleted list", Icon: List },
  { id: "numbers", label: "Numbered list", Icon: ListOrdered },
  { id: "link", label: "Add a link", Icon: Link2 },
];

/** Description with a formatting toolbar and a "see how it looks" preview. */
export function CommunityDescriptionEditor({
  id,
  value,
  onChange,
  rows = 12,
  hint,
  placeholder,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  hint?: string;
  placeholder?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const pendingSelection = useRef<[number, number] | null>(null);
  const [preview, setPreview] = useState(false);

  // Put the selection back after React re-renders the new text, so the next
  // keystroke replaces the placeholder the button dropped in.
  useLayoutEffect(() => {
    const el = ref.current;
    const range = pendingSelection.current;
    if (!el || !range) return;
    pendingSelection.current = null;
    el.focus();
    el.setSelectionRange(range[0], range[1]);
  }, [value]);

  function runFormat(format: DescriptionFormat) {
    const el = ref.current;
    if (!el) return;
    const edit = applyDescriptionFormat(format, el.value, el.selectionStart, el.selectionEnd);
    pendingSelection.current = [edit.selectionStart, edit.selectionEnd];
    onChange(edit.value);
  }

  return (
    <Field
      label="Description"
      htmlFor={id}
      hint={
        hint ??
        "Shown at the top of the participant view. Highlight words and use the buttons to make them bold or a heading; line breaks are kept."
      }
    >
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-hairline bg-white/[0.04] p-1">
          <div className="flex flex-wrap items-center gap-1" role="toolbar" aria-label="Description formatting">
            {TOOLBAR.map(({ id: format, label, Icon }) => (
              <Button
                key={format}
                type="button"
                variant="ghost"
                size="iconSm"
                title={label}
                aria-label={label}
                disabled={preview}
                onClick={() => runFormat(format)}
              >
                <Icon />
              </Button>
            ))}
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
        {preview ? (
          <div className="theme-luxe min-h-[12rem] rounded-xl border border-hairline bg-night-deep p-5">
            {value.trim() ? (
              <CommunityDescription text={value} />
            ) : (
              <p className="text-sm text-white/60">Nothing written yet — switch to Write to add a description.</p>
            )}
          </div>
        ) : (
          <Textarea
            ref={ref}
            id={id}
            rows={rows}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder={placeholder ?? "Welcome members and explain what this community includes."}
          />
        )}
      </div>
    </Field>
  );
}
