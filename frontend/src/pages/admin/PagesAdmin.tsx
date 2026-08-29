import { useCallback, useEffect, useMemo, useState } from "react";
import { FileStack, Save } from "lucide-react";
import { toast } from "sonner";
import { adminApi } from "@/lib/api";
import type { Page } from "@/types";
import { cn } from "@/lib/cn";
import { formatRelative } from "@/lib/format";
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
import { friendlyError, humanizeKey, webAddressLabel } from "@/pages/admin/ui/friendly";
import { useConfirm } from "@/pages/admin/ui/Dialog";

interface PageSummary {
  slug: string;
  title: string;
  description: string;
  updatedAt: string;
}

/** Where one editable value lives inside a page's stored content. */
type ContentPath = (string | number)[];

/* ------------------------------------------------ Naming what we recognise */

/**
 * The blocks of content the site actually ships with, in her words.
 *
 * Anything not listed here still renders — it just gets its stored name tidied
 * up by `humanizeKey` instead of a hand-written one. That's the difference
 * between an unfamiliar page block being editable and it being invisible.
 */
const SECTION_HEADINGS: Record<string, { title: string; hint?: string }> = {
  hero: {
    title: "Top of the page",
    hint: "The first thing someone reads when they land here.",
  },
};

/** The order these fields read best in, regardless of how they were stored. */
const FIELD_ORDER: Record<string, string[]> = {
  hero: ["eyebrow", "title", "subtitle", "body", "cta"],
  cta: ["label", "href"],
};

/** Labels for the fields we know, looked up by the block they sit in. */
const FIELD_LABELS: Record<string, Record<string, string>> = {
  hero: {
    eyebrow: "Small line above the headline",
    title: "Headline",
    subtitle: "Subheadline",
    body: "Intro paragraph",
  },
  cta: {
    label: "Button text",
    href: "Button links to",
  },
};

const LINK_HINT = "a page on your site like /apply, or a full web address";

const FIELD_HINTS: Record<string, Record<string, string>> = {
  hero: { eyebrow: "optional" },
};

/**
 * Blocks whose fields are already self-explanatory once labelled, so a heading
 * above them would only add a word she doesn't use ("Cta") to the screen.
 */
const INLINE_BLOCKS = new Set(["cta"]);

/** Keys that hold a paragraph rather than a line, so they get a bigger box. */
const PARAGRAPH_KEYS = new Set([
  "body",
  "description",
  "text",
  "content",
  "intro",
  "paragraph",
  "quote",
  "answer",
  "summary",
]);

/* ----------------------------------------------------- Reading and writing */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Returns a copy of `node` with one value replaced, spreading every level on
 * the way down.
 *
 * The spreads are the whole safety story: an edit to the headline rebuilds the
 * objects along that one path and carries every sibling key across untouched,
 * so saving a page can never drop a block this editor didn't draw.
 */
function setAtPath(node: unknown, path: ContentPath, value: unknown): unknown {
  if (path.length === 0) return value;
  const [head, ...rest] = path;

  if (typeof head === "number") {
    const list = Array.isArray(node) ? node.slice() : [];
    list[head] = setAtPath(list[head], rest, value);
    return list;
  }

  const object: Record<string, unknown> = isPlainObject(node) ? { ...node } : {};
  object[head] = setAtPath(object[head], rest, value);
  return object;
}

/** Known keys first in their reading order, then anything else as stored. */
function orderedKeys(value: Record<string, unknown>, blockKey: string | number | undefined): string[] {
  const stored = Object.keys(value);
  const preferred = typeof blockKey === "string" ? FIELD_ORDER[blockKey] : undefined;
  // Array.isArray rather than a truthiness check: a stored block called
  // "constructor" would otherwise pull an inherited property off the map.
  if (!Array.isArray(preferred)) return stored;
  return [
    ...preferred.filter((key) => Object.prototype.hasOwnProperty.call(value, key)),
    ...stored.filter((key) => !preferred.includes(key)),
  ];
}

