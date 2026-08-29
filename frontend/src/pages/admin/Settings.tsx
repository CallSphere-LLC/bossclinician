import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AtSign,
  ChevronDown,
  ChevronUp,
  Menu,
  PanelBottom,
  Plus,
  RotateCcw,
  Save,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { adminApi } from "@/lib/api";
import { friendlyError } from "@/pages/admin/ui/friendly";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  ErrorNotice,
  Field,
  Input,
  PageHeader,
  selectStyles,
  Skeleton,
  Textarea,
} from "@/pages/admin/ui/primitives";

/**
 * The three site-wide things — the top menu, the footer, and how people reach
 * her — edited as ordinary form fields.
 *
 * These live in one free-form settings record, which is why this screen used to
 * be a raw text editor. The owner shouldn't have to know that: she edits a menu
 * link, and the merge back into the stored record happens here.
 *
 * The copy on this screen deliberately stops short of saying a change is live.
 * The public header and footer still read their links from the static
 * `content/site` module rather than from this record, so an "it's on your site
 * now" promise would be a lie until they're wired up — and the one thing a
 * non-technical owner can't debug is a screen that says it worked when it
 * didn't. Once the public site reads this record, the closing line and the save
 * toast are the two strings to revisit.
 */

/* ---------------------------------------------------------------- Her pages */

/**
 * The pages of her site, offered by name so a link can't be pointed at an
 * address that doesn't exist. Anything else — an older address, or a link to
 * somewhere off her site — falls through to the free-text box instead.
 */
const SITE_PAGES: { href: string; label: string }[] = [
  { href: "/", label: "Home" },
  { href: "/about", label: "About Yvette" },
  { href: "/work-with-me", label: "Work With Me" },
  { href: "/courses", label: "Courses" },
  { href: "/resources", label: "Free Resources" },
  { href: "/resource-hub", label: "Resource Hub" },
  { href: "/retreats", label: "Retreats" },
  { href: "/store", label: "Store" },
  { href: "/blog", label: "Blog" },
  { href: "/apply", label: "Application form" },
  { href: "/contact", label: "Contact" },
  { href: "/practice-quiz", label: "Practice quiz" },
  { href: "/practice-reset-planner", label: "Practice Reset Planner" },
  { href: "/privacy-policy", label: "Privacy policy" },
  { href: "/terms", label: "Terms of use" },
  { href: "/disclaimer", label: "Disclaimer" },
  { href: "/financial-disclaimer", label: "Financial disclaimer" },
];

const SOMEWHERE_ELSE = "__somewhere-else";

/* ------------------------------------------------------------- Stored shape */

/** One row of a link list: `{ label, href }`, plus anything else it arrived with. */
type LinkRow = {
  /** Stable across reorder and removal so a row keeps focus while she types. */
  id: number;
  label: string;
  href: string;
  /** True when the address isn't one of her pages, so it needs the free-text box. */
  custom: boolean;
  /** Keys we don't render, carried through untouched. */
  extra: Record<string, unknown>;
};

type SettingsForm = {
  nav: LinkRow[];
  tagline: string;
  taglineSub: string;
  legalLinks: LinkRow[];
  email: string;
  instagram: string;
};

/**
 * Which parts of the stored record this form is willing to write back.
 *
 * A value stored in a shape these fields can't represent is never overwritten —
 * losing her menu or footer on save is the worst thing this screen could do, so
 * anything unrecognised is passed straight back to the server as-is and the card
 * says so rather than quietly replacing it with what's on screen.
 */
type Editable = { nav: boolean; footer: boolean; legalLinks: boolean; contact: boolean };

