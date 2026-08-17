import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Image as ImageIcon, LayoutList, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { adminApi } from "@/lib/api";
import type { MediaAsset } from "@/types/admin";
import { cn } from "@/lib/cn";
import { formatBytes } from "@/lib/format";
import {
  Badge,
  Button,
  EmptyState,
  ErrorNotice,
  Field,
  Input,
  PageHeader,
  Skeleton,
  Textarea,
} from "@/pages/admin/ui/primitives";
import { DataTable, RowActions } from "@/pages/admin/ui/DataTable";
import { Modal, useConfirm } from "@/pages/admin/ui/Dialog";
import { UploadDropzone } from "@/pages/admin/ui/Uploader";
import {
  PUBLISH_LABEL,
  friendlyError,
  humanizeKey,
  slugify,
  uniqueKey,
} from "@/pages/admin/ui/friendly";

const selectStyles =
  "h-11 w-full rounded-xl border border-hairline bg-surface px-3 text-sm text-ink outline-none transition-colors focus-visible:border-plum focus-visible:ring-4 focus-visible:ring-plum/12";

/** "a testimonial" / "an offer" — so generated sentences read like sentences. */
function withArticle(word: string): string {
  return `${/^[aeiou]/i.test(word) ? "an" : "a"} ${word}`;
}

/** Sentence-cases a noun for the start of a toast: "testimonial" → "Testimonial". */
function sentence(word: string): string {
  return word ? word[0].toUpperCase() + word.slice(1) : word;
}

/** What one row of this screen is, in the owner's words. */
export interface CrudNoun {
  /** "testimonial" */
  one: string;
  /** "testimonials" */
  many: string;
}

/** One option in a `choice` dropdown — the stored value plus what she reads. */
export interface CrudChoice {
  value: string;
  label: string;
}

export interface FieldConfig<T> {
  key: keyof T & string;
  label: string;
  type?: "text" | "textarea" | "number" | "checkbox" | "tags" | "picture" | "choice";
  /** Plain-English aside under the label — what this is for, not what it is. */
  hint?: string;
  placeholder?: string;
  /**
   * Options for a `choice` field. A stored value that isn't in this list is
   * kept and shown as its own option: a dropdown must never quietly rewrite
   * something she already saved.
   */
  options?: CrudChoice[];
  /** Force the field across both columns of the form. */
  wide?: boolean;
  /**
   * Sibling columns that hold the same idea and must receive the same value.
   * Testimonials are the case in point: the public card reads `photo` while the
   * table column is `image`, and she should be choosing one photo, not two.
   */
  mirrorKeys?: (keyof T & string)[];
}

interface CrudManagerProps<T extends { id: string }> {
  title: string;
  eyebrow?: string;
  description?: string;
  /** Drives every sentence on the screen — counts, buttons, toasts, errors. */
  noun: CrudNoun;
  /** Header for the first column. A real business noun: "Person", "Resource". */
  nameHeader: string;
  fields: FieldConfig<T>[];
  emptyItem: Partial<T>;
  list: () => Promise<T[]>;
  create: (data: Partial<T>) => Promise<T>;
  update: (id: string, data: Partial<T>) => Promise<T>;
  remove: (id: string) => Promise<void>;
  renderRowTitle: (item: T) => string;
  /** Optional secondary line under the row title. */
  renderRowSubtitle?: (item: T) => string;
  /**
   * The hidden identifier the API still requires, and the field it is built
   * from. She never sees or types it.
   */
  autoSlug?: { key: keyof T & string; from: keyof T & string };
  /** Overrides for the empty state when the default reads too flatly. */
  emptyTitle?: string;
  emptyDescription?: string;
}

/**
 * Generic list + modal-form screen, shared by Testimonials and Resources.
 *
 * Editing happens in a dialog rather than an inline panel so the list stays
 * visible and the form gets proper focus management from Radix.
 *
 * Every word this component renders is built from the `noun` its caller passes,
 * because a generic screen that invents its own vocabulary is how a business
 * owner ends up reading "3 records" about her own client quotes.
 */