/** The blocks of a page, with the ones we have a hand-written name for first. */
function orderedBlocks(content: Record<string, unknown>): string[] {
  const stored = Object.keys(content);
  const named = (key: string) => Object.prototype.hasOwnProperty.call(SECTION_HEADINGS, key);
  return [...stored.filter(named), ...stored.filter((key) => !named(key))];
}

function labelFor(path: ContentPath): string {
  const key = path[path.length - 1];
  const block = path[path.length - 2];
  if (typeof key === "number") return `Item ${key + 1}`;
  const known = typeof block === "string" ? FIELD_LABELS[block]?.[key] : undefined;
  return known ?? humanizeKey(key);
}

function hintFor(path: ContentPath): string | undefined {
  const key = path[path.length - 1];
  const block = path[path.length - 2];
  if (typeof key !== "string") return undefined;
  const known = typeof block === "string" ? FIELD_HINTS[block]?.[key] : undefined;
  if (known) return known;
  // Any key that holds a destination gets the same explanation, whichever
  // block it turns up in.
  return /^(href|url|link)$/i.test(key) ? LINK_HINT : undefined;
}

/** A repeated block reads better under its own headline than under "Item 3". */
function itemHeading(item: unknown, index: number): string {
  if (isPlainObject(item)) {
    for (const key of ["title", "label", "name", "heading"]) {
      const value = item[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  }
  return `Item ${index + 1}`;
}

function isParagraph(key: string | number, text: string): boolean {
  if (typeof key === "string" && PARAGRAPH_KEYS.has(key.toLowerCase())) return true;
  return text.includes("\n") || text.length > 120;
}

/** Everything that decides whether the Save button is worth offering. */
function snapshot(title: string, description: string, content: Record<string, unknown>): string {
  return JSON.stringify({ title, description, content });
}

/* ------------------------------------------------------------------ Screen */

/**
 * Editor for the words on each page of the marketing site.
 *
 * The page's content is stored as a free-form nested object, which used to mean
 * a raw text editor here. It doesn't have to: we walk whatever arrived and draw
 * a labelled box per value, hand-naming the blocks the site ships with and
 * falling back to a tidied-up version of the stored name for anything else.
 * Saving writes back the object we loaded with her edits applied in place, so
 * an unrecognised block survives being opened and saved.
 *
 * The wording stops short of promising an instant change: the marketing pages
 * still render their copy from the static `content/site` module rather than
 * from this record. Once they read it, the header description and the save
 * toast are the two strings to revisit.
 */
export default function PagesAdmin() {
  const [pages, setPages] = useState<PageSummary[] | null>(null);
  const [activeSlug, setActiveSlug] = useState<string | null>(null);
  const [page, setPage] = useState<Page | null>(null);
  const [content, setContent] = useState<Record<string, unknown>>({});
  const [baseline, setBaseline] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadList = useCallback(() => {
    adminApi
      .pagesList()
      .then((list) => {
        setPages(list);
        setActiveSlug((prev) => prev ?? list[0]?.slug ?? null);
      })
      .catch(() => setError("We couldn't load your pages. Try refreshing the page."));
  }, []);

  useEffect(loadList, [loadList]);

  useEffect(() => {
    if (!activeSlug) return;
    setPage(null);
    adminApi
      .pageGet(activeSlug)
      .then((loaded) => {
        const sections = isPlainObject(loaded.sections) ? loaded.sections : {};
        setPage(loaded);
        setContent(sections);
        setBaseline(snapshot(loaded.title, loaded.description, sections));
        setError(null);
      })
      .catch((err) => setError(friendlyError(err, "page")));
  }, [activeSlug]);

  const [confirm, confirmDialog] = useConfirm();

  const dirty = useMemo(
    () => page !== null && snapshot(page.title, page.description, content) !== baseline,
    [page, content, baseline],
  );

  const updateContent = useCallback((path: ContentPath, value: unknown) => {
    setContent((current) => setAtPath(current, path, value) as Record<string, unknown>);
  }, []);

  const blocks = useMemo(() => orderedBlocks(content), [content]);

  async function save() {
    if (!page) return;
    setSaving(true);
    try {
      await adminApi.pageUpdate(page.slug, {
        title: page.title,
        description: page.description,
        // The object we loaded, edited in place — never one rebuilt from the
        // boxes on screen, which would quietly lose anything not drawn.
        sections: content,
      });
      setBaseline(snapshot(page.title, page.description, content));
      toast.success("Saved as a draft — not on your live website yet.");
      loadList();
    } catch (err) {
      toast.error(friendlyError(err, "page"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Website"
        title="Pages"
        description="Draft the words for each page here. They aren't on your live website yet — your developer has to switch these pages over first."
        actions={
          <>
            {dirty && <Badge tone="gold">Unsaved changes</Badge>}
            <Button size="sm" onClick={save} disabled={saving || !dirty}>
              <Save />
              {saving ? "Saving…" : "Save page"}
            </Button>
          </>
        }
      />

      {error && <ErrorNotice message={error} />}

      {pages === null ? (
        <Skeleton className="h-64 w-full" />
      ) : pages.length === 0 ? (
        <Card>
          <EmptyState
            icon={<FileStack />}
            title="No pages yet"
            description="Your website pages will appear here once they're set up."
          />
        </Card>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[16rem_minmax(0,1fr)]">
          <Card className="h-fit">
            <CardHeader title="Your pages" />
            <ul className="space-y-0.5 p-2">
              {pages.map((p) => (
                <li key={p.slug}>
                  <button
                    type="button"
                    onClick={async () => {
                      if (p.slug === activeSlug) return;
                      if (
                        dirty &&
                        !(await confirm({
                          title: "Leave without saving?",
                          description: "The changes you've made to this page will be lost.",
                          confirmLabel: "Yes, leave it",
                          destructive: true,
                        }))
                      ) {
                        return;
                      }
                      setActiveSlug(p.slug);
                    }}
                    className={cn(
                      "w-full rounded-lg px-3 py-2.5 text-left transition-colors",
                      activeSlug === p.slug ? "bg-lilac-tint" : "hover:bg-cream",
                    )}
                  >
                    <span
                      className={cn(
                        "block truncate text-sm",
                        activeSlug === p.slug
                          ? "font-semibold text-plum-deep"
                          : "text-ink-soft",
                      )}
                    >
                      {p.title || humanizeKey(p.slug)}
                    </span>
                    <span className="block truncate text-[0.68rem] text-ink-soft/70">
                      Last edited {formatRelative(p.updatedAt)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            {page === null ? (
              <div className="space-y-3 p-5">
                <Skeleton className="h-11 w-full" />
                <Skeleton className="h-64 w-full" />
              </div>
            ) : (
              <>
                <CardHeader
                  title={page.title || humanizeKey(page.slug)}
                  // The home page is served at the site root, so spelling its
                  // stored name out would show her an address that doesn't open.
                  subtitle={webAddressLabel("", page.slug === "home" ? "" : page.slug)}
                  icon={<FileStack className="size-4" />}
                />

                <div className="space-y-6 p-5">
                  <Field label="Page title" hint="the name of this page">
                    <Input
                      value={page.title}
                      onChange={(e) => setPage((p) => (p ? { ...p, title: e.target.value } : p))}
                    />
                  </Field>
                  <Field
                    label="Description for Google"
                    hint="the grey summary line people see in search results"
                  >
                    <Input
                      value={page.description}
                      onChange={(e) =>
                        setPage((p) => (p ? { ...p, description: e.target.value } : p))
                      }
                    />
                  </Field>

                  <div className="space-y-3 border-t border-hairline/60 pt-5">
                    <div>
                      <h3 className="font-display text-sm text-ink">Page content</h3>
                      <p className="mt-0.5 text-xs text-ink-soft">
                        The words that appear on the page itself.
                      </p>
                    </div>

                    {blocks.length === 0 ? (
                      <p className="rounded-xl border border-hairline/60 bg-white/[0.02] px-4 py-3 text-sm text-ink-soft">
                        This page doesn't have any editable wording yet — its layout is built into
                        your site.
                      </p>
                    ) : (
                      blocks.map((key) => {
                        const heading = SECTION_HEADINGS[key];
                        return (
                          <div
                            key={key}
                            className="space-y-4 rounded-xl border border-hairline/60 bg-white/[0.02] p-4"
                          >
                            <div>
                              <p className="text-[0.8rem] font-semibold text-ink">
                                {heading?.title ?? humanizeKey(key)}
                              </p>
                              {heading?.hint && (
                                <p className="mt-0.5 text-xs text-ink-soft">{heading.hint}</p>
                              )}
                            </div>
                            <ContentValue
                              value={content[key]}
                              path={[key]}
                              depth={0}
                              onChange={updateContent}
                            />
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </>
            )}
          </Card>
        </div>
      )}

      {confirmDialog}
    </div>
  );
}

/* ------------------------------------------------------------ Content tree */

/**
 * Draws whatever is stored at `path`: a box for a single value, a stack of
 * boxes for a block, or a repeated group for a list.
 */
function ContentValue({
  value,
  path,
  depth,
  onChange,
}: {
  value: unknown;
  path: ContentPath;
  depth: number;
  onChange: (path: ContentPath, value: unknown) => void;
}) {
  // Nothing the site ships nests this deep, and past it the boxes lose the
  // context that makes them readable. Values we stop drawing are still saved
  // exactly as they arrived, because save merges rather than rebuilds.
  if (depth > 3) return null;

  if (Array.isArray(value)) {
    return (
      <div className="space-y-3">
        {value.map((item, index) => (
          <div
            key={index}
            className="space-y-4 rounded-xl border border-hairline/50 bg-white/[0.02] p-4"
          >
            <p className="text-[0.7rem] font-semibold uppercase tracking-[0.08em] text-ink-soft">
              {itemHeading(item, index)}
            </p>
            <ContentValue
              value={item}
              path={[...path, index]}
              depth={depth + 1}
              onChange={onChange}
            />
          </div>
        ))}
      </div>
    );
  }

  if (isPlainObject(value)) {
    return (
      <div className="space-y-4">
        {orderedKeys(value, path[path.length - 1]).map((key) => {
          const child = value[key];
          const childPath = [...path, key];

          if (isPlainObject(child) || Array.isArray(child)) {
            const inline = INLINE_BLOCKS.has(key);
            return (
              <div key={key} className="space-y-3">
                {!inline && (
                  <p className="text-[0.7rem] font-semibold uppercase tracking-[0.08em] text-ink-soft">
                    {humanizeKey(key)}
                  </p>
                )}
                <ContentValue
                  value={child}
                  path={childPath}
                  depth={depth + 1}
                  onChange={onChange}
                />
              </div>
            );
          }

          return <ContentLeaf key={key} value={child} path={childPath} onChange={onChange} />;
        })}
      </div>
    );
  }

  // A block stored as one bare line of copy still deserves a labelled box.
  return <ContentLeaf value={value} path={path} onChange={onChange} />;
}

/** One stored value, as the box she types into. */
function ContentLeaf({
  value,
  path,
  onChange,
}: {
  value: unknown;
  path: ContentPath;
  onChange: (path: ContentPath, value: unknown) => void;
}) {
  const key = path[path.length - 1];
  const label = labelFor(path);
  const hint = hintFor(path);

  if (typeof value === "boolean") {
    return (
      <label className="flex cursor-pointer items-center gap-2.5 text-sm font-medium text-ink">
        <input
          type="checkbox"
          checked={value}
          onChange={(e) => onChange(path, e.target.checked)}
          className="size-4 rounded border-hairline text-plum focus-visible:ring-plum/30"
        />
        {label}
      </label>
    );
  }

  if (typeof value === "number") {
    return (
      <Field label={label} hint={hint}>
        <Input
          type="number"
          value={value}
          onChange={(e) => {
            // A half-typed or emptied box must still hand back a number, or the
            // saved value would change type behind her.
            const next = Number(e.target.value);
            onChange(path, Number.isFinite(next) ? next : 0);
          }}
        />
      </Field>
    );
  }

  const text = value === null || value === undefined ? "" : String(value);

  return (
    <Field label={label} hint={hint}>
      {isParagraph(key, text) ? (
        <Textarea rows={4} value={text} onChange={(e) => onChange(path, e.target.value)} />
      ) : (
        <Input value={text} onChange={(e) => onChange(path, e.target.value)} />
      )}
    </Field>
  );
}
