import { useNewProductRequest } from "./ui/useNewProductRequest";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { motion } from "motion/react";
import { GraduationCap, Image as ImageIcon, Layers, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { adminApi } from "@/lib/api";
import type { Course } from "@/types";
import { formatCurrency } from "@/lib/format";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNotice,
  Field,
  Input,
  PageHeader,
  Skeleton,
  Textarea,
} from "@/pages/admin/ui/primitives";
import { Modal, useConfirm } from "@/pages/admin/ui/Dialog";
import { PicturePickerModal } from "@/pages/admin/CrudManager";
import { PUBLISH_LABEL, friendlyError, slugify, uniqueKey } from "@/pages/admin/ui/friendly";

const EMPTY: Partial<Course> = {
  title: "",
  // Generated from the title on save — she never sees or types it.
  slug: "",
  subtitle: "",
  description: "",
  priceText: "",
  image: "",
  url: "/apply",
  features: [],
  sort: 0,
  published: true,
};

/** "$" for dollars, "£" for pounds — whatever the course is priced in. */
function currencySymbol(currency: string | undefined): string {
  try {
    return (
      new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: (currency || "usd").toUpperCase(),
      })
        .formatToParts(0)
        .find((part) => part.type === "currency")?.value ?? "$"
    );
  } catch {
    // An unknown three-letter code would otherwise throw and blank the form.
    return "$";
  }
}

/** Stored pennies → what she typed: 49700 → "497", 49750 → "497.50". */
function priceToInput(cents: number | null | undefined): string {
  if (!cents) return "";
  return (cents / 100).toFixed(2).replace(/\.00$/, "");
}

/**
 * What she typed → pennies, or a correction to show under the box.
 *
 * She thinks in "497", the payment provider needs 49700, and nobody should ever
 * have to know that. Blank means the course simply isn't for sale yet, which is
 * a real answer rather than a mistake.
 */
function parsePrice(raw: string): { cents: number | null; error?: string } {
  const cleaned = raw.replace(/[^0-9.]/g, "").trim();
  if (!cleaned) return { cents: null };
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value < 0) {
    return { cents: null, error: "Type a number, like 497." };
  }
  return { cents: Math.round(value * 100) };
}

