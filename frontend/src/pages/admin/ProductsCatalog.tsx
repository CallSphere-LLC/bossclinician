import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { motion } from "motion/react";
import {
  Archive,
  ArchiveRestore,
  FileText,
  FolderOpen,
  Image as ImageIcon,
  Layers,
  Package,
  Pencil,
  Plus,
  Tag,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { adminApi } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatBytes, formatNumber } from "@/lib/format";
import type { Course } from "@/types";
import type { CoachingOffer, Community, MediaAsset, Newsletter, Podcast } from "@/types/admin";
import {
  adminCommerceApi,
  commerceMessage,
  fieldErrorsOf,
  PRODUCT_KIND,
  PRODUCT_STATUS_LABEL,
  type CatalogStatus,
  type Product,
  type ProductFile,
  type ProductInput,
  type ProductKind,
} from "@/lib/adminCommerceApi";
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
import { UploadDropzone } from "@/pages/admin/ui/Uploader";
import { PicturePickerModal } from "@/pages/admin/CrudManager";
import { pluralize, slugify, uniqueKey } from "@/pages/admin/ui/friendly";

/**
 * The catalogue — everything access can be granted to.
 *
 * Nothing here carries a price: a price and a checkout page for one of these is
 * an offer, and one thing in this list can sit behind as many offers as she
 * likes. Keeping the two screens apart is what makes "the same toolkit at seven
 * different prices" one row here and seven rows there.
 */

/** The order she thinks about her own work in, not the order the list arrives. */
const KIND_ORDER: ProductKind[] = [
  "course",
  "download",
  "bundle",
  "coaching",
  "community",
  "podcast",
  "newsletter",
  "access_group",
];

/** Which link on a product names the thing it actually unlocks. */
const RESOURCE_FIELD = {
  course: "courseId",
  community: "communityId",
  podcast: "podcastId",
  newsletter: "newsletterId",
  coaching: "coachingOfferId",
} as const satisfies Partial<Record<ProductKind, keyof ProductInput>>;

type LinkedKind = keyof typeof RESOURCE_FIELD;

function isLinkedKind(kind: ProductKind): kind is LinkedKind {
  return kind in RESOURCE_FIELD;
}

const STATUS_TONE: Record<CatalogStatus, NonNullable<BadgeProps["tone"]>> = {
  published: "green",
  draft: "slate",
  archived: "neutral",
};

/** Matches the Input primitive so a row of controls reads as one set. */
/** What the picker for each linked kind is called, and what it asks for. */
const RESOURCE_PROMPT: Record<LinkedKind, { label: string; empty: string }> = {
  course: { label: "Which course does this unlock?", empty: "You haven't built a course yet." },
  community: { label: "Which community does this let them into?", empty: "You haven't started a community yet." },
  podcast: { label: "Which show does this unlock?", empty: "You haven't set up a private show yet." },
  newsletter: { label: "Which newsletter does this unlock?", empty: "You haven't set up a newsletter yet." },
  coaching: { label: "Which coaching package is this?", empty: "You haven't set up a coaching package yet." },
};

interface ResourceOption {
  id: number;
  label: string;
}

interface Draft {
  id: number | null;
  kind: ProductKind;
  title: string;
  subtitle: string;
  description: string;
  thumbnailUrl: string;
  status: CatalogStatus;
  resourceId: number | null;
}

function blankDraft(kind: ProductKind): Draft {
  return {
    id: null,
    kind,
    title: "",
    subtitle: "",
    description: "",
    thumbnailUrl: "",
    status: "published",
    resourceId: null,
  };
}

function draftFrom(product: Product): Draft {
  return {
    id: product.id,
    kind: product.kind,
    title: product.title,
    subtitle: product.subtitle,
    description: product.description,
    thumbnailUrl: product.thumbnailUrl,
    status: product.status,
    resourceId:
      product.courseId ??
      product.communityId ??
      product.podcastId ??
      product.newsletterId ??
      product.coachingOfferId,
  };
}