export function CrudManager<T extends { id: string }>({
  title,
  eyebrow = "Website",
  description,
  noun,
  nameHeader,
  fields,
  emptyItem,
  list,
  create,
  update,
  remove,
  renderRowTitle,
  renderRowSubtitle,
  autoSlug,
  emptyTitle,
  emptyDescription,
}: CrudManagerProps<T>) {
  const [items, setItems] = useState<T[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Partial<T> | null>(null);
  const [saving, setSaving] = useState(false);
  // Which picture field the media picker is currently filling.
  const [picking, setPicking] = useState<(keyof T & string) | null>(null);
  const [confirm, confirmDialog] = useConfirm();

  const load = useCallback(() => {
    list()
      .then((rows) => {
        setItems(rows);
        setError(null);
      })
      .catch(() => setError(`We couldn't load your ${noun.many}. Try refreshing the page.`));
  }, [list, noun.many]);

  useEffect(load, [load]);

  function toRawValue(value: unknown, type: FieldConfig<T>["type"]): string {
    if (type === "tags" && Array.isArray(value)) return value.join(", ");
    if (value === undefined || value === null) return "";
    return String(value);
  }

  /**
   * Spreading a generic `Partial<T>` alongside a computed key widens to
   * `{ id?: T["id"] }` in TS, so the assertion is needed to keep the element
   * type. The key is constrained to `keyof T` by the caller.
   */
  function setField(key: keyof T & string, value: unknown) {
    setDraft((prev) => ({ ...(prev ?? {}), [key]: value }) as Partial<T>);
  }

  /** Writes a picture to its own column and to any column that mirrors it. */
  function setPicture(field: FieldConfig<T>, url: string) {
    setDraft((prev) => {
      const next: Record<string, unknown> = { ...(prev ?? {}) };
      next[field.key] = url;
      for (const mirror of field.mirrorKeys ?? []) next[mirror] = url;
      return next as Partial<T>;
    });
  }

  /** The picture to show: her own column first, then whatever mirrors it. */
  function pictureValue(field: FieldConfig<T>): string {
    const keys = [field.key, ...(field.mirrorKeys ?? [])];
    for (const key of keys) {
      const value = draft?.[key];
      if (typeof value === "string" && value.trim()) return value;
    }
    return "";
  }

  function fromRawValue(rawValue: string, type: FieldConfig<T>["type"]): unknown {
    if (type === "number") return Number(rawValue) || 0;
    if (type === "tags")
      return rawValue
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean);
    return rawValue;
  }

  /**
   * Fills the hidden identifier the API still requires.
   *
   * Derived from her title, and only when the row is first created: the public
   * cards and the checkout already point at the identifier an existing row has,
   * so regenerating it on a rename would break links she has already shared.
   * Identifiers already in use are collected so two "Welcome" resources can't
   * collide on save.
   */
  function withIdentifier(data: Partial<T>): Partial<T> {
    if (!autoSlug) return data;
    const current = data[autoSlug.key];
    if (typeof current === "string" && current.trim()) return data;

    const source = String(data[autoSlug.from] ?? "").trim();
    const taken = (items ?? []).map((item) =>
      String((item as Record<string, unknown>)[autoSlug.key] ?? ""),
    );
    const base = slugify(source) || slugify(noun.one) || "item";
    return { ...data, [autoSlug.key]: uniqueKey(base, taken, "-") } as Partial<T>;
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!draft) return;
    setSaving(true);
    try {
      if (draft.id) await update(String(draft.id), draft);
      else await create(withIdentifier(draft));
      toast.success(draft.id ? `${sentence(noun.one)} saved` : `${sentence(noun.one)} added`);
      setDraft(null);
      load();
    } catch (err) {
      toast.error(friendlyError(err, noun.one));
    } finally {
      setSaving(false);
    }
  }

  const handleDelete = useCallback(
    async (item: T) => {
      const label = renderRowTitle(item);
      const ok = await confirm({
        title: `Delete “${label}”?`,
        description: "It will disappear from your website straight away, and you can't undo this.",
        confirmLabel: "Yes, delete it",
        destructive: true,
      });
      if (!ok) return;

      try {
        await remove(item.id);
        toast.success(`${sentence(noun.one)} deleted`);
        load();
      } catch (err) {
        toast.error(friendlyError(err, noun.one));
      }
    },
    [confirm, load, noun.one, remove, renderRowTitle],
  );

  const columns = useMemo<ColumnDef<T, unknown>[]>(
    () => [
      {
        id: "name",
        header: nameHeader,
        accessorFn: (row) => renderRowTitle(row),
        cell: ({ row }) => (
          <button
            type="button"
            onClick={() => setDraft(row.original)}
            className="min-w-0 text-left"
          >
            <span className="block truncate font-semibold text-ink">
              {renderRowTitle(row.original)}
            </span>
            {renderRowSubtitle && (
              <span className="block truncate text-xs text-ink-soft">
                {renderRowSubtitle(row.original)}
              </span>
            )}
          </button>
        ),
      },
      {
        id: "published",
        header: "On your site",
        enableSorting: false,
        cell: ({ row }) => {
          const published = (row.original as Record<string, unknown>).published;
          if (typeof published !== "boolean") return null;
          return (
            <Badge tone={published ? "green" : "slate"}>
              {published ? PUBLISH_LABEL.live : PUBLISH_LABEL.draft}
            </Badge>
          );
        },
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        cell: ({ row }) => (
          <RowActions>
            <Button
              variant="ghost"
              size="iconSm"
              aria-label={`Edit ${renderRowTitle(row.original)}`}
              onClick={() => setDraft(row.original)}
            >
              <Pencil />
            </Button>
            <Button
              variant="dangerGhost"
              size="iconSm"
              aria-label={`Delete ${renderRowTitle(row.original)}`}
              onClick={() => handleDelete(row.original)}
            >
              <Trash2 />
            </Button>
          </RowActions>
        ),
      },
    ],
    [handleDelete, nameHeader, renderRowTitle, renderRowSubtitle],
  );

  const pickingField = fields.find((field) => field.key === picking) ?? null;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={eyebrow}
        title={title}
        description={description}
        actions={
          <Button size="sm" onClick={() => setDraft({ ...emptyItem })}>
            <Plus />
            Add {withArticle(noun.one)}
          </Button>
        }
      />

      {error && <ErrorNotice message={error} />}

      <DataTable
        columns={columns}
        data={items}
        itemNoun={noun}
        searchPlaceholder={`Search your ${noun.many}…`}
        emptyState={
          <EmptyState
            icon={<LayoutList />}
            title={emptyTitle ?? `No ${noun.many} yet`}
            description={
              emptyDescription ??
              `Add your first ${noun.one} and it will show up on your website.`
            }
            action={
              <Button size="sm" onClick={() => setDraft({ ...emptyItem })}>
                Add {withArticle(noun.one)}
              </Button>
            }
          />
        }
      />

      <Modal
        open={draft !== null}
        onOpenChange={(open) => !open && setDraft(null)}
        title={draft?.id ? `Edit this ${noun.one}` : `Add ${withArticle(noun.one)}`}
        size="lg"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button size="sm" type="submit" form="crud-form" disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        {draft && (
          <form id="crud-form" onSubmit={handleSave} className="grid gap-4 sm:grid-cols-2">
            {fields.map((field) => {
              const id = `crud-${field.key}`;
              const wide = field.wide || field.type === "textarea" || field.type === "picture";
              const className = wide ? "sm:col-span-2" : undefined;

              if (field.type === "checkbox") {
                const ticked = Boolean(draft[field.key]);
                return (
                  <div key={field.key} className={cn("flex flex-col justify-end", className)}>
                    <label className="flex cursor-pointer items-center gap-2.5 text-sm font-medium text-ink">
                      <input
                        id={id}
                        type="checkbox"
                        checked={ticked}
                        onChange={(e) => setField(field.key, e.target.checked)}
                        className="size-4 rounded border-hairline text-plum"
                      />
                      {field.label}
                    </label>
                    {/* Say what the tick means right now, rather than leaving her
                        to work it out from the box being empty. */}
                    {field.key === "published" && (
                      <p className="mt-1.5 text-xs text-ink-soft">
                        {ticked ? "Anyone can see this on your site." : "Nobody can see this yet."}
                      </p>
                    )}
                  </div>
                );
              }

              if (field.type === "picture") {
                const url = pictureValue(field);
                return (
                  <Field
                    key={field.key}
                    label={field.label}
                    hint={field.hint}
                    className={className}
                  >
                    {url ? (
                      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-hairline bg-white/[0.03] p-2.5">
                        <img
                          src={url}
                          alt=""
                          className="size-16 shrink-0 rounded-lg object-cover"
                        />
                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            onClick={() => setPicking(field.key)}
                          >
                            Choose a different one
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setPicture(field, "")}
                          >
                            Remove it
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => setPicking(field.key)}
                      >
                        <ImageIcon />
                        Choose {withArticle(field.label.toLowerCase())}
                      </Button>
                    )}
                  </Field>
                );
              }

              if (field.type === "choice") {
                const value = toRawValue(draft[field.key], field.type);
                const options = field.options ?? [];
                // Anything she saved before this dropdown existed stays
                // selectable rather than being silently swapped for the first
                // option the moment she opens the form. An empty value gets its
                // own row too, so what she reads always matches what's stored.
                const known = options.some((option) => option.value === value);
                return (
                  <Field
                    key={field.key}
                    label={field.label}
                    hint={field.hint}
                    htmlFor={id}
                    className={className}
                  >
                    <select
                      id={id}
                      value={value}
                      onChange={(e) => setField(field.key, e.target.value)}
                      className={selectStyles}
                    >
                      {!known && (
                        <option value={value}>{value ? humanizeKey(value) : "Pick one"}</option>
                      )}
                      {options.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                );
              }

              return (
                <Field
                  key={field.key}
                  label={field.label}
                  hint={field.hint}
                  htmlFor={id}
                  className={className}
                >
                  {field.type === "textarea" ? (
                    <Textarea
                      id={id}
                      rows={4}
                      placeholder={field.placeholder}
                      value={toRawValue(draft[field.key], field.type)}
                      onChange={(e) =>
                        setField(field.key, fromRawValue(e.target.value, field.type))
                      }
                    />
                  ) : (
                    <Input
                      id={id}
                      type={field.type === "number" ? "number" : "text"}
                      placeholder={field.placeholder}
                      value={toRawValue(draft[field.key], field.type)}
                      onChange={(e) =>
                        setField(field.key, fromRawValue(e.target.value, field.type))
                      }
                    />
                  )}
                </Field>
              );
            })}
          </form>
        )}
      </Modal>

      <PicturePickerModal
        open={picking !== null}
        onOpenChange={(open) => !open && setPicking(null)}
        onSelect={(asset) => {
          if (pickingField) setPicture(pickingField, asset.url);
          setPicking(null);
        }}
      />

      {confirmDialog}
    </div>
  );
}