export default function CoursesAdmin() {
  const [courses, setCourses] = useState<Course[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Partial<Course> | null>(null);
  const [featuresInput, setFeaturesInput] = useState("");
  const [priceInput, setPriceInput] = useState("");
  const [priceError, setPriceError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirm, confirmDialog] = useConfirm();

  const load = useCallback(() => {
    adminApi
      .coursesList()
      .then((list) => {
        setCourses(list);
        setError(null);
      })
      .catch(() => setError("We couldn't load your courses. Try refreshing the page."));
  }, []);

  useEffect(load, [load]);
  useNewProductRequest(startNew);

  function startNew() {
    setEditing({ ...EMPTY });
    setFeaturesInput("");
    setPriceInput("");
    setPriceError(null);
  }

  function startEdit(course: Course) {
    setEditing(course);
    setFeaturesInput((course.features ?? []).join("\n"));
    setPriceInput(priceToInput(course.priceCents));
    setPriceError(null);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!editing?.title?.trim()) return;

    const price = parsePrice(priceInput);
    if (price.error) {
      setPriceError(price.error);
      return;
    }
    setPriceError(null);
    setSaving(true);

    const payload: Partial<Course> = {
      ...editing,
      priceCents: price.cents,
      features: featuresInput
        .split("\n")
        .map((f) => f.trim())
        .filter(Boolean),
    };

    try {
      if (editing.id) {
        await adminApi.courseUpdate(String(editing.id), payload);
      } else {
        // Only a brand-new course gets an identifier: changing an existing
        // one would break the checkout links and course pages already pointing
        // at it. Existing ones are collected so two courses can't collide.
        const taken = (courses ?? []).map((c) => c.slug);
        const base = slugify(editing.title ?? "") || "course";
        await adminApi.courseCreate({ ...payload, slug: uniqueKey(base, taken, "-") });
      }
      toast.success(editing.id ? "Course saved" : "Course added");
      setEditing(null);
      load();
    } catch (err) {
      toast.error(friendlyError(err, "course"));
    } finally {
      setSaving(false);
    }
  }

  async function remove(course: Course) {
    const ok = await confirm({
      title: `Delete “${course.title}”?`,
      description:
        "Its sections, lessons and everyone enrolled on it go with it. You can't undo this.",
      confirmLabel: "Yes, delete it",
      destructive: true,
    });
    if (!ok) return;
    try {
      await adminApi.courseDelete(String(course.id));
      toast.success("Course deleted");
      load();
    } catch (err) {
      toast.error(friendlyError(err, "course"));
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Products"
        title="Courses"
        description="Everything you teach. Open a course to add its sections, lessons and videos."
        actions={
          <Button size="sm" onClick={startNew}>
            <Plus />
            Add a course
          </Button>
        }
      />

      {error && <ErrorNotice message={error} />}

      {courses === null ? (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-64 w-full" />
          ))}
        </div>
      ) : courses.length === 0 ? (
        <Card>
          <EmptyState
            icon={<GraduationCap />}
            title="No courses yet"
            description="Add your first course, then fill it with sections and lessons."
            action={
              <Button size="sm" onClick={startNew}>
                Add a course
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
          {courses.map((course, i) => (
            <motion.div
              key={course.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i * 0.05, 0.3) }}
            >
              <Card className="group flex h-full flex-col overflow-hidden transition-all hover:-translate-y-0.5 hover:border-plum/30 hover:shadow-[0_20px_44px_-22px_rgba(15,30,58,0.4)]">
                <div className="relative h-32 overflow-hidden bg-surface-raised">
                  {course.image && (
                    <img
                      src={course.image}
                      alt=""
                      loading="lazy"
                      className="size-full object-cover transition-transform duration-150 group-hover:scale-[1.04]"
                    />
                  )}
                  <div className="absolute left-3 top-3 flex gap-1.5">
                    {!course.published && (
                      <Badge tone="slate" className="!bg-night-deep/80 !text-white ring-1 ring-white/15 backdrop-blur">
                        {PUBLISH_LABEL.draft}
                      </Badge>
                    )}
                    {(course.stripePriceId || (course.priceCents ?? 0) > 0) && (
                      <Badge tone="green" className="!bg-night-deep/80 !text-white ring-1 ring-white/15 backdrop-blur">
                        On sale
                      </Badge>
                    )}
                  </div>
                </div>

                <div className="flex flex-1 flex-col p-5">
                  <h3 className="font-display text-lg leading-snug text-ink">{course.title}</h3>
                  {course.subtitle && (
                    <p className="mt-1 line-clamp-2 text-sm text-ink-soft">{course.subtitle}</p>
                  )}

                  <p className="mt-3 font-display text-lg text-plum">
                    {course.priceCents
                      ? formatCurrency(course.priceCents, course.currency)
                      : course.priceText || "No price set"}
                  </p>

                  <div className="mt-auto flex gap-2 pt-4">
                    <Button asChild size="sm" className="flex-1">
                      <Link to={`/admin/courses/${course.id}/curriculum`}>
                        <Layers />
                        Course content
                      </Link>
                    </Button>
                    <Button
                      variant="secondary"
                      size="iconSm"
                      aria-label={`Edit ${course.title}`}
                      onClick={() => startEdit(course)}
                    >
                      <Pencil />
                    </Button>
                    <Button
                      variant="dangerGhost"
                      size="iconSm"
                      aria-label={`Delete ${course.title}`}
                      onClick={() => remove(course)}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </div>
              </Card>
            </motion.div>
          ))}
        </div>
      )}

      <Modal
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        title={editing?.id ? "Edit this course" : "Add a course"}
        size="lg"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button size="sm" type="submit" form="course-form" disabled={saving}>
              {saving ? "Saving…" : "Save course"}
            </Button>
          </>
        }
      >
        {editing && (
          <form id="course-form" onSubmit={save} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Course name" className="sm:col-span-2">
              <Input
                value={editing.title ?? ""}
                onChange={(e) => setEditing((c) => ({ ...c, title: e.target.value }))}
                placeholder="The Full Practice Reset"
                required
                autoFocus
              />
            </Field>
            <Field label="One-line summary" className="sm:col-span-2">
              <Input
                value={editing.subtitle ?? ""}
                onChange={(e) => setEditing((c) => ({ ...c, subtitle: e.target.value }))}
                placeholder="Six weeks to a practice that pays you properly"
              />
            </Field>
            <Field label="Description" className="sm:col-span-2">
              <Textarea
                rows={3}
                value={editing.description ?? ""}
                onChange={(e) => setEditing((c) => ({ ...c, description: e.target.value }))}
                placeholder="Who it's for and what changes by the end."
              />
            </Field>

            <Field
              label="Price"
              hint="leave blank if it isn't for sale yet"
              error={priceError ?? undefined}
            >
              <div className="relative">
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-semibold text-ink-soft"
                >
                  {currencySymbol(editing.currency)}
                </span>
                <Input
                  className="pl-8"
                  inputMode="decimal"
                  value={priceInput}
                  onChange={(e) => {
                    setPriceInput(e.target.value);
                    if (priceError) setPriceError(null);
                  }}
                  placeholder="497"
                />
              </div>
            </Field>
            <Field
              label="Price shown on the page"
              hint="e.g. “From $497” — leave blank to just show the price"
            >
              <Input
                value={editing.priceText ?? ""}
                onChange={(e) => setEditing((c) => ({ ...c, priceText: e.target.value }))}
                placeholder="From $497"
              />
            </Field>

            <Field label="Cover image" className="sm:col-span-2">
              {editing.image ? (
                <div className="flex flex-wrap items-center gap-3 rounded-xl border border-hairline bg-white/[0.03] p-2.5">
                  <img src={editing.image} alt="" className="h-16 w-24 shrink-0 rounded-lg object-cover" />
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="secondary" size="sm" onClick={() => setPicking(true)}>
                      Choose a different one
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setEditing((c) => ({ ...c, image: "" }))}
                    >
                      Remove it
                    </Button>
                  </div>
                </div>
              ) : (
                <Button type="button" variant="secondary" size="sm" onClick={() => setPicking(true)}>
                  <ImageIcon />
                  Choose a cover image
                </Button>
              )}
            </Field>

            <Field label="What's included" hint="one thing per line" className="sm:col-span-2">
              <Textarea
                rows={4}
                value={featuresInput}
                onChange={(e) => setFeaturesInput(e.target.value)}
                placeholder={"Six live sessions\nThe full workbook\nLifetime access"}
              />
            </Field>

            <Field label="Order" hint="lower numbers show first">
              <Input
                type="number"
                value={editing.sort ?? 0}
                onChange={(e) => setEditing((c) => ({ ...c, sort: Number(e.target.value) || 0 }))}
              />
            </Field>
            <div className="flex flex-col justify-end">
              <label className="flex cursor-pointer items-center gap-2.5 text-sm font-medium text-ink">
                <input
                  type="checkbox"
                  checked={Boolean(editing.published)}
                  onChange={(e) => setEditing((c) => ({ ...c, published: e.target.checked }))}
                  className="size-4 rounded border-hairline text-plum focus-visible:ring-plum/30"
                />
                Live on your site
              </label>
              <p className="mt-1.5 text-xs text-ink-soft">
                {editing.published
                  ? "Anyone can see this course on your site."
                  : "Nobody can see this course yet."}
              </p>
            </div>
          </form>
        )}
      </Modal>

      <PicturePickerModal
        open={picking}
        onOpenChange={setPicking}
        onSelect={(asset) => {
          setEditing((c) => (c ? { ...c, image: asset.url } : c));
          setPicking(false);
        }}
      />

      {confirmDialog}
    </div>
  );
}