/**
 * Optionally narrowed to one kind.
 *
 * The Downloads entry in the sidebar is this screen with `restrictKind` set,
 * not a second page over the same rows — §1 of the sidebar requirements rules
 * out duplicate pages, and a filtered view of the catalogue is the honest way
 * to give downloads a home of their own.
 */
export default function ProductsCatalog({
  restrictKind,
  heading,
  description,
}: {
  restrictKind?: ProductKind;
  heading?: string;
  description?: string;
} = {}) {
  const [products, setProducts] = useState<Product[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showRetired, setShowRetired] = useState(false);

  const [choosingKind, setChoosingKind] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [draftErrors, setDraftErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [picking, setPicking] = useState(false);

  const [files, setFiles] = useState<Product | null>(null);
  const [bundle, setBundle] = useState<Product | null>(null);

  const [courses, setCourses] = useState<ResourceOption[]>([]);
  const [communities, setCommunities] = useState<ResourceOption[]>([]);
  const [podcasts, setPodcasts] = useState<ResourceOption[]>([]);
  const [newsletters, setNewsletters] = useState<ResourceOption[]>([]);
  const [coaching, setCoaching] = useState<ResourceOption[]>([]);

  const [confirm, confirmDialog] = useConfirm();

  const load = useCallback(() => {
    adminCommerceApi
      .productList()
      .then((list) => {
        setProducts(list);
        setError(null);
      })
      .catch(() => setError("We couldn't load your catalogue. Try refreshing the page."));
  }, []);

  useEffect(load, [load]);

  useEffect(() => {
    adminApi
      .coursesList()
      .then((list) => setCourses(list.map((c: Course) => ({ id: Number(c.id), label: c.title }))))
      .catch(() => setCourses([]));
    adminApi
      .communities()
      .then((list) => setCommunities(list.map((c: Community) => ({ id: c.id, label: c.name }))))
      .catch(() => setCommunities([]));
    adminApi
      .growthList<Podcast>("podcasts")
      .then((list) => setPodcasts(list.map((p) => ({ id: p.id, label: p.title }))))
      .catch(() => setPodcasts([]));
    adminApi
      .growthList<Newsletter>("newsletters")
      .then((list) => setNewsletters(list.map((n) => ({ id: n.id, label: n.name }))))
      .catch(() => setNewsletters([]));
    adminApi
      .growthList<CoachingOffer>("coaching/offers")
      .then((list) => setCoaching(list.map((o) => ({ id: o.id, label: o.title }))))
      .catch(() => setCoaching([]));
  }, []);

  const optionsFor = useCallback(
    (kind: ProductKind): ResourceOption[] => {
      if (kind === "course") return courses;
      if (kind === "community") return communities;
      if (kind === "podcast") return podcasts;
      if (kind === "newsletter") return newsletters;
      if (kind === "coaching") return coaching;
      return [];
    },
    [courses, communities, podcasts, newsletters, coaching],
  );

  const grouped = useMemo(() => {
    if (products === null) return null;
    const showing = restrictKind
      ? products.filter((product) => product.kind === restrictKind)
      : products;
    const visible = showRetired
      ? showing
      : showing.filter((product) => product.status !== "archived");
    const order = restrictKind ? [restrictKind] : KIND_ORDER;
    return order
      .map((kind) => ({ kind, items: visible.filter((product) => product.kind === kind) }))
      .filter((group) => group.items.length > 0);
  }, [products, showRetired, restrictKind]);

  // Counted within the restriction, so the Downloads screen does not offer to
  // reveal retired courses.
  const retiredCount = (products ?? []).filter(
    (product) =>
      product.status === "archived" && (!restrictKind || product.kind === restrictKind),
  ).length;

  function startNew(kind: ProductKind) {
    setChoosingKind(false);
    setDraft(blankDraft(kind));
    setDraftErrors({});
  }

  function startEdit(product: Product) {
    setDraft(draftFrom(product));
    setDraftErrors({});
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!draft || !draft.title.trim()) return;

    const kind = draft.kind;
    let resource: Partial<ProductInput> = {};
    if (isLinkedKind(kind)) {
      if (draft.resourceId === null) {
        setDraftErrors({
          resource: "Pick the thing this unlocks, or nobody gets anything when they buy.",
        });
        return;
      }
      resource = { [RESOURCE_FIELD[kind]]: draft.resourceId };
    }

    setSaving(true);
    try {
      const shared = {
        title: draft.title.trim(),
        subtitle: draft.subtitle.trim(),
        description: draft.description.trim(),
        thumbnailUrl: draft.thumbnailUrl,
        status: draft.status,
        ...resource,
      };

      if (draft.id === null) {
        // Generated once, from the name. It is the address the delivery pages
        // use, so an existing product never has its own changed underneath it.
        const taken = (products ?? []).map((product) => product.slug);
        const base = slugify(draft.title) || "item";
        await adminCommerceApi.productCreate({
          slug: uniqueKey(base, taken, "-"),
          kind,
          courseId: null,
          communityId: null,
          podcastId: null,
          newsletterId: null,
          coachingOfferId: null,
          sort: products?.length ?? 0,
          ...shared,
        });
        toast.success(`“${draft.title.trim()}” is in your catalogue.`);
      } else {
        await adminCommerceApi.productUpdate(draft.id, shared);
        toast.success("Saved.");
      }
      setDraft(null);
      load();
    } catch (err) {
      // Every correction used to be re-filed under the resource picker, which
      // most kinds don't even show — a complaint about the picture ended up
      // invisible, or under "which course does this unlock".
      const fields = fieldErrorsOf(err);
      const linked = isLinkedKind(kind) ? fields[RESOURCE_FIELD[kind]] : undefined;
      setDraftErrors({ ...fields, ...(linked ? { resource: linked } : {}) });
      toast.error(commerceMessage(err, "item"));
    } finally {
      setSaving(false);
    }
  }

  async function setStatus(product: Product, status: CatalogStatus) {
    try {
      await adminCommerceApi.productUpdate(product.id, { status });
      toast.success(
        status === "archived"
          ? `“${product.title}” is retired. Nobody new can be given it.`
          : `“${product.title}” is back in your catalogue.`,
      );
      load();
    } catch (err) {
      toast.error(commerceMessage(err, "item"));
    }
  }

  async function remove(product: Product) {
    const ok = await confirm({
      title: `Delete “${product.title}”?`,
      description: "It disappears from your catalogue for good. You can't undo this.",
      confirmLabel: "Yes, delete it",
      destructive: true,
    });
    if (!ok) return;
    try {
      await adminCommerceApi.productRemove(product.id);
      toast.success("Deleted.");
      load();
    } catch (err) {
      // The server refuses while anyone owns it or an offer sells it, and says
      // exactly who and what — which is far more use than "couldn't delete".
      toast.error(commerceMessage(err, "item"));
    }
  }

  const draftOptions = draft ? optionsFor(draft.kind) : [];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Content & Services"
        title={heading ?? "Catalogue"}
        description={
          description ??
          "Everything you sell or give away, grouped by what the customer receives. Put a price on one of these and you have an offer."
        }
        actions={
          <Button size="sm" onClick={() => setChoosingKind(true)}>
            <Plus />
            Add something to sell
          </Button>
        }
      />

      {error && <ErrorNotice message={error} />}

      {products === null ? (
        <div className="space-y-5">
          {Array.from({ length: 2 }, (_, i) => (
            <Skeleton key={i} className="h-52 w-full" />
          ))}
        </div>
      ) : products.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Package />}
            title="Nothing in your catalogue yet"
            description="This is the list of things people can be given — a course, a pack of files, a community, time with you. Add one, then put a price on it and you have something to sell."
            action={
              <Button size="sm" onClick={() => setChoosingKind(true)}>
                <Plus />
                Add your first one
              </Button>
            }
          />
        </Card>
      ) : (
        <>
          {retiredCount > 0 && (
            <label className="inline-flex cursor-pointer items-center gap-2.5 text-sm text-ink-soft">
              <input
                type="checkbox"
                checked={showRetired}
                onChange={(e) => setShowRetired(e.target.checked)}
                className="size-4 rounded border-hairline text-plum focus-visible:ring-plum/30"
              />
              Show the {pluralize(retiredCount, "retired one", "retired ones")}
            </label>
          )}

          <div className="space-y-5">
            {grouped !== null && grouped.length === 0 && (
              <Card>
                <EmptyState
                  icon={<Archive />}
                  title="Everything here is retired"
                  description="Nothing in your catalogue is in use at the moment. Tick the box above to see the retired ones and bring one back."
                />
              </Card>
            )}
            {(grouped ?? []).map((group, groupIndex) => (
              <motion.div
                key={group.kind}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(groupIndex * 0.04, 0.24) }}
              >
                <Card>
                  <CardHeader
                    icon={<Package className="size-4" />}
                    title={PRODUCT_KIND[group.kind].many}
                    subtitle={PRODUCT_KIND[group.kind].blurb}
                    action={
                      <span className="text-xs font-medium text-ink-soft">
                        {formatNumber(group.items.length)}
                      </span>
                    }
                  />
                  <ul className="divide-y divide-hairline/60">
                    {group.items.map((product) => (
                      <li
                        key={product.id}
                        className="flex flex-wrap items-center gap-3 px-5 py-4"
                      >
                        {product.thumbnailUrl ? (
                          <img
                            src={product.thumbnailUrl}
                            alt=""
                            loading="lazy"
                            className="size-11 shrink-0 rounded-xl object-cover"
                          />
                        ) : (
                          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-gold/[0.12] text-gold">
                            <Package className="size-5" />
                          </span>
                        )}

                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="truncate font-semibold text-ink">{product.title}</p>
                            {product.status !== "published" && (
                              <Badge tone={STATUS_TONE[product.status]}>
                                {PRODUCT_STATUS_LABEL[product.status]}
                              </Badge>
                            )}
                          </div>
                          <p className="mt-0.5 truncate text-xs text-ink-soft">
                            {describe(product)}
                          </p>
                        </div>

                        <div className="flex flex-wrap items-center gap-1.5">
                          {product.kind === "download" && (
                            <Button variant="secondary" size="sm" onClick={() => setFiles(product)}>
                              <FolderOpen />
                              {product.fileCount > 0
                                ? pluralize(product.fileCount, "file")
                                : "Add files"}
                            </Button>
                          )}
                          {product.kind === "bundle" && (
                            <Button variant="secondary" size="sm" onClick={() => setBundle(product)}>
                              <Layers />
                              What's inside
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="iconSm"
                            aria-label={`Edit ${product.title}`}
                            onClick={() => startEdit(product)}
                          >
                            <Pencil />
                          </Button>
                          {product.status === "archived" ? (
                            <Button
                              variant="ghost"
                              size="iconSm"
                              aria-label={`Put ${product.title} back in your catalogue`}
                              onClick={() => void setStatus(product, "draft")}
                            >
                              <ArchiveRestore />
                            </Button>
                          ) : (
                            <Button
                              variant="ghost"
                              size="iconSm"
                              aria-label={`Retire ${product.title}`}
                              onClick={() => void setStatus(product, "archived")}
                            >
                              <Archive />
                            </Button>
                          )}
                          <Button
                            variant="dangerGhost"
                            size="iconSm"
                            aria-label={`Delete ${product.title}`}
                            onClick={() => void remove(product)}
                          >
                            <Trash2 />
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </Card>
              </motion.div>
            ))}
          </div>
        </>
      )}

      {/* Step one of adding something: what sort of thing is it? */}
      <Modal
        open={choosingKind}
        onOpenChange={setChoosingKind}
        title="What are you adding?"
        description="Pick the sort of thing it is — you can put a price on it afterwards."
        size="lg"
      >
        <div className="grid gap-2.5 sm:grid-cols-2">
          {KIND_ORDER.map((kind) => (
            <button
              key={kind}
              type="button"
              onClick={() => startNew(kind)}
              className="flex items-start gap-3 rounded-xl border border-hairline bg-raise px-4 py-3 text-left transition-all hover:border-gold/50 hover:bg-gold/[0.06]"
            >
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-gold/[0.12] text-gold">
                <Package className="size-4" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-ink">
                  {PRODUCT_KIND[kind].one}
                </span>
                <span className="mt-0.5 block text-xs text-ink-soft">
                  {PRODUCT_KIND[kind].blurb}
                </span>
              </span>
            </button>
          ))}
        </div>
      </Modal>

      {/* Step two: its name, its picture, and what it unlocks. */}
      <Modal
        open={draft !== null}
        onOpenChange={(open) => !open && setDraft(null)}
        title={draft && draft.id === null ? "Add something to sell" : "Edit this"}
        description={draft ? PRODUCT_KIND[draft.kind].blurb : undefined}
        size="lg"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button size="sm" type="submit" form="product-form" disabled={saving}>
              {saving ? "Saving…" : "Save it"}
            </Button>
          </>
        }
      >
        {draft && (
          <form id="product-form" onSubmit={save} className="grid gap-4">
            <Field
              label="What is it called?"
              hint="what people see in their library"
              error={draftErrors.title}
            >
              <Input
                value={draft.title}
                onChange={(e) => setDraft((d) => (d ? { ...d, title: e.target.value } : d))}
                placeholder="The Practice Protection Pack"
                required
                autoFocus
              />
            </Field>

            {isLinkedKind(draft.kind) && (
              <Field
                label={RESOURCE_PROMPT[draft.kind].label}
                error={draftErrors.resource}
              >
                {draftOptions.length === 0 ? (
                  <p className="text-xs text-ink-soft">{RESOURCE_PROMPT[draft.kind].empty}</p>
                ) : (
                  <select
                    value={draft.resourceId ?? ""}
                    onChange={(e) =>
                      setDraft((d) =>
                        d ? { ...d, resourceId: e.target.value ? Number(e.target.value) : null } : d,
                      )
                    }
                    aria-label={RESOURCE_PROMPT[draft.kind].label}
                    className={selectStyles}
                  >
                    <option value="">Choose one…</option>
                    {draftOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            )}

            <Field label="One-line summary" hint="optional">
              <Input
                value={draft.subtitle}
                onChange={(e) => setDraft((d) => (d ? { ...d, subtitle: e.target.value } : d))}
                placeholder="Every contract and consent form I use in my own practice"
              />
            </Field>

            <Field label="Description" hint="optional">
              <Textarea
                rows={3}
                value={draft.description}
                onChange={(e) => setDraft((d) => (d ? { ...d, description: e.target.value } : d))}
                placeholder="What's in it and who it's for."
              />
            </Field>

            <Field label="Picture" error={draftErrors.thumbnailUrl}>
              {draft.thumbnailUrl ? (
                <div className="flex flex-wrap items-center gap-3 rounded-xl border border-hairline bg-raise p-2.5">
                  <img
                    src={draft.thumbnailUrl}
                    alt=""
                    className="h-16 w-24 shrink-0 rounded-lg object-cover"
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="secondary" size="sm" onClick={() => setPicking(true)}>
                      Choose a different one
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setDraft((d) => (d ? { ...d, thumbnailUrl: "" } : d))}
                    >
                      Remove it
                    </Button>
                  </div>
                </div>
              ) : (
                <Button type="button" variant="secondary" size="sm" onClick={() => setPicking(true)}>
                  <ImageIcon />
                  Choose a picture
                </Button>
              )}
            </Field>

            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-hairline bg-raise px-4 py-3">
              <input
                type="checkbox"
                checked={draft.status === "published"}
                onChange={(e) =>
                  setDraft((d) => (d ? { ...d, status: e.target.checked ? "published" : "draft" } : d))
                }
                className="mt-0.5 size-4 rounded border-hairline text-plum focus-visible:ring-plum/30"
              />
              <span>
                <span className="block text-sm font-semibold text-ink">Ready to sell</span>
                <span className="mt-0.5 block text-xs text-ink-soft">
                  Untick while you're still putting it together — you can still add it to an offer.
                </span>
              </span>
            </label>
          </form>
        )}
      </Modal>

      <FilesModal product={files} onClose={() => setFiles(null)} onChanged={load} confirm={confirm} />

      <BundleModal
        product={bundle}
        catalogue={products ?? []}
        onClose={() => setBundle(null)}
        onChanged={load}
      />

      <PicturePickerModal
        open={picking}
        onOpenChange={setPicking}
        onSelect={(asset) => {
          setDraft((d) => (d ? { ...d, thumbnailUrl: asset.url } : d));
          setPicking(false);
        }}
      />

      {confirmDialog}
    </div>
  );
}

/** The line under a product's name: what it is, who has it, what sells it. */
function describe(product: Product): string {
  const parts = [PRODUCT_KIND[product.kind].one];
  parts.push(
    product.offerCount > 0
      ? `sold by ${pluralize(product.offerCount, "offer")}`
      : "not for sale yet",
  );
  if (product.memberCount > 0) {
    parts.push(`${pluralize(product.memberCount, "person", "people")} can open it`);
  }
  if (product.kind === "download") {
    parts.push(product.fileCount > 0 ? pluralize(product.fileCount, "file") : "no files yet");
  }
  return parts.join(" · ");
}

/* ── The files inside a download ───────────────────────────────────────── */

type Confirm = (options: {
  title: string;
  description?: string;
  confirmLabel?: string;
  destructive?: boolean;
}) => Promise<boolean>;

function FilesModal({
  product,
  onClose,
  onChanged,
  confirm,
}: {
  product: Product | null;
  onClose: () => void;
  onChanged: () => void;
  confirm: Confirm;
}) {
  const [files, setFiles] = useState<ProductFile[] | null>(null);
  const productId = product?.id ?? null;

  const load = useCallback(() => {
    if (productId === null) return;
    adminCommerceApi
      .fileList(productId)
      .then(setFiles)
      .catch(() => setFiles([]));
  }, [productId]);

  useEffect(() => {
    if (productId === null) {
      setFiles(null);
      return;
    }
    load();
  }, [productId, load]);

  async function attach(asset: MediaAsset) {
    if (productId === null) return;
    try {
      await adminCommerceApi.fileAdd(productId, {
        mediaId: asset.id,
        title: asset.title || asset.originalName,
        description: "",
        // What the delivery route reads to find the file on disk. It is never
        // handed to a browser — each download is a fresh, expiring link. It has
        // to be the stored reference ("protected:abc.pdf"), not the bare key:
        // the prefix is what names the storage root, and the server refuses a
        // file that does not carry it.
        storagePath: asset.url,
        filename: asset.originalName,
        mime: asset.mime,
        // The column is a BIGINT, so it arrives as text however the type here
        // is written, and the server's schema only accepts a number.
        sizeBytes: Number(asset.sizeBytes),
        sort: files?.length ?? 0,
      });
      load();
      onChanged();
    } catch (err) {
      toast.error(commerceMessage(err, "file"));
    }
  }

  async function rename(file: ProductFile, title: string) {
    if (productId === null || title.trim() === file.title) return;
    try {
      await adminCommerceApi.fileUpdate(productId, file.id, { title: title.trim() });
      load();
    } catch (err) {
      toast.error(commerceMessage(err, "file"));
    }
  }

  async function remove(file: ProductFile) {
    if (productId === null) return;
    const ok = await confirm({
      title: `Take “${file.title || file.filename}” out of this?`,
      description:
        "Anyone who bought it stops being able to download it. The file itself stays in your media library.",
      confirmLabel: "Yes, take it out",
      destructive: true,
    });
    if (!ok) return;
    try {
      await adminCommerceApi.fileRemove(productId, file.id);
      toast.success("Taken out.");
      load();
      onChanged();
    } catch (err) {
      toast.error(commerceMessage(err, "file"));
    }
  }

  return (
    <Modal
      open={product !== null}
      onOpenChange={(open) => !open && onClose()}
      title={product ? `Files in “${product.title}”` : "Files"}
      description="Everyone who buys this gets these, and nobody else can reach them."
      size="lg"
      footer={
        <Button variant="secondary" size="sm" onClick={onClose}>
          Done
        </Button>
      }
    >
      <div className="space-y-5">
        <UploadDropzone compact visibility="protected" onUploaded={(asset) => void attach(asset)} />

        {files === null ? (
          <Skeleton className="h-24 w-full" />
        ) : files.length === 0 ? (
          <p className="rounded-xl border border-dashed border-hairline px-4 py-6 text-center text-sm text-ink-soft">
            Nothing in here yet. Drop the files in above and they're delivered the moment somebody
            buys.
          </p>
        ) : (
          <ul className="space-y-2">
            {files.map((file) => (
              <li
                key={file.id}
                className="flex flex-wrap items-center gap-3 rounded-xl border border-hairline bg-raise px-3 py-2.5"
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-lilac-tint text-plum">
                  <FileText className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <Input
                    defaultValue={file.title || file.filename}
                    onBlur={(e) => void rename(file, e.target.value)}
                    aria-label={`What to call ${file.filename}`}
                    className="h-9 text-sm"
                  />
                  <p className="mt-1 truncate text-xs text-ink-soft">
                    {file.filename} · {formatBytes(Number(file.sizeBytes))}
                    {file.downloadCount > 0
                      ? ` · downloaded ${pluralize(file.downloadCount, "time")}`
                      : ""}
                  </p>
                </div>
                <Button
                  variant="dangerGhost"
                  size="iconSm"
                  aria-label={`Take ${file.filename} out`}
                  onClick={() => void remove(file)}
                >
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}

/* ── What goes inside a bundle ─────────────────────────────────────────── */

function BundleModal({
  product,
  catalogue,
  onClose,
  onChanged,
}: {
  product: Product | null;
  catalogue: Product[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [chosen, setChosen] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);
  const productId = product?.id ?? null;

  useEffect(() => {
    // Cleared first: opening a second bundle before its contents arrive used to
    // show the previous one's ticks, and saving then wrote those into it.
    setChosen([]);
    if (productId === null) return;
    adminCommerceApi
      .productGet(productId)
      .then((detail) => setChosen(detail.bundleItems.map((item) => item.productId)))
      .catch(() => setChosen([]));
  }, [productId]);

  // A bundle inside a bundle is paid for and never delivered, so the ones on
  // offer here are everything that isn't itself a bundle.
  const available = catalogue.filter(
    (candidate) => candidate.kind !== "bundle" && candidate.status !== "archived",
  );

  function toggle(id: number) {
    setChosen((current) =>
      current.includes(id) ? current.filter((chosenId) => chosenId !== id) : [...current, id],
    );
  }

  async function save() {
    if (productId === null) return;
    setSaving(true);
    try {
      await adminCommerceApi.bundleSave(
        productId,
        chosen.map((id, index) => ({ productId: id, sort: index })),
      );
      toast.success("Saved what's inside.");
      onChanged();
      onClose();
    } catch (err) {
      toast.error(commerceMessage(err, "bundle"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={product !== null}
      onOpenChange={(open) => !open && onClose()}
      title={product ? `What's inside “${product.title}”` : "What's inside"}
      description="Everything you tick is handed over together when somebody buys this bundle."
      size="lg"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={() => void save()} disabled={saving}>
            {saving ? "Saving…" : "Save what's inside"}
          </Button>
        </>
      }
    >
      {available.length === 0 ? (
        <EmptyState
          icon={<Tag />}
          title="Nothing to put in it yet"
          description="Add a course, a pack of files or a community to your catalogue first, then come back and tick them here."
        />
      ) : (
        <ul className="space-y-2">
          {available.map((candidate) => {
            const ticked = chosen.includes(candidate.id);
            return (
              <li key={candidate.id}>
                <label
                  className={cn(
                    "flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 transition-colors",
                    ticked ? "border-gold/50 bg-gold/[0.08]" : "border-hairline hover:border-ink-soft/35",
                  )}
                >
                  <input
                    type="checkbox"
                    checked={ticked}
                    onChange={() => toggle(candidate.id)}
                    className="size-4 rounded border-hairline text-plum focus-visible:ring-plum/30"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-ink">
                      {candidate.title}
                    </span>
                    <span className="block text-xs text-ink-soft">
                      {PRODUCT_KIND[candidate.kind].one}
                    </span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
}