let rowSeq = 0;
function nextRowId(): number {
  rowSeq += 1;
  return rowSeq;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A stored value a text box can hold: a string, or nothing yet. `null` = leave it alone. */
function readText(value: unknown): string | null {
  if (value === undefined || value === null) return "";
  return typeof value === "string" ? value : null;
}

/** A stored link list → editable rows, or `null` if it isn't a list of links at all. */
function readLinkRows(value: unknown): LinkRow[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return null;

  const rows: LinkRow[] = [];
  for (const item of value) {
    if (!isPlainObject(item)) return null;
    const { label, href, ...extra } = item;
    const text = readText(label);
    const address = readText(href);
    if (text === null || address === null) return null;
    rows.push({
      id: nextRowId(),
      label: text,
      href: address,
      custom: address !== "" && !SITE_PAGES.some((page) => page.href === address),
      extra,
    });
  }
  return rows;
}

/** Editable rows → the stored shape. Rows she added but never filled in are dropped. */
function writeLinkRows(rows: LinkRow[]): Record<string, unknown>[] {
  return rows
    .filter((row) => row.label.trim() !== "" || row.href.trim() !== "")
    .map((row) => ({ ...row.extra, label: row.label.trim(), href: row.href.trim() }));
}

function readSettings(data: Record<string, unknown>): { form: SettingsForm; editable: Editable } {
  const navRows = readLinkRows(data.nav);

  const footerObj = isPlainObject(data.footer)
    ? data.footer
    : data.footer === undefined || data.footer === null
      ? {}
      : null;
  const tagline = footerObj ? readText(footerObj.tagline) : null;
  const taglineSub = footerObj ? readText(footerObj.taglineSub) : null;
  const footerEditable = tagline !== null && taglineSub !== null;
  const legalRows = footerEditable && footerObj ? readLinkRows(footerObj.legalLinks) : null;

  const contactObj = isPlainObject(data.contact)
    ? data.contact
    : data.contact === undefined || data.contact === null
      ? {}
      : null;
  const email = contactObj ? readText(contactObj.email) : null;
  const instagram = contactObj ? readText(contactObj.instagram) : null;

  return {
    form: {
      nav: navRows ?? [],
      tagline: tagline ?? "",
      taglineSub: taglineSub ?? "",
      legalLinks: legalRows ?? [],
      email: email ?? "",
      instagram: instagram ?? "",
    },
    editable: {
      nav: navRows !== null,
      footer: footerEditable,
      legalLinks: legalRows !== null,
      contact: email !== null && instagram !== null,
    },
  };
}

/** True when the stored record actually carried this value. */
function wasStored(value: unknown): boolean {
  return value !== undefined && value !== null;
}

/**
 * The whole stored record with her edits applied on top.
 *
 * It starts from everything the server handed us because saving upserts each
 * key it receives: anything this form doesn't show — now or after a future
 * change — has to be handed back or it would be stranded at its old value.
 *
 * The same upsert is why each part is only written back when the record already
 * carried it or she has actually put something in it. Writing an empty menu for
 * a record that never had one would add a menu she never asked for.
 */
function buildPayload(
  loaded: Record<string, unknown>,
  form: SettingsForm,
  editable: Editable,
): Record<string, unknown> {
  // Only what this screen owns. Starting from everything the server sent meant
  // saving her website details wrote back a whole snapshot of the settings
  // table — quietly undoing anything changed on another settings screen since
  // this one was opened.
  const payload: Record<string, unknown> = {};

  const navRows = writeLinkRows(form.nav);
  if (editable.nav && (wasStored(loaded.nav) || navRows.length > 0)) payload.nav = navRows;

  if (editable.footer) {
    const loadedFooter = isPlainObject(loaded.footer) ? loaded.footer : {};
    const legalRows = writeLinkRows(form.legalLinks);
    const footer: Record<string, unknown> = {
      ...loadedFooter,
      tagline: form.tagline.trim(),
      taglineSub: form.taglineSub.trim(),
    };
    if (editable.legalLinks && (wasStored(loadedFooter.legalLinks) || legalRows.length > 0)) {
      footer.legalLinks = legalRows;
    }
    const hasFooterWords = footer.tagline !== "" || footer.taglineSub !== "";
    if (wasStored(loaded.footer) || hasFooterWords || legalRows.length > 0) {
      payload.footer = footer;
    }
  }

  if (editable.contact) {
    const email = form.email.trim();
    const instagram = form.instagram.trim();
    if (wasStored(loaded.contact) || email !== "" || instagram !== "") {
      payload.contact = {
        ...(isPlainObject(loaded.contact) ? loaded.contact : {}),
        email,
        instagram,
      };
    }
  }

  return payload;
}

/** Matches the Input primitive's shell — the kit has no select of its own. */
/* ----------------------------------------------------------- Link list rows */

/** What's missing from a row she's started filling in. Blank rows aren't nagged. */
function rowProblems(row: LinkRow): { text?: string; page?: string } {
  const hasText = row.label.trim() !== "";
  const hasAddress = row.href.trim() !== "";
  if (!hasText && !hasAddress) return {};
  return {
    text: hasText ? undefined : "Add the words people will click on.",
    page: hasAddress ? undefined : "Choose where this link should go.",
  };
}

function countUnfinished(rows: LinkRow[]): number {
  return rows.filter((row) => {
    const problems = rowProblems(row);
    return Boolean(problems.text || problems.page);
  }).length;
}

function LinkRowEditor({
  rows,
  onChange,
  textLabel,
  textPlaceholder,
  addLabel,
  emptyText,
  showProblems,
}: {
  rows: LinkRow[];
  onChange: (rows: LinkRow[]) => void;
  textLabel: string;
  textPlaceholder: string;
  addLabel: string;
  emptyText: string;
  showProblems: boolean;
}) {
  function update(index: number, patch: Partial<LinkRow>) {
    onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= rows.length) return;
    const next = [...rows];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  }

  return (
    <div className="space-y-2.5">
      {rows.length === 0 && (
        <p className="rounded-xl border border-dashed border-hairline px-4 py-6 text-center text-sm text-ink-soft">
          {emptyText}
        </p>
      )}

      {rows.map((row, i) => {
        const problems: { text?: string; page?: string } = showProblems ? rowProblems(row) : {};
        const name = row.label.trim() || "this link";
        const textId = `link-text-${row.id}`;
        const pageId = `link-page-${row.id}`;

        return (
          <div
            key={row.id}
            className="flex flex-wrap items-start gap-2.5 rounded-xl border border-hairline p-3"
          >
            <Field
              label={textLabel}
              htmlFor={textId}
              error={problems.text}
              className="min-w-[10rem] flex-1"
            >
              <Input
                id={textId}
                value={row.label}
                placeholder={textPlaceholder}
                onChange={(e) => update(i, { label: e.target.value })}
              />
            </Field>

            <Field
              label="Page"
              htmlFor={pageId}
              error={problems.page}
              className="min-w-[12rem] flex-1"
            >
              <select
                id={pageId}
                value={row.custom ? SOMEWHERE_ELSE : row.href}
                onChange={(e) => {
                  const value = e.target.value;
                  if (value === SOMEWHERE_ELSE) update(i, { custom: true });
                  else update(i, { custom: false, href: value });
                }}
                className={selectStyles}
              >
                <option value="">Choose a page…</option>
                {SITE_PAGES.map((page) => (
                  <option key={page.href} value={page.href}>
                    {page.label}
                  </option>
                ))}
                <option value={SOMEWHERE_ELSE}>Somewhere else…</option>
              </select>

              {row.custom && (
                <Input
                  className="mt-2"
                  value={row.href}
                  placeholder="https://example.com/my-page"
                  aria-label={`Where ${name} goes`}
                  onChange={(e) => update(i, { href: e.target.value })}
                />
              )}
            </Field>

            <div className="mt-6 flex shrink-0 items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="iconSm"
                aria-label={`Move ${name} up`}
                disabled={i === 0}
                onClick={() => move(i, -1)}
              >
                <ChevronUp />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="iconSm"
                aria-label={`Move ${name} down`}
                disabled={i === rows.length - 1}
                onClick={() => move(i, 1)}
              >
                <ChevronDown />
              </Button>
              <Button
                type="button"
                variant="dangerGhost"
                size="iconSm"
                aria-label={`Remove ${name}`}
                onClick={() => onChange(rows.filter((_, idx) => idx !== i))}
              >
                <Trash2 />
              </Button>
            </div>
          </div>
        );
      })}

      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() =>
          onChange([...rows, { id: nextRowId(), label: "", href: "", custom: false, extra: {} }])
        }
      >
        <Plus />
        {addLabel}
      </Button>
    </div>
  );
}