/* --------------------------------------------------------- Picture chooser */

/**
 * Picks an image she has already uploaded, or takes a new one on the spot.
 *
 * The stored value is a path, but a path is never shown: she recognises her own
 * pictures by looking at them.
 *
 * Exported because the Courses screen needs the same chooser without the rest
 * of this screen — the shared admin UI kit doesn't own a media picker yet.
 */
export function PicturePickerModal({
  open,
  onOpenChange,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (asset: MediaAsset) => void;
}) {
  const [pictures, setPictures] = useState<MediaAsset[] | null>(null);

  const load = useCallback(() => {
    adminApi
      .mediaList("image")
      .then(setPictures)
      .catch(() => setPictures([]));
  }, []);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Choose a picture"
      description="Pick one you've already added, or drop in a new one."
      size="xl"
    >
      <div className="space-y-5">
        <UploadDropzone
          compact
          accept="image/*"
          onUploaded={(asset) => setPictures((prev) => (prev ? [asset, ...prev] : [asset]))}
        />

        {pictures === null ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="aspect-square w-full" />
            ))}
          </div>
        ) : pictures.length === 0 ? (
          <EmptyState
            icon={<ImageIcon />}
            title="No pictures yet"
            description="Drop an image above and it'll be ready to use."
          />
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {pictures.map((asset) => (
              <button
                key={asset.id}
                type="button"
                onClick={() => onSelect(asset)}
                className="group overflow-hidden rounded-xl border border-hairline text-left transition-all hover:border-plum hover:shadow-[0_12px_28px_-14px_rgba(15,30,58,0.4)]"
              >
                <span className="block aspect-square bg-ink/5">
                  <img
                    src={asset.url}
                    alt=""
                    loading="lazy"
                    className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
                  />
                </span>
                <span className="block p-2.5">
                  <span className="block truncate text-xs font-semibold text-ink">
                    {asset.title || asset.originalName}
                  </span>
                  <span className="block text-[0.66rem] text-ink-soft">
                    {formatBytes(Number(asset.sizeBytes))}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