/** Shown in place of a card's fields when its stored value isn't one we can edit. */
function NotEditableNotice({ what }: { what: string }) {
  return (
    <p className="rounded-xl border border-dashed border-hairline px-4 py-4 text-sm leading-relaxed text-ink-soft">
      Your {what} was set up in a way this page can't show. It's kept exactly as it is and saving
      here won't change it — ask whoever built your site if you'd like it altered.
    </p>
  );
}

/* ---------------------------------------------------------------- The screen */

export default function SettingsPage() {
  const [loaded, setLoaded] = useState<Record<string, unknown> | null>(null);
  const [form, setForm] = useState<SettingsForm | null>(null);
  const [original, setOriginal] = useState<SettingsForm | null>(null);
  const [editable, setEditable] = useState<Editable>({
    nav: true,
    footer: true,
    legalLinks: true,
    contact: true,
  });
  /** The saved state as a payload, so "has anything changed?" is one comparison. */
  const [baseline, setBaseline] = useState("");
  const [showProblems, setShowProblems] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apply = useCallback((data: Record<string, unknown>) => {
    const { form: next, editable: nextEditable } = readSettings(data);
    setLoaded(data);
    setForm(next);
    setOriginal(next);
    setEditable(nextEditable);
    setBaseline(JSON.stringify(buildPayload(data, next, nextEditable)));
    setShowProblems(false);
  }, []);

  useEffect(() => {
    adminApi
      .settingsGet()
      .then(apply)
      .catch(() => setError("We couldn't load your website details. Try refreshing the page."))
      .finally(() => setLoading(false));
  }, [apply]);

  const payload = useMemo(
    () => (loaded && form ? buildPayload(loaded, form, editable) : null),
    [loaded, form, editable],
  );
  const dirty = payload !== null && JSON.stringify(payload) !== baseline;

  function patch(changes: Partial<SettingsForm>) {
    setForm((current) => (current ? { ...current, ...changes } : current));
  }

  async function handleSave() {
    if (!payload || !dirty || !form) return;

    // A half-finished link is marked so she can find it, but it never blocks
    // the save: a link that arrived incomplete would otherwise stop her
    // changing her email address on the same screen.
    const unfinished = countUnfinished(form.nav) + countUnfinished(form.legalLinks);

    setSaving(true);
    try {
      // The server replies with everything it now holds, so re-reading its
      // answer is also the proof that what she sees is what's stored.
      const saved = await adminApi.settingsUpdate(payload);
      apply(saved);
      // `apply` clears the marks, so put them back for anything still unfinished.
      if (unfinished > 0) setShowProblems(true);
      toast.success(
        unfinished === 0
          ? "Saved."
          : unfinished === 1
            ? "Saved — one of your links still needs finishing."
            : `Saved — ${unfinished} of your links still need finishing.`,
      );
    } catch (err) {
      toast.error(friendlyError(err, "change"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Website"
        title="Website Details"
        description="Your menu, footer and contact details, kept in one place for your website."
        actions={
          <>
            {dirty && <Badge tone="gold">Unsaved changes</Badge>}
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setForm(original);
                setShowProblems(false);
              }}
              disabled={!dirty}
            >
              <RotateCcw />
              Undo my changes
            </Button>
            <Button size="sm" onClick={handleSave} disabled={saving || !dirty}>
              <Save />
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </>
        }
      />

      {error && <ErrorNotice message={error} />}

      {loading && (
        <div className="space-y-6">
          <Skeleton className="h-72 w-full" />
          <Skeleton className="h-80 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      )}

      {!loading && form && (
        <>
          <Card>
            <CardHeader
              title="Main menu"
              subtitle="The links for the menu across the top of your site."
              icon={<Menu className="size-4" />}
            />
            <div className="p-5">
              {editable.nav ? (
                <LinkRowEditor
                  rows={form.nav}
                  onChange={(nav) => patch({ nav })}
                  textLabel="Menu label"
                  textPlaceholder="About Yvette"
                  addLabel="Add a menu link"
                  emptyText="No menu links yet — add the first one so people can find their way around."
                  showProblems={showProblems}
                />
              ) : (
                <NotEditableNotice what="menu" />
              )}
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Footer"
              subtitle="The wording and small-print links for the bottom of your site."
              icon={<PanelBottom className="size-4" />}
            />
            <div className="space-y-5 p-5">
              {editable.footer ? (
                <>
                  <Field
                    label="Tagline"
                    hint="the bold line in your footer"
                    htmlFor="footer-tagline"
                  >
                    <Input
                      id="footer-tagline"
                      value={form.tagline}
                      placeholder="Join Our Free Trial"
                      onChange={(e) => patch({ tagline: e.target.value })}
                    />
                  </Field>

                  <Field
                    label="Supporting line"
                    hint="the smaller sentence underneath it"
                    htmlFor="footer-tagline-sub"
                  >
                    <Textarea
                      id="footer-tagline-sub"
                      rows={2}
                      value={form.taglineSub}
                      placeholder="Get started today before this once in a lifetime opportunity expires."
                      onChange={(e) => patch({ taglineSub: e.target.value })}
                    />
                  </Field>

                  <div>
                    <p className="mb-1.5 text-[0.8rem] font-semibold text-ink">
                      Legal links{" "}
                      <span className="font-normal text-ink-soft/80">
                        the small print row along the very bottom
                      </span>
                    </p>
                    {editable.legalLinks ? (
                      <LinkRowEditor
                        rows={form.legalLinks}
                        onChange={(legalLinks) => patch({ legalLinks })}
                        textLabel="Link text"
                        textPlaceholder="Privacy Policy"
                        addLabel="Add a legal link"
                        emptyText="No legal links yet — most sites list a privacy policy and terms of use here."
                        showProblems={showProblems}
                      />
                    ) : (
                      <NotEditableNotice what="legal links" />
                    )}
                  </div>
                </>
              ) : (
                <NotEditableNotice what="footer" />
              )}
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Contact details"
              subtitle="How people reach you, kept here for your contact page and footer."
              icon={<AtSign className="size-4" />}
            />
            <div className="grid gap-5 p-5 sm:grid-cols-2">
              {editable.contact ? (
                <>
                  <Field
                    label="Email address"
                    hint="where enquiries reach you"
                    htmlFor="contact-email"
                  >
                    <Input
                      id="contact-email"
                      type="email"
                      value={form.email}
                      placeholder="you@yourbusiness.com"
                      onChange={(e) => patch({ email: e.target.value })}
                    />
                  </Field>

                  <Field label="Instagram handle" hint="include the @" htmlFor="contact-instagram">
                    <Input
                      id="contact-instagram"
                      value={form.instagram}
                      placeholder="@profitwithyvette"
                      onChange={(e) => patch({ instagram: e.target.value })}
                    />
                  </Field>
                </>
              ) : (
                <div className="sm:col-span-2">
                  <NotEditableNotice what="contact details" />
                </div>
              )}
            </div>
          </Card>

          {/* Deliberately not "this is live on your site now": the public site
              still carries its own copy of the menu and footer, so promising an
              instant change here would send her looking for one that isn't
              there. Say what saving actually does and nothing more. */}
          <p className="text-sm text-ink-soft">
            Your website picks these details up the next time it's published.
          </p>
        </>
      )}
    </div>
  );
}
